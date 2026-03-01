/// Theorem LAN Sync — Tauri Command Wrappers
///
/// Bridges the Rust sync server with the Tauri frontend via IPC commands.
use crate::sync_crypto::{self, DeviceIdentity};
use crate::sync_protocol::*;
use crate::sync_server::{
    self, EventEmitter, PendingPairing, SyncDataSnapshot, SyncServerHandle, SyncServerState,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
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
            nonce_hex: hex::encode(nonce),
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

    // Perform ECDH key exchange.
    let shared_secret = sync_state
        .server_state
        .identity
        .diffie_hellman(&host_public_bytes);

    // Derive symmetric key.
    let symmetric_key =
        sync_crypto::derive_symmetric_key(&shared_secret, &nonce_bytes, b"theorem-sync-v1")?;

    // Create encrypted proof.
    let proof = sync_crypto::encrypt_payload(&symmetric_key, 0, b"THEOREM_PAIR_V1")?;
    let proof_json =
        serde_json::to_string(&proof).map_err(|e| format!("Failed to serialize proof: {e}"))?;

    // Build pairing request.
    let pairing_request = PairingRequest {
        ephemeral_public_key: hex::encode(sync_state.server_state.identity.public_key_bytes()),
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

async fn encrypt_request<T: serde::Serialize>(
    my_device_id: &str,
    sym_key: &[u8; 32],
    data: &T,
) -> Result<AuthenticatedRequest, String> {
    let json = serde_json::to_vec(data).map_err(|e| format!("Serialize failed: {}", e))?;
    let payload = sync_crypto::encrypt_payload(sym_key, 0, &json)
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

fn chrono_now_iso_string() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple ISO 8601 approximation (good enough for sync timestamps).
    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    let mut year = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days: [i64; 12] = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u32;
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
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
    let req_manifest = encrypt_request(my_device_id, &sym_key, &local_manifest).await?;
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

    // 4. Process Plan
    for action in plan.actions {
        let domain = action.domain;
        match action.direction {
            SyncDirection::Skip => {}
            SyncDirection::Push | SyncDirection::Merge => {
                // Get our local data to push
                let data_guard = sync_state.server_state.sync_data.lock().await;
                let data_json = data_guard
                    .as_ref()
                    .and_then(|d| d.domains.get(&domain).cloned())
                    .unwrap_or_else(|| "[]".to_string());
                drop(data_guard);

                let item_count = serde_json::from_str::<serde_json::Value>(&data_json)
                    .ok()
                    .and_then(|v| v.as_array().map(|a| a.len() as u32))
                    .unwrap_or(0);

                let payload = SyncDomainPayload {
                    domain: domain.clone(),
                    sender_device_id: my_device_id.clone(),
                    data_json,
                    item_count,
                };
                let req_payload = encrypt_request(my_device_id, &sym_key, &payload).await?;

                let res = client
                    .post(&format!("{base_url}/push/{domain}"))
                    .json(&req_payload)
                    .timeout(std::time::Duration::from_secs(30))
                    .send()
                    .await
                    .map_err(|e| format!("Push {domain} fail: {e}"))?;

                if !res.status().is_success() {
                    return Err(format!("Push {domain} rejected: {}", res.status()));
                }

                // Read pull for Merge too
                if action.direction == SyncDirection::Merge {
                    let req_pull =
                        encrypt_request(my_device_id, &sym_key, &serde_json::json!({})).await?;
                    let pull_res = client
                        .post(&format!("{base_url}/pull/{domain}"))
                        .json(&req_pull)
                        .timeout(std::time::Duration::from_secs(30))
                        .send()
                        .await
                        .map_err(|e| format!("Pull {domain} fail: {e}"))?;

                    let enc_res: crate::sync_crypto::EncryptedPayload = pull_res
                        .json()
                        .await
                        .map_err(|e| format!("Pull response parse fail: {e}"))?;
                    let pulled_data: SyncDomainPayload =
                        decrypt_response(&sym_key, &enc_res).await?;

                    incoming_domains.insert(domain, pulled_data.data_json);
                }
            }
            SyncDirection::Pull => {
                let req_pull =
                    encrypt_request(my_device_id, &sym_key, &serde_json::json!({})).await?;
                let pull_res = client
                    .post(&format!("{base_url}/pull/{domain}"))
                    .json(&req_pull)
                    .timeout(std::time::Duration::from_secs(30))
                    .send()
                    .await
                    .map_err(|e| format!("Pull {domain} fail: {e}"))?;

                let enc_res: crate::sync_crypto::EncryptedPayload = pull_res
                    .json()
                    .await
                    .map_err(|e| format!("Pull response parse fail: {e}"))?;
                let pulled_data: SyncDomainPayload = decrypt_response(&sym_key, &enc_res).await?;

                incoming_domains.insert(domain, pulled_data.data_json);
            }
        }
    }

    // 5. Complete sync and update timestamp
    let now = chrono_now_iso_string();
    let complete_msg = SyncCompleteMessage {
        device_id: my_device_id.clone(),
        sync_timestamp: now.clone(),
    };

    let complete_req = encrypt_request(my_device_id, &sym_key, &complete_msg).await?;
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
        let _ = crate::sync_server::save_paired_devices(
            &sync_state.server_state.app_data_dir,
            &devices,
        );
    }

    // Convert map to JSON string to pass back over IPC easily
    serde_json::to_string(&incoming_domains)
        .map_err(|e| format!("Failed to encode incoming domains: {}", e))
}
