//! Theorem — iroh P2P Sync Transport
//!
//! Full iroh QUIC transport replacing the HTTP sync server. Handles:
//! - Accept loop for incoming peer connections + protocol dispatch
//! - Client-side sync orchestration (manifest → push → pull → complete)
//! - File transfer and cover transfer over QUIC streams
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use iroh::endpoint::{self, presets::Minimal, RelayMode};
use iroh::{PublicKey, SecretKey};
use sha2::{Digest, Sha256};
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
    pub identity: DeviceIdentity,
    pub device_name: String,
    pub app_data_dir: PathBuf,
    pub paired_devices: Mutex<HashMap<String, PairedDevice>>,
    pub sync_data: Mutex<Option<SyncDataSnapshot>>,
    pub pending_pairing: Mutex<Option<PendingPairing>>,
    pub event_emitter: Option<EventCallback>,
}

/// Snapshot of app data provided by the frontend for sync operations.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncDataSnapshot {
    pub domains: HashMap<String, String>,
    pub manifest: HashMap<String, DomainVersion>,
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
        let endpoint = iroh::endpoint::Endpoint::builder(Minimal)
            .secret_key(secret_key)
            .alpns(vec![ALPN.to_vec()])
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

async fn iroh_request(
    conn: &endpoint::Connection,
    msg_type: &str,
    req_data: &impl serde::Serialize,
) -> Result<serde_json::Value, String> {
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

// ─── Client-Side File Transfer ───

pub struct FileTransferResult {
    pub transferred: Vec<String>,
    pub failed: Vec<FileTransferError>,
    pub unavailable: Vec<String>,
}

pub struct FileTransferError {
    pub book_id: String,
    pub error: String,
}

pub struct CoverTransferResult {
    pub transferred: Vec<String>,
    pub failed: Vec<FileTransferError>,
    pub unavailable: Vec<String>,
}

/// Pull book files from a peer over an iroh connection.
pub async fn pull_files_via_iroh(
    conn: &endpoint::Connection,
    sym_key: &[u8; 32],
    my_device_id: &str,
    book_ids: &[String],
    cache_dir: &std::path::Path,
) -> Result<FileTransferResult, String> {
    let mut result = FileTransferResult {
        transferred: Vec::new(),
        failed: Vec::new(),
        unavailable: Vec::new(),
    };

    // Check availability first
    let avail_req = FileAvailabilityRequest {
        book_ids: book_ids.to_vec(),
    };
    let enc_req = sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&avail_req).unwrap())?;
    let auth_req = AuthenticatedRequest {
        device_id: my_device_id.to_string(),
        payload: enc_req,
    };
    let resp_val = iroh_request(conn, "file_availability", &auth_req).await?;
    let enc_resp: EncryptedPayload =
        serde_json::from_value(resp_val).map_err(|e| format!("parse avail enc: {e}"))?;
    let resp_bytes = sync_crypto::decrypt_payload(sym_key, &enc_resp)?;
    let avail: FileAvailabilityResponse =
        serde_json::from_slice(&resp_bytes).map_err(|e| format!("parse avail: {e}"))?;

    let available_set: std::collections::HashSet<&str> =
        avail.available_ids.iter().map(|s| s.as_str()).collect();
    for id in book_ids {
        if !available_set.contains(id.as_str()) {
            result.unavailable.push(id.clone());
        }
    }

    // Transfer each available file
    for book_id in &avail.available_ids {
        match pull_single_file_iroh(conn, sym_key, my_device_id, book_id, cache_dir).await {
            Ok(_) => result.transferred.push(book_id.clone()),
            Err(e) => result.failed.push(FileTransferError {
                book_id: book_id.clone(),
                error: e,
            }),
        }
    }

    Ok(result)
}

async fn pull_single_file_iroh(
    conn: &endpoint::Connection,
    sym_key: &[u8; 32],
    my_device_id: &str,
    book_id: &str,
    cache_dir: &std::path::Path,
) -> Result<u64, String> {
    let pull_req = FilePullRequest {
        book_id: book_id.to_string(),
    };
    let enc_req = sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&pull_req).unwrap())?;
    let auth_req = AuthenticatedRequest {
        device_id: my_device_id.to_string(),
        payload: enc_req,
    };
    let resp_val = iroh_request(conn, "file_pull", &auth_req).await?;
    let pull_response: FilePullResponse =
        serde_json::from_value(resp_val).map_err(|e| format!("parse file pull: {e}"))?;

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

    let mut file_data = Vec::with_capacity(meta.total_size as usize);
    for chunk in &pull_response.chunks {
        let decrypted = sync_crypto::decrypt_file_chunk(sym_key, &chunk.data_b64)
            .map_err(|e| format!("chunk {} decrypt fail: {}", chunk.chunk_index, e))?;
        file_data.extend_from_slice(&decrypted);
    }

    // Verify integrity
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

    let file_path = cache_dir.join(format!("{book_id}.book"));
    let bytes_written = file_data.len() as u64;
    std::fs::write(&file_path, &file_data).map_err(|e| format!("write file: {e}"))?;

    Ok(bytes_written)
}

/// Pull cover images from a peer over an iroh connection.
pub async fn pull_covers_via_iroh(
    conn: &endpoint::Connection,
    sym_key: &[u8; 32],
    my_device_id: &str,
    book_ids: &[String],
) -> Result<CoverTransferResult, String> {
    let mut result = CoverTransferResult {
        transferred: Vec::new(),
        failed: Vec::new(),
        unavailable: Vec::new(),
    };

    for book_id in book_ids {
        let cover_req = CoverPullRequest {
            book_id: book_id.clone(),
        };
        let enc_req =
            sync_crypto::encrypt_payload(sym_key, &serde_json::to_vec(&cover_req).unwrap())?;
        let auth_req = AuthenticatedRequest {
            device_id: my_device_id.to_string(),
            payload: enc_req,
        };
        let resp_val = iroh_request(conn, "cover_pull", &auth_req).await?;
        let enc_resp: EncryptedPayload =
            serde_json::from_value(resp_val).map_err(|e| format!("parse cover enc: {e}"))?;
        let resp_bytes = sync_crypto::decrypt_payload(sym_key, &enc_resp)?;
        let cover: CoverPullResponse =
            serde_json::from_slice(&resp_bytes).map_err(|e| format!("parse cover: {e}"))?;

        if !cover.available {
            result.unavailable.push(book_id.clone());
        } else {
            result.transferred.push(book_id.clone());
            // The data_url will be saved by the caller
        }
    }

    Ok(result)
}

// ─── Server-Side Accept Loop ───

/// Start the iroh accept loop. Spawns a background task that accepts incoming
/// connections, performs a pairing handshake, and dispatches protocol messages.
pub fn start_accept_loop(
    endpoint: Arc<IrohSyncEndpoint>,
    state: Arc<SyncTransportState>,
) -> tokio::sync::watch::Sender<bool> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = cancel_rx.changed() => {
                    eprintln!("[iroh-sync] Accept loop cancelled");
                    break;
                }
                result = endpoint.endpoint.accept() => {
                    let Some(connecting) = result else {
                        eprintln!("[iroh-sync] Endpoint closed — accept loop exiting");
                        break;
                    };
                    let conn = match connecting.await {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("[iroh-sync] Connection accept error: {e}");
                            continue;
                        }
                    };
                    let state = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_peer_connection(conn, state).await {
                            eprintln!("[iroh-sync] Peer connection error: {e}");
                        }
                    });
                }
            }
        }
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

        // Look up symmetric key
        let sym_key = {
            let devices = state.paired_devices.lock().await;
            devices
                .get(&peer_device_id)
                .and_then(|d| BASE64.decode(&d.symmetric_key_b64).ok())
                .and_then(|v| <[u8; 32]>::try_from(v).ok())
        };

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

/// Ephemeral pairing state stored during a pairing session.
#[derive(Clone)]
#[allow(dead_code)]
pub struct PendingPairing {
    pub host_secret_bytes: [u8; 32],
    pub nonce: [u8; 32],
    pub created_at: std::time::Instant,
}

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

    let app_data_dir = state.app_data_dir.clone();
    let available_ids: Vec<String> = avail_req
        .book_ids
        .iter()
        .filter(|id| {
            let path = app_data_dir.join("book-cache").join(format!("{id}.book"));
            path.exists()
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

    let path = state
        .app_data_dir
        .join("book-cache")
        .join(format!("{}.book", pull_req.book_id));

    if !path.exists() {
        let response = FilePullResponse {
            available: false,
            meta: None,
            chunks: Vec::new(),
        };
        return serde_json::to_value(response).unwrap();
    }

    // Read file in chunks
    let sym_key_clone = *sym_key;
    let result: Result<(u64, String, Vec<String>), String> =
        tokio::task::spawn_blocking(move || {
            let mut file = std::fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
            let mut hasher = Sha256::new();
            let mut total_size = 0u64;
            let mut chunks = Vec::new();
            let mut buffer = vec![0u8; FILE_CHUNK_SIZE];

            loop {
                use std::io::Read;
                let n = file.read(&mut buffer).map_err(|e| format!("read: {e}"))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
                total_size += n as u64;
                let encoded = sync_crypto::encrypt_single_file_chunk(&sym_key_clone, &buffer[..n])?;
                chunks.push(encoded);
            }

            Ok((total_size, hex::encode(hasher.finalize()), chunks))
        })
        .await
        .map_err(|e| format!("join: {e}"))
        .and_then(|r| r);

    match result {
        Ok((total_size, content_hash, encrypted_chunks)) => {
            let total_chunks = encrypted_chunks.len() as u32;
            let chunks: Vec<FileTransferChunk> = encrypted_chunks
                .into_iter()
                .enumerate()
                .map(|(i, data_b64)| FileTransferChunk {
                    book_id: pull_req.book_id.clone(),
                    chunk_index: i as u32,
                    total_chunks,
                    data_b64,
                })
                .collect();

            let response = FilePullResponse {
                available: true,
                meta: Some(FileTransferMeta {
                    book_id: pull_req.book_id.clone(),
                    total_size,
                    total_chunks,
                    format: String::new(),
                    content_hash,
                }),
                chunks,
            };
            serde_json::to_value(response).unwrap()
        }
        Err(e) => serde_json::json!({"error": e}),
    }
}

async fn handle_cover_pull_req(
    _state: &Arc<SyncTransportState>,
    sym_key: &[u8; 32],
    _my_device_id: &str,
    data: &serde_json::Value,
) -> serde_json::Value {
    let (_, cover_req): (String, CoverPullRequest) = match decrypt_envelope(sym_key, data).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    let response = CoverPullResponse {
        available: false,
        data_url: None,
    };
    let _ = cover_req;
    encrypt_response(sym_key, &response).await
}

// ─── Pairing Handler ───

/// Handle an incoming pairing request (no symmetric key needed).
async fn handle_pair_req(
    state: &Arc<SyncTransportState>,
    peer_info: &IrohPeerInfo,
    data: &serde_json::Value,
) -> serde_json::Value {
    let pairing_req: PairingRequest = match serde_json::from_value(data.clone()) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({"error": format!("parse pair req: {e}")}),
    };

    let pending = state.pending_pairing.lock().await;
    let pending = match pending.as_ref() {
        Some(p) => p.clone(),
        None => return serde_json::json!({"error": "no pending pairing session"}),
    };

    let host_secret = x25519_dalek::StaticSecret::from(pending.host_secret_bytes);

    let scanner_public_bytes: [u8; 32] = match hex::decode(&pairing_req.ephemeral_public_key)
        .map_err(|e| format!("hex decode: {e}"))
        .and_then(|v| v.try_into().map_err(|_| "wrong len".to_string()))
    {
        Ok(b) => b,
        Err(e) => return serde_json::json!({"error": format!("invalid public key: {e}")}),
    };

    let scanner_public = x25519_dalek::PublicKey::from(scanner_public_bytes);
    let shared_secret = host_secret.diffie_hellman(&scanner_public);
    let shared: [u8; 32] = *shared_secret.as_bytes();

    let sym_key =
        match sync_crypto::derive_symmetric_key(&shared, &pending.nonce, b"theorem-sync-v1") {
            Ok(k) => k,
            Err(e) => return serde_json::json!({"error": format!("derive key: {e}")}),
        };

    // Verify proof
    let proof_bytes = match BASE64.decode(&pairing_req.encrypted_proof) {
        Ok(b) => b,
        Err(e) => return serde_json::json!({"error": format!("decode proof: {e}")}),
    };
    let proof_json_str = match String::from_utf8(proof_bytes) {
        Ok(s) => s,
        Err(e) => return serde_json::json!({"error": format!("utf8: {e}")}),
    };
    let proof_enc: EncryptedPayload = match serde_json::from_str(&proof_json_str) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({"error": format!("parse proof: {e}")}),
    };

    let decrypted = match sync_crypto::decrypt_payload(&sym_key, &proof_enc) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({"error": format!("decrypt proof: {e}")}),
    };

    if decrypted != b"THEOREM_PAIR_V1" {
        return serde_json::json!({"error": "invalid proof"});
    }

    // Save paired device
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Use scanner's self-reported address from the pairing request
    // (the QR payload has the HOST's address, so we must use the scanner's own).
    let scanner_node_id = if !pairing_req.node_id.is_empty() {
        pairing_req.node_id.clone()
    } else {
        peer_info.public_key.to_string()
    };
    let scanner_ip = if !pairing_req.ip.is_empty() {
        pairing_req.ip.clone()
    } else {
        String::new()
    };

    let paired = PairedDevice {
        device_id: pairing_req.device_id.clone(),
        device_name: pairing_req.device_name.clone(),
        iroh_node_id: scanner_node_id,
        symmetric_key_b64: BASE64.encode(sym_key),
        last_ip: scanner_ip,
        last_port: pairing_req.port,
        paired_at: format!("{}Z", now),
        last_sync_at: None,
        fingerprint: pairing_req.fingerprint.clone(),
        peer_relay_url: String::new(),
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

    let response = PairingResponse {
        device_id: state.identity.device_id.clone(),
        device_name: state.device_name.clone(),
        encrypted_ack: String::new(),
        fingerprint: state.identity.effective_fingerprint(),
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
