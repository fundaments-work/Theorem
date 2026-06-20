/// Kokoro TTS — offline text-to-speech via tts-rs + espeak-ng.
///
/// Downloads the quantized Kokoro ONNX model (~88 MB) and voice archive
/// (~27 MB) from GitHub releases on first use, caches them to the app data
/// directory, then runs synthesis on a blocking thread.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;
use tts_rs::engines::kokoro::{KokoroEngine, KokoroInferenceParams, KokoroModelParams};
use tts_rs::SynthesisEngine;

const MODEL_URL: &str =
    "https://github.com/taylorchu/kokoro-onnx/releases/download/v0.2.0/kokoro-quant-convinteger.onnx";
const MODEL_FILENAME: &str = "kokoro-quant-convinteger.onnx";
const VOICES_URL: &str =
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";
const VOICES_FILENAME: &str = "voices-v1.0.bin";

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

static ENGINE: Mutex<Option<KokoroEngine>> = Mutex::new(None);

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

fn download_if_missing(
    client: &reqwest::blocking::Client,
    dest: &std::path::Path,
    url: &str,
    description: &str,
) -> Result<(), String> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .map_err(|e| format!("Download failed for {description}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Server returned HTTP {} for {description}",
            status.as_u16()
        ));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read {description}: {e}"))?;
    std::fs::write(dest, &bytes).map_err(|e| format!("Failed to write {description}: {e}"))?;
    Ok(())
}

fn ensure_model_files(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = tts_cache_dir(app)?;

    // Clean up stale files from the old HuggingFace-based download scheme.
    // The old model was at onnx/model_quantized.onnx; tts-rs expects files
    // directly in the cache dir with different names. Also delete the old
    // config.json which lacks the 'vocab' field tts-rs needs — it falls
    // back to a hardcoded vocab when no config.json is present.
    let old_onnx_dir = cache_dir.join("onnx");
    let old_config = cache_dir.join("config.json");
    let old_voices_dir = cache_dir.join("voices");

    if old_onnx_dir.exists() {
        let _ = std::fs::remove_dir_all(&old_onnx_dir);
    }
    if old_config.exists() {
        let _ = std::fs::remove_file(&old_config);
    }
    if old_voices_dir.exists() {
        let _ = std::fs::remove_dir_all(&old_voices_dir);
    }

    let client = crate::shared_http_client();

    download_if_missing(
        client,
        &cache_dir.join(MODEL_FILENAME),
        MODEL_URL,
        "Kokoro ONNX model (~88 MB)",
    )?;
    download_if_missing(
        client,
        &cache_dir.join(VOICES_FILENAME),
        VOICES_URL,
        "Kokoro voices (~27 MB)",
    )?;

    Ok(cache_dir)
}

fn load_engine(app: &AppHandle) -> Result<(), String> {
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return Ok(());
    }

    let model_dir = ensure_model_files(app)?;

    // Resolve optimized cache path so subsequent loads skip re-optimization
    let optimized_cache = tts_cache_dir(app)?.join("kokoro-optimized.onnx");

    let mut engine = KokoroEngine::new();
    engine
        .load_model_with_params(
            &model_dir,
            KokoroModelParams {
                num_threads: None, // auto
                optimized_model_cache_path: Some(optimized_cache),
            },
        )
        .map_err(|e| format!("Failed to load Kokoro engine: {e}"))?;

    *guard = Some(engine);
    Ok(())
}

// ── Tauri Commands ──

#[tauri::command]
pub fn kokoro_is_ready() -> bool {
    ENGINE.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

#[tauri::command]
pub fn kokoro_list_voices() -> Vec<KokoroVoiceGroup> {
    let guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(engine) = guard.as_ref() else {
        return vec![];
    };
    let raw_voices = engine.list_voices();
    group_voices(&raw_voices)
}

#[tauri::command]
pub async fn kokoro_prepare(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || load_engine(&app))
        .await
        .map_err(|e| format!("Spawn error: {e}"))?
}

#[tauri::command]
pub async fn kokoro_generate(
    text: String,
    voice: String,
    speed: Option<f32>,
) -> Result<Vec<f32>, String> {
    let speed = speed.unwrap_or(1.0).clamp(0.5, 2.0);

    tokio::task::spawn_blocking(move || {
        let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
        let engine = guard
            .as_mut()
            .ok_or_else(|| "TTS engine not loaded — call kokoro_prepare first".to_string())?;

        let params = KokoroInferenceParams {
            voice,
            speed,
            style_index: None, // auto
        };

        let result = engine
            .synthesize(&text, Some(params))
            .map_err(|e| format!("Synthesis failed: {e}"))?;

        if result.samples.is_empty() {
            return Err("Synthesis produced no audio".to_string());
        }

        Ok(result.samples)
    })
    .await
    .map_err(|e| format!("Spawn error: {e}"))?
}

fn group_voices(voice_ids: &[&str]) -> Vec<KokoroVoiceGroup> {
    use std::collections::HashMap;
    let mut groups: HashMap<&str, Vec<KokoroVoice>> = HashMap::new();

    for id in voice_ids {
        let prefix = if id.len() >= 2 { &id[..2] } else { id };
        let name = id
            .split('_')
            .nth(1)
            .map(|s| {
                let mut c = s.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .unwrap_or_else(|| id.to_string());

        let gender = if prefix.ends_with('f') {
            "Female"
        } else {
            "Male"
        };

        let label = match prefix {
            "af" => "American — Female",
            "am" => "American — Male",
            "bf" => "British — Female",
            "bm" => "British — Male",
            "ef" => "Spanish — Female",
            "em" => "Spanish — Male",
            "ff" => "French — Female",
            "hf" => "Hindi — Female",
            "hm" => "Hindi — Male",
            "if" => "Italian — Female",
            "im" => "Italian — Male",
            "jf" => "Japanese — Female",
            "jm" => "Japanese — Male",
            "pf" => "Portuguese — Female",
            "pm" => "Portuguese — Male",
            "zf" => "Chinese — Female",
            _ => "Other",
        };

        groups.entry(label).or_default().push(KokoroVoice {
            id: id.to_string(),
            name,
            language: "auto".into(),
            gender: gender.into(),
        });
    }

    // Sort groups and voices within groups for consistent display
    let mut sorted_groups: Vec<KokoroVoiceGroup> = groups
        .into_iter()
        .map(|(label, mut voices)| {
            voices.sort_by(|a, b| a.id.cmp(&b.id));
            KokoroVoiceGroup {
                label: label.to_string(),
                voices,
            }
        })
        .collect();
    sorted_groups.sort_by(|a, b| a.label.cmp(&b.label));
    sorted_groups
}
