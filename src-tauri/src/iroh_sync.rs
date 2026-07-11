//! Theorem — iroh P2P Sync Transport
//!
//! Unified iroh QUIC transport. Sync flows through iroh-docs CRDT for metadata
//! and iroh-blobs for file transfer. QR-based device pairing uses a custom ALPN.
//! Legacy LWW protocol (manifest/push/pull/complete/file/cover over QUIC) removed.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use iroh::endpoint::{self, presets::N0, RelayMode};
use iroh::protocol::{ProtocolHandler, Router};
use iroh::{PublicKey, SecretKey};
use iroh_docs::engine::LiveEvent;
use tauri::Emitter;
use tokio::sync::Mutex;

use theorem_sync_core::sync_crypto;
use theorem_sync_core::sync_persistence;
use theorem_sync_core::sync_protocol::{PairedDevice, PairingRequest, PairingResponse};

const ALPN: &[u8] = b"theorem-sync/v1";
pub const ALPN_BYTES: &[u8] = ALPN;

// ─── iroh Wire Envelope (used only for pairing) ───

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct IrohEnvelope {
    #[serde(rename = "t")]
    msg_type: String,
    #[serde(rename = "d")]
    data: serde_json::Value,
}

// ─── Peer Info ───

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IrohPeerInfo {
    pub public_key: PublicKey,
    pub device_id: String,
    pub device_name: String,
    pub fingerprint: String,
}

// ─── Sync Transport State ───

/// Shared state needed by the iroh Router and Tauri commands.
/// Owned by `sync_commands` and passed via Arc.
pub struct SyncTransportState {
    pub app_handle: tauri::AppHandle,
    pub device_id: String,
    pub fingerprint: String,
    pub device_name: String,
    pub app_data_dir: PathBuf,
    pub paired_devices: Mutex<HashMap<String, PairedDevice>>,
    pub docs_api: Mutex<Option<DocsApiSnapshot>>,
}

/// Snapshot of the iroh-docs API client + author, stored after Router startup.
/// Tauri commands access this to read/write sync entries.
#[derive(Clone)]
pub struct DocsApiSnapshot {
    pub api: iroh_docs::api::DocsApi,
    pub author: iroh_docs::AuthorId,
    pub blobs: iroh_blobs::api::Store,
}

// ─── Iroh Sync Endpoint ───

pub struct IrohSyncEndpoint {
    pub endpoint: iroh::endpoint::Endpoint,
    pub public_key: PublicKey,
    pub peer_info: IrohPeerInfo,
    peers: Mutex<HashMap<String, IrohPeerInfo>>,
}

impl IrohSyncEndpoint {
    pub async fn new(
        key_path: &PathBuf,
        device_id: String,
        device_name: String,
        fingerprint: String,
    ) -> Result<Self, String> {
        let secret_key = load_or_create_key(key_path)?;
        let public_key = secret_key.public();
        let endpoint = iroh::endpoint::Endpoint::builder(N0)
            .secret_key(secret_key)
            .alpns(vec![
                ALPN.to_vec(),
                iroh_blobs::ALPN.to_vec(),
                iroh_docs::ALPN.to_vec(),
                iroh_gossip::ALPN.to_vec(),
            ])
            .relay_mode(RelayMode::Default)
            .bind()
            .await
            .map_err(|e| format!("iroh bind: {e}"))?;
        let peer_info = IrohPeerInfo {
            public_key,
            device_id: device_id.clone(),
            device_name,
            fingerprint,
        };
        Ok(Self {
            endpoint,
            public_key,
            peer_info,
            peers: Mutex::new(HashMap::new()),
        })
    }

    pub fn public_key_string(&self) -> String {
        self.public_key.to_string()
    }

    pub async fn add_peer(&self, peer: IrohPeerInfo) {
        self.peers.lock().await.insert(peer.device_id.clone(), peer);
    }

    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

// ─── Key Management ───

pub fn load_or_create_key(path: &PathBuf) -> Result<SecretKey, String> {
    if let Ok(bytes) = std::fs::read(path) {
        if let Ok(arr) = <[u8; 32]>::try_from(bytes) {
            return Ok(SecretKey::from_bytes(&arr));
        }
    }
    let key = SecretKey::generate();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).ok();
    }
    std::fs::write(path, key.to_bytes()).map_err(|e| e.to_string())?;
    Ok(key)
}

// ─── Stream I/O (for pairing) ───

async fn send_on_bi(
    send: &mut iroh::endpoint::SendStream,
    data: &impl serde::Serialize,
) -> Result<(), String> {
    let json = serde_json::to_vec(data).map_err(|e| format!("serialize: {e}"))?;
    let len = (json.len() as u32).to_be_bytes();
    send.write_all(&len)
        .await
        .map_err(|e| format!("write len: {e}"))?;
    send.write_all(&json)
        .await
        .map_err(|e| format!("write body: {e}"))?;
    send.finish().map_err(|e| format!("finish: {e}"))
}

async fn recv_from_bi(recv: &mut iroh::endpoint::RecvStream) -> Result<Vec<u8>, String> {
    let mut lb = [0u8; 4];
    recv.read_exact(&mut lb)
        .await
        .map_err(|e| format!("read len: {e}"))?;
    let len = u32::from_be_bytes(lb) as usize;
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf)
        .await
        .map_err(|e| format!("read body: {e}"))?;
    Ok(buf)
}

// ─── Full iroh Stack: Docs + Blobs + Gossip + Router ───

/// Subscribe to iroh-docs live events for a document and emit Tauri events
/// to the frontend when entries change. Enables real-time Zustand updates.
///
/// Always tries get_bytes immediately on InsertRemote (content may be
/// available if downloaded during the sync session). If not available,
/// tracks the entry and waits for ContentReady / PendingContentReady.
/// Also emits docs-sync-finished and docs-pending-content-ready events
/// for the frontend to detect sync completion.
pub fn subscribe_doc_events(
    app: tauri::AppHandle,
    doc: iroh_docs::api::Doc,
    blobs: iroh_blobs::api::Store,
) {
    tokio::spawn(async move {
        let mut stream = match doc.subscribe().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[iroh-sync] Failed to subscribe to doc events: {e}");
                return;
            }
        };
        use futures::StreamExt;
        let mut pending: std::collections::HashMap<iroh_blobs::Hash, String> =
            std::collections::HashMap::new();

        while let Some(event) = stream.next().await {
            match event {
                Ok(LiveEvent::InsertRemote { entry, .. }) => {
                    let key = String::from_utf8_lossy(entry.key()).to_string();
                    let hash = entry.content_hash();
                    if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                        if let Ok(value) = String::from_utf8(content.to_vec()) {
                            let app_clone = app.clone();
                            #[derive(serde::Serialize, Clone)]
                            struct EntryPayload {
                                key: String,
                                value: String,
                            }
                            app_clone
                                .emit(
                                    "docs-entry-changed",
                                    EntryPayload {
                                        key: key.clone(),
                                        value,
                                    },
                                )
                                .ok();
                            pending.insert(hash, key);
                        }
                    } else {
                        pending.insert(hash, key);
                    }
                }
                Ok(LiveEvent::ContentReady { hash }) => {
                    if let Some(key) = pending.remove(&hash) {
                        if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                            if let Ok(value) = String::from_utf8(content.to_vec()) {
                                let app_clone = app.clone();
                                #[derive(serde::Serialize, Clone)]
                                struct EntryPayload {
                                    key: String,
                                    value: String,
                                }
                                app_clone
                                    .emit("docs-entry-changed", EntryPayload { key, value })
                                    .ok();
                            }
                        }
                    }
                }
                Ok(LiveEvent::PendingContentReady) => {
                    let remaining: Vec<(iroh_blobs::Hash, String)> = pending.drain().collect();
                    for (hash, key) in remaining {
                        if let Ok(content) = blobs.blobs().get_bytes(hash).await {
                            if let Ok(value) = String::from_utf8(content.to_vec()) {
                                let app_clone = app.clone();
                                #[derive(serde::Serialize, Clone)]
                                struct EntryPayload {
                                    key: String,
                                    value: String,
                                }
                                app_clone
                                    .emit("docs-entry-changed", EntryPayload { key, value })
                                    .ok();
                            }
                        }
                    }
                    #[derive(serde::Serialize, Clone)]
                    struct PendingContentPayload {
                        remaining_count: usize,
                    }
                    let _ = app.emit(
                        "docs-pending-content-ready",
                        PendingContentPayload {
                            remaining_count: pending.len(),
                        },
                    );
                }
                Ok(LiveEvent::SyncFinished(event)) => {
                    #[derive(serde::Serialize, Clone)]
                    struct SyncFinishedPayload {
                        peer: String,
                        synced: bool,
                    }
                    let _ = app.emit(
                        "docs-sync-finished",
                        SyncFinishedPayload {
                            peer: event.peer.to_string(),
                            synced: true,
                        },
                    );
                }
                Err(err) => {
                    eprintln!("[iroh-sync] doc event stream error: {err}");
                }
                _ => {}
            }
        }
        eprintln!("[iroh-sync] doc event stream ended (doc closed or Router shut down)");
    });
}

/// Minimal pairing protocol handler — handles `theorem-sync/v1` ALPN connections
/// for QR-based device pairing. When the scanner connects, reads the pairing
/// request, calls `handle_pair_req`, and sends back the response.
/// Legacy protocol handlers for manifest/push/pull/complete/file/cover were removed.
#[derive(Clone)]
pub struct PairingProtocolHandler {
    pub state: Arc<SyncTransportState>,
}

impl std::fmt::Debug for PairingProtocolHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PairingProtocolHandler").finish()
    }
}

impl ProtocolHandler for PairingProtocolHandler {
    async fn accept(&self, conn: endpoint::Connection) -> Result<(), iroh::protocol::AcceptError> {
        // Stream 1: handshake (IrohPeerInfo from submit_pairing_code) — discard
        match conn.accept_bi().await {
            Ok((_send, mut recv)) => {
                let _ = recv_from_bi(&mut recv).await;
            }
            Err(e) => {
                eprintln!("[iroh-sync] Pairing: handshake accept_bi failed: {e}");
                return Ok(());
            }
        }
        // Stream 2: pairing request (PairingRequest wrapped in IrohEnvelope)
        let (mut send, mut recv) = match conn.accept_bi().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[iroh-sync] Pairing: request accept_bi failed: {e}");
                return Ok(());
            }
        };
        let req_bytes = match recv_from_bi(&mut recv).await {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[iroh-sync] Pairing: recv failed: {e}");
                return Ok(());
            }
        };
        let env: IrohEnvelope = match serde_json::from_slice(&req_bytes) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        if env.msg_type != "pair" {
            return Ok(());
        }
        let resp_val = handle_pair_req(&self.state, &env.data).await;
        let resp_env = IrohEnvelope {
            msg_type: "pair_resp".to_string(),
            data: resp_val,
        };
        let resp_json = match serde_json::to_vec(&resp_env) {
            Ok(j) => j,
            Err(_) => return Ok(()),
        };
        let len = (resp_json.len() as u32).to_be_bytes();
        let _ = send.write_all(&len).await;
        let _ = send.write_all(&resp_json).await;
        let _ = send.finish();
        Ok(())
    }
}

/// Start the iroh Router with Docs (metadata CRDT), Blobs (file transfer),
/// and Gossip (live notifications). Stores the DocsApi in the transport state
/// for Tauri command access. Returns a cancel sender — drop or send `true` to shut down.
pub fn start_accept_loop(
    endpoint: Arc<IrohSyncEndpoint>,
    state: Arc<SyncTransportState>,
) -> tokio::sync::watch::Sender<bool> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

    let router_endpoint = endpoint.endpoint.clone();
    let state_clone = state.clone();
    let data_dir = state.app_data_dir.clone();

    tokio::spawn(async move {
        // ── iroh-blobs: persistent file-backed store ──
        let blobs_path = data_dir.join("iroh-blobs");
        let _ = std::fs::create_dir_all(&blobs_path);
        let blobs = match iroh_blobs::store::fs::FsStore::load(&blobs_path).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[iroh-sync] Failed to load blobs store: {e}");
                return;
            }
        };
        let blobs_handler = iroh_blobs::BlobsProtocol::new(&blobs, None);

        // ── iroh-gossip: P2P messaging ──
        let gossip = iroh_gossip::net::Gossip::builder().spawn(router_endpoint.clone());

        // ── iroh-docs: CRDT metadata sync ──
        let docs_path = data_dir.join("iroh-docs");
        let _ = std::fs::create_dir_all(&docs_path);
        let blobs_store: iroh_blobs::api::Store = blobs.into();
        let blobs_for_cmds = blobs_store.clone();
        let docs_handler = match iroh_docs::protocol::Docs::persistent(docs_path)
            .spawn(router_endpoint.clone(), blobs_store, gossip.clone())
            .await
        {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[iroh-sync] Failed to spawn iroh-docs: {e}");
                return;
            }
        };

        // Store the DocsApi so Tauri commands can read/write entries
        let api = docs_handler.api().clone();
        let author = match api.author_default().await {
            Ok(a) => a,
            Err(_) => match api.author_create().await {
                Ok(a) => a,
                Err(e) => {
                    eprintln!("[iroh-sync] Failed to create docs author: {e}");
                    return;
                }
            },
        };

        let mut docs_api_state = state_clone.docs_api.lock().await;
        *docs_api_state = Some(DocsApiSnapshot {
            api,
            author,
            blobs: blobs_for_cmds,
        });
        drop(docs_api_state);

        // ── Pairing protocol handler ──
        let pairing_handler = PairingProtocolHandler {
            state: state_clone.clone(),
        };

        // ── Router: dispatch by ALPN ──
        let router = Router::builder(router_endpoint)
            .accept(iroh_blobs::ALPN, blobs_handler)
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs_handler)
            .accept(ALPN, pairing_handler)
            .spawn();

        let _ = cancel_rx.changed().await;
        eprintln!("[iroh-sync] Router shutdown requested");
        let _ = router.shutdown().await;
    });

    cancel_tx
}

// ─── Pairing Handler ───

/// Handle an incoming pairing request.
async fn handle_pair_req(
    state: &Arc<SyncTransportState>,
    data: &serde_json::Value,
) -> serde_json::Value {
    let pairing_req: PairingRequest = match serde_json::from_value(data.clone()) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({"error": format!("parse pair req: {e}")}),
    };

    if pairing_req.node_id.is_empty() {
        return serde_json::json!({"error": "pairing request missing node_id"});
    }

    // Save paired device
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let scanner_node_id = pairing_req.node_id.clone();

    let paired = PairedDevice {
        device_id: pairing_req.device_id.clone(),
        device_name: pairing_req.device_name.clone(),
        iroh_node_id: scanner_node_id,

        last_ip: String::new(),
        last_port: 0,
        paired_at: format!("{}Z", now),
        last_sync_at: None,
        fingerprint: pairing_req.fingerprint.clone(),
        peer_relay_url: String::new(),
        sync_doc_id: String::new(),
    };

    let mut devices = state.paired_devices.lock().await;
    if !paired.fingerprint.is_empty() {
        let old_id = devices
            .values()
            .find(|d| d.fingerprint == paired.fingerprint && d.device_id != paired.device_id)
            .map(|d| d.device_id.clone());
        if let Some(id) = old_id {
            devices.remove(&id);
        }
    }
    devices.insert(paired.device_id.clone(), paired);
    let _ = save_paired_devices_to_disk(&state.app_data_dir, &devices);
    drop(devices);

    // Create a shared iroh-docs sync document and generate a DocTicket
    // for the scanner to import.
    let sync_doc_ticket = {
        if let Ok(guard) = state.docs_api.try_lock() {
            if let Some(snapshot) = guard.as_ref() {
                match snapshot.api.create().await {
                    Ok(doc) => {
                        let doc_id = doc.id();
                        let ticket = doc
                            .share(
                                iroh_docs::api::protocol::ShareMode::Write,
                                Default::default(),
                            )
                            .await
                            .map(|t| t.to_string())
                            .unwrap_or_default();
                        // Subscribe to live events for this document
                        subscribe_doc_events(
                            state.app_handle.clone(),
                            doc.clone(),
                            snapshot.blobs.clone(),
                        );
                        // Store the doc_id on the paired device
                        let mut devices = state.paired_devices.lock().await;
                        if let Some(device) = devices.get_mut(&pairing_req.device_id) {
                            device.sync_doc_id = doc_id.to_string();
                        }
                        ticket
                    }
                    Err(_) => String::new(),
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    };

    let response = PairingResponse {
        device_id: state.device_id.clone(),
        device_name: state.device_name.clone(),
        fingerprint: sync_crypto::get_frontend_fingerprint()
            .unwrap_or_else(|| state.fingerprint.clone()),
        sync_doc_ticket,
    };

    serde_json::to_value(response)
        .unwrap_or_else(|e| serde_json::json!({"error": format!("to_value: {e}")}))
}

/// Send a pairing request to a peer over iroh.
pub async fn send_pair_request(
    conn: &endpoint::Connection,
    req: &PairingRequest,
) -> Result<PairingResponse, String> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;
    let env = IrohEnvelope {
        msg_type: "pair".to_string(),
        data: serde_json::to_value(req).map_err(|e| format!("serialize req: {e}"))?,
    };
    send_on_bi(&mut send, &env).await?;
    let resp_bytes = recv_from_bi(&mut recv).await?;
    let resp_env: IrohEnvelope =
        serde_json::from_slice(&resp_bytes).map_err(|e| format!("parse resp: {e}"))?;
    if let Some(err) = resp_env.data.get("error") {
        return Err(err.as_str().unwrap_or("pair error").to_string());
    }
    serde_json::from_value(resp_env.data).map_err(|e| format!("parse pair resp: {e}"))
}

/// Load paired devices from disk.
pub fn load_paired_devices_from_disk(
    app_data_dir: &std::path::Path,
) -> HashMap<String, PairedDevice> {
    sync_persistence::load_paired_devices(app_data_dir)
}

pub fn save_paired_devices_to_disk(
    app_data_dir: &std::path::Path,
    devices: &HashMap<String, PairedDevice>,
) -> Result<(), String> {
    sync_persistence::save_paired_devices(app_data_dir, devices)
}
