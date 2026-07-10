/// Theorem Sync — Tauri Command Wrappers
///
/// Bridges the iroh P2P sync transport with the Tauri frontend via IPC commands.
use crate::iroh_sync::{
    self, EventCallback, IrohPeerInfo, IrohSyncEndpoint, SyncDataSnapshot, SyncTransportState,
};
use theorem_sync_core::sync_crypto::{self, DeviceIdentity};
use theorem_sync_core::sync_protocol::*;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::Duration;

fn get_local_ip() -> String {
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("1.1.1.1:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_default()
}

// ─── Global iroh endpoint ───

static IROH_ENDPOINT: std::sync::OnceLock<Arc<IrohSyncEndpoint>> = std::sync::OnceLock::new();

// ─── Sync State ───

pub struct SyncState {
    pub transport_state: Arc<SyncTransportState>,
    accept_cancel: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

// ─── Background Sync Handle ───
pub struct BackgroundSyncHandle {
    pub cancel: Arc<Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
    pub running: Arc<AtomicBool>,
    pub data_version: Arc<AtomicU64>,
    pub wake: Arc<tokio::sync::Notify>,
}

// ─── Init ───

pub fn init_sync(
    app_data_dir: PathBuf,
    device_name: String,
    app_handle: tauri::AppHandle,
) -> Result<SyncState, String> {
    let identity = DeviceIdentity::load_or_create(&app_data_dir)?;
    let paired_devices = iroh_sync::load_paired_devices_from_disk(&app_data_dir);

    let emitter: EventCallback = {
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

    let transport_state = Arc::new(SyncTransportState {
        app_handle: app_handle.clone(),
        identity,
        device_name,
        app_data_dir,
        paired_devices: Mutex::new(paired_devices),
        sync_data: Mutex::new(None),
        pending_pairing: Mutex::new(None),
        event_emitter: Some(emitter),
        docs_api: Mutex::new(None),
    });

    // Don't start iroh accept loop here — it's started on-demand by the frontend.
    Ok(SyncState {
        transport_state,
        accept_cancel: Mutex::new(None),
    })
}

fn get_sync_state(app: &tauri::AppHandle) -> Result<tauri::State<'_, SyncState>, String> {
    app.try_state::<SyncState>().ok_or_else(|| {
        "Sync subsystem is not initialized. Sync features are unavailable on this device."
            .to_string()
    })
}

// ─── Iroh Lifecycle ───

async fn get_or_init_iroh(app: &tauri::AppHandle) -> Result<Arc<IrohSyncEndpoint>, String> {
    if let Some(ep) = IROH_ENDPOINT.get() {
        return Ok(ep.clone());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let key_path = data_dir.join("iroh-key");
    let sync_state = get_sync_state(app)?;
    let identity = &sync_state.transport_state.identity;
    let ep = Arc::new(
        IrohSyncEndpoint::new(
            &key_path,
            identity.device_id.clone(),
            sync_state.transport_state.device_name.clone(),
            identity.effective_fingerprint(),
        )
        .await?,
    );
    let _ = IROH_ENDPOINT.set(ep.clone());
    Ok(ep)
}

#[derive(serde::Serialize)]
pub struct IrohNodeIdResponse {
    pub node_id: String,
    pub device_id: String,
    pub fingerprint: String,
}

#[tauri::command]
pub async fn iroh_start(app: tauri::AppHandle) -> Result<IrohNodeIdResponse, String> {
    let ep = get_or_init_iroh(&app).await?;
    let sync_state = get_sync_state(&app)?;

    // Only start the accept loop if one isn't already running.
    // Previously, every call replaced accept_cancel, dropping the old Sender,
    // which caused cancel_rx.changed() to resolve (closed channel) and killed
    // the running loop — breaking in-flight file transfers.
    {
        let mut cancel_guard = sync_state.accept_cancel.lock().await;
        if cancel_guard.is_none() {
            let transport = sync_state.transport_state.clone();
            let ep_clone = ep.clone();
            let cancel = iroh_sync::start_accept_loop(ep_clone, transport);
            *cancel_guard = Some(cancel);
        }
    }

    Ok(IrohNodeIdResponse {
        node_id: ep.public_key_string(),
        device_id: ep.peer_info.device_id.clone(),
        fingerprint: ep.peer_info.fingerprint.clone(),
    })
}

#[tauri::command]
pub async fn iroh_stop(app: tauri::AppHandle) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
    if let Some(cancel) = sync_state.accept_cancel.lock().await.take() {
        let _ = cancel.send(true);
    }
    if let Some(ep) = IROH_ENDPOINT.get() {
        ep.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn iroh_pair(
    app: tauri::AppHandle,
    peer_device_id: String,
    peer_node_id: String,
    peer_device_name: String,
    peer_fingerprint: String,
) -> Result<(), String> {
    let ep = get_or_init_iroh(&app).await?;
    let peer = iroh_sync::IrohPeerInfo {
        public_key: peer_node_id
            .parse()
            .map_err(|e| format!("invalid public key: {e}"))?,
        device_id: peer_device_id,
        device_name: peer_device_name,
        fingerprint: peer_fingerprint,
    };
    ep.add_peer(peer).await;
    Ok(())
}

// ─── Pairing ───

#[tauri::command]
pub async fn generate_pairing_qr(app: tauri::AppHandle) -> Result<PairingQrData, String> {
    let ep = get_or_init_iroh(&app).await?;
    let sync_state = get_sync_state(&app)?;

    // Ensure accept loop is running for pairing
    {
        let mut cancel_guard = sync_state.accept_cancel.lock().await;
        if cancel_guard.is_none() {
            let transport = sync_state.transport_state.clone();
            let ep_clone = ep.clone();
            let cancel = iroh_sync::start_accept_loop(ep_clone, transport);
            *cancel_guard = Some(cancel);
        }
    }

    let secret = x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng);
    let public = x25519_dalek::PublicKey::from(&secret);
    let nonce = sync_crypto::generate_nonce();

    let ip = get_local_ip();
    let port = ep
        .endpoint
        .bound_sockets()
        .first()
        .map(|s| s.port())
        .unwrap_or(0);

    let qr_payload = PairingQrPayload {
        version: 1,
        node_id: ep.public_key_string(),
        ip,
        port,
        ephemeral_public_key: hex::encode(public.as_bytes()),
        device_id: sync_state.transport_state.identity.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        nonce: hex::encode(nonce),
        fingerprint: sync_state.transport_state.identity.effective_fingerprint(),
    };

    let payload_json = serde_json::to_string(&qr_payload)
        .map_err(|e| format!("Failed to serialize QR payload: {e}"))?;
    let qr_svg = sync_crypto::generate_qr_svg(&payload_json)?;

    let mut pending = sync_state.transport_state.pending_pairing.lock().await;
    *pending = Some(iroh_sync::PendingPairing {
        host_secret_bytes: secret.to_bytes(),
        nonce,
        created_at: std::time::Instant::now(),
    });

    Ok(PairingQrData {
        qr_svg,
        pairing_code: payload_json,
    })
}

#[tauri::command]
pub async fn submit_pairing_code(
    app: tauri::AppHandle,
    pairing_code: String,
) -> Result<PairedDeviceInfo, String> {
    let qr_payload: PairingQrPayload =
        serde_json::from_str(&pairing_code).map_err(|e| format!("Invalid pairing code: {e}"))?;

    if qr_payload.version != 1 {
        return Err(format!(
            "Unsupported pairing protocol version: {}",
            qr_payload.version
        ));
    }

    let sync_state = get_sync_state(&app)?;
    let ep = get_or_init_iroh(&app).await?;

    // Parse host's ephemeral key and nonce
    let host_public_bytes: [u8; 32] = hex::decode(&qr_payload.ephemeral_public_key)
        .map_err(|e| format!("Invalid host public key: {e}"))?
        .try_into()
        .map_err(|_| "Host public key must be 32 bytes".to_string())?;
    let nonce_bytes: [u8; 32] = hex::decode(&qr_payload.nonce)
        .map_err(|e| format!("Invalid nonce: {e}"))?
        .try_into()
        .map_err(|_| "Nonce must be 32 bytes".to_string())?;

    let (ephemeral_secret, ephemeral_public) = sync_crypto::generate_ephemeral_keypair();
    let host_public = x25519_dalek::PublicKey::from(host_public_bytes);
    let shared_secret = ephemeral_secret.diffie_hellman(&host_public);
    let symmetric_key = sync_crypto::derive_symmetric_key(
        shared_secret.as_bytes(),
        &nonce_bytes,
        b"theorem-sync-v1",
    )?;

    let proof = sync_crypto::encrypt_payload(&symmetric_key, b"THEOREM_PAIR_V1")?;
    let proof_json =
        serde_json::to_string(&proof).map_err(|e| format!("Failed to serialize proof: {e}"))?;

    let scanner_ip = get_local_ip();
    let scanner_port = ep
        .endpoint
        .bound_sockets()
        .first()
        .map(|s| s.port())
        .unwrap_or(0);

    let pairing_request = PairingRequest {
        ephemeral_public_key: hex::encode(ephemeral_public.as_bytes()),
        device_id: sync_state.transport_state.identity.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        encrypted_proof: BASE64.encode(proof_json.as_bytes()),
        fingerprint: sync_state.transport_state.identity.effective_fingerprint(),
        node_id: ep.public_key.to_string(),
        ip: scanner_ip,
        port: scanner_port,
    };

    // Connect to host via iroh — use the QR payload's IP/port as a direct hint.
    let peer_pk: iroh::PublicKey = qr_payload
        .node_id
        .parse()
        .map_err(|e| format!("Invalid host node_id: {e}"))?;
    let mut host_addr = iroh::EndpointAddr::new(peer_pk);
    if let Ok(ip_addr) = qr_payload.ip.parse::<std::net::IpAddr>() {
        if qr_payload.port > 0 {
            host_addr = host_addr.with_ip_addr(std::net::SocketAddr::new(ip_addr, qr_payload.port));
        }
    }

    let conn = ep
        .endpoint
        .connect(host_addr, crate::iroh_sync::ALPN_BYTES)
        .await
        .map_err(|e| format!("Connect to host failed: {e}"))?;

    // Send handshake first
    let my_info = iroh_sync::IrohPeerInfo {
        public_key: ep.public_key,
        device_id: sync_state.transport_state.identity.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        fingerprint: sync_state.transport_state.identity.effective_fingerprint(),
    };
    {
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;
        let json = serde_json::to_vec(&my_info).map_err(|e| format!("serialize: {e}"))?;
        let len = (json.len() as u32).to_be_bytes();
        send.write_all(&len)
            .await
            .map_err(|e| format!("write: {e}"))?;
        send.write_all(&json)
            .await
            .map_err(|e| format!("write: {e}"))?;
        send.finish().map_err(|e| format!("finish: {e}"))?;
        let mut lb = [0u8; 4];
        recv.read_exact(&mut lb)
            .await
            .map_err(|e| format!("read: {e}"))?;
        let _peer_len = u32::from_be_bytes(lb) as usize;
        // Receive host's info (we don't need it beyond verification)
    }

    let pairing_response = iroh_sync::send_pair_request(&conn, &pairing_request).await?;

    // Capture the host's relay URL from this connection for future reconnections.
    let host_relay_url = conn
        .paths()
        .iter()
        .find_map(|p| match p.remote_addr() {
            iroh::TransportAddr::Relay(url) => Some(url.to_string()),
            _ => None,
        })
        .unwrap_or_default();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let paired_device = PairedDevice {
        device_id: pairing_response.device_id.clone(),
        device_name: pairing_response.device_name.clone(),
        iroh_node_id: qr_payload.node_id.clone(),
        symmetric_key_b64: BASE64.encode(symmetric_key),
        last_ip: qr_payload.ip.clone(),
        last_port: qr_payload.port,
        paired_at: format!("{}Z", now),
        last_sync_at: None,
        fingerprint: pairing_response.fingerprint.clone(),
        peer_relay_url: host_relay_url,
        sync_doc_id: String::new(),
    };

    let paired_info = PairedDeviceInfo::from(&paired_device);

    // Save to state and disk
    {
        let mut devices = sync_state.transport_state.paired_devices.lock().await;
        if !paired_device.fingerprint.is_empty() {
            let old_id: Option<String> = devices
                .values()
                .find(|d| {
                    d.fingerprint == paired_device.fingerprint
                        && d.device_id != paired_device.device_id
                })
                .map(|d| d.device_id.clone());
            if let Some(old_device_id) = old_id {
                devices.remove(&old_device_id);
            }
        }
        devices.insert(paired_device.device_id.clone(), paired_device);
        iroh_sync::save_paired_devices_to_disk(&sync_state.transport_state.app_data_dir, &devices)
            .unwrap_or_else(|e| eprintln!("[sync] Failed to save paired devices: {e}"));
    }

    // Import the shared iroh-docs sync document from the host's ticket.
    if !pairing_response.sync_doc_ticket.is_empty() {
        let api = get_docs_api(&app)?;
        match pairing_response
            .sync_doc_ticket
            .parse::<iroh_docs::DocTicket>()
        {
            Ok(ticket) => match api.import(ticket).await {
                Ok(doc) => {
                    let doc_id = doc.id().to_string();
                    let sync_state = get_sync_state(&app)?;
                    let mut devices = sync_state.transport_state.paired_devices.lock().await;
                    if let Some(device) = devices.get_mut(&pairing_response.device_id) {
                        device.sync_doc_id = doc_id;
                        iroh_sync::save_paired_devices_to_disk(
                            &sync_state.transport_state.app_data_dir,
                            &devices,
                        )
                        .unwrap_or_else(|e| eprintln!("[sync] Failed to save paired devices: {e}"));
                    }
                }
                Err(e) => eprintln!("[sync] Failed to import docs doc: {e}"),
            },
            Err(e) => eprintln!("[sync] Failed to parse docs ticket: {e}"),
        }
    }

    // Also register with iroh endpoint
    let peer_info = iroh_sync::IrohPeerInfo {
        public_key: peer_pk,
        device_id: paired_info.device_id.clone(),
        device_name: paired_info.device_name.clone(),
        fingerprint: paired_info.fingerprint.clone(),
    };
    ep.add_peer(peer_info).await;

    Ok(paired_info)
}

// ─── Device Identity ───

#[tauri::command]
pub async fn get_device_identity(app: tauri::AppHandle) -> Result<DeviceIdentityInfo, String> {
    let sync_state = get_sync_state(&app)?;
    Ok(DeviceIdentityInfo {
        device_id: sync_state.transport_state.identity.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        public_key_hex: hex::encode(sync_state.transport_state.identity.public_key_bytes()),
        fingerprint: sync_state.transport_state.identity.effective_fingerprint(),
    })
}

#[tauri::command]
pub async fn set_device_fingerprint(fingerprint: String) -> Result<(), String> {
    theorem_sync_core::sync_crypto::set_fingerprint_from_frontend(&fingerprint);
    eprintln!("[sync] Device fingerprint set from frontend: {fingerprint}");
    Ok(())
}

// ─── Paired Devices ───

#[tauri::command]
pub async fn get_paired_devices(app: tauri::AppHandle) -> Result<Vec<PairedDeviceInfo>, String> {
    let sync_state = get_sync_state(&app)?;
    let devices = sync_state.transport_state.paired_devices.lock().await;
    Ok(devices.values().map(PairedDeviceInfo::from).collect())
}

#[tauri::command]
pub async fn unpair_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
    let mut devices = sync_state.transport_state.paired_devices.lock().await;
    if devices.remove(&device_id).is_none() {
        return Err(format!("Device {} not found", device_id));
    }
    iroh_sync::save_paired_devices_to_disk(&sync_state.transport_state.app_data_dir, &devices)?;
    Ok(())
}

// ─── Sync Data Provisioning ───

#[tauri::command]
pub async fn set_sync_data(
    app: tauri::AppHandle,
    domains_map: HashMap<String, String>,
    manifest_map: HashMap<String, DomainVersion>,
    book_file_paths: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
    let mut sync_data = sync_state.transport_state.sync_data.lock().await;
    *sync_data = Some(SyncDataSnapshot {
        domains: domains_map,
        manifest: manifest_map,
        book_file_paths: book_file_paths.unwrap_or_default(),
    });
    let bg = app.state::<BackgroundSyncHandle>();
    bg.data_version.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn get_incoming_sync_data(app: tauri::AppHandle) -> Result<String, String> {
    let sync_state = get_sync_state(&app)?;
    let mut sync_data = sync_state.transport_state.sync_data.lock().await;

    let mut incoming: HashMap<String, String> = HashMap::new();

    // Load persisted incoming data from prior WorkManager/JNI sync rounds
    let cache_path = sync_state
        .transport_state
        .app_data_dir
        .join("sync-incoming-cache.json");
    if cache_path.exists() {
        if let Ok(cache_json) = std::fs::read_to_string(&cache_path) {
            if let Ok(cached_incoming) =
                serde_json::from_str::<HashMap<String, String>>(&cache_json)
            {
                for (k, v) in cached_incoming {
                    incoming.insert(k.replace("incoming_", ""), v);
                }
            }
        }
        let _ = std::fs::remove_file(&cache_path);
    }

    if let Some(data) = sync_data.as_mut() {
        let incoming_keys: Vec<String> = data
            .domains
            .keys()
            .filter(|k| k.starts_with("incoming_"))
            .cloned()
            .collect();
        for key in &incoming_keys {
            if let Some(val) = data.domains.remove(key) {
                let domain = key.strip_prefix("incoming_").unwrap_or(key);
                incoming.insert(domain.to_string(), val);
            }
        }
    }

    serde_json::to_string(&incoming).map_err(|e| format!("Serialize incoming data failed: {e}"))
}

async fn queue_incoming_sync_result(
    app: &tauri::AppHandle,
    peer_device_id: &str,
    incoming_json: &str,
) -> Result<(), String> {
    let incoming: HashMap<String, String> = serde_json::from_str(incoming_json)
        .map_err(|e| format!("Parse incoming sync data: {e}"))?;
    let sync_state = get_sync_state(app)?;
    let mut sync_data = sync_state.transport_state.sync_data.lock().await;

    if sync_data.is_none() {
        *sync_data = Some(SyncDataSnapshot::default());
    }
    if let Some(data) = sync_data.as_mut() {
        for (domain, payload) in incoming {
            data.domains.insert(format!("incoming_{domain}"), payload);
        }
    }
    drop(sync_data);

    if let Some(emitter) = &sync_state.transport_state.event_emitter {
        emitter(
            "sync-incoming-complete",
            &serde_json::json!({ "peerDeviceId": peer_device_id }).to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn update_peer_address(
    app: tauri::AppHandle,
    device_id: String,
    ip: String,
    port: u16,
) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
    let mut devices = sync_state.transport_state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(&device_id) {
        device.last_ip = ip;
        device.last_port = port;
        iroh_sync::save_paired_devices_to_disk(&sync_state.transport_state.app_data_dir, &devices)?;
        Ok(())
    } else {
        Err(format!("Device {} not paired", device_id))
    }
}

#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<(), String> {
    let peer_ids: Vec<String> = {
        let sync_state = get_sync_state(&app)?;
        let devices = sync_state.transport_state.paired_devices.lock().await;
        devices.keys().cloned().collect()
    };

    if peer_ids.is_empty() {
        return Ok(());
    }

    let mut failures = Vec::new();
    for peer_id in peer_ids {
        match initiate_sync(app.clone(), peer_id.clone()).await {
            Ok(incoming) => {
                if let Err(error) = queue_incoming_sync_result(&app, &peer_id, &incoming).await {
                    failures.push(format!("{peer_id}: {error}"));
                }
            }
            Err(error) => failures.push(format!("{peer_id}: {error}")),
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("Sync failed: {}", failures.join("; ")))
    }
}

// ─── Sync Orchestrator (Client Side) ───

/// Extract peer addressing info from a connection and save it for reconnection.
async fn save_peer_addrs_from_conn(
    app: &tauri::AppHandle,
    device_id: &str,
    conn: &iroh::endpoint::Connection,
) {
    let relay_url = conn.paths().iter().find_map(|p| match p.remote_addr() {
        iroh::TransportAddr::Relay(url) => Some(url.to_string()),
        _ => None,
    });
    let direct_addr = conn.paths().iter().find_map(|p| match p.remote_addr() {
        iroh::TransportAddr::Ip(addr) => Some(*addr),
        _ => None,
    });

    let sync_state = match app.try_state::<SyncState>() {
        Some(s) => s,
        None => return,
    };
    let mut devices = sync_state.transport_state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(device_id) {
        if let Some(url) = &relay_url {
            device.peer_relay_url = url.clone();
        }
        if let Some(addr) = direct_addr {
            device.last_ip = addr.ip().to_string();
            device.last_port = addr.port();
        }
        let _ = iroh_sync::save_paired_devices_to_disk(
            &sync_state.transport_state.app_data_dir,
            &devices,
        );
    }
}

/// Connect to a peer via iroh. With the N0 preset, the endpoint publishes its own
/// relay URL to DNS (dns.iroh.link) so peers can resolve by PublicKey alone, even
/// after restarts. Stored relay URL and IP are used as speed hints but are optional.
async fn connect_to_peer(
    app: &tauri::AppHandle,
    peer: &PairedDevice,
) -> Result<(iroh::endpoint::Connection, iroh::PublicKey), String> {
    let ep = get_or_init_iroh(app).await?;
    let peer_pk: iroh::PublicKey = peer
        .iroh_node_id
        .parse()
        .map_err(|e| format!("Invalid peer node_id: {e}"))?;

    // Build address with stored hints (optional — N0 DNS lookup resolves without them).
    let mut addr = iroh::EndpointAddr::new(peer_pk);
    if !peer.peer_relay_url.is_empty() {
        if let Ok(relay_url) = peer.peer_relay_url.parse::<iroh::RelayUrl>() {
            addr = addr.with_relay_url(relay_url);
        }
    }
    if let Ok(ip_addr) = peer.last_ip.parse::<std::net::IpAddr>() {
        if peer.last_port > 0 {
            addr = addr.with_ip_addr(std::net::SocketAddr::new(ip_addr, peer.last_port));
        }
    }

    eprintln!("[sync] Connecting to peer {}...", peer.device_name);
    let conn = tokio::time::timeout(std::time::Duration::from_secs(60), async {
        ep.endpoint
            .connect(addr, crate::iroh_sync::ALPN_BYTES)
            .await
    })
    .await
    .map_err(|_| "Connect to peer timed out after 60s".to_string())?
    .map_err(|e| format!("Connect to peer failed: {e}"))?;
    eprintln!("[sync] Connected to peer {}", peer.device_name);

    Ok((conn, ep.public_key))
}

/// Perform the iroh peer info handshake on a newly established connection.
/// Both sides exchange their `IrohPeerInfo` so the acceptor can identify the peer.
/// After this, the connection is ready for protocol requests via `iroh_request`.
async fn perform_handshake(
    conn: &iroh::endpoint::Connection,
    public_key: iroh::PublicKey,
    device_id: &str,
    device_name: &str,
    fingerprint: &str,
) -> Result<(), String> {
    eprintln!("[sync] Performing handshake with {device_name}...");
    let h = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let my_info = IrohPeerInfo {
            public_key,
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            fingerprint: fingerprint.to_string(),
        };
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;
        let json = serde_json::to_vec(&my_info).map_err(|e| format!("serialize: {e}"))?;
        let len = (json.len() as u32).to_be_bytes();
        send.write_all(&len)
            .await
            .map_err(|e| format!("write: {e}"))?;
        send.write_all(&json)
            .await
            .map_err(|e| format!("write: {e}"))?;
        send.finish().map_err(|e| format!("finish: {e}"))?;
        let mut lb = [0u8; 4];
        recv.read_exact(&mut lb)
            .await
            .map_err(|e| format!("read: {e}"))?;
        let _ = u32::from_be_bytes(lb);
        Ok::<(), String>(())
    })
    .await;
    match h {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Handshake timeout (30s)".to_string()),
    }
    eprintln!("[sync] Handshake complete with {device_name}");
    Ok(())
}

#[tauri::command]
pub async fn initiate_sync(
    app: tauri::AppHandle,
    peer_device_id: String,
) -> Result<String, String> {
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.transport_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = sync_state.transport_state.identity.device_id.clone();

    let sync_data_guard = sync_state.transport_state.sync_data.lock().await;
    let data = sync_data_guard.clone();
    drop(sync_data_guard);

    let data = data.ok_or("Sync data not set by frontend yet")?;

    let manifest = SyncManifest {
        device_id: my_device_id.clone(),
        last_sync_at: peer.last_sync_at.clone(),
        domains: data.manifest.clone(),
    };

    // Connect via iroh — uses stored relay URL + IP/port as address hints.
    let (conn, my_public_key) = connect_to_peer(&app, &peer).await?;
    // Capture the peer's actual relay URL and direct address from this connection
    // so future reconnections (after restarts) can use them as address hints.
    save_peer_addrs_from_conn(&app, &peer_device_id, &conn).await;

    // Perform handshake
    perform_handshake(
        &conn,
        my_public_key,
        &my_device_id,
        &sync_state.transport_state.device_name,
        &sync_state.transport_state.identity.effective_fingerprint(),
    )
    .await?;

    let incoming =
        iroh_sync::sync_with_peer(&conn, &sym_key, &my_device_id, &manifest, &data.domains)
            .await
            .map_err(|e| format!("sync failed: {e}"))?;

    // Update last_sync_at
    {
        let mut devices = sync_state.transport_state.paired_devices.lock().await;
        if let Some(d) = devices.get_mut(&peer_device_id) {
            d.last_sync_at = Some(sync_crypto::now_iso8601());
        }
    }

    serde_json::to_string(&incoming).map_err(|e| format!("Serialize incoming map: {e}"))
}

// ─── File Transfer ───

#[derive(serde::Serialize)]
pub struct FileTransferResult {
    pub transferred: Vec<String>,
    pub failed: Vec<FileTransferErrorItem>,
    pub unavailable: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct FileTransferErrorItem {
    pub book_id: String,
    pub error: String,
}

#[derive(serde::Serialize)]
pub struct CoverTransferResult {
    pub transferred: Vec<String>,
    pub failed: Vec<FileTransferErrorItem>,
    pub unavailable: Vec<String>,
    pub covers: HashMap<String, String>,
}

#[tauri::command]
pub async fn pull_book_files(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_ids: Vec<String>,
) -> Result<FileTransferResult, String> {
    eprintln!(
        "[sync] pull_book_files: peer={}, {} files",
        peer_device_id,
        book_ids.len()
    );
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.transport_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec.try_into().map_err(|_| "Key length invalid")?;
    let my_id = sync_state.transport_state.identity.device_id.clone();

    let cache_dir = sync_state.transport_state.app_data_dir.join("book-cache");
    std::fs::create_dir_all(&cache_dir).ok();

    let (conn, my_pk) = connect_to_peer(&app, &peer).await?;
    save_peer_addrs_from_conn(&app, &peer_device_id, &conn).await;

    // Must perform handshake so the server can identify this connection.
    perform_handshake(
        &conn,
        my_pk,
        &my_id,
        &sync_state.transport_state.device_name,
        &sync_state.transport_state.identity.effective_fingerprint(),
    )
    .await?;

    let result =
        iroh_sync::pull_files_via_iroh(Some(&app), conn, sym_key, my_id, &book_ids, cache_dir)
            .await?;

    Ok(FileTransferResult {
        transferred: result.transferred,
        failed: result
            .failed
            .into_iter()
            .map(|f| FileTransferErrorItem {
                book_id: f.book_id,
                error: f.error,
            })
            .collect(),
        unavailable: result.unavailable,
    })
}

#[tauri::command]
pub async fn pull_book_covers(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_ids: Vec<String>,
) -> Result<CoverTransferResult, String> {
    eprintln!(
        "[sync] pull_book_covers: peer={}, {} books",
        peer_device_id,
        book_ids.len()
    );
    let sync_state = get_sync_state(&app)?;

    let devices = sync_state.transport_state.paired_devices.lock().await;
    let peer = devices
        .get(&peer_device_id)
        .cloned()
        .ok_or("Peer not paired")?;
    drop(devices);

    let sym_key_vec = BASE64
        .decode(&peer.symmetric_key_b64)
        .map_err(|e| format!("Decode key: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec.try_into().map_err(|_| "Key length invalid")?;
    let my_id = sync_state.transport_state.identity.device_id.clone();

    let (conn, my_pk) = connect_to_peer(&app, &peer).await?;
    save_peer_addrs_from_conn(&app, &peer_device_id, &conn).await;

    // Must perform handshake so the server can identify this connection.
    perform_handshake(
        &conn,
        my_pk,
        &my_id,
        &sync_state.transport_state.device_name,
        &sync_state.transport_state.identity.effective_fingerprint(),
    )
    .await?;

    let result = iroh_sync::pull_covers_via_iroh(conn, sym_key, my_id, &book_ids).await?;

    Ok(CoverTransferResult {
        transferred: result.transferred,
        failed: result
            .failed
            .into_iter()
            .map(|f| FileTransferErrorItem {
                book_id: f.book_id,
                error: f.error,
            })
            .collect(),
        unavailable: result.unavailable,
        covers: result.covers,
    })
}

// ─── Background Sync ───

#[tauri::command]
pub async fn start_background_sync(
    app: tauri::AppHandle,
    interval_secs: Option<u64>,
) -> Result<(), String> {
    let bg_handle = app.state::<BackgroundSyncHandle>();
    if bg_handle.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let interval = interval_secs.unwrap_or(300).max(60);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

    {
        let mut cancel_lock = bg_handle.cancel.lock().await;
        *cancel_lock = Some(cancel_tx);
    }
    bg_handle.running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();
    let wake = bg_handle.wake.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(interval));
        let mut last_synced_version: u64 = 0;

        loop {
            tokio::select! {
                _ = timer.tick() => {}
                _ = wake.notified() => {
                    eprintln!("[background-sync] Woken by JS mutation trigger");
                }
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[background-sync] Stopped by cancel signal");
                        break;
                    }
                }
            }

            let bg = app_clone.state::<BackgroundSyncHandle>();
            let current_version = bg.data_version.load(Ordering::SeqCst);
            if current_version == last_synced_version {
                continue;
            }

            let peer_ids: Vec<String> = {
                let sync_state = match get_sync_state(&app_clone) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let devices = sync_state.transport_state.paired_devices.lock().await;
                devices.keys().cloned().collect()
            };

            if peer_ids.is_empty() {
                continue;
            }

            for peer_id in &peer_ids {
                match initiate_sync(app_clone.clone(), peer_id.clone()).await {
                    Ok(incoming) => {
                        match queue_incoming_sync_result(&app_clone, peer_id, &incoming).await {
                            Ok(()) => eprintln!("[background-sync] Completed sync with {peer_id}"),
                            Err(e) => eprintln!(
                                "[background-sync] Failed to queue sync data from {peer_id}: {e}"
                            ),
                        }
                    }
                    Err(e) => eprintln!("[background-sync] Sync with {peer_id} failed: {e}"),
                }
            }

            last_synced_version = current_version;
        }

        let bg = app_clone.state::<BackgroundSyncHandle>();
        bg.running.store(false, Ordering::SeqCst);
    });

    eprintln!("[background-sync] Started (interval={interval}s)");
    Ok(())
}

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
    tokio::time::sleep(Duration::from_millis(500)).await;
    eprintln!("[background-sync] Stopped");
    Ok(())
}

#[tauri::command]
pub async fn wake_background_sync(app: tauri::AppHandle) -> Result<(), String> {
    let bg_handle = app.state::<BackgroundSyncHandle>();
    if !bg_handle.running.load(Ordering::SeqCst) {
        return Ok(());
    }
    bg_handle.data_version.fetch_add(1, Ordering::SeqCst);
    bg_handle.wake.notify_one();
    Ok(())
}

// ─── iroh-docs Commands (CRDT metadata sync) ───

fn get_docs_api(app: &tauri::AppHandle) -> Result<iroh_docs::api::DocsApi, String> {
    let sync_state = get_sync_state(app)?;
    let guard = sync_state
        .transport_state
        .docs_api
        .try_lock()
        .map_err(|_| "docs api busy".to_string())?;
    guard
        .as_ref()
        .map(|s| s.api.clone())
        .ok_or_else(|| "iroh-docs not initialized".to_string())
}

fn get_docs_author(app: &tauri::AppHandle) -> Result<iroh_docs::AuthorId, String> {
    let sync_state = get_sync_state(app)?;
    let guard = sync_state
        .transport_state
        .docs_api
        .try_lock()
        .map_err(|_| "docs api busy".to_string())?;
    guard
        .as_ref()
        .map(|s| s.author)
        .ok_or_else(|| "iroh-docs not initialized".to_string())
}

#[tauri::command]
pub async fn docs_create_sync_doc(
    app: tauri::AppHandle,
    peer_device_id: String,
) -> Result<String, String> {
    let api = get_docs_api(&app)?;
    let _author = get_docs_author(&app)?;
    let doc = api.create().await.map_err(|e| format!("create doc: {e}"))?;
    let doc_id = doc.id();
    let ticket = doc
        .share(
            iroh_docs::api::protocol::ShareMode::Write,
            Default::default(),
        )
        .await
        .map_err(|e| format!("share doc: {e}"))?;

    let sync_state = get_sync_state(&app)?;
    let mut devices = sync_state.transport_state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(&peer_device_id) {
        device.sync_doc_id = doc_id.to_string();
        let _ = iroh_sync::save_paired_devices_to_disk(
            &sync_state.transport_state.app_data_dir,
            &devices,
        );
    }

    Ok(ticket.to_string())
}

#[tauri::command]
pub async fn docs_import_sync_doc(
    app: tauri::AppHandle,
    peer_device_id: String,
    ticket_str: String,
) -> Result<(), String> {
    let api = get_docs_api(&app)?;
    let ticket: iroh_docs::DocTicket = ticket_str
        .parse()
        .map_err(|e| format!("parse ticket: {e}"))?;
    let doc = api
        .import(ticket)
        .await
        .map_err(|e| format!("import doc: {e}"))?;
    let doc_id = doc.id();

    let sync_state = get_sync_state(&app)?;
    let mut devices = sync_state.transport_state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(&peer_device_id) {
        device.sync_doc_id = doc_id.to_string();
        let _ = iroh_sync::save_paired_devices_to_disk(
            &sync_state.transport_state.app_data_dir,
            &devices,
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn docs_set_entry(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let api = get_docs_api(&app)?;
    let author = get_docs_author(&app)?;
    let sync_state = get_sync_state(&app)?;
    let devices = sync_state.transport_state.paired_devices.lock().await;
    for (_, device) in devices.iter() {
        if device.sync_doc_id.is_empty() {
            continue;
        }
        let doc_id: iroh_docs::NamespaceId = device
            .sync_doc_id
            .parse()
            .map_err(|e| format!("parse doc id: {e}"))?;
        if let Ok(Some(doc)) = api.open(doc_id).await {
            let _ = doc
                .set_bytes(author, key.clone().into_bytes(), value.clone().into_bytes())
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn docs_get_all_entries(
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    use futures::pin_mut;
    use futures::StreamExt;
    let api = get_docs_api(&app)?;
    let sync_state = get_sync_state(&app)?;
    let (blobs, devices) = {
        let guard = sync_state
            .transport_state
            .docs_api
            .try_lock()
            .map_err(|_| "docs api busy".to_string())?;
        let snapshot = guard
            .as_ref()
            .ok_or_else(|| "iroh-docs not initialized".to_string())?;
        let devices = sync_state.transport_state.paired_devices.lock().await;
        (snapshot.blobs.clone(), devices)
    };
    let mut results = std::collections::HashMap::new();

    for (_, device) in devices.iter() {
        if device.sync_doc_id.is_empty() {
            continue;
        }
        let doc_id: iroh_docs::NamespaceId = device
            .sync_doc_id
            .parse()
            .map_err(|e| format!("parse doc id: {e}"))?;
        if let Ok(Some(doc)) = api.open(doc_id).await {
            if let Ok(stream) = doc.get_many(iroh_docs::store::Query::all().build()).await {
                pin_mut!(stream);
                while let Some(entry_res) = stream.next().await {
                    if let Ok(entry) = entry_res {
                        let key = String::from_utf8_lossy(entry.key()).to_string();
                        let hash = entry.content_hash();
                        if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                            if let Ok(value) = String::from_utf8(content.to_vec()) {
                                results.insert(key, value);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn docs_sync_now(app: tauri::AppHandle, peer_device_id: String) -> Result<(), String> {
    let api = get_docs_api(&app)?;
    let sync_state = get_sync_state(&app)?;
    let doc_id: iroh_docs::NamespaceId = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        devices
            .get(&peer_device_id)
            .and_then(|d| {
                if d.sync_doc_id.is_empty() {
                    None
                } else {
                    d.sync_doc_id.parse().ok()
                }
            })
            .ok_or_else(|| "No sync doc for this peer".to_string())?
    };

    if let Ok(Some(doc)) = api.open(doc_id).await {
        let ep = get_or_init_iroh(&app).await?;
        let addr = ep.endpoint.addr();
        doc.start_sync(vec![addr])
            .await
            .map_err(|e| format!("start_sync: {e}"))?;
    }

    Ok(())
}

// ─── iroh-blobs File/Cover Transfer ───

#[tauri::command]
pub async fn blobs_add_bytes(app: tauri::AppHandle, data: Vec<u8>) -> Result<String, String> {
    let sync_state = get_sync_state(&app)?;
    let guard = sync_state
        .transport_state
        .docs_api
        .try_lock()
        .map_err(|_| "docs api busy".to_string())?;
    let snapshot = guard
        .as_ref()
        .ok_or("iroh-docs not initialized".to_string())?;
    snapshot
        .blobs
        .blobs()
        .add_slice(data)
        .await
        .map(|tag| tag.hash.to_string())
        .map_err(|e| format!("blobs add: {e}"))
}

#[tauri::command]
pub async fn blobs_download_bytes(
    app: tauri::AppHandle,
    peer_device_id: String,
    hash_str: String,
) -> Result<Vec<u8>, String> {
    let ep = get_or_init_iroh(&app).await?;
    let sync_state = get_sync_state(&app)?;

    let peer_pk: iroh::PublicKey = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        peer.iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?
    };

    let hash: iroh_blobs::Hash = hash_str.parse().map_err(|e| format!("parse hash: {e}"))?;

    let guard = sync_state
        .transport_state
        .docs_api
        .try_lock()
        .map_err(|_| "docs api busy".to_string())?;
    let snapshot = guard
        .as_ref()
        .ok_or("iroh-docs not initialized".to_string())?;

    let downloader = snapshot.blobs.downloader(&ep.endpoint);
    downloader
        .download(hash, Some(peer_pk))
        .await
        .map_err(|e| format!("download: {e}"))?;

    snapshot
        .blobs
        .blobs()
        .get_bytes(hash)
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("get bytes: {e}"))
}
