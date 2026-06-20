/// Kokoro TTS — offline text-to-speech via tts-rs + espeak-ng + rodio.
///
/// Downloads the quantized Kokoro ONNX model (~88 MB) and voice archive
/// (~27 MB) from GitHub releases on first use, caches them to the app data
/// directory, then runs streaming synthesis + audio playback on background threads.
use serde::{Deserialize, Serialize};
use std::num::NonZero;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tts_rs::engines::kokoro::{KokoroEngine, KokoroInferenceParams, KokoroModelParams};
use tts_rs::SynthesisEngine;

const MODEL_URL: &str =
    "https://github.com/taylorchu/kokoro-onnx/releases/download/v0.2.0/kokoro-quant-convinteger.onnx";
const MODEL_FILENAME: &str = "kokoro-quant-convinteger.onnx";
const VOICES_URL: &str =
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";
const VOICES_FILENAME: &str = "voices-v1.0.bin";

/// Max chars per synthesis chunk — keeps first-chunk latency low.
const CHUNK_CHARS: usize = 1200;

/// Number of samples to crossfade between chunks (10 ms @ 24 kHz).
/// Eliminates audible clicks/pops at chunk boundaries.
/// Matches the crossfade length used by Parrot and tts-rs internally.
const CROSSFADE_SAMPLES: usize = 240;

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

struct ActivePlayback {
    player: rodio::Player,
    generation: u64,
}

struct TtsInner {
    engine: Option<KokoroEngine>,
    sink: Option<rodio::MixerDeviceSink>,
}

static INNER: Mutex<Option<TtsInner>> = Mutex::new(None);
static PLAYBACK: Mutex<Option<ActivePlayback>> = Mutex::new(None);
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

    // Clean stale files from previous download schemes
    let old_onnx_dir = cache_dir.join("onnx");
    let old_config = cache_dir.join("config.json");
    let old_voices_dir = cache_dir.join("voices");
    let stale_optimized = cache_dir.join("kokoro-optimized.onnx");

    if old_onnx_dir.exists() {
        let _ = std::fs::remove_dir_all(&old_onnx_dir);
    }
    if old_config.exists() {
        let _ = std::fs::remove_file(&old_config);
    }
    if old_voices_dir.exists() {
        let _ = std::fs::remove_dir_all(&old_voices_dir);
    }
    if stale_optimized.exists() {
        let _ = std::fs::remove_file(&stale_optimized);
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

// ── Engine lifecycle ──

fn ensure_engine(app: &AppHandle) -> Result<(), String> {
    let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().map_or(false, |inner| inner.engine.is_some()) {
        return Ok(());
    }

    // Open the default audio output device
    let sink = rodio::DeviceSinkBuilder::open_default_sink()
        .map_err(|e| format!("Failed to open audio output: {e}"))?;

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

    *guard = Some(TtsInner {
        engine: Some(engine),
        sink: Some(sink),
    });

    // Drop the lock so warmup_inference can acquire it independently.
    drop(guard);

    // Run a dummy synthesis to warm up the ONNX session.
    // The first real call will be much faster (~200ms vs ~3s cold).
    warmup_inference("af_heart");

    Ok(())
}

/// Run a single short inference to warm the ONNX runtime session.
/// Without this, the first user-visible synthesis call incurs a multi-second
/// cold-start penalty.
fn warmup_inference(voice: &str) {
    let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
    let Some(inner) = guard.as_mut() else { return };
    let Some(engine) = inner.engine.as_mut() else {
        return;
    };

    let params = KokoroInferenceParams {
        voice: voice.to_string(),
        speed: 1.0,
        style_index: Some(0),
    };
    match engine.synthesize("Hello.", Some(params)) {
        Ok(result) => {
            eprintln!(
                "[TTS] ONNX warmup complete — {} samples ({:.1}s)",
                result.samples.len(),
                result.samples.len() as f64 / 24000.0
            );
        }
        Err(e) => {
            eprintln!("[TTS] ONNX warmup failed (non-fatal): {e}");
        }
    }
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

// ── Audio playback helpers ──

fn clear_playback() {
    if let Ok(mut guard) = PLAYBACK.lock() {
        if let Some(pb) = guard.take() {
            pb.player.stop();
        }
    }
}

fn pause_playback() -> bool {
    match PLAYBACK.lock() {
        Ok(guard) => {
            if let Some(pb) = guard.as_ref() {
                pb.player.pause();
                return true;
            }
            false
        }
        Err(_) => false,
    }
}

fn resume_playback() -> bool {
    match PLAYBACK.lock() {
        Ok(guard) => {
            if let Some(pb) = guard.as_ref() {
                pb.player.play();
                return true;
            }
            false
        }
        Err(_) => false,
    }
}

// ── Text chunking ──

fn split_text(text: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        let sentence_end = remaining.find(|c: char| matches!(c, '.' | '!' | '?' | '\n'));
        match sentence_end {
            Some(idx) => {
                let sentence = &remaining[..=idx];
                if current.len() + sentence.len() > CHUNK_CHARS && !current.is_empty() {
                    chunks.push(current.trim().to_string());
                    current = String::new();
                }
                current.push_str(sentence);
                remaining = &remaining[idx + 1..];
            }
            None => {
                if current.len() + remaining.len() > CHUNK_CHARS && !current.is_empty() {
                    chunks.push(current.trim().to_string());
                    chunks.push(remaining.trim().to_string());
                } else {
                    current.push_str(remaining);
                    chunks.push(current.trim().to_string());
                }
                break;
            }
        }
    }

    if !current.trim().is_empty() && chunks.last().map_or(true, |c| c != current.trim()) {
        chunks.push(current.trim().to_string());
    }

    chunks.retain(|c| !c.is_empty());
    chunks
}

// ── Audio smoothing ──

/// Linear crossfade between two consecutive chunks.
/// Blends the tail of `prev` into the beginning of `samples` so there
/// is no audible click at the boundary.  10 ms of overlap eliminates
/// transients while preserving intelligibility.
fn apply_crossfade(prev_tail: &[f32], samples: &mut Vec<f32>) {
    let overlap = prev_tail.len().min(samples.len());
    for i in 0..overlap {
        let t = (i + 1) as f32 / (overlap + 1) as f32;
        samples[i] = prev_tail[prev_tail.len() - overlap + i] * (1.0 - t) + samples[i] * t;
    }
    // If the tail is longer than the new chunk (unlikely), prepend the excess.
    if prev_tail.len() > overlap {
        let prefix = &prev_tail[..prev_tail.len() - overlap];
        samples.splice(0..0, prefix.iter().copied());
    }
}

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
        let _ = app.emit(
            "tts-state",
            TtsStateEvent {
                status: "loading".into(),
                voices: None,
                message: None,
            },
        );
        match ensure_engine(&app) {
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

#[tauri::command]
pub fn tts_play(
    app: AppHandle,
    text: String,
    voice: String,
    speed: Option<f32>,
) -> Result<(), String> {
    let speed = speed.unwrap_or(1.0).clamp(0.5, 2.0);
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("No text to speak".into());
    }

    // Cancel any active playback
    clear_playback();
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    let app_clone = app.clone();
    let voice_clone = voice.clone();

    // Spawn speech in a dedicated OS thread — returns immediately.
    // The thread runs independently; stop/pause/resume commands work
    // by checking GENERATION or mutating the Player through PLAYBACK.
    std::thread::spawn(move || {
        eprintln!(
            "[TTS] Synthesis thread started, gen={}, chunks={}",
            generation,
            split_text(&trimmed).len()
        );

        let _ = app_clone.emit(
            "tts-state",
            TtsStateEvent {
                status: "playing".into(),
                voices: None,
                message: None,
            },
        );

        let mixer = {
            let guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .as_ref()
                .and_then(|inner| inner.sink.as_ref())
                .map(|sink| sink.mixer().clone())
        };

        let Some(mixer) = mixer else {
            eprintln!("[TTS] ERROR: Audio output not initialized (sink missing)");
            let _ = app_clone.emit(
                "tts-state",
                TtsStateEvent {
                    status: "error".into(),
                    voices: None,
                    message: Some("Audio output not initialized".into()),
                },
            );
            return;
        };
        eprintln!("[TTS] Mixer acquired, creating player...");

        let player = rodio::Player::connect_new(&mixer);
        // Start paused — we'll unpause after the first real chunk is appended.
        // This ensures audio starts exactly when samples are ready, avoiding
        // any gap between the first chunk and playback start.
        player.pause();
        eprintln!("[TTS] Player created (paused)");

        {
            let mut pb = PLAYBACK.lock().unwrap_or_else(|e| e.into_inner());
            *pb = Some(ActivePlayback { player, generation });
        }

        let chunks = split_text(&trimmed);
        if chunks.is_empty() {
            let _ = app_clone.emit(
                "tts-state",
                TtsStateEvent {
                    status: "error".into(),
                    voices: None,
                    message: Some("No readable text found".into()),
                },
            );
            return;
        }

        let total_chunks = chunks.len();
        eprintln!("[TTS] Synthesizing {} chunks...", total_chunks);

        // Shorten the first chunk to get audio playing sooner.
        let first_chunk_max = 400usize;

        // Track the tail of the previous chunk for crossfading.
        let mut crossfade_tail: Option<Vec<f32>> = None;
        // Track whether playback has started yet.
        let mut started = false;

        for (i, chunk) in chunks.iter().enumerate() {
            if GENERATION.load(Ordering::SeqCst) != generation {
                eprintln!("[TTS] Generation changed, aborting");
                return;
            }

            let effective_chunk = if i == 0 && chunk.len() > first_chunk_max {
                &chunk[..first_chunk_max]
            } else {
                chunk.as_str()
            };

            eprintln!(
                "[TTS] Chunk {}/{} — {} chars: {:?}...",
                i + 1,
                total_chunks,
                effective_chunk.len(),
                &effective_chunk[..effective_chunk.len().min(80)]
            );

            // Take the engine OUT of the mutex so we don't hold the lock
            // during the blocking synthesize() call.
            let engine = {
                let mut guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
                guard.as_mut().and_then(|inner| inner.engine.take())
            };

            let Some(mut engine) = engine else {
                eprintln!("[TTS] Engine not available, aborting");
                return;
            };

            let params = KokoroInferenceParams {
                voice: voice_clone.clone(),
                speed,
                style_index: Some(0),
            };

            let mut samples = match engine.synthesize(effective_chunk, Some(params)) {
                Ok(result) => {
                    // Put engine back immediately after synthesis
                    if let Ok(mut guard) = INNER.lock() {
                        if let Some(inner) = guard.as_mut() {
                            inner.engine = Some(engine);
                        }
                    }
                    if result.samples.is_empty() {
                        eprintln!("[TTS] Chunk {} produced EMPTY samples, skipping", i + 1);
                        continue;
                    }
                    eprintln!(
                        "[TTS] Chunk {} OK — {} samples ({:.1}s at 24kHz)",
                        i + 1,
                        result.samples.len(),
                        result.samples.len() as f64 / 24000.0
                    );
                    result.samples
                }
                Err(e) => {
                    eprintln!("[TTS] Synthesis FAILED: {}", e);
                    if let Ok(mut guard) = INNER.lock() {
                        if let Some(inner) = guard.as_mut() {
                            inner.engine = Some(engine);
                        }
                    }
                    let _ = app_clone.emit(
                        "tts-state",
                        TtsStateEvent {
                            status: "error".into(),
                            voices: None,
                            message: Some(format!("Synthesis failed: {e}")),
                        },
                    );
                    return;
                }
            };

            if GENERATION.load(Ordering::SeqCst) != generation {
                eprintln!("[TTS] Generation changed mid-synthesis, aborting");
                return;
            }

            // ── Crossfade with previous chunk's tail ──
            // This eliminates clicks/pops at chunk boundaries, making
            // audio sound like one continuous stream.
            if let Some(prev_tail) = crossfade_tail.take() {
                apply_crossfade(&prev_tail, &mut samples);
            }
            // Hold back the last CROSSFADE_SAMPLES for the next chunk.
            if samples.len() > CROSSFADE_SAMPLES {
                let split = samples.len() - CROSSFADE_SAMPLES;
                crossfade_tail = Some(samples[split..].to_vec());
                samples.truncate(split);
            }

            // Apply gain and append to player.
            {
                let pb = PLAYBACK.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(pb) = pb.as_ref() {
                    if pb.generation == generation {
                        let buf = rodio::buffer::SamplesBuffer::new(
                            NonZero::new(1u16).unwrap(),
                            NonZero::new(24000u32).unwrap(),
                            samples
                                .into_iter()
                                .map(|s| (s * 1.8).clamp(-1.0, 1.0))
                                .collect::<Vec<f32>>(),
                        );
                        pb.player.append(buf);
                        if !started {
                            started = true;
                            pb.player.play();
                            eprintln!("[TTS] Playback started (first chunk appended)");
                        }
                        eprintln!("[TTS] Chunk {} appended to player", i + 1);
                    }
                }
            }

            let _ = app_clone.emit(
                "tts-progress",
                serde_json::json!({
                    "chunk": i + 1,
                    "total": total_chunks,
                }),
            );
        }

        // Flush any held-back crossfade tail from the final chunk.
        if let Some(tail) = crossfade_tail.take() {
            let pb = PLAYBACK.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(pb) = pb.as_ref() {
                if pb.generation == generation {
                    let buf = rodio::buffer::SamplesBuffer::new(
                        NonZero::new(1u16).unwrap(),
                        NonZero::new(24000u32).unwrap(),
                        tail.into_iter()
                            .map(|s| (s * 1.8).clamp(-1.0, 1.0))
                            .collect::<Vec<f32>>(),
                    );
                    pb.player.append(buf);
                    eprintln!("[TTS] Crossfade tail flushed");
                }
            }
        }

        // Wait for playback to finish
        eprintln!("[TTS] All chunks synthesized, waiting for playback to drain...");
        {
            loop {
                if GENERATION.load(Ordering::SeqCst) != generation {
                    eprintln!("[TTS] Generation changed during drain, aborting");
                    return;
                }

                let done = {
                    let pb = PLAYBACK.lock().unwrap_or_else(|e| e.into_inner());
                    pb.as_ref().map_or(true, |pb| pb.player.empty())
                };

                if done {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }

            let mut pb = PLAYBACK.lock().unwrap_or_else(|e| e.into_inner());
            if pb.as_ref().map_or(false, |p| p.generation == generation) {
                *pb = None;
            }
        }

        eprintln!("[TTS] Playback finished");
        let _ = app_clone.emit(
            "tts-state",
            TtsStateEvent {
                status: "finished".into(),
                voices: Some(list_voice_groups()),
                message: None,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn tts_stop() {
    clear_playback();
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub fn tts_pause() -> bool {
    pause_playback()
}

#[tauri::command]
pub fn tts_resume() -> bool {
    resume_playback()
}

/// Play a 440 Hz sine wave for 1 second at full volume.
/// Use this to verify that audio output is working on the system.
/// If you hear a beep: audio pipeline is fine, issue is in Kokoro synthesis.
/// If no beep: audio device / ALSA / permissions problem.
#[tauri::command]
pub fn tts_test_audio() -> Result<(), String> {
    let mixer = {
        let guard = INNER.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .and_then(|inner| inner.sink.as_ref())
            .map(|sink| sink.mixer().clone())
    };
    let Some(mixer) = mixer else {
        return Err("Audio not initialized — engine must be loaded first".into());
    };

    let sample_rate: u32 = 44100;
    let duration_secs = 1.0;
    let freq = 440.0;
    let num_samples = (sample_rate as f64 * duration_secs) as usize;
    let samples: Vec<f32> = (0..num_samples)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            (0.5 * (2.0 * std::f64::consts::PI * freq * t).sin()) as f32
        })
        .collect();

    let player = rodio::Player::connect_new(&mixer);
    let buf = rodio::buffer::SamplesBuffer::new(
        NonZero::new(1u16).unwrap(),
        NonZero::new(sample_rate).unwrap(),
        samples,
    );
    player.append(buf);
    // Let the tone play (1s tone + margin)
    thread::sleep(Duration::from_millis(1500));
    eprintln!("[TTS] Test tone played (440 Hz, 1s). If you didn't hear it, check system audio.");
    Ok(())
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
