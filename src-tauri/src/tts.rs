use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;
use kokoro_en::KokoroTts;
use futures::stream::{self, StreamExt};

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

/// Split text into ≤500-char chunks on sentence boundaries.
/// Kokoro handles up to ~500 chars well; longer text gets split.
pub fn split_text(text: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        current.push(c);
        if matches!(c, '.' | '!' | '?' | ';' | '\n') && !current.trim().is_empty() {
            sentences.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    // Merge very short sentences together, split overly long ones
    let mut result: Vec<String> = Vec::new();
    let mut buf = String::new();

    for s in sentences {
        if buf.len() + s.len() + 1 <= 500 {
            if !buf.is_empty() {
                buf.push(' ');
            }
            buf.push_str(&s);
        } else {
            if !buf.is_empty() {
                result.push(buf.clone());
                buf.clear();
            }
            if s.len() > 500 {
                // Hard-split on whitespace near midpoint
                let mid = s.len() / 2;
                let best = s
                    .char_indices()
                    .filter(|(_, c)| c.is_whitespace())
                    .min_by_key(|(i, _)| ((*i as isize) - mid as isize).unsigned_abs())
                    .map(|(i, _)| i)
                    .unwrap_or(mid);
                let (a, b) = s.split_at(best);
                result.push(a.trim().to_string());
                buf = b.trim().to_string();
            } else {
                buf = s;
            }
        }
    }
    if !buf.is_empty() {
        result.push(buf);
    }

    result.retain(|s| !s.trim().is_empty());
    result
}

/// Load the Kokoro engine, trying the Tauri resource directory first,
/// then falling back to CWD-relative `models/` for dev mode.
async fn ensure_engine(app: &AppHandle, state: &TtsState) -> Result<(), String> {
    // Fast path: check with read lock
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

    // Try Tauri resource dir first
    let resource_dir = app.path().resource_dir().unwrap_or_default();
    let model_path = resource_dir.join("models/kokoro.onnx");
    let voice_path = resource_dir.join("models/voices.bin");

    if model_path.exists() && voice_path.exists() {
        let kokoro = KokoroTts::new(&model_path, &voice_path)
            .await
            .map_err(|e| format!("Failed to load Kokoro (resource dir): {}", e))?;
        *guard = Some(kokoro);
        return Ok(());
    }

    // Dev fallback: CWD/models/
    let kokoro = KokoroTts::new("models/kokoro.onnx", "models/voices.bin")
        .await
        .map_err(|e| format!("Failed to load Kokoro (CWD): {}", e))?;
    *guard = Some(kokoro);
    Ok(())
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
) -> Result<u64, String> {
    let state = app.state::<TtsState>();

    // Bump generation ID — any older in-flight generation will see this and abort
    let gen_id = state
        .generation_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    // Ensure engine is loaded (fast if already loaded)
    ensure_engine(&app, &state).await?;

    let dom_id = start_from_id.unwrap_or_else(|| "tts-w-0".to_string());
    let chunks = split_text(&text);
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
    tokio::spawn(async move {
        // Run up to 4 synthesis tasks in parallel, but yield them in original order
        let mut stream = stream::iter(chunks.into_iter().enumerate())
            .map(|(i, chunk_text)| {
                let engine_arc = engine_arc.clone();
                let gen_id_arc = gen_id_arc.clone();
                let dom_id = dom_id.clone();
                
                async move {
                    // Check abort before starting synthesis
                    let current = gen_id_arc.load(std::sync::atomic::Ordering::SeqCst);
                    if current != gen_id {
                        return (i, chunk_text, dom_id, Err("aborted".to_string()));
                    }

                    // Concurrent read lock
                    let guard = engine_arc.read().await;
                    let engine = match guard.as_ref() {
                        Some(e) => e,
                        None => return (i, chunk_text, dom_id, Err("Engine not loaded".to_string())),
                    };

                    let synth_result = engine.synth(&chunk_text, "af_bella").await;
                    drop(guard);

                    (i, chunk_text, dom_id, synth_result.map_err(|e| format!("{:?}", e)))
                }
            })
            .buffered(4); // parallel buffer size = 4

        while let Some((i, chunk_text, dom_id, synth_result)) = stream.next().await {
            // Abort if no windows exist (app closed)
            use tauri::Manager;
            if app_clone.webview_windows().is_empty() {
                eprintln!("[tts] aborting because all windows are closed");
                return;
            }

            // Check abort again before emitting
            let current = gen_id_arc.load(std::sync::atomic::Ordering::SeqCst);
            if current != gen_id {
                eprintln!("[tts] generation {} aborted during stream (current={})", gen_id, current);
                return;
            }

            match synth_result {
                Ok((audio_data, _duration)) => {
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
                    let _ = app_clone.emit("tts-error", TtsError {
                        message: format!("Synthesis error on chunk {}: {}", i, err_msg),
                    });
                    return;
                }
            }
        }

        // Signal completion
        let _ = app_clone.emit("tts-done", TtsDone { total_chunks: total });
    });

    Ok(gen_id)
}

/// Cancel any in-flight generation by bumping the generation ID.
#[tauri::command]
pub async fn stop_speech(app: AppHandle) -> Result<(), String> {
    let state = app.state::<TtsState>();
    state
        .generation_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_text_basic() {
        let result = split_text("Hello world. This is a test. Goodbye!");
        assert!(!result.is_empty());
        // All chunks should be non-empty
        for chunk in &result {
            assert!(!chunk.trim().is_empty());
        }
    }

    #[test]
    fn test_split_text_merges_short() {
        let result = split_text("Hi. Ok. Yes. No. Fine.");
        // Should merge these tiny sentences into fewer chunks
        assert!(result.len() <= 2);
    }

    #[test]
    fn test_split_text_splits_long() {
        let long = "A ".repeat(300); // 600 chars
        let result = split_text(&long);
        assert!(result.len() >= 2);
        for chunk in &result {
            assert!(chunk.len() <= 510); // some slack
        }
    }
}
