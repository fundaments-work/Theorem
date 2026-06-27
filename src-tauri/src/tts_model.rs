use futures::StreamExt;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// The 6 English voices (3 female + 3 male) shipped with the installer.
/// Names must match .bin filenames in the HF repo onnx-community/Kokoro-82M-ONNX/voices/.
pub const VOICE_FILES: &[&str] = &[
    "af_bella",
    "af_nicole",
    "af_sarah",
    "am_adam",
    "am_michael",
    "bm_george",
];

const MODEL_FILENAME: &str = "kokoro.onnx";
const MODEL_URL: &str =
    "https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/main/onnx/model_quantized.onnx";

fn voice_url(voice: &str) -> String {
    format!(
        "https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/main/voices/{voice}.bin",
        voice = voice
    )
}

/// Status report for the frontend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsModelStatus {
    pub ok: bool,
    pub missing_files: Vec<String>,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub current_file: String,
    pub downloading: bool,
    pub error: Option<String>,
}

/// Download progress event sent to the frontend.
#[derive(Serialize, Clone)]
pub struct TtsDownloadProgress {
    pub current_file: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub file_index: u32,
    pub total_files: u32,
}

#[derive(Serialize, Clone)]
pub struct TtsDownloadComplete;

#[derive(Serialize, Clone)]
pub struct TtsDownloadError {
    pub message: String,
}

/// Shared state for model download management.
pub struct ModelState {
    pub downloading: Arc<AtomicBool>,
    pub cancelled: Arc<AtomicBool>,
}

impl ModelState {
    pub fn new() -> Self {
        Self {
            downloading: Arc::new(AtomicBool::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Resolve the directory where the runtime-downloaded models live.
/// Always returns `app_data_dir/models/` so the bundled resource fallback
/// only kicks in if this directory lacks the files.
fn app_models_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("models")
}

/// Resolve the `models/` directory for the Kokoro engine.
///
/// Priority:
///   1. `app_data_dir/models/` — runtime downloaded (works both dev + prod)
///   2. Tauri resource dir (bundled) — only if model + voices/ dir exist
///   3. `CARGO_MANIFEST_DIR/models/` (dev fallback)
pub fn resolve_models_dir(app: &AppHandle) -> PathBuf {
    // 1. App data dir (runtime downloaded)
    let app_dir = app_models_dir(app);
    if app_dir.join(MODEL_FILENAME).exists() && app_dir.join("voices").is_dir() {
        return app_dir;
    }

    // 2. Tauri resource dir (bundled)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("models");
        if candidate.join(MODEL_FILENAME).exists() && candidate.join("voices").is_dir() {
            return candidate;
        }
    }

    // 3. Dev fallback
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models")
}

/// Check whether all required model files exist in the resolved directory.
fn check_models(dir: &Path) -> TtsModelStatus {
    let mut missing = Vec::new();
    let model_path = dir.join(MODEL_FILENAME);
    if !model_path.exists() {
        missing.push(MODEL_FILENAME.to_string());
    }
    let voices_dir = dir.join("voices");
    for voice in VOICE_FILES {
        let vf = voices_dir.join(format!("{}.bin", voice));
        if !vf.exists() {
            missing.push(format!("voices/{}.bin", voice));
        }
    }
    TtsModelStatus {
        ok: missing.is_empty(),
        missing_files: missing,
        total_bytes: 0,
        downloaded_bytes: 0,
        current_file: String::new(),
        downloading: false,
        error: None,
    }
}

/// Compute the path where the model should be stored.
fn target_models_dir(app: &AppHandle) -> PathBuf {
    app_models_dir(app)
}

/// Download a single file with progress reporting.
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    cancelled: &AtomicBool,
    app: &AppHandle,
    current_file: &str,
    file_index: u32,
    total_files: u32,
    offset_bytes: u64,
) -> Result<u64, String> {
    let dest_dir = dest.parent().unwrap();
    fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir: {}", e))?;

    let temp_path = dest.with_extension("part");

    // Start request
    let mut req_builder = client.get(url);
    let existing_len = if temp_path.exists() {
        let meta = fs::metadata(&temp_path).map_err(|e| format!("stat: {}", e))?;
        let len = meta.len();
        if len > 0 {
            req_builder = req_builder.header("Range", format!("bytes={}-", len));
        }
        len
    } else {
        0
    };

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        // If we were resuming and got a 416 (Range Not Satisfiable),
        // the file is already complete — just rename and return.
        if response.status().as_u16() == 416 && existing_len > 0 {
            fs::rename(&temp_path, dest).map_err(|e| format!("rename after 416: {}", e))?;
            return Ok(existing_len);
        }
        return Err(format!("HTTP {}", response.status()));
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(existing_len == 0)
        .open(&temp_path)
        .map_err(|e| format!("file open: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded = existing_len;

    while let Some(result) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            let _ = file.flush();
            return Err("cancelled".to_string());
        }

        let chunk = result.map_err(|e| format!("stream: {}", e))?;

        file.write_all(&chunk)
            .map_err(|e| format!("write: {}", e))?;

        downloaded += chunk.len() as u64;

        // Emit progress periodically (every ~512 KiB)
        let _ = app.emit(
            "tts-download-progress",
            TtsDownloadProgress {
                current_file: current_file.to_string(),
                downloaded_bytes: offset_bytes + downloaded,
                total_bytes: 0, // filled by caller
                file_index,
                total_files,
            },
        );
    }

    file.flush().map_err(|e| format!("flush: {}", e))?;
    drop(file);

    // Atomic rename
    fs::rename(&temp_path, dest).map_err(|e| format!("rename: {}", e))?;

    Ok(downloaded)
}

/// Ensure all required model files exist in app_data_dir/models/.
/// Downloads missing files from HuggingFace with progress events.
pub async fn ensure_models(app: &AppHandle, state: &ModelState) -> Result<TtsModelStatus, String> {
    // If already downloading, return current status
    if state.downloading.load(Ordering::Relaxed) {
        let dir = target_models_dir(app);
        let mut status = check_models(&dir);
        status.downloading = true;
        return Ok(status);
    }

    let dir = target_models_dir(app);
    let initial = check_models(&dir);
    if initial.ok {
        return Ok(initial);
    }

    // Start download
    state.downloading.store(true, Ordering::Relaxed);
    state.cancelled.store(false, Ordering::Relaxed);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800)) // 30 min timeout
        .build()
        .map_err(|e| format!("client: {}", e))?;

    let model_path = dir.join(MODEL_FILENAME);
    let voices_dir = dir.join("voices");

    // Build download queue: model + missing voices
    let mut jobs: Vec<(String, String, PathBuf)> = Vec::new(); // (label, url, dest)

    if !model_path.exists() {
        jobs.push((
            MODEL_FILENAME.to_string(),
            MODEL_URL.to_string(),
            model_path.clone(),
        ));
    }

    for voice in VOICE_FILES {
        let vf = voices_dir.join(format!("{}.bin", voice));
        if !vf.exists() {
            jobs.push((format!("voices/{}.bin", voice), voice_url(voice), vf));
        }
    }

    let total_files = jobs.len() as u32;
    let mut total_byte_offset: u64 = 0;

    for (i, (label, url, dest)) in jobs.iter().enumerate() {
        if state.cancelled.load(Ordering::Relaxed) {
            state.downloading.store(false, Ordering::Relaxed);
            return Err("cancelled".to_string());
        }

        match download_file(
            &client,
            url,
            dest,
            &state.cancelled,
            app,
            label,
            i as u32,
            total_files,
            total_byte_offset,
        )
        .await
        {
            Ok(bytes) => {
                total_byte_offset += bytes;
            }
            Err(e) => {
                let _ = app.emit(
                    "tts-download-error",
                    TtsDownloadError {
                        message: format!("Failed to download {}: {}", label, e),
                    },
                );
                state.downloading.store(false, Ordering::Relaxed);
                return Err(format!("Download failed for {}: {}", label, e));
            }
        }
    }

    state.downloading.store(false, Ordering::Relaxed);

    // Validate minimum file sizes
    let final_status = check_models(&dir);
    if !final_status.ok {
        return Err(format!(
            "Validation failed - missing: {:?}",
            final_status.missing_files
        ));
    }

    let _ = app.emit("tts-download-complete", TtsDownloadComplete);

    Ok(TtsModelStatus {
        ok: true,
        missing_files: vec![],
        total_bytes: total_byte_offset,
        downloaded_bytes: total_byte_offset,
        current_file: String::new(),
        downloading: false,
        error: None,
    })
}

/// Cancel any in-progress download.
pub fn cancel_download(state: &ModelState) {
    state.cancelled.store(true, Ordering::Relaxed);
}

/// Get current model status without triggering download.
pub fn get_model_status(app: &AppHandle) -> TtsModelStatus {
    let dir = resolve_models_dir(app);
    check_models(&dir)
}

/// Delete all downloaded model files from app_data_dir/models/.
/// This lets the user force a clean re-download.
pub fn delete_models(app: &AppHandle) -> Result<(), String> {
    let dir = app_models_dir(app);
    if !dir.exists() {
        return Ok(());
    }

    let model_path = dir.join(MODEL_FILENAME);
    let voices_dir = dir.join("voices");

    if model_path.exists() {
        fs::remove_file(&model_path).map_err(|e| format!("delete model: {}", e))?;
    }
    if voices_dir.exists() {
        fs::remove_dir_all(&voices_dir).map_err(|e| format!("delete voices: {}", e))?;
    }

    eprintln!("[tts] deleted model files from {}", dir.display());
    Ok(())
}
