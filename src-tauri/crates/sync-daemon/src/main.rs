//! Theorem Sync Daemon
//!
//! A standalone background process that runs the sync server and periodic
//! auto-sync rounds independently of the GUI. The main Tauri app communicates
//! with the daemon via a local REST control API on port 43936.
//!
//! Architecture:
//!   Main App (Tauri GUI)  ←→  Sync Daemon (sidecar)  ←→  Peer Devices (LAN)
//!                              Port 43935: Sync HTTP server (same as before)
//!                              Port 43936: Control API (for main app)

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use theorem_sync_core::sync_crypto;
use theorem_sync_core::sync_protocol::*;
use theorem_sync_core::sync_server::{self, SyncDataSnapshot, SyncServerState};
use tokio::sync::{Mutex, Notify};
use tokio::time::{interval, Duration};

// ─── Daemon State ───

struct DaemonState {
    server_state: Arc<SyncServerState>,
    data_cache_path: PathBuf,
    auto_sync_enabled: Mutex<bool>,
    sync_trigger: Notify,
}

// ─── Control API Types ───

#[derive(Serialize)]
struct DaemonStatus {
    running: bool,
    device_id: String,
    device_name: String,
    server_port: u16,
    paired_devices: Vec<PairedDeviceInfo>,
    auto_sync_enabled: bool,
    last_sync_at: Option<String>,
}

#[derive(Deserialize)]
struct SetSyncDataRequest {
    domains: HashMap<String, String>,
    manifest: HashMap<String, DomainVersion>,
}

#[derive(Serialize)]
struct ApiResponse<T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

fn ok_response<T: Serialize>(data: T) -> axum::Json<ApiResponse<T>> {
    axum::Json(ApiResponse {
        success: true,
        data: Some(data),
        error: None,
    })
}

// ─── Entry Point ───

#[tokio::main]
async fn main() {
    eprintln!(
        "[sync-daemon] Starting Theorem Sync Daemon v{}",
        env!("CARGO_PKG_VERSION")
    );

    let config_dir: PathBuf = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .or_else(|| std::env::var("THEOREM_CONFIG_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| dirs_data_dir().join("theorem"));

    eprintln!("[sync-daemon] Config directory: {}", config_dir.display());
    std::fs::create_dir_all(&config_dir).expect("Failed to create config directory");

    let identity = sync_crypto::DeviceIdentity::load_or_create(&config_dir)
        .expect("Failed to load/create device identity");

    let device_name = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "Theorem Device".to_string());

    eprintln!("[sync-daemon] Device ID: {}", identity.device_id);
    eprintln!("[sync-daemon] Device name: {device_name}");

    let paired_devices = sync_server::load_paired_devices(&config_dir);
    eprintln!("[sync-daemon] Paired devices: {}", paired_devices.len());

    let data_cache_path = config_dir.join("sync-data-cache.json");
    let cached_data: Option<SyncDataSnapshot> = load_sync_data_cache(&data_cache_path);

    let server_state = Arc::new(SyncServerState {
        identity,
        device_name: device_name.clone(),
        paired_devices: tokio::sync::Mutex::new(paired_devices),
        app_data_dir: config_dir.clone(),
        pending_pairing: tokio::sync::Mutex::new(None),
        sync_data: tokio::sync::Mutex::new(cached_data),
        event_emitter: None,
    });

    let server_handle = match sync_server::start_server(server_state.clone()).await {
        Ok(handle) => {
            eprintln!(
                "[sync-daemon] Sync server listening on port {}",
                handle.addr.port()
            );
            handle
        }
        Err(e) => {
            eprintln!("[sync-daemon] Failed to start sync server: {e}");
            return;
        }
    };

    let daemon_state = Arc::new(DaemonState {
        server_state: server_state.clone(),
        data_cache_path,
        auto_sync_enabled: tokio::sync::Mutex::new(true),
        sync_trigger: Notify::new(),
    });

    // ─── Control API Server (port 43936) ───
    let control_app = build_control_router(daemon_state.clone());
    let control_listener = tokio::net::TcpListener::bind("127.0.0.1:43936").await;
    match control_listener {
        Ok(listener) => {
            eprintln!("[sync-daemon] Control API listening on 127.0.0.1:43936");
            tokio::spawn(async move {
                axum::serve(listener, control_app).await.ok();
            });
        }
        Err(e) => {
            eprintln!("[sync-daemon] Warning: Could not bind control API on port 43936: {e}");
        }
    }

    // ─── Auto-Sync Scheduler ───
    let auto_sync_handle = {
        let daemon = daemon_state.clone();
        tokio::spawn(async move {
            auto_sync_loop(daemon).await;
        })
    };

    // ─── Wait for shutdown signal ───
    #[cfg(unix)]
    {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler");
        let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
            .expect("Failed to install SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => {
                eprintln!("[sync-daemon] Received SIGTERM, shutting down...");
            }
            _ = sigint.recv() => {
                eprintln!("[sync-daemon] Received SIGINT, shutting down...");
            }
        }
    }

    #[cfg(not(unix))]
    {
        eprintln!("[sync-daemon] Running until killed (Ctrl+C to stop)");
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    }

    auto_sync_handle.abort();
    server_handle.shutdown_notify.notify_one();
    eprintln!("[sync-daemon] Shutdown complete");
}

// ─── Control API Router ───

fn build_control_router(state: Arc<DaemonState>) -> axum::Router {
    use axum::routing::{get, post};
    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);
    axum::Router::new()
        .route("/daemon/health", get(handle_health))
        .route("/daemon/status", get(handle_status))
        .route("/daemon/sync-now", post(handle_sync_now))
        .route("/daemon/set-sync-data", post(handle_set_sync_data))
        .route("/daemon/configure", post(handle_configure))
        .route("/daemon/shutdown", post(handle_shutdown))
        .layer(cors)
        .with_state(state)
}

// ─── Control Handlers ───

async fn handle_health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok", "service": "theorem-sync-daemon" }))
}

async fn handle_status(
    axum::extract::State(state): axum::extract::State<Arc<DaemonState>>,
) -> axum::Json<ApiResponse<DaemonStatus>> {
    let devices = state.server_state.paired_devices.lock().await;
    let paired: Vec<PairedDeviceInfo> = devices.values().map(PairedDeviceInfo::from).collect();
    let last_sync_at = devices
        .values()
        .filter_map(|d| d.last_sync_at.clone())
        .max();
    drop(devices);

    let auto_sync = *state.auto_sync_enabled.lock().await;

    ok_response(DaemonStatus {
        running: true,
        device_id: state.server_state.identity.device_id.clone(),
        device_name: state.server_state.device_name.clone(),
        server_port: sync_server::SYNC_PORT,
        paired_devices: paired,
        auto_sync_enabled: auto_sync,
        last_sync_at,
    })
}

async fn handle_sync_now(
    axum::extract::State(state): axum::extract::State<Arc<DaemonState>>,
) -> axum::Json<ApiResponse<String>> {
    state.sync_trigger.notify_one();
    ok_response("Sync triggered".to_string())
}

async fn handle_set_sync_data(
    axum::extract::State(state): axum::extract::State<Arc<DaemonState>>,
    axum::extract::Json(req): axum::extract::Json<SetSyncDataRequest>,
) -> axum::Json<ApiResponse<String>> {
    {
        let mut sync_data = state.server_state.sync_data.lock().await;
        *sync_data = Some(SyncDataSnapshot {
            domains: req.domains,
            manifest: req.manifest,
        });
    }

    save_sync_data_cache(&state.data_cache_path, &state.server_state.sync_data);
    ok_response("Sync data updated".to_string())
}

async fn handle_configure(
    axum::extract::State(state): axum::extract::State<Arc<DaemonState>>,
    axum::extract::Json(config): axum::extract::Json<serde_json::Value>,
) -> axum::Json<ApiResponse<String>> {
    if let Some(auto_sync) = config.get("auto_sync_enabled").and_then(|v| v.as_bool()) {
        let mut enabled = state.auto_sync_enabled.lock().await;
        *enabled = auto_sync;
        eprintln!(
            "[sync-daemon] Auto-sync {}",
            if auto_sync { "enabled" } else { "disabled" }
        );
    }

    ok_response("Configuration updated".to_string())
}

async fn handle_shutdown(
    axum::extract::State(state): axum::extract::State<Arc<DaemonState>>,
) -> axum::Json<ApiResponse<String>> {
    eprintln!("[sync-daemon] Shutdown requested via control API");
    save_sync_data_cache(&state.data_cache_path, &state.server_state.sync_data);
    {
        let mut enabled = state.auto_sync_enabled.lock().await;
        *enabled = false;
    }
    ok_response("Shutdown initiated".to_string())
}

// ─── Auto-Sync Loop ───

async fn auto_sync_loop(state: Arc<DaemonState>) {
    let mut ticker = interval(Duration::from_secs(120));

    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = state.sync_trigger.notified() => {}
        }

        let enabled = *state.auto_sync_enabled.lock().await;
        if !enabled {
            continue;
        }

        let devices = state.server_state.paired_devices.lock().await;
        let peers: Vec<(String, String, u16, String)> = devices
            .iter()
            .map(|(id, d)| {
                (
                    id.clone(),
                    d.last_ip.clone(),
                    d.last_port,
                    d.symmetric_key_b64.clone(),
                )
            })
            .collect();
        drop(devices);

        if peers.is_empty() {
            continue;
        }

        for (peer_id, ip, port, sym_key_b64) in &peers {
            if ip.is_empty() || *port == 0 {
                continue;
            }

            eprintln!(
                "[sync-daemon] Auto-sync: attempting sync with peer {peer_id} at {ip}:{port}"
            );

            match run_sync_round(&state.server_state, peer_id, ip, *port, sym_key_b64).await {
                Ok(incoming_count) => {
                    if incoming_count > 0 {
                        eprintln!("[sync-daemon] Auto-sync: received {incoming_count} domain(s) from {peer_id}");
                    }
                }
                Err(e) => {
                    eprintln!("[sync-daemon] Auto-sync with {peer_id} failed: {e}");
                }
            }
        }
    }
}

async fn run_sync_round(
    server_state: &Arc<SyncServerState>,
    peer_device_id: &str,
    ip: &str,
    port: u16,
    sym_key_b64: &str,
) -> Result<usize, String> {
    let sym_key_vec = BASE64
        .decode(sym_key_b64)
        .map_err(|e| format!("Decode key failed: {e}"))?;
    let sym_key: [u8; 32] = sym_key_vec
        .try_into()
        .map_err(|_| "Key length invalid".to_string())?;
    let my_device_id = &server_state.identity.device_id;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let base_url = format!("http://{ip}:{port}/sync");

    // 1. Pre-flight health check.
    let health_url = format!("http://{ip}:{port}/health");
    let health_res = client
        .get(&health_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Health check failed: {e}"))?;

    if !health_res.status().is_success() {
        return Err("Peer health check failed".to_string());
    }

    // 2. Build manifest from local sync data.
    let sync_data_guard = server_state.sync_data.lock().await;
    let local_manifest: Option<SyncManifest> = sync_data_guard.as_ref().map(|data| SyncManifest {
        device_id: my_device_id.clone(),
        last_sync_at: None,
        domains: data.manifest.clone(),
    });
    let local_domains: Option<HashMap<String, String>> =
        sync_data_guard.as_ref().map(|d| d.domains.clone());
    drop(sync_data_guard);

    let local_manifest = match local_manifest {
        Some(m) => m,
        None => return Err("No sync data available".to_string()),
    };

    let local_domains = match local_domains {
        Some(d) => d,
        None => return Err("No sync data available".to_string()),
    };

    // 3. Manifest exchange.
    let manifest_req = encrypt(&sym_key, my_device_id, &local_manifest)?;
    let manifest_res = client
        .post(format!("{base_url}/manifest"))
        .json(&manifest_req)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Manifest request failed: {e}"))?;

    if !manifest_res.status().is_success() {
        return Err(format!("Manifest rejected: {}", manifest_res.status()));
    }

    let enc_plan: sync_crypto::EncryptedPayload = manifest_res
        .json()
        .await
        .map_err(|e| format!("Manifest response parse: {e}"))?;

    let plan_value = decrypt::<serde_json::Value>(&sym_key, &enc_plan)?;
    let plan: SyncPlan =
        serde_json::from_value(plan_value).map_err(|e| format!("Plan parse: {e}"))?;

    // 4. Process plan — collect domains to push and pull.
    let mut push_domains: HashMap<String, String> = HashMap::new();
    let mut pull_domain_names: Vec<String> = Vec::new();

    for action in &plan.actions {
        match action.direction {
            SyncDirection::Skip => {}
            SyncDirection::Push | SyncDirection::Merge => {
                if let Some(data) = local_domains.get(&action.domain) {
                    push_domains.insert(action.domain.clone(), data.clone());
                }
            }
            SyncDirection::Pull => {}
        }
        if matches!(action.direction, SyncDirection::Pull | SyncDirection::Merge) {
            pull_domain_names.push(action.domain.clone());
        }
    }

    let mut incoming_count = 0;

    // 5. Batched push.
    if !push_domains.is_empty() {
        let batch = BatchedDomainPayload {
            sender_device_id: my_device_id.clone(),
            domains: push_domains,
        };
        let push_req = encrypt(&sym_key, my_device_id, &batch)?;
        let push_res = client
            .post(format!("{base_url}/push-batch"))
            .json(&push_req)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Push failed: {e}"))?;

        if !push_res.status().is_success() {
            return Err(format!("Push rejected: {}", push_res.status()));
        }
    }

    // 6. Batched pull.
    if !pull_domain_names.is_empty() {
        let pull_req_msg = BatchedPullRequest {
            domains: pull_domain_names,
        };
        let pull_req_enc = encrypt(&sym_key, my_device_id, &pull_req_msg)?;
        let pull_res = client
            .post(format!("{base_url}/pull-batch"))
            .json(&pull_req_enc)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Pull failed: {e}"))?;

        if !pull_res.status().is_success() {
            return Err(format!("Pull rejected: {}", pull_res.status()));
        }

        let enc_pull: sync_crypto::EncryptedPayload = pull_res
            .json()
            .await
            .map_err(|e| format!("Pull resp parse: {e}"))?;

        let pull_value = decrypt::<serde_json::Value>(&sym_key, &enc_pull)?;
        let pulled: BatchedPullResponse =
            serde_json::from_value(pull_value).map_err(|e| format!("Batched pull parse: {e}"))?;

        incoming_count = pulled.domains.len();

        {
            let mut sync_data = server_state.sync_data.lock().await;
            if let Some(ref mut data) = *sync_data {
                for (domain, data_json) in &pulled.domains {
                    data.domains
                        .insert(format!("incoming_{}", domain), data_json.clone());
                }
            }
        }
    }

    // 7. Complete sync.
    let now = sync_crypto::now_iso8601();
    let complete_msg = SyncCompleteMessage {
        device_id: my_device_id.clone(),
        sync_timestamp: now,
        server_ip: String::new(),
        server_port: 0,
    };
    let complete_req = encrypt(&sym_key, my_device_id, &complete_msg)?;
    let _ = client
        .post(format!("{base_url}/complete"))
        .json(&complete_req)
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    // Update last sync timestamp.
    {
        let mut devices = server_state.paired_devices.lock().await;
        if let Some(device) = devices.get_mut(peer_device_id) {
            device.last_sync_at = Some(sync_crypto::now_iso8601());
        }
        let _ = sync_server::save_paired_devices(&server_state.app_data_dir, &devices);
    }

    Ok(incoming_count)
}

// ─── Crypto Helpers ───

fn encrypt<T: serde::Serialize>(
    sym_key: &[u8; 32],
    device_id: &str,
    data: &T,
) -> Result<AuthenticatedRequest, String> {
    let json = serde_json::to_vec(data).map_err(|e| format!("Serialize: {e}"))?;
    let payload =
        sync_crypto::encrypt_payload(sym_key, &json).map_err(|e| format!("Encrypt: {e}"))?;
    Ok(AuthenticatedRequest {
        device_id: device_id.to_string(),
        payload,
    })
}

fn decrypt<T: serde::de::DeserializeOwned>(
    sym_key: &[u8; 32],
    payload: &sync_crypto::EncryptedPayload,
) -> Result<T, String> {
    let decrypted =
        sync_crypto::decrypt_payload(sym_key, payload).map_err(|e| format!("Decrypt: {e}"))?;
    serde_json::from_slice(&decrypted).map_err(|e| format!("Parse: {e}"))
}

// ─── Sync Data Cache ───

fn load_sync_data_cache(path: &PathBuf) -> Option<SyncDataSnapshot> {
    if !path.exists() {
        return None;
    }
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).ok(),
        Err(_) => None,
    }
}

fn save_sync_data_cache(path: &PathBuf, sync_data: &Mutex<Option<SyncDataSnapshot>>) {
    if let Ok(guard) = sync_data.try_lock() {
        if let Some(ref data) = *guard {
            if let Ok(json) = serde_json::to_string_pretty(data) {
                let _ = std::fs::write(path, json);
            }
        }
    }
}

fn dirs_data_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
                PathBuf::from(home).join(".local").join("share")
            })
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        PathBuf::from(".")
    }
}
