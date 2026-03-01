/// Theorem LAN Sync — Tauri Command Wrappers
///
/// Bridges the Rust sync server with the Tauri frontend via IPC commands.
use crate::sync_crypto::{self, DeviceIdentity};
use crate::sync_protocol::*;
use crate::sync_server::{
    self, EventEmitter, PendingPairing, SyncDataSnapshot, SyncServerHandle, SyncServerState,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// Global sync state managed by Tauri.
pub struct SyncAppState {
    pub server_state: Arc<SyncServerState>,
    pub server_handle: Arc<Mutex<Option<SyncServerHandle>>>,
}

/// Initialize the sync subsystem. Call this once during app startup.
/// Accepts an AppHandle to create the event emitter for responder-side notifications.
pub fn init_sync(
    app_data_dir: PathBuf,
    device_name: String,
    app_handle: tauri::AppHandle,
) -> Result<SyncAppState, String> {
    let identity = DeviceIdentity::load_or_create(&app_data_dir)?;

    let paired_devices = sync_server::load_paired_devices(&app_data_dir);

    // Create a type-erased event emitter that captures the AppHandle.
    // This lets the sync server (which cannot be generic over AppHandle<R>)
    // emit Tauri events to the frontend.
    let emitter: EventEmitter = {
        let handle = app_handle.clone();
        Arc::new(move |event_name: &str, payload_json: &str| {
            if let Err(e) = handle.emit(event_name, payload_json.to_string()) {
                eprintln!(
                    "[theorem-sync] Failed to emit event '{}': {}",
                    event_name, e
                );
            }
        })
    };

    let server_state = Arc::new(SyncServerState {
        identity,
        device_name,
        paired_devices: Mutex::new(paired_devices),
        app_data_dir,
        pending_pairing: Mutex::new(None),
        sync_data: Mutex::new(None),
        event_emitter: Some(emitter),
    });

    Ok(SyncAppState {
        server_state,
        server_handle: Arc::new(Mutex::new(None)),
    })
}

// ─── Tauri Commands ───

/// Start the sync server and return its address info.
#[tauri::command]
pub async fn start_sync_server(app: tauri::AppHandle) -> Result<SyncServerInfo, String> {
    let sync_state = app.state::<SyncAppState>();
    let mut handle_guard = sync_state.server_handle.lock().await;

    if let Some(ref handle) = *handle_guard {
        // Server already running — return current address.
        let ip = sync_server::get_local_ip()?;
        return Ok(SyncServerInfo {
            ip,
            port: handle.addr.port(),
            running: true,
        });
    }

    let handle = sync_server::start_server(sync_state.server_state.clone()).await?;
    let ip = sync_server::get_local_ip()?;
    let port = handle.addr.port();

    *handle_guard = Some(handle);

    Ok(SyncServerInfo {
        ip,
        port,
        running: true,
    })
}

/// Stop the sync server.
#[tauri::command]
pub async fn stop_sync_server(app: tauri::AppHandle) -> Result<(), String> {
    let sync_state = app.state::<SyncAppState>();
    let mut handle_guard = sync_state.server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.shutdown_notify.notify_one();
    }

    Ok(())
}

/// Generate a QR code for pairing. Starts the server if not already running.
#[tauri::command]
pub async fn generate_pairing_qr(app: tauri::AppHandle) -> Result<PairingQrData, String> {
    // Ensure server is running.
    let server_info = start_sync_server(app.clone()).await?;

    let sync_state = app.state::<SyncAppState>();

    // Generate ephemeral keypair for this pairing session.
    // We use a StaticSecret here so we can store the bytes for later use.
    let secret = x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng);
    let public = x25519_dalek::PublicKey::from(&secret);

    let nonce = sync_crypto::generate_nonce();

    // Build QR payload.
    let qr_payload = PairingQrPayload {
        version: 1,
        ip: server_info.ip.clone(),
        port: server_info.port,
        ephemeral_public_key: hex::encode(public.as_bytes()),
        device_id: sync_state.server_state.identity.device_id.clone(),
        device_name: sync_state.server_state.device_name.clone(),
        nonce: hex::encode(nonce),
    };

    let payload_json = serde_json::to_string(&qr_payload)
        .map_err(|e| format!("Failed to serialize QR payload: {e}"))?;

    // Generate QR SVG.
    let qr_svg = sync_crypto::generate_qr_svg(&payload_json)?;

    // Store the pending pairing session.
    {
        let mut pending = sync_state.server_state.pending_pairing.lock().await;
        *pending = Some(PendingPairing {
            host_secret_bytes: secret.to_bytes(),
            nonce,
            created_at: std::time::Instant::now(),
        });
    }

    Ok(PairingQrData {
        qr_svg,
        pairing_code: payload_json,
    })
}

/// Submit a pairing code (from QR scan or manual entry) to connect to a peer.
/// This device acts as the "scanner" — it connects to the host's server.
#[tauri::command]
pub async fn submit_pairing_code(
    app: tauri::AppHandle,
    pairing_code: String,
) -> Result<PairedDeviceInfo, String> {
    // Parse the pairing payload.
    let qr_payload: PairingQrPayload =
        serde_json::from_str(&pairing_code).map_err(|e| format!("Invalid pairing code: {e}"))?;

    if qr_payload.version != 1 {
        return Err(format!(
            "Unsupported pairing protocol version: {}",
            qr_payload.version
        ));
    }

    let sync_state = app.state::<SyncAppState>();

    // Decode host's ephemeral public key and nonce.
    let host_public_bytes: [u8; 32] = hex::decode(&qr_payload.ephemeral_public_key)
        .map_err(|e| format!("Invalid host public key: {e}"))?
        .try_into()
        .map_err(|_| "Host public key must be 32 bytes".to_string())?;

    let nonce_bytes: [u8; 32] = hex::decode(&qr_payload.nonce)
        .map_err(|e| format!("Invalid nonce: {e}"))?
        .try_into()
        .map_err(|_| "Nonce must be 32 bytes".to_string())?;

    // Generate a fresh ephemeral keypair for forward secrecy.
    // The ephemeral secret is consumed by diffie_hellman() and never stored.
    let (ephemeral_secret, ephemeral_public) = sync_crypto::generate_ephemeral_keypair();
    let ephemeral_public_bytes = ephemeral_public.as_bytes().to_owned();

    // Perform ECDH key exchange using the ephemeral secret (not the long-term identity key).
    let host_public = x25519_dalek::PublicKey::from(host_public_bytes);
    let shared_secret_obj = ephemeral_secret.diffie_hellman(&host_public);
    let shared_secret: [u8; 32] = *shared_secret_obj.as_bytes();

    // Derive symmetric key.
    let symmetric_key =
        sync_crypto::derive_symmetric_key(&shared_secret, &nonce_bytes, b"theorem-sync-v1")?;

    // Create encrypted proof.
    let proof = sync_crypto::encrypt_payload(&symmetric_key, b"THEOREM_PAIR_V1")?;
    let proof_json =
        serde_json::to_string(&proof).map_err(|e| format!("Failed to serialize proof: {e}"))?;

    // Build pairing request — send the ephemeral public key (not the identity key).
    let pairing_request = PairingRequest {
        ephemeral_public_key: hex::encode(ephemeral_public_bytes),
        device_id: sync_state.server_state.identity.device_id.clone(),
        device_name: sync_state.server_state.device_name.clone(),
        encrypted_proof: BASE64.encode(proof_json.as_bytes()),
    };

    // Send pairing request to host.
    let url = format!("http://{}:{}/pair", qr_payload.ip, qr_payload.port);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&pairing_request)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to peer: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Pairing refused by peer ({}): {}", status, body));
    }

    let pairing_response: PairingResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid pairing response: {e}"))?;

    // Save the paired device.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let paired_device = PairedDevice {
        device_id: pairing_response.device_id.clone(),
        device_name: pairing_response.device_name.clone(),
        symmetric_key_b64: BASE64.encode(symmetric_key),
        last_ip: qr_payload.ip.clone(),
        last_port: qr_payload.port,
        paired_at: format!("{}Z", now), // Simplified ISO
        last_sync_at: None,
    };

    let paired_info = PairedDeviceInfo::from(&paired_device);

    // Persist.
    {
        let mut devices = sync_state.server_state.paired_devices.lock().await;
        devices.insert(paired_device.device_id.clone(), paired_device);
        sync_server::save_paired_devices(&sync_state.server_state.app_data_dir, &devices)?;
    }

    Ok(paired_info)
}

/// Get this device's identity info.
#[tauri::command]
pub async fn get_device_identity(app: tauri::AppHandle) -> Result<DeviceIdentityInfo, String> {
    let sync_state = app.state::<SyncAppState>();
    Ok(DeviceIdentityInfo {
        device_id: sync_state.server_state.identity.device_id.clone(),
        device_name: sync_state.server_state.device_name.clone(),
        public_key_hex: hex::encode(sync_state.server_state.identity.public_key_bytes()),
    })
}

/// Get the list of paired devices.
#[tauri::command]
pub async fn get_paired_devices(app: tauri::AppHandle) -> Result<Vec<PairedDeviceInfo>, String> {
    let sync_state = app.state::<SyncAppState>();
    let devices = sync_state.server_state.paired_devices.lock().await;
    Ok(devices.values().map(PairedDeviceInfo::from).collect())
}

/// Remove a paired device.
#[tauri::command]
pub async fn unpair_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let sync_state = app.state::<SyncAppState>();
    let mut devices = sync_state.server_state.paired_devices.lock().await;

    if devices.remove(&device_id).is_none() {
        return Err(format!("Device {} not found", device_id));
    }

    sync_server::save_paired_devices(&sync_state.server_state.app_data_dir, &devices)?;
    Ok(())
}

/// Provide sync data snapshot from the frontend stores.
/// Must be called before initiating a sync so the server has data to serve.
#[tauri::command]
pub async fn set_sync_data(
    app: tauri::AppHandle,
    domains_json: String,
    manifest_json: String,
) -> Result<(), String> {
    let sync_state = app.state::<SyncAppState>();

    let domains: HashMap<String, String> =
        serde_json::from_str(&domains_json).map_err(|e| format!("Invalid domains JSON: {e}"))?;

    let manifest: HashMap<String, DomainVersion> =
        serde_json::from_str(&manifest_json).map_err(|e| format!("Invalid manifest JSON: {e}"))?;

    let mut sync_data = sync_state.server_state.sync_data.lock().await;
    *sync_data = Some(SyncDataSnapshot { domains, manifest });

    Ok(())
}

/// Retrieve any incoming data pushed by a peer during responder-mode sync.
/// Returns a JSON map of `"incoming_{domain}" -> data_json`.
/// Clears the incoming data after reading.
#[tauri::command]
pub async fn get_incoming_sync_data(app: tauri::AppHandle) -> Result<String, String> {
    let sync_state = app.state::<SyncAppState>();
    let mut sync_data = sync_state.server_state.sync_data.lock().await;

    let mut incoming: HashMap<String, String> = HashMap::new();

    if let Some(data) = sync_data.as_mut() {
        // Collect all incoming_ prefixed domains
        let incoming_keys: Vec<String> = data
            .domains
            .keys()
            .filter(|k| k.starts_with("incoming_"))
            .cloned()
            .collect();

        for key in &incoming_keys {
            if let Some(val) = data.domains.remove(key) {
                // Strip "incoming_" prefix
                let domain = key.strip_prefix("incoming_").unwrap_or(key);
                incoming.insert(domain.to_string(), val);
            }
        }
    }

    serde_json::to_string(&incoming).map_err(|e| format!("Serialize incoming data failed: {e}"))
}

/// Update a paired device's last-known IP and port.
/// Called after a successful pairing or when discovering a peer on the network.
#[tauri::command]
pub async fn update_peer_address(
    app: tauri::AppHandle,
    device_id: String,
    ip: String,
    port: u16,
) -> Result<(), String> {
    let sync_state = app.state::<SyncAppState>();
    let mut devices = sync_state.server_state.paired_devices.lock().await;

    if let Some(device) = devices.get_mut(&device_id) {
        device.last_ip = ip;
        device.last_port = port;
        sync_server::save_paired_devices(&sync_state.server_state.app_data_dir, &devices)?;
        Ok(())
    } else {
        Err(format!("Device {} not paired", device_id))
    }
}

// ─── Sync Orchestrator (Client side) ───

fn encrypt_request<T: serde::Serialize>(
    my_device_id: &str,
    sym_key: &[u8; 32],
    data: &T,
) -> Result<AuthenticatedRequest, String> {
    let json = serde_json::to_vec(data).map_err(|e| format!("Serialize failed: {}", e))?;
    let payload = sync_crypto::encrypt_payload(sym_key, &json)
        .map_err(|e| format!("Encrypt failed: {}", e))?;
    Ok(AuthenticatedRequest {
        device_id: my_device_id.to_string(),
        payload,
    })
}

async fn decrypt_response<T: serde::de::DeserializeOwned>(
    sym_key: &[u8; 32],
    payload: &crate::sync_crypto::EncryptedPayload,
) -> Result<T, String> {
    let decrypted = sync_crypto::decrypt_payload(sym_key, payload)
        .map_err(|e| format!("Decrypt failed: {}", e))?;
    let obj = serde_json::from_slice(&decrypted).map_err(|e| format!("Parse failed: {}", e))?;
    Ok(obj)
}

/// Orchestrates a sync session with a paired peer, retrieving necessary domain updates.
/// Returns a JSON string of a map `Domain Name -> JSON Domain Data` which the frontend will merge.
#[tauri::command]
pub async fn initiate_sync(
    app: tauri::AppHandle,
    peer_device_id: String,
) -> Result<String, String> {
    let sync_state = app.state::<SyncAppState>();

    // 1. Get paired device details
    let devices = sync_state.server_state.paired_devices.lock().await;
    let mut peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let ip = &peer.last_ip;
    let port = peer.last_port;
    if ip.is_empty() || port == 0 {
        return Err("Peer IP/port unknown. Scan their QR code again.".to_string());
    }

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = &sync_state.server_state.identity.device_id;

    // 2. Get local manifest
    let sync_data_guard = sync_state.server_state.sync_data.lock().await;
    let local_manifest = match sync_data_guard.as_ref() {
        Some(data) => SyncManifest {
            device_id: my_device_id.clone(),
            last_sync_at: peer.last_sync_at.clone(),
            domains: data.manifest.clone(),
        },
        None => return Err("Sync data not set by frontend yet".to_string()),
    };
    drop(sync_data_guard);

    let client = reqwest::Client::new();
    let base_url = format!("http://{ip}:{port}/sync");

    // 3. POST /manifest
    let req_manifest = encrypt_request(my_device_id, &sym_key, &local_manifest)?;
    let res = client
        .post(&format!("{base_url}/manifest"))
        .json(&req_manifest)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Manifest request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Manifest rejected: {}", res.status()));
    }

    let enc_res: crate::sync_crypto::EncryptedPayload = res
        .json()
        .await
        .map_err(|e| format!("Manifest response parse fail: {e}"))?;

    let plan: SyncPlan = decrypt_response(&sym_key, &enc_res).await?;

    let mut incoming_domains: HashMap<String, String> = HashMap::new();

    // 4. Process Plan — collect domains to push and pull, then do batched transfers.
    let mut push_domains: HashMap<String, String> = HashMap::new();
    let mut pull_domain_names: Vec<String> = Vec::new();

    for action in &plan.actions {
        match action.direction {
            SyncDirection::Skip => {}
            SyncDirection::Push => {
                // Only push, no pull needed
                let data_guard = sync_state.server_state.sync_data.lock().await;
                let data_json = data_guard
                    .as_ref()
                    .and_then(|d| d.domains.get(&action.domain).cloned())
                    .unwrap_or_else(|| "[]".to_string());
                drop(data_guard);
                push_domains.insert(action.domain.clone(), data_json);
            }
            SyncDirection::Merge => {
                // Push our data and also pull theirs
                let data_guard = sync_state.server_state.sync_data.lock().await;
                let data_json = data_guard
                    .as_ref()
                    .and_then(|d| d.domains.get(&action.domain).cloned())
                    .unwrap_or_else(|| "[]".to_string());
                drop(data_guard);
                push_domains.insert(action.domain.clone(), data_json);
                pull_domain_names.push(action.domain.clone());
            }
            SyncDirection::Pull => {
                pull_domain_names.push(action.domain.clone());
            }
        }
    }

    // 4a. Batched push (single request for all push domains)
    if !push_domains.is_empty() {
        let batch_payload = crate::sync_protocol::BatchedDomainPayload {
            sender_device_id: my_device_id.clone(),
            domains: push_domains,
        };
        let req_payload = encrypt_request(my_device_id, &sym_key, &batch_payload)?;

        let res = client
            .post(&format!("{base_url}/push-batch"))
            .json(&req_payload)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Batched push failed: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Batched push rejected: {}", res.status()));
        }
    }

    // 4b. Batched pull (single request for all pull domains)
    if !pull_domain_names.is_empty() {
        let pull_req = crate::sync_protocol::BatchedPullRequest {
            domains: pull_domain_names,
        };
        let req_payload = encrypt_request(my_device_id, &sym_key, &pull_req)?;

        let res = client
            .post(&format!("{base_url}/pull-batch"))
            .json(&req_payload)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Batched pull failed: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Batched pull rejected: {}", res.status()));
        }

        let enc_res: crate::sync_crypto::EncryptedPayload = res
            .json()
            .await
            .map_err(|e| format!("Batched pull response parse fail: {e}"))?;

        let pulled: crate::sync_protocol::BatchedPullResponse =
            decrypt_response(&sym_key, &enc_res).await?;

        for (domain, data_json) in pulled.domains {
            incoming_domains.insert(domain, data_json);
        }
    }

    // 5. Complete sync and update timestamp
    let now = sync_crypto::now_iso8601();
    let complete_msg = SyncCompleteMessage {
        device_id: my_device_id.clone(),
        sync_timestamp: now.clone(),
    };

    let complete_req = encrypt_request(my_device_id, &sym_key, &complete_msg)?;
    let _ = client
        .post(&format!("{base_url}/complete"))
        .json(&complete_req)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await; // we don't strictly care if they acknowledge complete

    peer.last_sync_at = Some(now);

    // Save updated peer
    {
        let mut devices = sync_state.server_state.paired_devices.lock().await;
        devices.insert(peer.device_id.clone(), peer);
        if let Err(e) = crate::sync_server::save_paired_devices(
            &sync_state.server_state.app_data_dir,
            &devices,
        ) {
            eprintln!("[sync] Failed to persist paired devices after sync: {e}");
        }
    }

    // Convert map to JSON string to pass back over IPC easily
    serde_json::to_string(&incoming_domains)
        .map_err(|e| format!("Failed to encode incoming domains: {}", e))
}

// ─── File Transfer ───

/// Subdirectory under app_data_dir where materialized book files are stored.
const BOOK_CACHE_DIR: &str = "book-cache";

/// Result of a file transfer operation, returned to the frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct FileTransferResult {
    /// Book IDs that were successfully transferred and saved.
    pub transferred: Vec<String>,
    /// Book IDs that failed, with error messages.
    pub failed: Vec<FileTransferError>,
    /// Book IDs that the peer did not have files for.
    pub unavailable: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct FileTransferError {
    pub book_id: String,
    pub error: String,
}

/// Pull book files from a paired peer device.
///
/// 1. Queries file availability for the given book IDs.
/// 2. For each available book: pulls the encrypted file, decrypts chunks,
///    verifies SHA-256 integrity, and saves to local `book-cache/`.
/// 3. Emits `sync-file-progress` events for frontend progress tracking.
/// 4. Returns which books succeeded, failed, or were unavailable.
#[tauri::command]
pub async fn pull_book_files(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_ids: Vec<String>,
) -> Result<FileTransferResult, String> {
    let sync_state = app.state::<SyncAppState>();

    // Look up peer and derive key.
    let devices = sync_state.server_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let ip = &peer.last_ip;
    let port = peer.last_port;
    if ip.is_empty() || port == 0 {
        return Err("Peer IP/port unknown. Scan their QR code again.".to_string());
    }

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = &sync_state.server_state.identity.device_id;

    let client = reqwest::Client::new();
    let base_url = format!("http://{ip}:{port}/sync");

    // 1. Check file availability.
    let avail_req = FileAvailabilityRequest {
        book_ids: book_ids.clone(),
    };
    let enc_req = encrypt_request(my_device_id, &sym_key, &avail_req)?;
    let res = client
        .post(&format!("{base_url}/file/availability"))
        .json(&enc_req)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("File availability check failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!(
            "File availability check rejected: {}",
            res.status()
        ));
    }

    let enc_res: crate::sync_crypto::EncryptedPayload = res
        .json()
        .await
        .map_err(|e| format!("Availability response parse fail: {e}"))?;

    let availability: FileAvailabilityResponse = decrypt_response(&sym_key, &enc_res).await?;

    // Partition book_ids into available and unavailable.
    let available_set: std::collections::HashSet<&str> = availability
        .available_ids
        .iter()
        .map(|s| s.as_str())
        .collect();
    let unavailable: Vec<String> = book_ids
        .iter()
        .filter(|id| !available_set.contains(id.as_str()))
        .cloned()
        .collect();

    let total_files = availability.available_ids.len();
    let total_bytes: u64 = availability.file_sizes.values().sum();

    // Emit initial progress.
    let _ = app.emit(
        "sync-file-progress",
        serde_json::json!({
            "phase": "starting",
            "total_files": total_files,
            "total_bytes": total_bytes,
            "completed_files": 0,
            "completed_bytes": 0u64,
        })
        .to_string(),
    );

    // Ensure book-cache directory exists.
    let cache_dir = sync_state.server_state.app_data_dir.join(BOOK_CACHE_DIR);
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create book cache dir: {e}"))?;

    let mut transferred: Vec<String> = Vec::new();
    let mut failed: Vec<FileTransferError> = Vec::new();
    let mut completed_bytes: u64 = 0;

    // 2. Pull each available file one at a time.
    for (file_index, book_id) in availability.available_ids.iter().enumerate() {
        let result =
            pull_single_file(&client, &base_url, my_device_id, &sym_key, book_id, &cache_dir)
                .await;

        match result {
            Ok(bytes_written) => {
                completed_bytes += bytes_written;
                transferred.push(book_id.clone());
            }
            Err(e) => {
                failed.push(FileTransferError {
                    book_id: book_id.clone(),
                    error: e,
                });
            }
        }

        // Emit progress after each file.
        let _ = app.emit(
            "sync-file-progress",
            serde_json::json!({
                "phase": "transferring",
                "total_files": total_files,
                "total_bytes": total_bytes,
                "completed_files": file_index + 1,
                "completed_bytes": completed_bytes,
                "current_book_id": book_id,
            })
            .to_string(),
        );
    }

    // Emit completion.
    let _ = app.emit(
        "sync-file-progress",
        serde_json::json!({
            "phase": "complete",
            "total_files": total_files,
            "total_bytes": total_bytes,
            "completed_files": transferred.len(),
            "completed_bytes": completed_bytes,
            "failed_count": failed.len(),
        })
        .to_string(),
    );

    Ok(FileTransferResult {
        transferred,
        failed,
        unavailable,
    })
}

/// Pull a single book file from the peer, decrypt, verify, and save to disk.
/// Returns the number of bytes written on success.
async fn pull_single_file(
    client: &reqwest::Client,
    base_url: &str,
    my_device_id: &str,
    sym_key: &[u8; 32],
    book_id: &str,
    cache_dir: &PathBuf,
) -> Result<u64, String> {
    // Validate book_id before using it in file paths to prevent path traversal.
    if book_id.is_empty()
        || book_id.len() > 256
        || book_id.contains('\0')
        || book_id.contains('/')
        || book_id.contains('\\')
        || book_id.contains("..")
        || !book_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
    {
        return Err(format!("Invalid book ID: {book_id}"));
    }

    let pull_req = FilePullRequest {
        book_id: book_id.to_string(),
    };
    let enc_req = encrypt_request(my_device_id, sym_key, &pull_req)?;

    // Use a longer timeout for file transfers — large files need time.
    let res = client
        .post(&format!("{base_url}/file/pull"))
        .json(&enc_req)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("File pull request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("File pull rejected: {}", res.status()));
    }

    // The file pull response is NOT wrapped in an EncryptedPayload envelope —
    // each chunk is already individually AEAD-encrypted, so we parse directly.
    let pull_response: FilePullResponse = res
        .json()
        .await
        .map_err(|e| format!("File pull response parse fail: {e}"))?;

    if !pull_response.available {
        return Err("File not available on peer".to_string());
    }

    let meta = pull_response
        .meta
        .ok_or("File response missing metadata")?;

    if pull_response.chunks.len() != meta.total_chunks as usize {
        return Err(format!(
            "Chunk count mismatch: expected {} got {}",
            meta.total_chunks,
            pull_response.chunks.len()
        ));
    }

    // Decrypt all chunks and reassemble the file.
    let mut file_data = Vec::with_capacity(meta.total_size as usize);

    for chunk in &pull_response.chunks {
        let decrypted =
            sync_crypto::decrypt_file_chunk(sym_key, &chunk.data_b64).map_err(|e| {
                format!(
                    "Chunk {} decryption failed: {}",
                    chunk.chunk_index, e
                )
            })?;
        file_data.extend_from_slice(&decrypted);
    }

    // Verify SHA-256 integrity.
    let actual_hash = {
        let mut hasher = Sha256::new();
        hasher.update(&file_data);
        hex::encode(hasher.finalize())
    };

    if actual_hash != meta.content_hash {
        return Err(format!(
            "Content hash mismatch: expected {} got {}",
            meta.content_hash, actual_hash
        ));
    }

    // Write to disk at book-cache/<book_id>.book
    let file_path = cache_dir.join(format!("{book_id}.book"));
    let bytes_written = file_data.len() as u64;

    tokio::task::spawn_blocking({
        let file_path = file_path.clone();
        move || std::fs::write(&file_path, &file_data)
    })
    .await
    .map_err(|e| format!("Task join failed: {e}"))?
    .map_err(|e| format!("Failed to write book file: {e}"))?;

    Ok(bytes_written)
}
