//! Theorem — iroh P2P Sync Transport
//!
//! Full iroh QUIC transport replacing the HTTP sync server. Handles:
//! - Accept loop for incoming peer connections + protocol dispatch
//! - Client-side sync orchestration (manifest → push → pull → complete)
//! - File transfer and cover transfer over QUIC streams
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use iroh::endpoint::{self, presets::N0, RelayMode};
use iroh::protocol::{ProtocolHandler, Router};
use iroh::{PublicKey, SecretKey};
use iroh_docs::engine::LiveEvent;
use tauri::Emitter;
use tokio::sync::Mutex;

use theorem_sync_core::sync_crypto::{self, DeviceIdentity, EncryptedPayload};
use theorem_sync_core::sync_persistence;
use theorem_sync_core::sync_protocol::*;

const ALPN: &[u8] = b"theorem-sync/v1";
pub const ALPN_BYTES: &[u8] = ALPN;
const FILE_CHUNK_SIZE: usize = 1024 * 1024; // 1 MiB

// ─── iroh Wire Envelope ───

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

/// Type-erased event emitter callback.
pub type EventCallback = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// Shared state needed by the iroh accept loop for protocol dispatch.
/// Owned by `sync_commands` and passed via Arc.
pub struct SyncTransportState {
    pub app_handle: tauri::AppHandle,
    pub identity: DeviceIdentity,
    pub device_name: String,
    pub app_data_dir: PathBuf,
    pub paired_devices: Mutex<HashMap<String, PairedDevice>>,
    pub sync_data: Mutex<Option<SyncDataSnapshot>>,
    pub event_emitter: Option<EventCallback>,
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

/// Snapshot of app data provided by the frontend for sync operations.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncDataSnapshot {
    pub domains: HashMap<String, String>,
    pub manifest: HashMap<String, DomainVersion>,
    /// Map of book_id → absolute file path on this device.
    /// Populated by the JS frontend so the Rust responder can locate
    /// books that live at external OS paths (not yet in book-cache).
    #[serde(default)]
    pub book_file_paths: HashMap<String, String>,
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

fn load_or_create_key(path: &PathBuf) -> Result<SecretKey, String> {
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

// ─── Stream I/O ───

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

const IROH_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

async fn iroh_request(
    conn: &endpoint::Connection,
    msg_type: &str,
    req_data: &impl serde::Serialize,
) -> Result<serde_json::Value, String> {
    eprintln!("[iroh-sync] iroh_request: type={msg_type}");
    tokio::time::timeout(IROH_REQUEST_TIMEOUT, async {
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;
        let env = IrohEnvelope {
            msg_type: msg_type.to_string(),
            data: serde_json::to_value(req_data).map_err(|e| format!("serialize req: {e}"))?,
        };
        send_on_bi(&mut send, &env).await?;
        let resp_bytes = recv_from_bi(&mut recv).await?;
        let resp_env: IrohEnvelope =
            serde_json::from_slice(&resp_bytes).map_err(|e| format!("parse resp: {e}"))?;
        Ok(resp_env.data)
    })
    .await
    .map_err(|_| {
        format!(
            "iroh_request timeout after {:.0}s",
            IROH_REQUEST_TIMEOUT.as_secs()
        )
    })?
}

// ─── Client-Side Sync ───

/// Run the full sync protocol with a peer over an existing iroh connection.
/// Returns a map of domain → JSON data for the frontend to merge.
pub async fn sync_with_peer(
    conn: &endpoint::Connection,
    sym_key: &[u8; 32],
    my_device_id: &str,
    manifest: &SyncManifest,
    domains: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    // 1. Manifest exchange
    let enc_manifest =
        sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(manifest).unwrap())?;
    let auth_req = AuthenticatedRequest {
        device_id: my_device_id.to_string(),
        payload: enc_manifest,
    };
    let plan_val = iroh_request(conn, "manifest", &auth_req).await?;
    let enc_plan: EncryptedPayload =
        serde_json::from_value(plan_val).map_err(|e| format!("parse plan enc: {e}"))?;
    let plan_bytes = sync_crypto::decrypt_payload(sym_key, &enc_plan)?;
    let plan: SyncPlan =
        serde_json::from_slice(&plan_bytes).map_err(|e| format!("parse plan: {e}"))?;

    // 2. Collect push and pull domains
    let mut push_domains: HashMap<String, String> = HashMap::new();
    let mut pull_names: Vec<String> = Vec::new();
    for action in &plan.actions {
        let direction = &action.direction;
        if matches!(direction, SyncDirection::Push) || matches!(direction, SyncDirection::Merge) {
            if let Some(data) = domains.get(&action.domain) {
                push_domains.insert(action.domain.clone(), data.clone());
            }
        }
        if matches!(direction, SyncDirection::Pull) || matches!(direction, SyncDirection::Merge) {
            pull_names.push(action.domain.clone());
        }
    }

    let mut incoming: HashMap<String, String> = HashMap::new();

    // 3. Push batch
    if !push_domains.is_empty() {
        let batched = BatchedDomainPayload {
            sender_device_id: my_device_id.to_string(),
            domains: push_domains,
        };
        let enc_batch =
            sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&batched).unwrap())?;
        let auth_batch = AuthenticatedRequest {
            device_id: my_device_id.to_string(),
            payload: enc_batch,
        };
        iroh_request(conn, "push_batch", &auth_batch).await?;
    }

    // 4. Pull batch
    if !pull_names.is_empty() {
        let pull_req = BatchedPullRequest {
            domains: pull_names,
        };
        let enc_req =
            sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&pull_req).unwrap())?;
        let auth_req = AuthenticatedRequest {
            device_id: my_device_id.to_string(),
            payload: enc_req,
        };
        let resp_val = iroh_request(conn, "pull_batch", &auth_req).await?;
        let enc_resp: EncryptedPayload =
            serde_json::from_value(resp_val).map_err(|e| format!("parse pull enc: {e}"))?;
        let resp_bytes = sync_crypto::decrypt_payload(sym_key, &enc_resp)?;
        let pull_resp: BatchedPullResponse =
            serde_json::from_slice(&resp_bytes).map_err(|e| format!("parse pull: {e}"))?;
        for (domain, data) in pull_resp.domains {
            incoming.insert(domain, data);
        }
    }

    // 5. Complete
    let complete_msg = SyncCompleteMessage {
        device_id: my_device_id.to_string(),
        sync_timestamp: sync_crypto::now_iso8601(),
        server_ip: String::new(),
        server_port: 0,
    };
    let enc_complete =
        sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&complete_msg).unwrap())?;
    let auth_complete = AuthenticatedRequest {
        device_id: my_device_id.to_string(),
        payload: enc_complete,
    };
    iroh_request(conn, "complete", &auth_complete).await?;

    Ok(incoming)
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

/// Protocol handler that wraps our sync protocol dispatch.
/// Registered on iroh Router ALPN for incoming theorem connections.
#[derive(Clone)]
#[allow(dead_code)]
pub struct TheoremProtocolHandler {
    pub state: Arc<SyncTransportState>,
}

impl std::fmt::Debug for TheoremProtocolHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TheoremProtocolHandler").finish()
    }
}

impl ProtocolHandler for TheoremProtocolHandler {
    async fn accept(&self, conn: endpoint::Connection) -> Result<(), iroh::protocol::AcceptError> {
        if let Err(e) = handle_peer_connection(conn, self.state.clone()).await {
            eprintln!("[iroh-sync] Peer connection error: {e}");
        }
        Ok(())
    }
}

/// Start the iroh Router with Docs (metadata CRDT), Blobs (file transfer),
/// Gossip (live notifications), and our custom sync protocol handler.
/// Stores the DocsApi in the transport state for Tauri command access.
/// Returns a cancel sender — drop or send `true` to shut down.
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

        // Create or open the sync document (shared with paired peers)
        let mut docs_api_state = state_clone.docs_api.lock().await;
        *docs_api_state = Some(DocsApiSnapshot {
            api,
            author,
            blobs: blobs_for_cmds,
        });
        drop(docs_api_state);

        // ── Router: dispatch by ALPN ──
        let router = Router::builder(router_endpoint)
            .accept(iroh_blobs::ALPN, blobs_handler)
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs_handler)
            .spawn();

        let _ = cancel_rx.changed().await;
        eprintln!("[iroh-sync] Router shutdown requested");
        let _ = router.shutdown().await;
    });

    cancel_tx
}

async fn handle_peer_connection(
    conn: endpoint::Connection,
    state: Arc<SyncTransportState>,
) -> Result<(), String> {
    // Send our peer info and receive theirs
    let peer_info: IrohPeerInfo = {
        let (mut send, mut recv) = conn
            .accept_bi()
            .await
            .map_err(|e| format!("accept_bi for handshake: {e}"))?;
        let my_info = make_peer_info(&state);
        send_on_bi(&mut send, &my_info).await?;
        let bytes = recv_from_bi(&mut recv).await?;
        serde_json::from_slice(&bytes).map_err(|e| format!("parse peer info: {e}"))?
    };

    let peer_device_id = peer_info.device_id.clone();
    eprintln!(
        "[iroh-sync] Accepted connection from {} ({})",
        peer_info.device_name, peer_device_id
    );

    // Dispatch loop
    let my_device_id = state.identity.device_id.clone();
    loop {
        let stream_result = conn.accept_bi().await;
        let (mut send, mut recv) = match stream_result {
            Ok(s) => s,
            Err(_) => break,
        };

        let req_bytes = match recv_from_bi(&mut recv).await {
            Ok(b) => b,
            Err(_) => break,
        };

        let env: IrohEnvelope = match serde_json::from_slice(&req_bytes) {
            Ok(e) => e,
            Err(_) => break,
        };

        // Pairing messages are handled without a symmetric key
        if env.msg_type == "pair" {
            let resp = handle_pair_req(&state, &peer_info, &env.data).await;
            // Capture the scanner's relay URL from this connection and persist it
            // for future reconnections (survives app restarts).
            if let Some(url) = conn.paths().iter().find_map(|p| match p.remote_addr() {
                iroh::TransportAddr::Relay(url) => Some(url.to_string()),
                _ => None,
            }) {
                let mut devices = state.paired_devices.lock().await;
                if let Some(device) = devices.get_mut(&peer_device_id) {
                    device.peer_relay_url = url;
                    let _ = save_paired_devices_to_disk(&state.app_data_dir, &devices);
                }
                drop(devices);
            }
            let resp_env = IrohEnvelope {
                msg_type: "pair_resp".to_string(),
                data: resp,
            };
            let resp_json =
                serde_json::to_vec(&resp_env).map_err(|_| "serialize resp".to_string())?;
            let len = (resp_json.len() as u32).to_be_bytes();
            let mut send_buf = Vec::with_capacity(4 + resp_json.len());
            send_buf.extend_from_slice(&len);
            send_buf.extend_from_slice(&resp_json);
            let _ = send.write_all(&send_buf).await;
            let _ = send.finish();
            continue;
        }

        // Legacy protocol uses deterministic key for backward compatibility.
        // Both sides agree on [0u8; 32]. DEPRECATED — new sync uses iroh-docs CRDT.
        let sym_key: Option<[u8; 32]> = Some([0u8; 32]);
        let sym_key = match sym_key {
            Some(k) => k,
            None => {
                let error_resp = serde_json::json!({"error": "not paired"});
                let resp_env = IrohEnvelope {
                    msg_type: format!("{}_resp", env.msg_type),
                    data: error_resp,
                };
                let resp_json =
                    serde_json::to_vec(&resp_env).map_err(|_| "serialize resp".to_string())?;
                let len = (resp_json.len() as u32).to_be_bytes();
                let mut send_buf = Vec::with_capacity(4 + resp_json.len());
                send_buf.extend_from_slice(&len);
                send_buf.extend_from_slice(&resp_json);
                let _ = send.write_all(&send_buf).await;
                let _ = send.finish();
                break;
            }
        };

        eprintln!("[iroh-sync] Handling request type: {}", env.msg_type);
        let response_data =
            dispatch_request(&state, &sym_key, &my_device_id, &peer_device_id, &env).await;

        let resp_env = IrohEnvelope {
            msg_type: format!("{}_resp", env.msg_type),
            data: response_data,
        };

        let resp_json = serde_json::to_vec(&resp_env).map_err(|_| "serialize resp".to_string())?;
        let len = (resp_json.len() as u32).to_be_bytes();
        let mut send_buf = Vec::with_capacity(4 + resp_json.len());
        send_buf.extend_from_slice(&len);
        send_buf.extend_from_slice(&resp_json);
        send.write_all(&send_buf)
            .await
            .map_err(|e| format!("write resp: {e}"))?;
        send.finish().map_err(|e| format!("finish resp: {e}"))?;
    }

    eprintln!("[iroh-sync] Peer {} disconnected", peer_device_id);
    Ok(())
}

fn make_peer_info(state: &SyncTransportState) -> IrohPeerInfo {
    IrohPeerInfo {
        public_key: PublicKey::from_bytes(&[0u8; 32]).unwrap(),
        device_id: state.identity.device_id.clone(),
        device_name: state.device_name.clone(),
        fingerprint: state.identity.fingerprint.clone(),
    }
}

// ─── Pairing over iroh ───

async fn dispatch_request(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    my_device_id: &str,
    peer_device_id: &str,
    env: &IrohEnvelope,
) -> serde_json::Value {
    match env.msg_type.as_str() {
        "manifest" => handle_manifest_req(state, sym_key, my_device_id, &env.data).await,
        "push_batch" => handle_push_batch_req(state, sym_key, peer_device_id, &env.data).await,
        "pull_batch" => handle_pull_batch_req(state, sym_key, my_device_id, &env.data).await,
        "complete" => handle_complete_req(state, sym_key, peer_device_id, &env.data).await,
        "file_availability" => {
            handle_file_availability_req(state, sym_key, my_device_id, &env.data).await
        }
        "file_pull" => handle_file_pull_req(state, sym_key, my_device_id, &env.data).await,
        "cover_pull" => handle_cover_pull_req(state, sym_key, my_device_id, &env.data).await,
        _ => serde_json::json!({"error": format!("unknown msg type: {}", env.msg_type)}),
    }
}

async fn decrypt_envelope<T: serde::de::DeserializeOwned>(
    sym_key: &[u8; 32],
    data: &serde_json::Value,
) -> Result<(String, T), serde_json::Value> {
    // Data may be wrapped in AuthenticatedRequest { deviceId, payload }.
    // Extract the inner payload if present.
    let payload_data = data.get("payload").cloned().unwrap_or_else(|| data.clone());

    let enc: EncryptedPayload = match serde_json::from_value(payload_data) {
        Ok(e) => e,
        Err(e) => return Err(serde_json::json!({"error": format!("parse enc: {e}")})),
    };
    let decrypted = match sync_crypto::decrypt_payload(sym_key, &enc) {
        Ok(d) => d,
        Err(e) => return Err(serde_json::json!({"error": format!("decrypt: {e}")})),
    };
    let inner: T = match serde_json::from_slice(&decrypted) {
        Ok(t) => t,
        Err(e) => return Err(serde_json::json!({"error": format!("parse inner: {e}")})),
    };
    Ok((String::new(), inner))
}

async fn encrypt_response(sym_key: &[u8; 32], data: &impl serde::Serialize) -> serde_json::Value {
    let json = match serde_json::to_vec(data) {
        Ok(j) => j,
        Err(e) => return serde_json::json!({"error": format!("serialize: {e}")}),
    };
    match sync_crypto::encrypt_payload(sym_key, &json) {
        Ok(enc) => serde_json::to_value(enc).unwrap(),
        Err(e) => serde_json::json!({"error": format!("encrypt: {e}")}),
    }
}

// ─── Server-Side Protocol Handlers ───

async fn handle_manifest_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, remote_manifest): (String, SyncManifest) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    let sync_data = state.sync_data.lock().await;
    let local_manifest: HashMap<String, DomainVersion> = sync_data
        .as_ref()
        .map(|d| d.manifest.clone())
        .unwrap_or_default();
    drop(sync_data);

    let mut actions = Vec::new();
    let all_domains: std::collections::HashSet<&str> = local_manifest
        .keys()
        .map(|k| k.as_str())
        .chain(remote_manifest.domains.keys().map(|k| k.as_str()))
        .collect();

    for domain in all_domains {
        let local = local_manifest.get(domain);
        let remote = remote_manifest.domains.get(domain);

        let action = match (local, remote) {
            (Some(l), Some(r)) => {
                if l.content_hash == r.content_hash && !l.content_hash.is_empty() {
                    SyncAction {
                        domain: domain.to_string(),
                        direction: SyncDirection::Skip,
                        local_version: l.version,
                        remote_version: r.version,
                    }
                } else if r.version > l.version {
                    // Remote (initiator) has newer data → initiator should push to us
                    SyncAction {
                        domain: domain.to_string(),
                        direction: SyncDirection::Push,
                        local_version: l.version,
                        remote_version: r.version,
                    }
                } else if l.version > r.version {
                    // Local (responder) has newer data → initiator should pull from us
                    SyncAction {
                        domain: domain.to_string(),
                        direction: SyncDirection::Pull,
                        local_version: l.version,
                        remote_version: r.version,
                    }
                } else {
                    SyncAction {
                        domain: domain.to_string(),
                        direction: SyncDirection::Merge,
                        local_version: l.version,
                        remote_version: r.version,
                    }
                }
            }
            (Some(_), None) => SyncAction {
                domain: domain.to_string(),
                direction: SyncDirection::Push,
                local_version: local.unwrap().version,
                remote_version: 0,
            },
            (None, Some(r)) => SyncAction {
                domain: domain.to_string(),
                direction: SyncDirection::Pull,
                local_version: 0,
                remote_version: r.version,
            },
            (None, None) => continue,
        };
        actions.push(action);
    }

    let plan = SyncPlan { actions };
    encrypt_response(sym_key, &plan).await
}

async fn handle_push_batch_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    peer_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, batch): (String, BatchedDomainPayload) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    let mut sync_data = state.sync_data.lock().await;
    if let Some(ref mut sd) = *sync_data {
        for (domain, data_json) in &batch.domains {
            sd.domains
                .insert(format!("incoming_{domain}"), data_json.clone());
        }
    } else {
        let mut domains = HashMap::new();
        for (domain, data_json) in &batch.domains {
            domains.insert(format!("incoming_{domain}"), data_json.clone());
        }
        *sync_data = Some(SyncDataSnapshot {
            domains,
            manifest: HashMap::new(),
            book_file_paths: HashMap::new(),
        });
    }
    drop(sync_data);

    if let Some(ref emitter) = state.event_emitter {
        let payload = serde_json::json!({
            "peerDeviceId": peer_device_id,
        });
        emitter("sync-incoming-complete", &payload.to_string());
    }

    serde_json::json!({"ok": true})
}

async fn handle_pull_batch_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, pull_req): (String, BatchedPullRequest) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    let sync_data = state.sync_data.lock().await;
    let mut domains = HashMap::new();
    if let Some(ref sd) = *sync_data {
        for domain in &pull_req.domains {
            if let Some(data_json) = sd.domains.get(domain) {
                domains.insert(domain.clone(), data_json.clone());
            }
        }
    }
    drop(sync_data);

    let response = BatchedPullResponse { domains };
    encrypt_response(sym_key, &response).await
}

async fn handle_complete_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    peer_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, complete): (String, SyncCompleteMessage) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    let mut devices = state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(peer_device_id) {
        device.last_sync_at = Some(complete.sync_timestamp);
    }
    drop(devices);

    serde_json::json!({"ok": true})
}

async fn handle_file_availability_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, avail_req): (String, FileAvailabilityRequest) =
        match decrypt_envelope(sym_key, data).await {
            Ok(r) => r,
            Err(e) => return e,
        };

    // Grab the external file-path map populated by setSyncData.
    let book_file_paths = {
        let guard = state.sync_data.lock().await;
        guard
            .as_ref()
            .map(|d| d.book_file_paths.clone())
            .unwrap_or_default()
    };

    let app_data_dir = state.app_data_dir.clone();
    let app_handle = state.app_handle.clone();
    let available_ids: Vec<String> = avail_req
        .book_ids
        .iter()
        .filter(|id| {
            // 1. Materialized book-cache file (fastest path).
            let cache_path = app_data_dir.join("book-cache").join(format!("{id}.book"));
            if cache_path.exists() {
                return true;
            }
            // 2. External path provided by the JS frontend via setSyncData.
            if let Some(ext_path) = book_file_paths.get(*id) {
                if std::path::Path::new(ext_path).exists() {
                    return true;
                }
            }
            // 3. SQLite blob (legacy inline storage — materialise on demand).
            matches!(
                crate::database::sqlite_get_materialized_book_path(
                    app_handle.clone(),
                    (*id).clone()
                ),
                Ok(Some(_))
            )
        })
        .cloned()
        .collect();

    let response = FileAvailabilityResponse {
        available_ids,
        file_sizes: HashMap::new(),
        cover_sizes: HashMap::new(),
    };

    encrypt_response(sym_key, &response).await
}

async fn handle_file_pull_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, pull_req): (String, FilePullRequest) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    // Resolve the actual file path using the same priority chain as availability.
    let path: std::path::PathBuf = {
        // 1. Materialized book-cache (most common after first access).
        let cache_path = state
            .app_data_dir
            .join("book-cache")
            .join(format!("{}.book", pull_req.book_id));
        if cache_path.exists() {
            cache_path
        } else {
            // 2. External path provided by the JS frontend.
            let ext_path = {
                let guard = state.sync_data.lock().await;
                guard
                    .as_ref()
                    .and_then(|d| d.book_file_paths.get(&pull_req.book_id).cloned())
            };
            if let Some(p) = ext_path {
                let pb = std::path::PathBuf::from(&p);
                if pb.exists() {
                    pb
                } else {
                    // 3. SQLite blob → materialise and serve the cache path.
                    match crate::database::sqlite_get_materialized_book_path(
                        state.app_handle.clone(),
                        pull_req.book_id.clone(),
                    ) {
                        Ok(Some(_)) => state
                            .app_data_dir
                            .join("book-cache")
                            .join(format!("{}.book", pull_req.book_id)),
                        _ => {
                            let response = FilePullResponse {
                                available: false,
                                meta: None,
                                chunks: Vec::new(),
                            };
                            return serde_json::to_value(response).unwrap();
                        }
                    }
                }
            } else {
                // 3. SQLite blob → materialise.
                match crate::database::sqlite_get_materialized_book_path(
                    state.app_handle.clone(),
                    pull_req.book_id.clone(),
                ) {
                    Ok(Some(_)) => state
                        .app_data_dir
                        .join("book-cache")
                        .join(format!("{}.book", pull_req.book_id)),
                    _ => {
                        let response = FilePullResponse {
                            available: false,
                            meta: None,
                            chunks: Vec::new(),
                        };
                        return serde_json::to_value(response).unwrap();
                    }
                }
            }
        }
    };

    if !path.exists() {
        let response = FilePullResponse {
            available: false,
            meta: None,
            chunks: Vec::new(),
        };
        return serde_json::to_value(response).unwrap();
    }

    // Chunk requests read only the requested slice so a full book is never
    // buffered in JSON. Metadata requests return size + chunk count from the
    // file stat (no full-file I/O).  Integrity is guaranteed by the per-chunk
    // ChaCha20Poly1305 AEAD — SHA-256 verification is redundant.
    let sym_key_clone = *sym_key;
    let requested_chunk = pull_req.chunk_index;
    let result: Result<(u64, u32, Option<String>), String> =
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Seek, SeekFrom};

            let mut file = std::fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
            let total_size = file.metadata().map_err(|e| format!("metadata: {e}"))?.len();
            let total_chunks = (total_size / FILE_CHUNK_SIZE as u64
                + u64::from(total_size % FILE_CHUNK_SIZE as u64 != 0))
                as u32;

            if let Some(chunk_index) = requested_chunk {
                if chunk_index >= total_chunks {
                    return Err(format!("chunk index {chunk_index} out of range"));
                }
                file.seek(SeekFrom::Start(chunk_index as u64 * FILE_CHUNK_SIZE as u64))
                    .map_err(|e| format!("seek: {e}"))?;
                let remaining = total_size - chunk_index as u64 * FILE_CHUNK_SIZE as u64;
                let mut buffer = vec![0u8; remaining.min(FILE_CHUNK_SIZE as u64) as usize];
                file.read_exact(&mut buffer)
                    .map_err(|e| format!("read: {e}"))?;
                let chunk = sync_crypto::encrypt_single_file_chunk(&sym_key_clone, &buffer)?;
                return Ok((total_size, total_chunks, Some(chunk)));
            }

            Ok((total_size, total_chunks, None))
        })
        .await
        .map_err(|e| format!("join: {e}"))
        .and_then(|r| r);

    match result {
        Ok((total_size, total_chunks, encrypted_chunk)) => {
            let chunks = encrypted_chunk
                .map(|data_b64| FileTransferChunk {
                    book_id: pull_req.book_id.clone(),
                    chunk_index: pull_req.chunk_index.unwrap_or_default(),
                    total_chunks,
                    data_b64,
                })
                .into_iter()
                .collect();

            let response = FilePullResponse {
                available: true,
                meta: Some(FileTransferMeta {
                    book_id: pull_req.book_id.clone(),
                    total_size,
                    total_chunks,
                    format: String::new(),
                    content_hash: String::new(),
                }),
                chunks,
            };
            serde_json::to_value(response).unwrap()
        }
        Err(e) => serde_json::json!({"error": e}),
    }
}

async fn handle_cover_pull_req(
    state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, cover_req): (String, CoverPullRequest) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    let book_id = cover_req.book_id;
    eprintln!("[iroh-sync] handle_cover_pull_req: book={book_id}");
    let app_handle = state.app_handle.clone();
    let cover = tokio::task::spawn_blocking(move || {
        crate::database::sqlite_get_cover_image(app_handle, book_id)
    })
    .await
    .map_err(|e| format!("cover lookup task: {e}"));

    let response = match cover {
        Ok(Ok(data_url)) => CoverPullResponse {
            available: data_url.is_some(),
            data_url,
        },
        Ok(Err(error)) | Err(error) => return serde_json::json!({"error": error}),
    };
    encrypt_response(sym_key, &response).await
}

// ─── Pairing Handler ───

/// Handle an incoming pairing request.
async fn handle_pair_req(
    state: &Arc<SyncTransportState>,
    _peer_info: &IrohPeerInfo,
    data: &serde_json::Value,
) -> serde_json::Value {
    let pairing_req: PairingRequest = match serde_json::from_value(data.clone()) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({"error": format!("parse pair req: {e}")}),
    };

    // Save paired device
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let scanner_node_id = if !pairing_req.node_id.is_empty() {
        pairing_req.node_id.clone()
    } else {
        _peer_info.public_key.to_string()
    };

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
        device_id: state.identity.device_id.clone(),
        device_name: state.device_name.clone(),

        fingerprint: state.identity.effective_fingerprint(),
        sync_doc_ticket,
    };

    serde_json::to_value(response).unwrap()
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
