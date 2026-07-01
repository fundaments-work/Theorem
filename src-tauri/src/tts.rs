use futures::stream::{self, StreamExt};
use kokoro_en::{split_sentences, KokoroTts};
use regex::Regex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

pub use crate::tts_model::{ModelState, TtsModelStatus};

/// Lightweight text normalisation performed *before* sentence-splitting and
/// synthesis.  Helps the phonemizer handle edge cases.
fn normalize_for_tts(text: &str) -> String {
    // "&" → "and"  (common in titles, author strings, etc.)
    let mut s = text.replace(" & ", " and ");
    if s.starts_with("& ") {
        s.replace_range(..2, "and ");
    }
    if s.ends_with(" &") {
        let len = s.len();
        s.replace_range(len - 2.., " and");
    }

    // 1. Sanitize Quotes & Typography
    // Replace smart quotes and em-dashes with standard ASCII equivalents
    s = s.replace(['‘', '’', '`'], "'");
    s = s.replace(['“', '”'], "\"");
    s = s.replace('—', "-");

    // 2. Remove apostrophes — the misaki-lean phonemizer treats ' as a word
    //    boundary and splits on it, causing "friends's" → "friends" + "s"
    //    and "don't" → "don" + "t". Dropping them entirely preserves correct
    //    pronunciation (the apostrophe carries no phonetic value).
    s = s.replace('\'', "");

    // 3. Fix missing spaces after punctuation (e.g., "him!'.The" -> "him!'. The")
    // This looks for punctuation followed immediately by a letter and inserts a space.
    let re_missing_space = Regex::new(r"([.!?,\x22])([a-zA-Z])").unwrap();
    s = re_missing_space.replace_all(&s, "$1 $2").to_string();

    // 4. The "Anti-Bite" Detachment
    // Add a space BEFORE punctuation so espeak-ng doesn't swallow the final consonant.
    // "good," becomes "good ," -> guarantees the 'd' is fully pronounced.
    let re_detach_punct = Regex::new(r"([a-zA-Z])([.,!?])").unwrap();
    s = re_detach_punct.replace_all(&s, "$1 $2").to_string();

    // 5. Clean up any double spaces we might have created
    let re_double_spaces = Regex::new(r"\s+").unwrap();
    s = re_double_spaces.replace_all(&s, " ").to_string();

    // 6. The "misaki-lean" bug workaround
    // The pure-Rust `misaki-lean` dictionary phonemizer has a catastrophic bug where it
    // drops the last character of every word it tokenizes (e.g., "time." -> "tim", "91" -> "9").
    // We append a dummy `_` to the end of every alphanumeric sequence so the phonemizer
    // drops the `_` instead of the actual last letter/number, perfectly restoring pronunciation.
    let re_misaki_bug = Regex::new(r"([a-zA-Z0-9])\b").unwrap();
    s = re_misaki_bug.replace_all(&s, "${1}_").to_string();

    // Force a final trailing space for the audio buffer
    s.push(' ');

    s
}

/// A chunk of TTS audio with per-word timing metadata.
#[derive(Serialize, Clone)]
pub struct TtsChunk {
    pub audio_data: Vec<f32>,
    pub sample_rate: u32,
    pub words: Vec<WordTimestamp>,
    /// Index of this chunk in the current generation batch (0-based).
    pub chunk_index: u32,
    /// Total number of chunks queued for this generation.
    pub total_chunks: u32,
    /// Generation ID from generate_speech — lets the frontend distinguish
    /// preloaded audio from the currently-playing generation.
    pub generation_id: u64,
}

/// Per-word timing entry, matched to a DOM span by `dom_id`.
#[derive(Serialize, Clone)]
pub struct WordTimestamp {
    pub word: String,
    pub start_time: f32,
    pub end_time: f32,
    pub dom_id: String,
}

/// Emitted when TTS encounters a fatal error mid-stream.
#[derive(Serialize, Clone)]
pub struct TtsError {
    pub message: String,
}

/// Emitted when all chunks for a generation batch are done.
#[derive(Serialize, Clone)]
pub struct TtsDone {
    pub total_chunks: u32,
}

pub struct TtsState {
    pub engine: Arc<RwLock<Option<KokoroTts>>>,
    /// Monotonically increasing generation ID.  When the frontend starts a new
    /// synthesis, it gets a new ID; any in-flight generation with an older ID
    /// should abort as soon as possible.
    pub generation_id: Arc<std::sync::atomic::AtomicU64>,
}

/// Apply a linear fade-out to the last `fade_ms` milliseconds of audio.
/// This prevents the ONNX model from abruptly cutting off the final
/// phoneme (e.g. "time" → "tim", "hello" → "hell").
fn apply_fade_out(audio: &mut [f32], sample_rate: u32) {
    // 50 ms is enough for the final phoneme to decay naturally.
    const FADE_MS: usize = 50;
    let fade_samples = (sample_rate as usize * FADE_MS) / 1000;
    let len = audio.len();
    if len < fade_samples {
        return;
    }
    for i in 0..fade_samples {
        let idx = len - fade_samples + i;
        let factor = (fade_samples - i) as f32 / fade_samples as f32;
        audio[idx] *= factor;
    }
}

/// Load the Kokoro engine. Uses the tts_model resolver which checks:
///   1. app_data_dir/models/ (runtime downloaded)
///   2. Tauri resource dir (bundled)
///   3. CARGO_MANIFEST_DIR/models/ (dev)
async fn ensure_engine(app: &AppHandle, state: &TtsState) -> Result<(), String> {
    {
        let guard = state.engine.read().await;
        if guard.is_some() {
            return Ok(());
        }
    }

    let mut guard = state.engine.write().await;
    if guard.is_some() {
        return Ok(());
    }

    let models_dir = crate::tts_model::resolve_models_dir(app);
    let model_path = models_dir.join("kokoro.onnx");
    let voice_dir = models_dir.join("voices");
    let voice_path: std::path::PathBuf = if voice_dir.is_dir() {
        voice_dir
    } else {
        models_dir.join("voices.bin")
    };

    eprintln!(
        "[tts] ensure_engine: model={} voice={}",
        model_path.display(),
        voice_path.display(),
    );

    let t = std::time::Instant::now();
    let kokoro = KokoroTts::new(&model_path, &voice_path)
        .await
        .map_err(|e| format!("Failed to load Kokoro: {}", e))?;
    eprintln!("[tts] ensure_engine: KokoroTts::new in {:?}", t.elapsed());
    *guard = Some(kokoro);
    Ok(())
}

/// Pre-warm the Kokoro TTS engine at app startup so the first user-requested
/// synthesis is fast.  Loads the ONNX model, voices, and runs a short dummy
/// synthesis to initialize the phonemizer and warm the ONNX graph.
///
/// Polls for model availability (in case a background download is in progress)
/// then loads.  On subsequent launches with cached models, this completes in
/// ~5 s — the time it takes `KokoroTts::new` + dummy synth.
#[cfg(not(target_os = "android"))]
pub async fn prewarm_engine(app: &AppHandle, state: &TtsState) {
    let t0 = std::time::Instant::now();
    eprintln!("[tts] prewarm: start, waiting for models…");

    // Poll for model availability — download may be in progress (first launch).
    let mut waited_ms = 0u64;
    loop {
        let status = crate::tts_model::get_model_status(app);
        if status.ok {
            break;
        }
        if waited_ms >= 180_000 {
            eprintln!(
                "[tts] prewarm: TIMED OUT waiting for models after {:?}",
                t0.elapsed()
            );
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        waited_ms += 500;
    }
    eprintln!(
        "[tts] prewarm: models available after {:?} (waited {} ms)",
        t0.elapsed(),
        waited_ms
    );

    let t1 = std::time::Instant::now();
    if let Err(e) = ensure_engine(app, state).await {
        eprintln!(
            "[tts] prewarm: engine load FAILED after {:?}: {}",
            t1.elapsed(),
            e
        );
        return;
    }
    eprintln!("[tts] prewarm: engine loaded in {:?}", t1.elapsed());

    let t2 = std::time::Instant::now();
    let guard = state.engine.read().await;
    if let Some(engine) = guard.as_ref() {
        match engine
            .synth("The quick brown fox jumps over the lazy dog.", "af_bella")
            .await
        {
            Ok((_, duration)) => {
                eprintln!(
                    "[tts] prewarm: dummy synth in {:?} (audio {:?})",
                    t2.elapsed(),
                    duration
                );
            }
            Err(e) => {
                eprintln!("[tts] prewarm: dummy synthesis failed: {:?}", e);
            }
        }
    }
    drop(guard);

    eprintln!("[tts] prewarm: READY, total {:?}", t0.elapsed());
}

/// Generate speech for a page of text.  Streams `audio-chunk` events
/// as each sentence is synthesized, so playback starts immediately.
///
/// Returns immediately with a generation ID.  The frontend listens for
/// `audio-chunk`, `tts-error`, and `tts-done` events.
#[tauri::command]
pub async fn generate_speech(
    app: AppHandle,
    text: String,
    start_from_id: Option<String>,
    voice: Option<String>,
) -> Result<u64, String> {
    let t0 = std::time::Instant::now();
    eprintln!("[tts] generate_speech: called ({} chars)", text.len());

    let state = app.state::<TtsState>();

    // Bump generation ID — any older in-flight generation will see this and abort
    let gen_id = state
        .generation_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    // Ensure engine is loaded (fast if already loaded)
    let t_eng = std::time::Instant::now();
    ensure_engine(&app, &state).await?;
    eprintln!(
        "[tts] generate_speech: ensure_engine in {:?}",
        t_eng.elapsed()
    );

    let dom_id = start_from_id.unwrap_or_else(|| "tts-w-0".to_string());
    let normalized = normalize_for_tts(&text);

    // Merge short sentences into chunks. The first chunk is kept small so
    // audio starts playing in ~5s on slower hardware (CPU inference of
    // ~21 chars/s). With FIRST_CHUNK_LEN=100, chunk 0 takes ~5s synth →
    // audio starts immediately while buffered(4) begins G2P for chunks 1-3
    // in parallel so they're ready by the time chunk 0 finishes playing.
    //
    // Empirical tuning (post-warmup):
    //   engine.synth rate ≈ 21 chars/s on a single-thread CPU
    //   audio playback rate ≈ 60 chars/s
    //   With small chunks: first audio in ~5s, gapless on short pages,
    //   brief loading gaps may appear on very long pages with this hardware.
    const FIRST_CHUNK_LEN: usize = 100;
    const TARGET_CHUNK_LEN: usize = 150;
    let raw_sentences = split_sentences(&normalized);
    let chunks: Vec<String> = {
        let mut result: Vec<String> = Vec::new();
        let mut buf = String::new();
        let mut is_first = true;
        for s in raw_sentences {
            let s = s.trim();
            if s.is_empty() {
                continue;
            }
            let s_with_space = format!("{} ", s);
            let limit = if is_first {
                FIRST_CHUNK_LEN
            } else {
                TARGET_CHUNK_LEN
            };
            if buf.len() + s_with_space.len() <= limit {
                buf.push_str(&s_with_space);
            } else {
                if !buf.is_empty() {
                    result.push(buf.clone());
                    buf.clear();
                    is_first = false;
                }
                buf.push_str(&s_with_space);
            }
        }
        if !buf.is_empty() {
            result.push(buf);
        }
        result
    };
    let total = chunks.len() as u32;

    if total == 0 {
        let _ = app.emit("tts-done", TtsDone { total_chunks: 0 });
        return Ok(gen_id);
    }

    // Clone what we need for the background task
    let engine_arc = state.engine.clone();
    let gen_id_arc = state.generation_id.clone();
    let app_clone = app.clone();

    // Spawn the actual synthesis on a background task so generate_speech
    // returns immediately and the frontend transitions to "playing".
    eprintln!(
        "[tts] generate_speech: returning gen_id={} after {:?} ({} chunks queued)",
        gen_id,
        t0.elapsed(),
        total
    );
    tokio::spawn(async move {
        use tauri::Manager;

        let voice_name = voice.as_deref().unwrap_or("af_bella").to_string();

        // buffered(4): starts up to 4 chunk syntheses concurrently.
        // G2P (phonemizer) runs in parallel across chunks; ONNX inference
        // serializes naturally on the session Mutex. Chunk 0 is polled first
        // so it typically gets the Mutex first → fastest first audio.
        // By the time chunk 0 finishes playing, chunks 1-3 are already
        // synthesized → gapless playback.
        let synth_t0 = std::time::Instant::now();
        eprintln!(
            "[tts] synthesis: starting stream ({} chunks, buffered 4)",
            total
        );
        let mut stream = stream::iter(chunks.into_iter().enumerate())
            .map(|(i, chunk_text)| {
                let engine_arc = engine_arc.clone();
                let gen_id_arc = gen_id_arc.clone();
                let dom_id = dom_id.clone();
                let voice_name = voice_name.clone();

                async move {
                    let current = gen_id_arc.load(std::sync::atomic::Ordering::SeqCst);
                    if current != gen_id {
                        return (i, chunk_text, dom_id, Err("aborted".to_string()));
                    }

                    let guard = engine_arc.read().await;
                    let engine = match guard.as_ref() {
                        Some(e) => e,
                        None => {
                            return (i, chunk_text, dom_id, Err("Engine not loaded".to_string()))
                        }
                    };

                    let synth_result = engine.synth(&chunk_text, &voice_name).await;
                    drop(guard);

                    (
                        i,
                        chunk_text,
                        dom_id,
                        synth_result.map_err(|e| format!("{:?}", e)),
                    )
                }
            })
            .buffered(4);

        while let Some((i, chunk_text, dom_id, synth_result)) = stream.next().await {
            if app_clone.webview_windows().is_empty() {
                eprintln!("[tts] aborting because all windows are closed");
                return;
            }

            let current = gen_id_arc.load(std::sync::atomic::Ordering::SeqCst);
            if current != gen_id {
                eprintln!(
                    "[tts] generation {} aborted during stream (current={})",
                    gen_id, current
                );
                return;
            }

            match synth_result {
                Ok((mut audio_data, _duration)) => {
                    if i == 0 {
                        eprintln!(
                            "[tts] synthesis: first chunk done after {:?}",
                            synth_t0.elapsed()
                        );
                    }
                    apply_fade_out(&mut audio_data, 24000);
                    let end_time = audio_data.len() as f32 / 24000.0;
                    let chunk_data = TtsChunk {
                        audio_data,
                        sample_rate: 24000,
                        words: vec![WordTimestamp {
                            word: chunk_text.clone(),
                            start_time: 0.0,
                            end_time,
                            dom_id: dom_id.clone(),
                        }],
                        chunk_index: i as u32,
                        total_chunks: total,
                        generation_id: gen_id,
                    };

                    if let Err(e) = app_clone.emit("audio-chunk", chunk_data) {
                        eprintln!("[tts] failed to emit audio-chunk: {}", e);
                        return;
                    }
                }
                Err(err_msg) => {
                    if err_msg == "aborted" {
                        return;
                    }
                    let _ = app_clone.emit(
                        "tts-error",
                        TtsError {
                            message: format!("Synthesis error on chunk {}: {}", i, err_msg),
                        },
                    );
                    return;
                }
            }
        }

        // Signal completion
        let _ = app_clone.emit(
            "tts-done",
            TtsDone {
                total_chunks: total,
            },
        );
    });

    Ok(gen_id)
}

/// Cancel any in-flight generation by bumping the generation ID.
#[tauri::command]
pub async fn stop_speech(app: AppHandle) -> Result<(), String> {
    let state = app.state::<TtsState>();
    let prev = state
        .generation_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    eprintln!("[tts] stop_speech called (gen_id {} → {})", prev, prev + 1);
    Ok(())
}

/// Ensure the Kokoro ONNX model and voice files are downloaded.
/// Called by the frontend on first launch / onboarding.
#[tauri::command]
pub async fn ensure_tts_model(app: AppHandle) -> Result<TtsModelStatus, String> {
    let state = app.state::<ModelState>();
    crate::tts_model::ensure_models(&app, state.inner()).await
}

/// Cancel an in-progress model download.
#[tauri::command]
pub async fn cancel_tts_model_download(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ModelState>();
    crate::tts_model::cancel_download(state.inner());
    Ok(())
}

/// Get the current model status without triggering a download.
#[tauri::command]
pub async fn get_tts_model_status(app: AppHandle) -> Result<TtsModelStatus, String> {
    Ok(crate::tts_model::get_model_status(&app))
}

/// Delete all downloaded model files so the user can force a clean re-download.
#[tauri::command]
pub async fn delete_tts_model(app: AppHandle) -> Result<(), String> {
    crate::tts_model::delete_models(&app)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_normalize_ampersand() {
        let normalized = super::normalize_for_tts("Apples & Oranges");
        assert_eq!(normalized, "Apples_ and_ Oranges_ ");
    }

    #[test]
    fn test_normalize_whitespace() {
        let normalized = super::normalize_for_tts("Hello    world.  Spaced. ");
        assert_eq!(normalized, "Hello_ world_ . Spaced_ .  ");
    }

    #[test]
    fn test_normalize_possessive_apostrophe() {
        let normalized = super::normalize_for_tts("friends's");
        assert_eq!(normalized, "friendss_ ");
    }

    #[test]
    fn test_normalize_contraction_apostrophe() {
        let normalized = super::normalize_for_tts("don't");
        assert_eq!(normalized, "dont_ ");
    }
}
