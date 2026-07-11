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
use tauri::Manager;
use tokio::sync::Mutex;

// ─── Global iroh endpoint ───

static IROH_ENDPOINT: std::sync::OnceLock<Arc<IrohSyncEndpoint>> = std::sync::OnceLock::new();

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
    if let Some(ep) = IROH_ENDPOINT.get() {
        return Ok(ep.clone());
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

    let qr_payload = PairingQrPayload {
        version: 1,
        node_id: ep.public_key_string(),
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| sync_state.transport_state.fingerprint.clone()),
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

    // Connect to host via iroh
    let peer_pk: iroh::PublicKey = qr_payload
        .node_id
        .parse()
        .map_err(|e| format!("Invalid host node_id: {e}"))?;
    let host_addr = iroh::EndpointAddr::new(peer_pk);

    let conn = ep
        .endpoint
        .connect(host_addr, crate::iroh_sync::ALPN_BYTES)
        .await
        .map_err(|e| format!("Connect to host failed: {e}"))?;

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
    };

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

        last_ip: String::new(),
        last_port: 0,
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
                    // Subscribe to live events
                    if let Ok(blobs) = get_blobs_store(&app) {
                        iroh_sync::subscribe_doc_events(app.clone(), doc, blobs);
                    }
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
        device_id: sync_state.transport_state.device_id.clone(),
        device_name: sync_state.transport_state.device_name.clone(),
        public_key_hex: String::new(),
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
            if let Ok(stream) = doc.get_many(iroh_docs::store::Query::all().build()).await {
                pin_mut!(stream);
                while let Some(entry_res) = stream.next().await {
                    if let Ok(entry) = entry_res {
                        let key = String::from_utf8_lossy(entry.key()).to_string();
                        let hash = entry.content_hash();
                        if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                            if let Ok(value) = String::from_utf8(content.to_vec()) {
                                per_key.entry(key).or_default().push(value);
                            }
                        }
                    }
                }
            }
        }
    }

    // Merge values for each key: if multiple authors wrote to the same key,
    // merge them appropriately based on value type:
    // - JSON arrays -> concatenate (dedup happens on the JS side via mergeBooks etc.)
    // - JSON objects -> merge top-level keys (for settings, reading_stats)
    // - Other types -> last writer wins
    let mut results = std::collections::HashMap::new();
    for (key, values) in per_key {
        if values.len() == 1 {
            results.insert(key, values.into_iter().next().unwrap());
        } else {
            // Check if all values are JSON objects (settings, reading_stats)
            let parsed: Vec<serde_json::Value> = values
                .iter()
                .filter_map(|v| serde_json::from_str(v).ok())
                .collect();

            let all_objects = parsed.iter().all(|v| v.is_object());
            let all_arrays = parsed.iter().all(|v| v.is_array());

            if all_objects {
                // JSON objects: deep-merge top-level keys. Later authors
                // overwrite earlier authors for the same key. This is correct
                // for settings and reading_stats — small objects where field-
                // level LWW is acceptable.
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
                // JSON arrays: concatenate. The JS mergeIncomingData handles
                // dedup via mergeBooks/mergeAnnotations etc.
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
                // Mixed types or unknown — last writer wins
                results.insert(key, values.into_iter().last().unwrap());
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn docs_sync_now(app: tauri::AppHandle, peer_device_id: String) -> Result<(), String> {
    let api = get_docs_api(&app)?;
    let sync_state = get_sync_state(&app)?;
    let (doc_id, peer_pk, relay_url, ip, port) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let device = devices
            .get(&peer_device_id)
            .ok_or_else(|| "Peer not paired".to_string())?;
        let doc_id: iroh_docs::NamespaceId = if device.sync_doc_id.is_empty() {
            return Err("No sync doc for this peer".to_string());
        } else {
            device
                .sync_doc_id
                .parse()
                .map_err(|e| format!("parse doc id: {e}"))?
        };
        let pk: iroh::PublicKey = device
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (
            doc_id,
            pk,
            device.peer_relay_url.clone(),
            device.last_ip.clone(),
            device.last_port,
        )
    };

    let doc = api
        .open(doc_id)
        .await
        .map_err(|e| format!("open doc: {e}"))?
        .ok_or_else(|| "Sync doc not found locally".to_string())?;

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

    // Check peer reachability BEFORE start_sync (which returns Ok immediately
    // even if peer is offline — it registers for background sync).
    let ep = get_or_init_iroh(&app).await?;
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        ep.endpoint.connect(peer_addr.clone(), iroh_docs::ALPN),
    )
    .await
    .map_err(|_| format!("Peer is offline or unreachable (timeout after 10s)"))?
    .map_err(|_| format!("Peer is offline or unreachable (connection rejected)"))?;

    // Now start the actual CRDT sync
    doc.start_sync(vec![peer_addr])
        .await
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

    let (peer_pk, relay_url, ip, port) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        let pk: iroh::PublicKey = peer
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (
            pk,
            peer.peer_relay_url.clone(),
            peer.last_ip.clone(),
            peer.last_port,
        )
    };

    let hash: iroh_blobs::Hash = hash_str.parse().map_err(|e| format!("parse hash: {e}"))?;

    // Warm up the connection pool with relay/IP hints (same as blobs_download_file).
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
    let _ = ep.endpoint.connect(peer_addr, iroh_blobs::ALPN).await;

    let snapshot = get_docs_snapshot(&app)?;
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

    let (peer_pk, relay_url, ip, port) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        let pk: iroh::PublicKey = peer
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (
            pk,
            peer.peer_relay_url.clone(),
            peer.last_ip.clone(),
            peer.last_port,
        )
    };

    let hash: iroh_blobs::Hash = hash_str.parse().map_err(|e| format!("parse hash: {e}"))?;

    // Establish a connection to the peer with relay/IP hints so the
    // endpoint's connection pool caches it. The blobs downloader
    // reuses this connection; without hints, it would need to resolve
    // the peer via DNS (N0), which may fail on mobile networks.
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
    // Connect to warm up the connection pool; ignore error (download
    // will retry internally if this fails).
    let _ = ep.endpoint.connect(peer_addr, iroh_blobs::ALPN).await;

    let snapshot = get_docs_snapshot(&app)?;
    let downloader = snapshot.blobs.downloader(&ep.endpoint);
    downloader
        .download(hash, Some(peer_pk))
        .await
        .map_err(|e| format!("download: {e}"))?;

    snapshot
        .blobs
        .blobs()
        .export(hash, &dest_path)
        .await
        .map(|_bytes| ())
        .map_err(|e| format!("export blob: {e}"))
}
