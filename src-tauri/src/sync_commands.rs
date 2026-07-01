/// Theorem LAN Sync — Tauri Command Wrappers
///
/// Bridges the Rust sync server with the Tauri frontend via IPC commands.
use theorem_sync_core::sync_crypto::{self, DeviceIdentity};
use theorem_sync_core::sync_protocol::*;
use theorem_sync_core::sync_server::{
    self, EventEmitter, PendingPairing, SyncDataSnapshot, SyncServerHandle, SyncServerState,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures::stream::{self, StreamExt};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::Duration;

/// Global sync state managed by Tauri.
pub struct SyncAppState {
    pub server_state: Arc<SyncServerState>,
    pub server_handle: Arc<Mutex<Option<SyncServerHandle>>>,
}

/// Handle to cancel the background sync loop.
pub struct BackgroundSyncHandle {
    pub cancel: Arc<Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
    pub running: Arc<AtomicBool>,
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

/// Safely retrieve the sync state without panicking.
///
/// `app.state::<SyncAppState>()` panics if the state was never registered
/// (which happens when `init_sync` fails during app startup — common on
/// Android when `app_data_dir` resolution fails). This helper returns a
/// clean `Err` instead so the frontend gets a graceful IPC rejection rather
/// than a native panic that tears down the process.
fn get_sync_state(app: &tauri::AppHandle) -> Result<tauri::State<'_, SyncAppState>, String> {
    app.try_state::<SyncAppState>().ok_or_else(|| {
        "Sync subsystem is not initialized. Sync features are unavailable on this device."
            .to_string()
    })
}

// ─── Tauri Commands ───

/// Start the sync server and return its address info.
#[tauri::command]
pub async fn start_sync_server(app: tauri::AppHandle) -> Result<SyncServerInfo, String> {
    let sync_state = get_sync_state(&app)?;
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
    let sync_state = get_sync_state(&app)?;
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

    let sync_state = get_sync_state(&app)?;

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
        fingerprint: sync_state.server_state.identity.fingerprint.clone(),
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

    let sync_state = get_sync_state(&app)?;

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
        fingerprint: sync_state.server_state.identity.fingerprint.clone(),
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
        fingerprint: pairing_response.fingerprint.clone(),
    };

    let paired_info = PairedDeviceInfo::from(&paired_device);

    // Persist (with dedup by fingerprint).
    {
        let mut devices = sync_state.server_state.paired_devices.lock().await;

        // Dedup: if a device with this fingerprint already exists under a
        // different device_id, replace the old entry (same physical device,
        // new key pair).
        if !paired_device.fingerprint.is_empty() {
            let old_id: Option<String> = devices
                .values()
                .find(|d| {
                    d.fingerprint == paired_device.fingerprint
                        && d.device_id != paired_device.device_id
                })
                .map(|d| d.device_id.clone());

            if let Some(old_device_id) = old_id {
                eprintln!(
                    "[sync] Replacing old paired device {old_device_id} with new device {} (same fingerprint on scanner side)",
                    paired_device.device_id
                );
                devices.remove(&old_device_id);
            }
        }

        devices.insert(paired_device.device_id.clone(), paired_device);
        sync_server::save_paired_devices(&sync_state.server_state.app_data_dir, &devices)?;
    }

    Ok(paired_info)
}

/// Get this device's identity info.
#[tauri::command]
pub async fn get_device_identity(app: tauri::AppHandle) -> Result<DeviceIdentityInfo, String> {
    let sync_state = get_sync_state(&app)?;
    Ok(DeviceIdentityInfo {
        device_id: sync_state.server_state.identity.device_id.clone(),
        device_name: sync_state.server_state.device_name.clone(),
        public_key_hex: hex::encode(sync_state.server_state.identity.public_key_bytes()),
        fingerprint: sync_state.server_state.identity.effective_fingerprint(),
    })
}

/// Get the list of paired devices.
#[tauri::command]
pub async fn get_paired_devices(app: tauri::AppHandle) -> Result<Vec<PairedDeviceInfo>, String> {
    let sync_state = get_sync_state(&app)?;
    let devices = sync_state.server_state.paired_devices.lock().await;
    Ok(devices.values().map(PairedDeviceInfo::from).collect())
}

/// Set the device fingerprint from the frontend (used on Android where
/// the ANDROID_ID is only accessible from Java/Kotlin).
/// This updates the global fingerprint override, which takes precedence
/// over the machine-derived fingerprint for all subsequent lookups.
#[tauri::command]
pub async fn set_device_fingerprint(fingerprint: String) -> Result<(), String> {
    theorem_sync_core::sync_crypto::set_fingerprint_from_frontend(&fingerprint);
    eprintln!("[sync] Device fingerprint set from frontend: {fingerprint}");
    Ok(())
}

/// Remove a paired device.
#[tauri::command]
pub async fn unpair_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
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
    domains_map: HashMap<String, String>,
    manifest_map: HashMap<String, DomainVersion>,
) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;

    let mut sync_data = sync_state.server_state.sync_data.lock().await;
    *sync_data = Some(SyncDataSnapshot {
        domains: domains_map,
        manifest: manifest_map,
    });

    Ok(())
}

/// Retrieve any incoming data pushed by a peer during responder-mode sync.
/// Returns a JSON map of `"incoming_{domain}" -> data_json`.
/// Clears the incoming data after reading.
#[tauri::command]
pub async fn get_incoming_sync_data(app: tauri::AppHandle) -> Result<String, String> {
    let sync_state = get_sync_state(&app)?;
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
    let sync_state = get_sync_state(&app)?;
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

// ─── Peer Discovery ───

/// Probe a peer's last-known IP to find its current port.
///
/// Strategy:
/// 1. Try the last-known IP:port combination.
/// 2. If that fails, scan a small range of candidate ports
///    (the peer's preferred port from its `sync-preferred-port` file
///    is typically the same port across restarts; we also probe a few
///    common fallback ports in case the OS reassigned).
///
/// On success, updates the paired device record with the new port and returns
/// the verified (ip, port) pair.
#[tauri::command]
pub async fn discover_peer(
    app: tauri::AppHandle,
    peer_device_id: String,
) -> Result<(String, u16), String> {
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.server_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    if peer.last_ip.is_empty() {
        return Err("Peer IP unknown. Scan their QR code to pair first.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    // With the fixed port, always try 43935 first.
    // Also probe the stored port in case the fixed port was taken at startup.
    let mut candidates: Vec<u16> = vec![sync_server::SYNC_PORT];
    if peer.last_port > 0 && peer.last_port != sync_server::SYNC_PORT {
        candidates.push(peer.last_port);
    }
    // Probe adjacent ports as fallback.
    for &offset in &[1u16, 2] {
        let below = sync_server::SYNC_PORT.saturating_sub(offset);
        let above = sync_server::SYNC_PORT.saturating_add(offset);
        if !candidates.contains(&below) {
            candidates.push(below);
        }
        if !candidates.contains(&above) {
            candidates.push(above);
        }
    }

    // Try each candidate.
    for port in &candidates {
        let url = format!("http://{}:{}/health", peer.last_ip, port);
        match client.get(&url).send().await {
            Ok(res) if res.status().is_success() => {
                // Verify the device_id matches so we don't connect to the wrong device.
                if let Ok(health) = res
                    .json::<theorem_sync_core::sync_protocol::HealthResponse>()
                    .await
                {
                    if health.device_id == peer_device_id {
                        // Update stored address if port changed.
                        if *port != peer.last_port {
                            let mut devices = sync_state.server_state.paired_devices.lock().await;
                            if let Some(d) = devices.get_mut(&peer_device_id) {
                                d.last_port = *port;
                                let _ = theorem_sync_core::sync_server::save_paired_devices(
                                    &sync_state.server_state.app_data_dir,
                                    &devices,
                                );
                            }
                        }
                        return Ok((peer.last_ip.clone(), *port));
                    }
                }
            }
            _ => continue,
        }
    }

    Err("Peer not reachable. Make sure both devices are on the same network and the peer app is running.".to_string())
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
    payload: &theorem_sync_core::sync_crypto::EncryptedPayload,
) -> Result<T, String> {
    let decrypted = sync_crypto::decrypt_payload(sym_key, payload)
        .map_err(|e| format!("Decrypt failed: {}", e))?;
    let obj = serde_json::from_slice(&decrypted).map_err(|e| format!("Parse failed: {}", e))?;
    Ok(obj)
}

/// Discover the peer's current port by probing health endpoints.
/// Returns the (ip, port) on success, or the original error on failure.
async fn discover_peer_port(
    app: &tauri::AppHandle,
    peer_device_id: &str,
    ip: &str,
    last_known_port: u16,
) -> Result<(String, u16), String> {
    let sync_state = get_sync_state(&app)?;
    let discovery_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mut candidates: Vec<u16> = vec![sync_server::SYNC_PORT];
    if last_known_port > 0 && last_known_port != sync_server::SYNC_PORT {
        candidates.push(last_known_port);
    }
    for &offset in &[1u16, 2] {
        let below = sync_server::SYNC_PORT.saturating_sub(offset);
        let above = sync_server::SYNC_PORT.saturating_add(offset);
        if !candidates.contains(&below) {
            candidates.push(below);
        }
        if !candidates.contains(&above) {
            candidates.push(above);
        }
    }

    for candidate_port in &candidates {
        let health_url = format!("http://{ip}:{candidate_port}/health");
        if let Ok(res) = discovery_client.get(&health_url).send().await {
            if res.status().is_success() {
                if let Ok(health) = res.json::<HealthResponse>().await {
                    if health.device_id == peer_device_id {
                        let mut devices = sync_state.server_state.paired_devices.lock().await;
                        if let Some(peer) = devices.get_mut(peer_device_id) {
                            peer.last_port = *candidate_port;
                        }
                        let _ = theorem_sync_core::sync_server::save_paired_devices(
                            &sync_state.server_state.app_data_dir,
                            &devices,
                        );
                        eprintln!(
                            "[sync] Peer {} discovered at {}:{}",
                            peer_device_id, ip, candidate_port
                        );
                        return Ok((ip.to_string(), *candidate_port));
                    }
                }
            }
        }
    }

    Err(format!(
        "Peer {} not reachable at {} (last port {})",
        peer_device_id, ip, last_known_port
    ))
}

/// Check if a peer is reachable and return its current (ip, port).
async fn ensure_peer_reachable(
    app: &tauri::AppHandle,
    peer_device_id: &str,
    ip: &str,
    port: u16,
) -> Result<(String, u16), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let health_url = format!("http://{ip}:{port}/health");
    match client.get(&health_url).send().await {
        Ok(res) if res.status().is_success() => {
            // Verify device identity
            if let Ok(health) = res.json::<HealthResponse>().await {
                if health.device_id == peer_device_id {
                    eprintln!(
                        "[sync] Pre-flight health check OK for {} at {}:{}",
                        peer_device_id, ip, port
                    );
                    return Ok((ip.to_string(), port));
                }
            }
            // Wrong device at this address — try discovery
            eprintln!(
                "[sync] Health check returned wrong device_id at {}:{}, discovering...",
                ip, port
            );
        }
        Ok(res) => {
            eprintln!(
                "[sync] Health check returned {} for {} at {}:{}, discovering...",
                res.status(),
                peer_device_id,
                ip,
                port
            );
        }
        Err(e) => {
            eprintln!(
                "[sync] Health check failed for {} at {}:{} ({}), discovering...",
                peer_device_id, ip, port, e
            );
        }
    }

    discover_peer_port(app, peer_device_id, ip, port).await
}

/// Try an async sync operation; if it fails with a connection error,
/// attempt peer discovery once and retry.
async fn try_with_discovery<F, Fut, T>(
    app: &tauri::AppHandle,
    peer_device_id: &str,
    op_name: &str,
    ip: &str,
    port: u16,
    mut f: F,
) -> Result<T, String>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let base_url = format!("http://{ip}:{port}/sync");
    match f(base_url.clone()).await {
        Ok(result) => Ok(result),
        Err(e) => {
            let is_connection_error = e.contains("Connection refused")
                || e.contains("connect error")
                || e.contains("timeout")
                || e.contains("Connection reset")
                || e.contains("No route to host");
            if is_connection_error {
                eprintln!(
                    "[sync] {} failed at {}:{} ({}), attempting discovery...",
                    op_name, ip, port, e
                );
                let (new_ip, new_port) = discover_peer_port(app, peer_device_id, ip, port).await?;
                let new_base_url = format!("http://{new_ip}:{new_port}/sync");
                f(new_base_url).await
            } else {
                Err(e)
            }
        }
    }
}

/// Orchestrates a sync session with a paired peer, retrieving necessary domain updates.
/// Returns a JSON string of a map `Domain Name -> JSON Domain Data` which the frontend will merge.
#[tauri::command]
pub async fn initiate_sync(
    app: tauri::AppHandle,
    peer_device_id: String,
) -> Result<String, String> {
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.server_state.paired_devices.lock().await;
    let mut peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let stored_ip = peer.last_ip.clone();
    let stored_port = peer.last_port;
    if stored_ip.is_empty() {
        return Err("Peer IP unknown. Scan their QR code to pair first.".to_string());
    }
    if stored_port == 0 {
        return Err("Peer port unknown. Run discover_peer first or re-scan QR.".to_string());
    }

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = sync_state.server_state.identity.device_id.clone();

    // 0. Pre-flight: verify peer is reachable before any sync operations.
    let (peer_ip, peer_port) =
        ensure_peer_reachable(&app, &peer_device_id, &stored_ip, stored_port).await?;

    // 1. Get local manifest
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

    // 2. Manifest exchange with retry on connection errors.
    let plan: SyncPlan = try_with_discovery(
        &app,
        &peer_device_id,
        "manifest",
        &peer_ip,
        peer_port,
        |base_url| {
            let my_id = my_device_id.clone();
            let key = sym_key;
            let manifest = local_manifest.clone();
            let c = client.clone();
            async move {
                let req_manifest = encrypt_request(&my_id, &key, &manifest)?;
                let res = c
                    .post(format!("{base_url}/manifest"))
                    .json(&req_manifest)
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await
                    .map_err(|e| format!("Manifest request to {base_url} failed: {e}"))?;

                if !res.status().is_success() {
                    return Err(format!("Manifest rejected by peer: {}", res.status()));
                }

                let enc_res: theorem_sync_core::sync_crypto::EncryptedPayload = res
                    .json()
                    .await
                    .map_err(|e| format!("Manifest response parse fail: {e}"))?;

                decrypt_response(&key, &enc_res).await
            }
        },
    )
    .await?;

    let mut incoming_domains: HashMap<String, String> = HashMap::new();

    // 3. Process Plan — collect domains to push and pull, then do batched transfers.
    let mut push_domains: HashMap<String, String> = HashMap::new();
    let mut pull_domain_names: Vec<String> = Vec::new();

    for action in &plan.actions {
        match action.direction {
            SyncDirection::Skip => {}
            SyncDirection::Push => {
                let data_guard = sync_state.server_state.sync_data.lock().await;
                let data_json = data_guard
                    .as_ref()
                    .and_then(|d| d.domains.get(&action.domain).cloned())
                    .unwrap_or_else(|| "[]".to_string());
                drop(data_guard);
                push_domains.insert(action.domain.clone(), data_json);
            }
            SyncDirection::Merge => {
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

    // 3a. Batched push with retry on connection errors.
    if !push_domains.is_empty() {
        let push_count = push_domains.len();
        let batch_payload = theorem_sync_core::sync_protocol::BatchedDomainPayload {
            sender_device_id: my_device_id.clone(),
            domains: push_domains,
        };
        try_with_discovery(
            &app,
            &peer_device_id,
            "push-batch",
            &peer_ip,
            peer_port,
            |base_url| {
                let my_id = my_device_id.clone();
                let key = sym_key;
                let payload = batch_payload.clone();
                let c = client.clone();
                async move {
                    let req_payload = encrypt_request(&my_id, &key, &payload)?;
                    let res = c
                        .post(format!("{base_url}/push-batch"))
                        .json(&req_payload)
                        .timeout(std::time::Duration::from_secs(60))
                        .send()
                        .await
                        .map_err(|e| format!("Batched push to {base_url} failed: {e}"))?;

                    if !res.status().is_success() {
                        return Err(format!("Batched push rejected by peer: {}", res.status()));
                    }
                    Ok(())
                }
            },
        )
        .await?;
        eprintln!(
            "[sync] Pushed {} domain(s) to peer {}",
            push_count, peer_device_id
        );
    }

    // 3b. Batched pull with retry on connection errors.
    if !pull_domain_names.is_empty() {
        let pull_count = pull_domain_names.len();
        let pull_req = theorem_sync_core::sync_protocol::BatchedPullRequest {
            domains: pull_domain_names,
        };
        let pulled: BatchedPullResponse = try_with_discovery(
            &app,
            &peer_device_id,
            "pull-batch",
            &peer_ip,
            peer_port,
            |base_url| {
                let my_id = my_device_id.clone();
                let key = sym_key;
                let req = pull_req.clone();
                let c = client.clone();
                async move {
                    let req_payload = encrypt_request(&my_id, &key, &req)?;
                    let res = c
                        .post(format!("{base_url}/pull-batch"))
                        .json(&req_payload)
                        .timeout(std::time::Duration::from_secs(60))
                        .send()
                        .await
                        .map_err(|e| format!("Batched pull from {base_url} failed: {e}"))?;

                    if !res.status().is_success() {
                        return Err(format!("Batched pull rejected by peer: {}", res.status()));
                    }

                    let enc_res: theorem_sync_core::sync_crypto::EncryptedPayload = res
                        .json()
                        .await
                        .map_err(|e| format!("Pull response parse fail: {e}"))?;

                    decrypt_response(&key, &enc_res).await
                }
            },
        )
        .await?;

        for (domain, data_json) in pulled.domains {
            incoming_domains.insert(domain, data_json);
        }
        eprintln!(
            "[sync] Pulled {} domain(s) from peer {}",
            pull_count, peer_device_id
        );
    }

    // 4. Complete sync and update timestamp.
    let now = sync_crypto::now_iso8601();
    let own_ip = sync_server::get_local_ip().unwrap_or_default();
    let own_port = {
        let handle_guard = sync_state.server_handle.lock().await;
        handle_guard.as_ref().map(|h| h.addr.port()).unwrap_or(0)
    };
    let complete_msg = SyncCompleteMessage {
        device_id: my_device_id.clone(),
        sync_timestamp: now.clone(),
        server_ip: own_ip,
        server_port: own_port,
    };

    try_with_discovery(
        &app,
        &peer_device_id,
        "complete",
        &peer_ip,
        peer_port,
        |base_url| {
            let my_id = my_device_id.clone();
            let key = sym_key;
            let msg = complete_msg.clone();
            let c = client.clone();
            async move {
                let complete_req = encrypt_request(&my_id, &key, &msg)?;
                let res = c
                    .post(format!("{base_url}/complete"))
                    .json(&complete_req)
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await
                    .map_err(|e| format!("Sync completion notify at {base_url} failed: {e}"))?;
                if !res.status().is_success() {
                    return Err(format!(
                        "Sync completion rejected by peer: {}",
                        res.status()
                    ));
                }
                Ok(())
            }
        },
    )
    .await?;

    peer.last_sync_at = Some(now);

    // Save updated peer
    {
        let mut devices = sync_state.server_state.paired_devices.lock().await;
        devices.insert(peer.device_id.clone(), peer);
        if let Err(e) = theorem_sync_core::sync_server::save_paired_devices(
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
/// 2. Pulls available books **in parallel** (up to 4 concurrent transfers).
///    Each file is encrypted in chunks, decrypted, SHA-256 verified, and saved.
/// 3. Skips files that already exist locally with matching size.
/// 4. Emits `sync-file-progress` events for frontend progress tracking.
/// 5. Returns which books succeeded, failed, or were unavailable.
#[tauri::command]
pub async fn pull_book_files(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_ids: Vec<String>,
) -> Result<FileTransferResult, String> {
    let sync_state = get_sync_state(&app)?;

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
        return Err("Peer address unknown. Run discover_peer or re-scan QR.".to_string());
    }

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = &sync_state.server_state.identity.device_id;

    // Shared HTTP client with connection pooling for parallel transfers.
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(8)
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let base_url = format!("http://{ip}:{port}/sync");

    // 1. Check file availability.
    let avail_req = FileAvailabilityRequest {
        book_ids: book_ids.clone(),
    };
    let enc_req = encrypt_request(my_device_id, &sym_key, &avail_req)?;
    let res = client
        .post(format!("{base_url}/file/availability"))
        .json(&enc_req)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("File availability check failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!(
            "File availability check rejected: {}",
            res.status()
        ));
    }

    let enc_res: theorem_sync_core::sync_crypto::EncryptedPayload = res
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

    // Shared atomic counters for progress tracking across parallel tasks.
    let completed_files = Arc::new(AtomicU64::new(0));
    let completed_bytes = Arc::new(AtomicU64::new(0));

    // 2. Pull files in parallel with bounded concurrency (up to 4 concurrent).
    let results: Vec<(String, Result<u64, String>)> =
        stream::iter(availability.available_ids.iter().cloned())
            .map(|book_id| {
                let client = client.clone();
                let base_url = base_url.clone();
                let my_device_id = my_device_id.clone();
                let cache_dir = cache_dir.clone();
                let app = app.clone();
                let completed_files = completed_files.clone();
                let completed_bytes = completed_bytes.clone();
                let file_size = availability.file_sizes.get(&book_id).copied().unwrap_or(0);

                async move {
                    // Skip if the file already exists locally with matching size.
                    let local_path = cache_dir.join(format!("{book_id}.book"));
                    if let Ok(meta) = tokio::fs::metadata(&local_path).await {
                        if meta.is_file() && meta.len() > 0 && meta.len() == file_size {
                            // File already exists with matching size — skip download.
                            let new_files = completed_files.fetch_add(1, Ordering::Relaxed) + 1;
                            let new_bytes =
                                completed_bytes.fetch_add(file_size, Ordering::Relaxed) + file_size;
                            let _ = app.emit(
                                "sync-file-progress",
                                serde_json::json!({
                                    "phase": "transferring",
                                    "total_files": total_files,
                                    "total_bytes": total_bytes,
                                    "completed_files": new_files,
                                    "completed_bytes": new_bytes,
                                    "current_book_id": book_id,
                                    "skipped": true,
                                })
                                .to_string(),
                            );
                            return (book_id, Ok(file_size));
                        }
                    }

                    let result = pull_single_file(
                        &client,
                        &base_url,
                        &my_device_id,
                        &sym_key,
                        &book_id,
                        &cache_dir,
                    )
                    .await;

                    let bytes_done = match &result {
                        Ok(b) => *b,
                        Err(_) => 0,
                    };

                    let new_files = completed_files.fetch_add(1, Ordering::Relaxed) + 1;
                    let new_bytes =
                        completed_bytes.fetch_add(bytes_done, Ordering::Relaxed) + bytes_done;

                    let _ = app.emit(
                        "sync-file-progress",
                        serde_json::json!({
                            "phase": "transferring",
                            "total_files": total_files,
                            "total_bytes": total_bytes,
                            "completed_files": new_files,
                            "completed_bytes": new_bytes,
                            "current_book_id": book_id,
                        })
                        .to_string(),
                    );

                    (book_id, result)
                }
            })
            .buffer_unordered(2) // ≤2 concurrent file pulls
            .collect()
            .await;

    // Partition results.
    let mut transferred: Vec<String> = Vec::new();
    let mut failed: Vec<FileTransferError> = Vec::new();
    for (book_id, result) in results {
        match result {
            Ok(_) => transferred.push(book_id),
            Err(e) => failed.push(FileTransferError { book_id, error: e }),
        }
    }

    let final_bytes = completed_bytes.load(Ordering::Relaxed);

    // Emit completion.
    let _ = app.emit(
        "sync-file-progress",
        serde_json::json!({
            "phase": "complete",
            "total_files": total_files,
            "total_bytes": total_bytes,
            "completed_files": transferred.len(),
            "completed_bytes": final_bytes,
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
    cache_dir: &Path,
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
        .post(format!("{base_url}/file/pull"))
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

    let meta = pull_response.meta.ok_or("File response missing metadata")?;

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
        let decrypted = sync_crypto::decrypt_file_chunk(sym_key, &chunk.data_b64)
            .map_err(|e| format!("Chunk {} decryption failed: {}", chunk.chunk_index, e))?;
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

// ─── Cover Transfer ───

/// Result of a cover transfer operation, returned to the frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct CoverTransferResult {
    /// Book IDs whose covers were successfully transferred.
    pub transferred: Vec<String>,
    /// Book IDs whose covers failed to transfer.
    pub failed: Vec<FileTransferError>,
    /// Book IDs that the peer did not have covers for.
    pub unavailable: Vec<String>,
}

/// Pull cover images from a paired peer device.
///
/// Uses the `/sync/file/cover` endpoint to fetch data_url cover images.
/// Fetches covers in parallel (up to 6 concurrent, since they're small).
/// Saves each cover into the local SQLite `covers` table.
#[tauri::command]
pub async fn pull_book_covers(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_ids: Vec<String>,
) -> Result<CoverTransferResult, String> {
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.server_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let ip = &peer.last_ip;
    let port = peer.last_port;
    if ip.is_empty() || port == 0 {
        return Err("Peer address unknown.".to_string());
    }

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = sync_state.server_state.identity.device_id.clone();

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(8)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let base_url = format!("http://{ip}:{port}/sync");
    let app_data_dir = sync_state.server_state.app_data_dir.clone();

    // Pull covers in parallel (up to 6 concurrent — covers are small).
    let results: Vec<(String, Result<(), String>)> = stream::iter(book_ids)
        .map(|book_id| {
            let client = client.clone();
            let base_url = base_url.clone();
            let my_device_id = my_device_id.clone();
            let app_data_dir = app_data_dir.clone();

            async move {
                let result = pull_single_cover(
                    &client,
                    &base_url,
                    &my_device_id,
                    &sym_key,
                    &book_id,
                    &app_data_dir,
                )
                .await;
                (book_id, result)
            }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    let mut transferred = Vec::new();
    let mut failed = Vec::new();
    let mut unavailable_list = Vec::new();

    for (book_id, result) in results {
        match result {
            Ok(()) => transferred.push(book_id),
            Err(e) if e.contains("not available") => unavailable_list.push(book_id),
            Err(e) => failed.push(FileTransferError { book_id, error: e }),
        }
    }

    Ok(CoverTransferResult {
        transferred,
        failed,
        unavailable: unavailable_list,
    })
}

/// Pull a single cover image from the peer and save to SQLite.
async fn pull_single_cover(
    client: &reqwest::Client,
    base_url: &str,
    my_device_id: &str,
    sym_key: &[u8; 32],
    book_id: &str,
    app_data_dir: &Path,
) -> Result<(), String> {
    let cover_req = CoverPullRequest {
        book_id: book_id.to_string(),
    };
    let enc_req = encrypt_request(my_device_id, sym_key, &cover_req)?;

    let res = client
        .post(format!("{base_url}/file/cover"))
        .json(&enc_req)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Cover pull request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Cover pull rejected: {}", res.status()));
    }

    let enc_res: theorem_sync_core::sync_crypto::EncryptedPayload = res
        .json()
        .await
        .map_err(|e| format!("Cover response parse fail: {e}"))?;

    let cover_response: CoverPullResponse = decrypt_response(sym_key, &enc_res).await?;

    if !cover_response.available {
        return Err("Cover not available on peer".to_string());
    }

    let data_url = cover_response
        .data_url
        .ok_or("Cover response missing data_url")?;

    if data_url.is_empty() {
        return Err("Cover data_url is empty".to_string());
    }

    // Save to SQLite covers table.
    let db_path = app_data_dir.join("theorem.db");
    let book_id_owned = book_id.to_string();
    tokio::task::spawn_blocking(move || {
        let connection = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("Failed to open SQLite for cover save: {e}"))?;

        // Ensure covers table exists.
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS covers (
                    book_id TEXT PRIMARY KEY,
                    data_url TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                )",
            )
            .map_err(|e| format!("Failed to ensure covers table: {e}"))?;

        connection
            .execute(
                r#"INSERT INTO covers (book_id, data_url, updated_at)
                   VALUES (?1, ?2, unixepoch())
                   ON CONFLICT(book_id) DO UPDATE SET
                       data_url = excluded.data_url,
                       updated_at = unixepoch()"#,
                rusqlite::params![book_id_owned, data_url],
            )
            .map_err(|e| format!("Failed to save cover: {e}"))?;

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Cover save task failed: {e}"))?
}

// ─── Background Sync Scheduler ───

/// Start the background sync loop. Runs periodically (default every 5 min)
/// and initiates sync with all paired devices.
///
/// On Android, pair this with the ForegroundService to keep the process alive.
/// On desktop, this is a convenience for periodic sync without JS timers.
#[tauri::command]
pub async fn start_background_sync(
    app: tauri::AppHandle,
    interval_secs: Option<u64>,
) -> Result<(), String> {
    // Check if already running
    let bg_handle = app.state::<BackgroundSyncHandle>();
    if bg_handle.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let interval = interval_secs.unwrap_or(300).max(60);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

    // Store cancel handle
    {
        let mut cancel_lock = bg_handle.cancel.lock().await;
        *cancel_lock = Some(cancel_tx);
    }
    bg_handle.running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(interval));

        loop {
            tokio::select! {
                _ = timer.tick() => {
                    let sync_state = match get_sync_state(&app_clone) {
                        Ok(s) => s,
                        Err(_) => {
                            eprintln!("[background-sync] Sync not initialized, skipping round");
                            continue;
                        }
                    };

                    // Get all paired device IDs.
                    let peer_ids: Vec<String> = {
                        let devices = sync_state.server_state.paired_devices.lock().await;
                        devices.keys().cloned().collect()
                    };

                    if peer_ids.is_empty() {
                        eprintln!("[background-sync] No paired devices, skipping round");
                        continue;
                    }

                    eprintln!(
                        "[background-sync] Starting sync round with {} device(s)",
                        peer_ids.len()
                    );

                    for peer_id in &peer_ids {
                        let result = initiate_sync(app_clone.clone(), peer_id.clone()).await;
                        match result {
                            Ok(_) => {
                                eprintln!("[background-sync] Completed sync with {peer_id}");
                            }
                            Err(e) => {
                                eprintln!(
                                    "[background-sync] Sync with {peer_id} failed: {e}"
                                );
                            }
                        }
                    }

                    eprintln!("[background-sync] Sync round complete");
                }
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[background-sync] Stopped by cancel signal");
                        break;
                    }
                }
            }
        }

        // Reset running flag on exit.
        let bg = app_clone.state::<BackgroundSyncHandle>();
        bg.running.store(false, Ordering::SeqCst);
    });

    eprintln!("[background-sync] Started (interval={interval}s)");
    Ok(())
}

/// Stop the background sync loop.
#[tauri::command]
pub async fn stop_background_sync(app: tauri::AppHandle) -> Result<(), String> {
    let bg_handle = app.state::<BackgroundSyncHandle>();
    if !bg_handle.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut cancel_lock = bg_handle.cancel.lock().await;
    if let Some(sender) = cancel_lock.take() {
        let _ = sender.send(true);
    }
    drop(cancel_lock);

    // Wait briefly for the loop to acknowledge.
    tokio::time::sleep(Duration::from_millis(500)).await;

    eprintln!("[background-sync] Stopped");
    Ok(())
}
