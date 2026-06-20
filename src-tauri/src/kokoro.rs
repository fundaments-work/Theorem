/// Kokoro TTS — offline text-to-speech via ONNX Runtime.
///
/// Downloads the quantized Kokoro-82M ONNX model from HuggingFace
/// on first use (~92 MB), caches it to the app data directory, then
/// runs inference on a blocking thread so the UI stays responsive.
use ort::session::Session;
use ort::value::TensorRef;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

const MODEL_REPO: &str = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_FILE: &str = "model_quantized.onnx";
const CONFIG_FILE: &str = "config.json";
const VOICES_DIR: &str = "voices";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KokoroVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub gender: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KokoroVoiceGroup {
    pub label: String,
    pub voices: Vec<KokoroVoice>,
}

static ENGINE: Mutex<Option<(Session, PathBuf)>> = Mutex::new(None);

/// All 27 English voices bundled with Kokoro v1.0.
const VOICE_IDS: &[&str] = &[
    "af_heart",
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
];

fn voice_group_label(prefix: &str) -> &str {
    match prefix {
        "af" => "American — Female",
        "am" => "American — Male",
        "bf" => "British — Female",
        "bm" => "British — Male",
        _ => "Other",
    }
}

fn voice_groups() -> Vec<KokoroVoiceGroup> {
    let mut groups: HashMap<&str, Vec<KokoroVoice>> = HashMap::new();
    for id in VOICE_IDS {
        let prefix = &id[..2];
        let parts: Vec<&str> = id.split('_').collect();
        let name = parts
            .get(1)
            .map(|s| {
                let mut c = s.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .unwrap_or_default();
        let gender = if prefix.starts_with('a') || prefix.starts_with('b') {
            if prefix.ends_with('f') {
                "Female"
            } else {
                "Male"
            }
        } else {
            "Unknown"
        };
        groups
            .entry(voice_group_label(prefix))
            .or_default()
            .push(KokoroVoice {
                id: id.to_string(),
                name,
                language: "English".into(),
                gender: gender.into(),
            });
    }
    groups
        .into_iter()
        .map(|(label, voices)| KokoroVoiceGroup {
            label: label.to_string(),
            voices,
        })
        .collect()
}

fn tts_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    dir.push("tts");
    dir.push("kokoro");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create TTS cache dir: {e}"))?;
    Ok(dir)
}

fn hf_url(path: &str) -> String {
    format!("https://huggingface.co/{MODEL_REPO}/resolve/main/{path}")
}

fn download_if_missing(
    client: &reqwest::blocking::Client,
    cache_dir: &PathBuf,
    rel_path: &str,
) -> Result<PathBuf, String> {
    let dest = cache_dir.join(rel_path);
    if dest.exists() {
        return Ok(dest);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    let url = hf_url(rel_path);
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .map_err(|e| format!("Download failed for {rel_path}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Server returned HTTP {} for {rel_path}",
            status.as_u16()
        ));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read {rel_path}: {e}"))?;
    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write {rel_path}: {e}"))?;
    Ok(dest)
}

fn ensure_model_files(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
) -> Result<PathBuf, String> {
    let cache_dir = tts_cache_dir(app)?;
    download_if_missing(client, &cache_dir, MODEL_FILE)?;
    download_if_missing(client, &cache_dir, CONFIG_FILE)?;
    for voice_id in VOICE_IDS {
        download_if_missing(client, &cache_dir, &format!("{VOICES_DIR}/{voice_id}.bin"))?;
    }
    Ok(cache_dir)
}

fn load_engine(app: &AppHandle) -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| format!("Lock error: {e}"))?;
    if guard.is_some() {
        return Ok(());
    }
    let client = crate::shared_http_client();
    let model_dir = ensure_model_files(app, client)?;
    let model_path = model_dir.join(MODEL_FILE);
    let session = Session::builder()
        .map_err(|e| format!("Failed to create session builder: {e}"))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Failed to load ONNX model: {e}"))?;
    *guard = Some((session, model_dir));
    Ok(())
}

fn run_inference(tokens: &[i64], style: &[f32], speed: f32) -> Result<Vec<f32>, String> {
    let mut guard = ENGINE.lock().map_err(|e| format!("Lock error: {e}"))?;
    let (session, _) = guard.as_mut().ok_or("TTS engine not loaded")?;

    let tokens_array = ndarray::Array1::from_vec(tokens.to_vec())
        .into_shape_with_order((1, tokens.len()))
        .map_err(|e| format!("Token shape: {e}"))?;
    let style_array = ndarray::Array1::from_vec(style.to_vec())
        .into_shape_with_order((1, style.len()))
        .map_err(|e| format!("Style shape: {e}"))?;
    let speed_array = ndarray::Array1::from_vec(vec![speed])
        .into_shape_with_order((1,))
        .map_err(|e| format!("Speed shape: {e}"))?;

    let outputs = session
        .run(ort::inputs![
            TensorRef::from_array_view(tokens_array.view())
                .map_err(|e| format!("Token tensor: {e}"))?,
            TensorRef::from_array_view(style_array.view())
                .map_err(|e| format!("Style tensor: {e}"))?,
            TensorRef::from_array_view(speed_array.view())
                .map_err(|e| format!("Speed tensor: {e}"))?,
        ])
        .map_err(|e| format!("Inference failed: {e}"))?;

    let (_shape, audio_data) = outputs["audio"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to extract audio: {e}"))?;

    Ok(audio_data.to_vec())
}

// ── Tauri Commands ──

#[tauri::command]
pub fn kokoro_is_ready() -> bool {
    ENGINE.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn kokoro_list_voices() -> Vec<KokoroVoiceGroup> {
    voice_groups()
}

#[tauri::command]
pub async fn kokoro_prepare(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || load_engine(&app))
        .await
        .map_err(|e| format!("Spawn error: {e}"))?
}

#[tauri::command]
pub async fn kokoro_generate(
    tokens: Vec<i64>,
    voice: String,
    speed: Option<f32>,
) -> Result<Vec<f32>, String> {
    let mut padded = vec![0i64];
    padded.extend(&tokens);
    padded.push(0);

    if padded.len() > 512 {
        return Err(format!("Input too long: {} tokens (max 510)", tokens.len()));
    }

    let speed = speed.unwrap_or(1.0).clamp(0.5, 2.0);

    // Read voice file (brief lock)
    let voice_path = {
        let guard = ENGINE.lock().map_err(|e| format!("Lock error: {e}"))?;
        let (_, model_dir) = guard
            .as_ref()
            .ok_or("TTS engine not loaded — call kokoro_prepare first")?;
        model_dir.join(VOICES_DIR).join(format!("{voice}.bin"))
    };

    let voice_bytes = std::fs::read(&voice_path)
        .map_err(|e| format!("Failed to read voice file {voice}: {e}"))?;

    if voice_bytes.len() < 256 * 4 {
        return Err(format!("Voice file {voice} too small"));
    }

    let style: Vec<f32> = voice_bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    tokio::task::spawn_blocking(move || run_inference(&padded, &style, speed))
        .await
        .map_err(|e| format!("Spawn error: {e}"))?
}
