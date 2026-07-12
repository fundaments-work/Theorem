/// Theorem Sync — Tauri Command Wrappers
///
/// Bridges the iroh P2P sync transport with the Tauri frontend via IPC commands.
use crate::iroh_sync::{self, DocsApiSnapshot, IrohSyncEndpoint, SyncTransportState};
use theorem_sync_core::sync_crypto;
use theorem_sync_core::sync_protocol::{
    DeviceIdentityInfo, PairedDevice, PairedDeviceInfo, PairingQrData, PairingQrPayload,
    PairingRequest,
};

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;

// ─── Global iroh endpoint ───

static IROH_ENDPOINT: std::sync::Mutex<Option<Arc<IrohSyncEndpoint>>> = std::sync::Mutex::new(None);

/// Global init lock — prevents concurrent iroh_start() calls from
/// interfering with each other. Without this, two concurrent starts
/// can race: the second sees the docs API not ready within 5s and
/// triggers the database-wipe retry path, destroying the first
/// Router's databases while it's still initializing.
static IROH_START_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ─── Sync State ───

pub struct SyncState {
    pub transport_state: Arc<SyncTransportState>,
    accept_cancel: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

// ─── Init ───

pub fn init_sync(
    app_data_dir: PathBuf,
    device_name: String,
    app_handle: tauri::AppHandle,
) -> Result<SyncState, String> {
    let key_path = app_data_dir.join("iroh-key");
    let secret_key = crate::iroh_sync::load_or_create_key(&key_path)?;
    let public_key_bytes = *secret_key.public().as_bytes();
    let device_id = sync_crypto::compute_device_id(&public_key_bytes);
    let fingerprint = sync_crypto::read_machine_fingerprint();

    let paired_devices = iroh_sync::load_paired_devices_from_disk(&app_data_dir);

    let transport_state = Arc::new(SyncTransportState {
        app_handle: app_handle.clone(),
        device_id,
        fingerprint,
        device_name,
        app_data_dir,
        paired_devices: Mutex::new(paired_devices),
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
    if let Some(ep) = IROH_ENDPOINT.lock().unwrap().clone() {
        return Ok(ep);
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let key_path = data_dir.join("iroh-key");
    let sync_state = get_sync_state(app)?;
    let ep = Arc::new(
        IrohSyncEndpoint::new(
            &key_path,
            sync_state.transport_state.device_id.clone(),
            sync_state.transport_state.device_name.clone(),
            sync_crypto::get_frontend_fingerprint()
                .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
        )
        .await?,
    );
    let mut guard = IROH_ENDPOINT.lock().unwrap();
    if guard.is_none() {
        *guard = Some(ep.clone());
    }
    Ok(ep)
}

/// Get the iroh endpoint's relay URL for pairing handshakes.
pub fn get_iroh_relay_url() -> String {
    IROH_ENDPOINT
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|ep| {
            ep.endpoint
                .addr()
                .relay_urls()
                .collect::<Vec<_>>()
                .first()
                .map(|u| u.to_string())
        })
        .unwrap_or_default()
}

#[derive(serde::Serialize)]
pub struct IrohNodeIdResponse {
    pub node_id: String,
    pub device_id: String,
    pub fingerprint: String,
}

#[tauri::command]
pub async fn iroh_start(app: tauri::AppHandle) -> Result<IrohNodeIdResponse, String> {
    // Serialize all iroh_start calls — prevents concurrent starts from
    // wiping each other's databases via the 5s timeout retry path.
    let _init_lock = IROH_START_LOCK.lock().await;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    // Periodic GC: check iroh-docs redb database size on startup.
    // iroh-docs entries are immutable — writes accumulate forever.
    // If the database grows beyond 100MB, wipe and recreate it.
    // The re-import mechanism (iroh_sync.rs re-subscription loop)
    // will restore sync docs from stored DocTickets.
    let docs_db_path = data_dir.join("iroh-docs").join("docs.db");
    if let Ok(meta) = std::fs::metadata(&docs_db_path) {
        const MAX_DB_BYTES: u64 = 100 * 1024 * 1024; // 100 MB
        if meta.len() > MAX_DB_BYTES {
            eprintln!(
                "[iroh-sync] redb database is {} MB — exceeding {} MB threshold. Wiping and recreating...",
                meta.len() / (1024 * 1024),
                MAX_DB_BYTES / (1024 * 1024)
            );
            let blobs_path = data_dir.join("iroh-blobs");
            let docs_path = data_dir.join("iroh-docs");
            let _ = std::fs::remove_dir_all(&blobs_path);
            let _ = std::fs::remove_dir_all(&docs_path);
        }
    }

    for attempt in 0..2 {
        let ep = get_or_init_iroh(&app).await?;
        let sync_state = get_sync_state(&app)?;

        // Start the accept loop if not running
        {
            let mut cancel_guard = sync_state.accept_cancel.lock().await;
            if cancel_guard.is_none() {
                let transport = sync_state.transport_state.clone();
                let ep_clone = ep.clone();
                let cancel = iroh_sync::start_accept_loop(ep_clone, transport);
                *cancel_guard = Some(cancel);
            } else if attempt > 0 {
                // On retry: databases were wiped, so the old accept loop's
                // databases are gone. Drop its cancel guard to signal
                // shutdown, then wait for it to fully stop before starting
                // a fresh accept loop. Without this delay, the old Router's
                // iroh-docs actor is still shutting down while the new one
                // starts — their event streams collide and all die with
                // "sending to iroh_docs actor failed".
                *cancel_guard = None;
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                let transport = sync_state.transport_state.clone();
                let ep_clone = ep.clone();
                let cancel = iroh_sync::start_accept_loop(ep_clone, transport);
                *cancel_guard = Some(cancel);
            }
        }

        // Wait up to 15s for the docs API to be initialized (was 5s — too
        // short for slow devices or large databases).
        for _ in 0..150 {
            if sync_state
                .transport_state
                .docs_api
                .try_lock()
                .map(|g| g.is_some())
                .unwrap_or(false)
            {
                return Ok(IrohNodeIdResponse {
                    node_id: ep.public_key_string(),
                    device_id: ep.peer_info.device_id.clone(),
                    fingerprint: ep.peer_info.fingerprint.clone(),
                });
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        if attempt == 0 {
            eprintln!("[iroh-sync] Database corrupted — wiping and retrying");
            // Wipe corrupted redb databases so the next start recreates fresh
            let blobs_path = data_dir.join("iroh-blobs");
            let docs_path = data_dir.join("iroh-docs");
            let _ = std::fs::remove_dir_all(&blobs_path);
            let _ = std::fs::remove_dir_all(&docs_path);
            // Close and reset the endpoint so it reconnects fresh
            let old_ep = IROH_ENDPOINT.lock().unwrap().clone();
            if let Some(ep) = old_ep {
                ep.close().await;
            }
            *IROH_ENDPOINT.lock().unwrap() = None;
        }
    }

    Err("iroh-docs not initialized after 5s wait".to_string())
}

#[tauri::command]
pub async fn iroh_stop(app: tauri::AppHandle) -> Result<(), String> {
    let sync_state = get_sync_state(&app)?;
    if let Some(cancel) = sync_state.accept_cancel.lock().await.take() {
        let _ = cancel.send(true);
    }
    let endpoint = IROH_ENDPOINT.lock().unwrap().clone();
    if let Some(ep) = endpoint {
        ep.close().await;
    }
    *IROH_ENDPOINT.lock().unwrap() = None;
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

    let qr_payload = PairingQrPayload {
        version: 1,
        node_id: ep.public_key_string(),
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
        lan_addrs: ep
            .endpoint
            .bound_sockets()
            .into_iter()
            .map(|a| a.to_string())
            .collect(),
        relay_url: ep
            .endpoint
            .addr()
            .relay_urls()
            .collect::<Vec<_>>()
            .first()
            .map(|u| u.to_string())
            .unwrap_or_default(),
    };

    let payload_json = serde_json::to_string(&qr_payload)
        .map_err(|e| format!("Failed to serialize QR payload: {e}"))?;
    let qr_svg = sync_crypto::generate_qr_svg(&payload_json)?;

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

    // ── Step 1: Connect to host device ──
    let _ = app.emit(
        "pairing-progress",
        serde_json::json!({"step": "connecting", "message": "Connecting to device..."}),
    );

    // Connect to host via iroh. Include LAN addresses from the QR code
    // as direct-connect hints so pairing works without internet (no N0 DNS
    // or relay required when on the same local network).
    let peer_pk: iroh::PublicKey = qr_payload
        .node_id
        .parse()
        .map_err(|e| format!("Invalid host node_id: {e}"))?;
    let mut host_addr = iroh::EndpointAddr::new(peer_pk);
    for addr_str in &qr_payload.lan_addrs {
        if let Ok(socket) = addr_str.parse::<std::net::SocketAddr>() {
            host_addr = host_addr.with_ip_addr(socket);
        }
    }

    let conn = ep
        .endpoint
        .connect(host_addr, crate::iroh_sync::ALPN_BYTES)
        .await
        .map_err(|e| format!("Connect to host failed: {e}"))?;

    let _ = app.emit(
        "pairing-progress",
        serde_json::json!({"step": "handshake", "message": "Connected, exchanging keys..."}),
    );

    // Send handshake first
    let my_info = iroh_sync::IrohPeerInfo {
        public_key: ep.public_key,
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
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

    let pairing_request = PairingRequest {
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
        node_id: ep.public_key.to_string(),
        relay_url: ep
            .endpoint
            .addr()
            .relay_urls()
            .collect::<Vec<_>>()
            .first()
            .map(|u| u.to_string())
            .unwrap_or_default(),
    };

    let pairing_response = iroh_sync::send_pair_request(&conn, &pairing_request).await?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Capture the peer's actual network address from the QUIC connection
    // so blob downloads have direct-connect hints. Without this, iroh-blobs
    // must resolve the peer via N0 DNS (which fails on many mobile networks).
    let (connected_ip, connected_port, connected_relay) = {
        let paths = conn.paths();
        let mut direct = None;
        let mut relay = None;
        for p in paths.iter() {
            match p.remote_addr() {
                iroh::TransportAddr::Ip(addr) => {
                    direct = Some((addr.ip().to_string(), addr.port()));
                }
                iroh::TransportAddr::Relay(url) => {
                    relay = Some(url.to_string());
                }
                _ => {}
            }
        }
        match direct {
            Some((ip, port)) => (ip, port, relay.unwrap_or_default()),
            None => (String::new(), 0u16, relay.unwrap_or_default()),
        }
    };

    // Prefer the host's relay URL from the pairing response, then from
    // the connection, then from the QR code payload. This ensures blob
    // downloads can use the relay even for direct-LAN pairings.
    let host_relay = if !pairing_response.relay_url.is_empty() {
        pairing_response.relay_url.clone()
    } else if !connected_relay.is_empty() {
        connected_relay
    } else {
        qr_payload.relay_url.clone()
    };

    let paired_device = PairedDevice {
        device_id: pairing_response.device_id.clone(),
        device_name: pairing_response.device_name.clone(),
        iroh_node_id: qr_payload.node_id.clone(),

        last_ip: connected_ip,
        last_port: connected_port,
        paired_at: format!("{}Z", now),
        last_sync_at: None,
        fingerprint: pairing_response.fingerprint.clone(),
        peer_relay_url: host_relay,
        sync_doc_id: String::new(),
        sync_doc_ticket: pairing_response.sync_doc_ticket.clone(),
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

    // Ensure the iroh Router + docs are initialized before importing the ticket.
    {
        let mut cancel_guard = sync_state.accept_cancel.lock().await;
        if cancel_guard.is_none() {
            let transport = sync_state.transport_state.clone();
            let ep_clone = ep.clone();
            let cancel = iroh_sync::start_accept_loop(ep_clone, transport);
            *cancel_guard = Some(cancel);
        }
    }

    // Wait for iroh-docs to be available (up to 5s after Router starts).
    let _ = app.emit(
        "pairing-progress",
        serde_json::json!({"step": "setup", "message": "Setting up sync engine..."}),
    );
    let docs_ready = {
        let mut waited = 0;
        loop {
            if sync_state
                .transport_state
                .docs_api
                .try_lock()
                .map(|g| g.is_some())
                .unwrap_or(false)
            {
                break true;
            }
            waited += 1;
            if waited > 50 {
                break false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    };

    // Import the shared iroh-docs sync document from the host's ticket.
    if docs_ready && !pairing_response.sync_doc_ticket.is_empty() {
        let api = get_docs_api(&app)?;
        match pairing_response
            .sync_doc_ticket
            .parse::<iroh_docs::DocTicket>()
        {
            Ok(ticket) => match api.import(ticket).await {
                Ok(doc) => {
                    let doc_id = doc.id().to_string();
                    // Start live sync so future writes propagate via gossip
                    if let Ok(host_pk) = qr_payload.node_id.parse::<iroh::PublicKey>() {
                        let host_addr = iroh::EndpointAddr::new(host_pk);
                        let _ = doc.start_sync(vec![host_addr]).await;
                    }
                    // Subscribe to live events
                    if let Ok(blobs) = get_blobs_store(&app) {
                        iroh_sync::subscribe_doc_events(app.clone(), doc, blobs);
                    }
                    let sync_state = get_sync_state(&app)?;
                    let mut devices = sync_state.transport_state.paired_devices.lock().await;
                    if let Some(device) = devices.get_mut(&pairing_response.device_id) {
                        device.sync_doc_id = doc_id;
                        device.sync_doc_ticket = pairing_response.sync_doc_ticket.clone();
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

    let _ = app.emit(
        "pairing-progress",
        serde_json::json!({"step": "complete", "message": "Device paired!"}),
    );

    Ok(paired_info)
}

// ─── Device Identity ───

#[tauri::command]
pub async fn get_device_identity(app: tauri::AppHandle) -> Result<DeviceIdentityInfo, String> {
    let sync_state = get_sync_state(&app)?;
    let public_key = IROH_ENDPOINT
        .lock()
        .unwrap()
        .as_ref()
        .map(|ep| ep.public_key_string())
        .unwrap_or_default();
    Ok(DeviceIdentityInfo {
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        public_key_hex: public_key,
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
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

// ─── iroh-docs Commands (CRDT metadata sync) ───

fn get_docs_api(app: &tauri::AppHandle) -> Result<iroh_docs::api::DocsApi, String> {
    let snapshot = get_docs_snapshot(app)?;
    Ok(snapshot.api.clone())
}

fn get_docs_author(app: &tauri::AppHandle) -> Result<iroh_docs::AuthorId, String> {
    let snapshot = get_docs_snapshot(app)?;
    Ok(snapshot.author)
}

fn get_blobs_store(app: &tauri::AppHandle) -> Result<iroh_blobs::api::Store, String> {
    let snapshot = get_docs_snapshot(app)?;
    Ok(snapshot.blobs.clone())
}

/// Wait up to 5 seconds for the iroh-docs API snapshot to be initialized.
/// The DocsApi is stored by the start_accept_loop background task, which
/// may take time to set up blobs store, gossip, and docs handler.
fn get_docs_snapshot(app: &tauri::AppHandle) -> Result<DocsApiSnapshot, String> {
    let sync_state = get_sync_state(app)?;
    for i in 0..50 {
        {
            let guard = sync_state
                .transport_state
                .docs_api
                .try_lock()
                .map_err(|_| "docs api busy".to_string())?;
            if let Some(ref snapshot) = *guard {
                return Ok(snapshot.clone());
            }
        }
        if i < 49 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    Err("iroh-docs not initialized after 5s wait".to_string())
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

    // Subscribe to live events for this document
    if let Ok(blobs) = get_blobs_store(&app) {
        iroh_sync::subscribe_doc_events(app.clone(), doc, blobs);
    }

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

    // Subscribe to live events for this document
    if let Ok(blobs) = get_blobs_store(&app) {
        iroh_sync::subscribe_doc_events(app.clone(), doc, blobs);
    }

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

    // Clone device configs out of the lock so we don't hold it across .await
    // points. 5000 sequential docsSetEntry calls each hold the lock across
    // api.open().await + set_bytes().await, starving any other task that
    // needs paired_devices (e.g. docs_sync_now, docs_get_all_entries).
    let targets: Vec<(iroh_docs::NamespaceId,)> = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        devices
            .values()
            .filter(|d| !d.sync_doc_id.is_empty())
            .filter_map(|d| {
                d.sync_doc_id
                    .parse::<iroh_docs::NamespaceId>()
                    .ok()
                    .map(|doc_id| (doc_id,))
            })
            .collect()
    };

    for (doc_id,) in &targets {
        if let Ok(Some(doc)) = api.open(*doc_id).await {
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
    // Group all entries by key — multiple authors may have entries for the
    // same key (e.g., "books"). We collect ALL values per key and merge them
    // by concatenating JSON arrays. This way, data from all authors survives
    // instead of only the last HashMap::insert winner.
    let mut per_key: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for (_, device) in devices.iter() {
        if device.sync_doc_id.is_empty() {
            continue;
        }
        let doc_id: iroh_docs::NamespaceId = device
            .sync_doc_id
            .parse()
            .map_err(|e| format!("parse doc id: {e}"))?;
        if let Ok(Some(doc)) = api.open(doc_id).await {
            if let Ok(stream) = doc
                .get_many(iroh_docs::store::Query::single_latest_per_key().build())
                .await
            {
                pin_mut!(stream);
                let mut doc_entries_seen = 0u64;
                let mut doc_entries_read = 0u64;
                while let Some(entry_res) = stream.next().await {
                    doc_entries_seen += 1;
                    if let Ok(entry) = entry_res {
                        let key = String::from_utf8_lossy(entry.key()).to_string();
                        let hash = entry.content_hash();
                        if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                            if let Ok(value) = String::from_utf8(content.to_vec()) {
                                per_key.entry(key).or_default().push(value);
                                doc_entries_read += 1;
                            }
                        } else {
                            eprintln!(
                                "[iroh-sync] docs_get_all_entries: blob not available for key={key}"
                            );
                        }
                    }
                }
                eprintln!(
                    "[iroh-sync] docs_get_all_entries: {doc_entries_read}/{doc_entries_seen} entries read from doc {doc_id}"
                );
            }
        }
    }

    // Merge values for each key: if multiple authors wrote to the same key,
    // merge them appropriately based on value type and key namespace:
    //
    // Domain arrays ("books", "annotations", "collections"):
    //   -> concatenate (dedup happens on the JS side via mergeBooks etc.)
    // Domain objects ("settings", "reading_stats"):
    //   -> merge top-level keys (for settings, reading_stats)
    // Per-entity keys ("book:<id>", "annotation:<id>", "collection:<id>"):
    //   -> last-writer-wins (each key represents a single entity; field-
    //      level object-merge would produce incoherent hybrid entities)
    // Other types -> last writer wins
    let mut results = std::collections::HashMap::new();
    for (key, values) in per_key {
        let is_per_entity = key.starts_with("book:")
            || key.starts_with("annotation:")
            || key.starts_with("collection:");
        if values.len() == 1 || is_per_entity {
            results.insert(key, values.into_iter().last().unwrap());
        } else {
            let parsed: Vec<serde_json::Value> = values
                .iter()
                .filter_map(|v| serde_json::from_str(v).ok())
                .collect();

            let all_objects = parsed.iter().all(|v| v.is_object());
            let all_arrays = parsed.iter().all(|v| v.is_array());

            if all_objects {
                let mut merged = serde_json::Map::new();
                for v in &parsed {
                    if let Some(obj) = v.as_object() {
                        for (k, val) in obj {
                            merged.insert(k.clone(), val.clone());
                        }
                    }
                }
                results.insert(
                    key,
                    serde_json::to_string(&merged).unwrap_or_else(|_| values.join("\n")),
                );
            } else if all_arrays {
                let mut merged: Vec<serde_json::Value> = Vec::new();
                for v in &parsed {
                    if let Some(arr) = v.as_array() {
                        merged.extend(arr.iter().cloned());
                    }
                }
                results.insert(
                    key,
                    serde_json::to_string(&merged).unwrap_or_else(|_| values.join("\n")),
                );
            } else {
                results.insert(key, values.into_iter().last().unwrap());
            }
        }
    }

    Ok(results)
}

/// Try to get the docs API, and if the accept loop died (corrupted database),
/// restart it and retry. Without this, a corrupted redb database silently kills
/// the accept loop at startup, and every subsequent sync round fails with
/// "iroh-docs not initialized after 5s wait" until the user reinstalls the app.
async fn get_docs_api_or_init(app: &tauri::AppHandle) -> Result<iroh_docs::api::DocsApi, String> {
    match get_docs_api(app) {
        Ok(api) => Ok(api),
        Err(e) => {
            eprintln!("[iroh-sync] {e} — restarting sync endpoint with database cleanup");
            // This restarts the accept loop. If the database is corrupted,
            // the cleanup in start_accept_loop deletes the broken redb files
            // and the new loop recreates them fresh.
            let _ = iroh_start(app.clone()).await;
            // get_docs_api polls for up to 5s internally; on a fresh database
            // the loop initializes in <1s.
            get_docs_api(app)
        }
    }
}

#[tauri::command]
pub async fn docs_sync_now(app: tauri::AppHandle, peer_device_id: String) -> Result<(), String> {
    let api = get_docs_api_or_init(&app).await?;
    let sync_state = get_sync_state(&app)?;
    let (doc_id, peer_pk, relay_url, ip, port) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let device = devices
            .get(&peer_device_id)
            .ok_or_else(|| "Peer not paired".to_string())?;
        let sync_doc_id = device.sync_doc_id.clone();
        let sync_doc_ticket = device.sync_doc_ticket.clone();
        let iroh_node_id = device.iroh_node_id.clone();
        let peer_relay_url = device.peer_relay_url.clone();
        let last_ip = device.last_ip.clone();
        let last_port = device.last_port;
        drop(devices);

        let doc_id: iroh_docs::NamespaceId = if sync_doc_id.is_empty() {
            if !sync_doc_ticket.is_empty() {
                eprintln!(
                    "[iroh-sync] sync_doc_id empty for {peer_device_id} — \
                     attempting recovery from stored ticket"
                );
                if let Ok(ticket) = sync_doc_ticket.parse::<iroh_docs::DocTicket>() {
                    match api.import(ticket).await {
                        Ok(doc) => {
                            let new_doc_id_str = doc.id().to_string();
                            let mut devices =
                                sync_state.transport_state.paired_devices.lock().await;
                            if let Some(d) = devices.get_mut(&peer_device_id) {
                                d.sync_doc_id = new_doc_id_str.clone();
                                let _ = iroh_sync::save_paired_devices_to_disk(
                                    &sync_state.transport_state.app_data_dir,
                                    &devices,
                                );
                            }
                            new_doc_id_str
                                .parse()
                                .map_err(|e| format!("parse recovered doc id: {e}"))?
                        }
                        Err(e) => {
                            return Err(format!("Sync doc recovery from ticket failed: {e}"));
                        }
                    }
                } else {
                    return Err("No sync doc for this peer — re-pair required".to_string());
                }
            } else {
                return Err("No sync doc for this peer — re-pair required".to_string());
            }
        } else {
            sync_doc_id
                .parse()
                .map_err(|e| format!("parse doc id: {e}"))?
        };
        let pk: iroh::PublicKey = iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (doc_id, pk, peer_relay_url, last_ip, last_port)
    };

    let doc = match api.open(doc_id).await {
        Ok(Some(d)) => d,
        Ok(None) | Err(_) => {
            // Doc not found — likely the iroh-docs database was wiped due to
            // corruption recovery. Try to re-import the doc from the stored
            // DocTicket (saved during pairing). This avoids requiring the user
            // to re-pair after a database reset.
            let ticket_str = {
                let devices = sync_state.transport_state.paired_devices.lock().await;
                devices
                    .get(&peer_device_id)
                    .map(|d| d.sync_doc_ticket.clone())
                    .unwrap_or_default()
            };

            if let Ok(ticket) = ticket_str.parse::<iroh_docs::DocTicket>() {
                eprintln!("[iroh-sync] Re-importing doc from stored ticket...");
                match api.import(ticket).await {
                    Ok(imported) => {
                        let new_doc_id = imported.id().to_string();
                        let mut devices = sync_state.transport_state.paired_devices.lock().await;
                        if let Some(d) = devices.get_mut(&peer_device_id) {
                            d.sync_doc_id = new_doc_id;
                            let _ = iroh_sync::save_paired_devices_to_disk(
                                &sync_state.transport_state.app_data_dir,
                                &devices,
                            );
                        }
                        imported
                    }
                    Err(e) => {
                        eprintln!("[iroh-sync] Re-import from ticket failed: {e}. Ticket preserved for retry.");
                        return Err(format!("Sync doc recovery failed — will retry: {e}"));
                    }
                }
            } else {
                // No stored ticket — can't recover after database wipe.
                // Don't clear sync_doc_id; the doc might still exist but be
                // temporarily unavailable. Clear only if it clearly doesn't exist.
                return Err("Sync doc not available — will retry".to_string());
            }
        }
    };

    let mut peer_addr = iroh::EndpointAddr::new(peer_pk);
    if !relay_url.is_empty() {
        if let Ok(url) = relay_url.parse::<iroh::RelayUrl>() {
            peer_addr = peer_addr.with_relay_url(url);
        }
    }
    if let Ok(ip_addr) = ip.parse::<std::net::IpAddr>() {
        if port > 0 {
            peer_addr = peer_addr.with_ip_addr(std::net::SocketAddr::new(ip_addr, port));
        }
    }

    // Start CRDT sync with peer. start_sync() may return Ok before the
    // actual reconciliation completes — it triggers a background sync session
    // (gossip subscription + state reconciliation). After pairing, gossip is
    // already active so this call is fast (registers peer for live updates).
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        doc.start_sync(vec![peer_addr]),
    )
    .await
    .map_err(|_| "Peer is offline or unreachable (timeout after 15s)".to_string())?
    .map_err(|e| format!("start_sync: {e}"))?;

    // Update last_sync_at so the peer list shows "Synced at ..." instead of "Never synced"
    {
        let mut devices = sync_state.transport_state.paired_devices.lock().await;
        if let Some(d) = devices.get_mut(&peer_device_id) {
            d.last_sync_at = Some(sync_crypto::now_iso8601());
            let _ = iroh_sync::save_paired_devices_to_disk(
                &sync_state.transport_state.app_data_dir,
                &devices,
            );
        }
    }

    Ok(())
}

// ─── iroh-blobs File/Cover Transfer ───

#[tauri::command]
pub async fn blobs_add_bytes(app: tauri::AppHandle, data: Vec<u8>) -> Result<String, String> {
    let snapshot = get_docs_snapshot(&app)?;
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

    let (peer_pk, relay_url) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        let pk: iroh::PublicKey = peer
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (pk, peer.peer_relay_url.clone())
    };

    let hash: iroh_blobs::Hash = hash_str.parse().map_err(|e| format!("parse hash: {e}"))?;

    let mut peer_addr = iroh::EndpointAddr::new(peer_pk);
    if !relay_url.is_empty() {
        if let Ok(url) = relay_url.parse::<iroh::RelayUrl>() {
            peer_addr = peer_addr.with_relay_url(url);
        }
    }
    if let Err(e) = ep.endpoint.connect(peer_addr, iroh_blobs::ALPN).await {
        eprintln!("[blob-download] connect warmup failed (relay-only): {e}");
    }

    let snapshot = get_docs_snapshot(&app)?;
    let downloader = snapshot.blobs.downloader(&ep.endpoint);
    let download_fut = downloader.download(hash, Some(peer_pk));
    tokio::time::timeout(std::time::Duration::from_secs(30), download_fut)
        .await
        .map_err(|_| "download: timeout after 30s".to_string())?
        .map_err(|e| format!("download: {e}"))?;

    snapshot
        .blobs
        .blobs()
        .get_bytes(hash)
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("get bytes: {e}"))
}

#[tauri::command]
pub async fn blobs_add_file(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    let snapshot = get_docs_snapshot(&app)?;
    snapshot
        .blobs
        .blobs()
        .add_path(&file_path)
        .await
        .map(|tag| tag.hash.to_string())
        .map_err(|e| format!("blobs add file: {e}"))
}

#[tauri::command]
pub async fn blobs_download_file(
    app: tauri::AppHandle,
    peer_device_id: String,
    hash_str: String,
    dest_path: String,
) -> Result<(), String> {
    let ep = get_or_init_iroh(&app).await?;
    let sync_state = get_sync_state(&app)?;

    let (peer_pk, relay_url) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        let pk: iroh::PublicKey = peer
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (pk, peer.peer_relay_url.clone())
    };

    let hash: iroh_blobs::Hash = hash_str.parse().map_err(|e| format!("parse hash: {e}"))?;

    let mut peer_addr = iroh::EndpointAddr::new(peer_pk);
    if !relay_url.is_empty() {
        if let Ok(url) = relay_url.parse::<iroh::RelayUrl>() {
            peer_addr = peer_addr.with_relay_url(url);
        }
    }
    if let Err(e) = ep.endpoint.connect(peer_addr, iroh_blobs::ALPN).await {
        eprintln!("[blob-download] connect warmup failed (relay-only): {e}");
    }

    let snapshot = get_docs_snapshot(&app)?;
    let downloader = snapshot.blobs.downloader(&ep.endpoint);
    let download_fut = downloader.download(hash, Some(peer_pk));
    tokio::time::timeout(std::time::Duration::from_secs(30), download_fut)
        .await
        .map_err(|_| "download: timeout after 30s".to_string())?
        .map_err(|e| format!("download: {e}"))?;

    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }

    snapshot
        .blobs
        .blobs()
        .export(hash, &dest_path)
        .await
        .map(|_bytes| ())
        .map_err(|e| format!("export blob: {e}"))
}

// ─── Blobs Garbage Collection ───

/// Collect unreferenced blobs from the FsStore and remove them.
/// Accepts a list of BLAKE3 hashes to keep (from current book metadata).
/// Walks the FsStore directory to find stored blob files, and deletes
/// any file whose hash is not in the keep list.
#[tauri::command]
pub async fn blobs_gc(app: tauri::AppHandle, keep_hashes: Vec<String>) -> Result<usize, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let blobs_path = data_dir.join("iroh-blobs");
    let blobs_sub = blobs_path.join("data");

    if !blobs_sub.exists() {
        return Ok(0);
    }

    let keep: std::collections::HashSet<String> = keep_hashes.into_iter().collect();
    let mut removed = 0usize;

    // FsStore stores blobs as: data/<XX>/<64-char-hex-hash>
    // where XX is the first 2 hex chars. Walk prefix dirs, then
    // check each blob file.
    if let Ok(prefix_entries) = std::fs::read_dir(&blobs_sub) {
        for prefix_entry in prefix_entries.flatten() {
            let prefix_path = prefix_entry.path();
            if !prefix_path.is_dir() {
                continue;
            }
            if let Ok(blob_entries) = std::fs::read_dir(&prefix_path) {
                for blob_entry in blob_entries.flatten() {
                    let blob_path = blob_entry.path();
                    if !blob_path.is_file() {
                        continue;
                    }
                    if let Some(name) = blob_path.file_name().and_then(|n| n.to_str()) {
                        // The blob filename IS the BLAKE3 hex hash (64 chars)
                        if name.len() == 64
                            && name.chars().all(|c| c.is_ascii_hexdigit())
                            && !keep.contains(name)
                            && std::fs::remove_file(&blob_path).is_ok()
                        {
                            removed += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(removed)
}

/// Check if a blob with the given hash exists in the local FsStore.
/// Used by provisionBookFileBlobs to verify that blobs didn't get
/// deleted from disk (e.g., via cache cleanup) while their metadata
/// still references the hash.
#[tauri::command]
pub async fn blobs_has_hash(app: tauri::AppHandle, hash_str: String) -> Result<bool, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let blobs_path = data_dir
        .join("iroh-blobs")
        .join("data")
        .join(&hash_str[..2])
        .join(&hash_str);
    Ok(blobs_path.exists())
}

/// Fast check: are there any blob files in the iroh-blobs FsStore?
/// Used to decide whether to skip blob re-provisioning.
/// Returns true if at least one blob prefix subdirectory has content.
#[tauri::command]
pub async fn blobs_store_is_populated(app: tauri::AppHandle) -> Result<bool, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let blobs_sub = data_dir.join("iroh-blobs").join("data");
    if !blobs_sub.exists() {
        return Ok(false);
    }
    match std::fs::read_dir(&blobs_sub) {
        Ok(mut entries) => Ok(entries.any(|e| {
            e.ok().is_some_and(|entry| {
                entry.path().is_dir()
                    && entry.file_type().ok().is_some_and(|ft| ft.is_dir())
                    && std::fs::read_dir(entry.path())
                        .ok()
                        .is_some_and(|mut inner| inner.next().is_some())
            })
        })),
        Err(_) => Ok(false),
    }
}

/// Clear all sync databases (iroh-blobs FsStore + iroh-docs redb).
/// Called from `clearAllApplicationStorage` so wiped-app-data re-syncs
/// don't show stale old blob storage usage.
#[tauri::command]
pub async fn clear_sync_databases(app: tauri::AppHandle) -> Result<(), String> {
    // First stop the iroh endpoint so databases aren't in use
    iroh_stop(app.clone()).await?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    let blobs_path = data_dir.join("iroh-blobs");
    let docs_path = data_dir.join("iroh-docs");
    let key_path = data_dir.join("iroh-key");
    let paired_path = data_dir.join("sync-paired-devices.json");

    let _ = std::fs::remove_dir_all(&blobs_path);
    let _ = std::fs::remove_dir_all(&docs_path);
    let _ = std::fs::remove_file(&key_path);
    let _ = std::fs::remove_file(&paired_path);

    eprintln!("[iroh-sync] Cleared sync databases, identity key, and paired devices");
    Ok(())
}
