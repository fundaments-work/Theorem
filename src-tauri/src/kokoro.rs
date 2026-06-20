/// Kokoro TTS — offline text-to-speech via tts-rs + espeak-ng + ONNX.
///
/// The Rust backend ONLY handles model loading and synthesis.
/// Audio playback is handled by the frontend via the Web Audio API,
/// which gives precise scheduling, instant pause/resume, and eliminates
/// all ALSA/rodio/cpal audio device issues.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use tauri::{AppHandle, Emitter, Manager};
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

#[derive(Debug, Clone, Serialize)]
struct TtsStateEvent {
    status: String,
    voices: Option<Vec<KokoroVoiceGroup>>,
    message: Option<String>,
}

// ── Global TTS state ──

struct TtsInner {
    engine: Option<KokoroEngine>,
}

static INNER: Mutex<Option<TtsInner>> = Mutex::new(None);
static IS_LOADING: Mutex<bool> = Mutex::new(false);
static LOADING_CONDVAR: Condvar = Condvar::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);

// ── Paths / download helpers ──

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

    // Clean stale files from previous download schemes (but NOT the
    // optimized ONNX cache — that's our current optimization cache!)
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
    // NOTE: Do NOT delete kokoro-optimized.onnx — it's our active cache.

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

// ── Engine lifecycle ──

fn ensure_engine(app: &AppHandle) -> Result<(), String> {
    let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().map_or(false, |inner| inner.engine.is_some()) {
        return Ok(());
    }

    let model_dir = ensure_model_files(app)?;
    let optimized_cache = tts_cache_dir(app)?.join("kokoro-optimized.onnx");

    let mut engine = KokoroEngine::new();
    engine
        .load_model_with_params(
            &model_dir,
            KokoroModelParams {
                num_threads: None,
                optimized_model_cache_path: Some(optimized_cache),
            },
        )
        .map_err(|e| format!("Failed to load Kokoro engine: {e}"))?;

    // Warm up the ONNX session with a short dummy synthesis.
    // Without this, the first real call takes 2-5 seconds (cold start).
    let _ = engine.synthesize("Hello.", None);
    eprintln!("[TTS] ONNX warmup complete");

    *guard = Some(TtsInner {
        engine: Some(engine),
    });

    Ok(())
}

fn list_voice_groups() -> Vec<KokoroVoiceGroup> {
    let guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
    let Some(inner) = guard.as_ref() else {
        return vec![];
    };
    let Some(engine) = inner.engine.as_ref() else {
        return vec![];
    };
    group_voices(&engine.list_voices())
}

// ── Text chunking ──

// ── Tauri Commands ──

#[tauri::command]
pub fn tts_is_ready() -> bool {
    INNER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(false, |inner| inner.engine.is_some())
}

#[tauri::command]
pub fn tts_get_voices() -> Vec<KokoroVoiceGroup> {
    list_voice_groups()
}

#[tauri::command]
pub async fn tts_load(app: AppHandle) -> Result<(), String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        // Check if already loaded
        {
            let guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
            if guard.as_ref().map_or(false, |inner| inner.engine.is_some()) {
                let voices = list_voice_groups();
                let _ = app.emit(
                    "tts-state",
                    TtsStateEvent {
                        status: "ready".into(),
                        voices: Some(voices),
                        message: None,
                    },
                );
                return Ok(());
            }
        }

        // Check if already loading — wait for it
        {
            let mut loading = IS_LOADING.lock().unwrap();
            if *loading {
                // Wait for the other load to finish
                while *loading {
                    loading = LOADING_CONDVAR.wait(loading).unwrap();
                }
                // Check result
                let guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
                if guard.as_ref().map_or(false, |inner| inner.engine.is_some()) {
                    let voices = list_voice_groups();
                    let _ = app.emit(
                        "tts-state",
                        TtsStateEvent {
                            status: "ready".into(),
                            voices: Some(voices),
                            message: None,
                        },
                    );
                    return Ok(());
                }
                // Loading failed, fall through to retry
            }
            *loading = true;
        }

        let _ = app.emit(
            "tts-state",
            TtsStateEvent {
                status: "loading".into(),
                voices: None,
                message: None,
            },
        );

        let result = ensure_engine(&app);

        {
            let mut loading = IS_LOADING.lock().unwrap();
            *loading = false;
            LOADING_CONDVAR.notify_all();
        }

        match result {
            Ok(()) => {
                let voices = list_voice_groups();
                let _ = app.emit(
                    "tts-state",
                    TtsStateEvent {
                        status: "ready".into(),
                        voices: Some(voices),
                        message: None,
                    },
                );
                Ok(())
            }
            Err(e) => {
                let _ = app.emit(
                    "tts-state",
                    TtsStateEvent {
                        status: "error".into(),
                        voices: None,
                        message: Some(e.clone()),
                    },
                );
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| format!("Spawn error: {e}"))?
}

/// Synthesize a single chunk of text and return the raw f32 PCM samples.
/// The frontend plays these via the Web Audio API.
///
/// Returns samples at 24 kHz, mono (1 channel).
#[tauri::command]
pub fn tts_synthesize(text: String, voice: String, speed: Option<f32>) -> Result<Vec<f32>, String> {
    let speed = speed.unwrap_or(1.0).clamp(0.5, 2.0);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("No text to synthesize".into());
    }

    // Take the engine out of the mutex so we don't hold the lock
    // during the blocking synthesize() call.
    let engine = {
        let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_mut().and_then(|inner| inner.engine.take())
    };

    let Some(mut engine) = engine else {
        return Err("TTS engine not loaded".into());
    };

    let params = KokoroInferenceParams {
        voice,
        speed,
        style_index: Some(0),
    };

    let result = engine
        .synthesize(trimmed, Some(params))
        .map_err(|e| format!("Synthesis failed: {e}"));

    // Put engine back
    {
        let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(inner) = guard.as_mut() {
            inner.engine = Some(engine);
        }
    }

    let synthesis = result?;
    if synthesis.samples.is_empty() {
        return Err("Synthesis produced empty audio".into());
    }

    eprintln!(
        "[TTS] Synthesized {} chars → {} samples ({:.1}s at 24kHz)",
        trimmed.len(),
        synthesis.samples.len(),
        synthesis.samples.len() as f64 / 24000.0
    );

    Ok(synthesis.samples)
}

/// Stop any in-progress synthesis (bumps generation counter).
#[tauri::command]
pub fn tts_stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

// ── Voice grouping ──

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
