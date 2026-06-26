use futures::stream::{self, StreamExt};
use kokoro_en::{split_sentences, KokoroTts};
use regex::Regex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

/// Known English abbreviations whose trailing period should NOT be treated as
/// a sentence boundary.  Lowercase, without the period.
const ABBREVIATIONS: &[&str] = &[
    "dr", "mr", "mrs", "ms", "mx", "prof", "sr", "jr", "st", "sgt", "capt", "maj", "col", "gen",
    "lt", "gov", "pres", "dept", "est", "vol", "vs", "etc", "inc", "ltd", "co", "corp", "jan",
    "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec", "e.g", "i.e", "viz",
    "al", "ch", "pp", "no", "ex", "appx", "fig", "eq", "approx", "eds", "anon", "c", "cf", "chap",
    "diss", "ed", "trans", "rev", "n.p", "n.d", "l", "ll", "vols", "p", "pp", "par", "pars",
];

/// Returns `true` when `c` at byte position `char_pos` inside `text` is a
/// genuine sentence-ending boundary (not an abbreviation, initial, or decimal).
fn is_sentence_end(text: &str, char_pos: usize, c: char) -> bool {
    debug_assert!(char_pos < text.len());

    match c {
        '!' | '?' | ';' => true,
        '\n' => {
            // Only treat newline as boundary if preceded by actual sentence end
            let before = &text[..char_pos];
            before
                .trim()
                .ends_with(|ch: char| matches!(ch, '.' | '!' | '?' | ';' | '\n'))
        }
        '.' => {
            let before = &text[..char_pos];
            let preceding_word = before.split_whitespace().last().unwrap_or("");

            // Decimal number: "3.14", "1.5" – never boundary
            if preceding_word.chars().all(|ch| ch.is_ascii_digit()) {
                return false;
            }

            // Initial: "J. K. Rowling" – never boundary
            let stem = preceding_word.trim_end_matches('.');
            if stem.len() == 1 && stem.chars().all(|ch| ch.is_ascii_uppercase()) {
                return false;
            }

            // Known abbreviation – never boundary
            if !stem.is_empty()
                && stem.len() <= 8
                && stem.chars().all(|ch| ch.is_ascii_alphabetic())
                && ABBREVIATIONS.contains(&stem.to_ascii_lowercase().as_str())
            {
                return false;
            }

            true
        }
        _ => false,
    }
}

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

/// Split text into ≤500-char chunks on sentence boundaries.
/// Kokoro handles up to ~500 chars well; longer text gets split.
///
/// Improves on naïve sentence-splitting by:
///   - Not splitting on known abbreviations, initials, or decimal numbers.
///   - Including context overlap when hard-splitting a long sentence.
pub fn split_text(text: &str) -> Vec<String> {
    // ── First pass: split into sentences ──
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();

    for (pos, c) in text.char_indices() {
        current.push(c);
        if is_sentence_end(text, pos, c) && !current.trim().is_empty() {
            // Trailing space forces the ONNX model to generate a silent
            // audio tail, preventing truncation of the last phoneme
            // (e.g. "time" → "tim", "ninety-one" → "nine").
            sentences.push(current.trim().to_string() + " ");
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string() + " ");
    }

    // ── Second pass: merge short, split long ──
    const MAX_CHUNK_LEN: usize = 200;
    /// Number of trailing characters from the previous chunk to include as
    /// leading context for the next chunk when hard-splitting a long sentence.
    /// The phonemizer uses this surrounding context for disambiguation.
    const CONTEXT_OVERLAP: usize = 60;

    let mut result: Vec<String> = Vec::new();
    let mut buf = String::new();

    for s in &sentences {
        if buf.len() + s.len() + 1 <= MAX_CHUNK_LEN {
            if !buf.is_empty() {
                buf.push(' ');
            }
            buf.push_str(s);
        } else {
            if !buf.is_empty() {
                result.push(buf.clone());
                buf.clear();
            }
            if s.len() > MAX_CHUNK_LEN {
                split_long_sentence(s, MAX_CHUNK_LEN, CONTEXT_OVERLAP, &mut result, &mut buf);
            } else {
                buf = s.clone();
            }
        }
    }
    if !buf.is_empty() {
        result.push(buf);
    }

    result.retain(|s| !s.trim().is_empty());
    result
}

/// Hard-split a single long sentence that exceeds `max_len`.
///
/// Each split point adds `overlap` characters of trailing-context from the
/// previous piece so the phonemizer has enough context to pronounce the
/// start of the next piece correctly.  The first piece never repeats, but
/// subsequent pieces have a repeated tail-to-head overlap zone.
fn split_long_sentence(
    sentence: &str,
    max_len: usize,
    overlap: usize,
    result: &mut Vec<String>,
    remainder: &mut String,
) {
    let mut start = 0_usize;
    let bytes = sentence.as_bytes();
    let len = sentence.len();

    loop {
        if start >= len {
            break;
        }

        let remaining = len - start;
        if remaining <= max_len {
            // Last piece — keep as remainder for merging
            *remainder = format!("{} ", sentence[start..].trim());
            break;
        }

        let target = start + max_len;
        if target >= len {
            *remainder = format!("{} ", sentence[start..].trim());
            break;
        }

        let cut = (start + (max_len / 4)..target)
            .rev()
            .find(|&i| bytes[i].is_ascii_whitespace())
            .unwrap_or(target);

        let piece = format!("{} ", sentence[start..cut].trim());
        if !piece.trim().is_empty() {
            result.push(piece);
        }

        start = cut;
        if overlap > 0 && start >= overlap {
            let overlap_start = start.saturating_sub(overlap);
            if !sentence.is_char_boundary(overlap_start) {
                let adjusted = overlap_start.saturating_sub(4);
                start = (adjusted..start)
                    .find(|&i| sentence.is_char_boundary(i) && i >= adjusted)
                    .unwrap_or(start);
            } else {
                start = overlap_start;
            }
        }
    }
}

/// Resolve the `models/` directory at runtime:
///   1. Tauri resource dir (production / bundled) — only if the model AND
///      the `voices/` directory (with individual voice .bin files) exist.
///   2. `CARGO_MANIFEST_DIR/models/` (dev — has the full voices/ directory).
///
/// We require the `voices/` directory, not `voices.bin`, because `voices.bin`
/// is a single-voice pack — using it makes ALL voices sound identical (the
/// `get_pack` fallback returns the same pack regardless of requested voice).
fn resolve_models_dir(app: &AppHandle) -> std::path::PathBuf {
    let resource_dir = app.path().resource_dir().ok();
    if let Some(ref d) = resource_dir {
        let candidate = d.join("models");
        if candidate.join("kokoro.onnx").exists() && candidate.join("voices").is_dir() {
            return candidate;
        }
    }
    // Dev: use the crate root (set at compile time)
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models")
}

/// Load the Kokoro engine, trying the Tauri resource directory first,
/// then falling back to `CARGO_MANIFEST_DIR/models/` for dev mode.
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

    let models_dir = resolve_models_dir(app);
    let model_path = models_dir.join("kokoro.onnx");
    let voice_dir = models_dir.join("voices");
    let voice_path: std::path::PathBuf = if voice_dir.is_dir() {
        voice_dir
    } else {
        models_dir.join("voices.bin")
    };

    eprintln!(
        "[tts] loading engine: model={} voice={}",
        model_path.display(),
        voice_path.display(),
    );

    let kokoro = KokoroTts::new(&model_path, &voice_path)
        .await
        .map_err(|e| format!("Failed to load Kokoro: {}", e))?;
    *guard = Some(kokoro);
    Ok(())
}

/// Pre-warm the Kokoro TTS engine at app startup so the first user-requested
/// synthesis is fast.  Loads the ONNX model, voices, and runs a short dummy
/// synthesis to initialize the phonemizer and warm the ONNX graph.
///
/// Should be called once from `setup()` via `tauri::async_runtime::spawn`.
pub async fn prewarm_engine(app: &AppHandle, state: &TtsState) {
    eprintln!("[tts] prewarm: starting engine warm-up...");

    if let Err(e) = ensure_engine(app, state).await {
        eprintln!("[tts] prewarm: engine load failed: {}", e);
        return;
    }

    // Run a dummy synthesis to warm the phonemizer (misaki-lean LazyLock)
    // and the first real ONNX inference path. Using a multi-word sentence
    // ensures the per-word misaki G2P path is exercised, not just the
    // single-word lexicon fast path.
    let guard = state.engine.read().await;
    if let Some(engine) = guard.as_ref() {
        match engine
            .synth("The quick brown fox jumps over the lazy dog.", "af_bella")
            .await
        {
            Ok((_, duration)) => {
                eprintln!(
                    "[tts] prewarm: phonemizer + inference warm-up completed in {:?}",
                    duration
                );
            }
            Err(e) => {
                eprintln!("[tts] prewarm: dummy synthesis failed: {:?}", e);
            }
        }
    }
    drop(guard);

    eprintln!("[tts] prewarm: engine is ready");
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
    let state = app.state::<TtsState>();

    // Bump generation ID — any older in-flight generation will see this and abort
    let gen_id = state
        .generation_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    // Ensure engine is loaded (fast if already loaded)
    ensure_engine(&app, &state).await?;

    let dom_id = start_from_id.unwrap_or_else(|| "tts-w-0".to_string());
    let normalized = normalize_for_tts(&text);

    // Use kokoro-en's sentence splitter, then merge short sentences into
    // ~150-char chunks. Individual sentences (~50 chars) produce only ~2s
    // of audio — too short, causing gaps between chunks. Merging to 150
    // chars gives ~6-8s of audio per chunk, plenty of time for the next
    // chunk to synthesize via buffered(4). First chunk still synthesizes
    // in ~2-3s because it's shorter than the old 200-char chunks.
    const TARGET_CHUNK_LEN: usize = 150;
    let raw_sentences = split_sentences(&normalized);
    let chunks: Vec<String> = {
        let mut result: Vec<String> = Vec::new();
        let mut buf = String::new();
        for s in raw_sentences {
            let s = s.trim();
            if s.is_empty() {
                continue;
            }
            let s_with_space = format!("{} ", s);
            if buf.len() + s_with_space.len() <= TARGET_CHUNK_LEN {
                buf.push_str(&s_with_space);
            } else {
                if !buf.is_empty() {
                    result.push(buf.clone());
                    buf.clear();
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
    tokio::spawn(async move {
        use tauri::Manager;

        let voice_name = voice.as_deref().unwrap_or("af_bella").to_string();

        // buffered(4): starts up to 4 chunk syntheses concurrently.
        // G2P (phonemizer) runs in parallel across chunks; ONNX inference
        // serializes naturally on the session Mutex. Chunk 0 is polled first
        // so it typically gets the Mutex first → fastest first audio.
        // By the time chunk 0 finishes playing, chunks 1-3 are already
        // synthesized → gapless playback.
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
        for chunk in &result {
            assert!(!chunk.trim().is_empty());
        }
    }

    #[test]
    fn test_split_text_merges_short() {
        let result = split_text("Hi. Ok. Yes. No. Fine.");
        assert!(result.len() <= 2);
    }

    #[test]
    fn test_split_text_splits_long() {
        let long = "A ".repeat(300);
        let result = split_text(&long);
        assert!(result.len() >= 2);
        for chunk in &result {
            assert!(chunk.len() <= 510);
        }
    }

    #[test]
    fn test_does_not_split_on_abbreviations() {
        let text = "Dr. Smith went to Washington. He met with Mr. Jones.";
        let result = split_text(text);
        // "Dr. Smith went to Washington." should be one sentence
        assert!(
            result
                .iter()
                .any(|s| s.contains("Dr. Smith") && s.contains("Washington")),
            "Dr. and Mr. should not trigger splits: {:?}",
            result
        );
    }

    #[test]
    fn test_does_not_split_on_initials() {
        let text = "J. K. Rowling wrote Harry Potter. It was a success.";
        let result = split_text(text);
        assert!(
            result
                .iter()
                .any(|s| s.contains("J. K. Rowling") && s.contains("Harry Potter")),
            "Initials should not trigger splits: {:?}",
            result
        );
    }

    #[test]
    fn test_does_not_split_on_decimals() {
        let text = "The value is 3.14 and it's constant. Really.";
        let result = split_text(text);
        assert!(
            result
                .iter()
                .any(|s| s.contains("3.14") && s.contains("constant")),
            "Decimals should not trigger splits: {:?}",
            result
        );
    }

    #[test]
    fn test_normalize_ampersand() {
        let normalized = normalize_for_tts("Apples & Oranges");
        // misaki workaround appends _ at word boundaries
        assert_eq!(normalized, "Apples_ and_ Oranges_ ");
    }

    #[test]
    fn test_normalize_whitespace() {
        let normalized = normalize_for_tts("Hello    world.  Spaced. ");
        // anti-bite detaches . from words, misaki appends _, then trailing space
        assert_eq!(normalized, "Hello_ world_ . Spaced_ .  ");
    }

    #[test]
    fn test_normalize_possessive_apostrophe() {
        // apostrophe is removed entirely — misaki splits on ' regardless
        // "friends's" → apostrophe removed → "friendss" → misaki → "friendss_"
        let normalized = normalize_for_tts("friends's");
        assert_eq!(normalized, "friendss_ ");
    }

    #[test]
    fn test_normalize_contraction_apostrophe() {
        // apostrophe is removed entirely — misaki splits on ' regardless
        let normalized = normalize_for_tts("don't");
        assert_eq!(normalized, "dont_ ");
    }

    #[test]
    fn test_context_overlap_in_long_sentence() {
        // Build a sentence long enough to force hard-split (>500 chars)
        let long = "The quick brown fox jumps over the lazy dog near the bank. ".repeat(15);
        let text = long.trim();
        assert!(
            text.len() > 500,
            "test text must exceed 500 chars (was {})",
            text.len()
        );
        let result = split_text(text);
        assert!(
            result.len() >= 2,
            "long text should produce multiple chunks: {:?}",
            result
        );
        // Verify no chunk exceeds the hard limit + slack (trailing space adds 1)
        for chunk in &result {
            assert!(
                chunk.len() <= 570,
                "chunk too long ({} chars): {:?}",
                chunk.len(),
                chunk
            );
        }
    }

    #[test]
    fn test_abbreviation_at_true_sentence_end() {
        // An abbreviation followed by end-of-text IS still a sentence end.
        let text = "Bring pens, paper, and other supplies etc.";
        let result = split_text(text);
        assert_eq!(result.len(), 1, "single sentence: {:?}", result);
        assert!(result[0].trim().ends_with("etc."));
    }

    #[test]
    fn test_abbreviation_does_not_prevent_actual_sentence_break() {
        // '!' is always a sentence boundary and is not affected by abbreviation
        // checks.  Short fragments get merged back but the punctuation survives.
        let text = "Call Dr. Smith! He is expecting you.";
        let result = split_text(text);
        assert!(result[0].contains("Smith!"));
    }

    #[test]
    fn test_split_text_with_quotes() {
        // Quotes preserve sentence-internal periods correctly.
        let text = "He said \"Hello world.\" Then she replied \"Goodbye.\"";
        let result = split_text(text);
        let concatenated: String = result.concat();
        assert!(concatenated.contains("Hello world"));
        assert!(concatenated.contains("Goodbye"));
    }

    #[test]
    fn test_trailing_space_added_to_sentences() {
        // Every sentence must end with a space so the ONNX model generates
        // a silent audio tail (prevents "time"→"tim" truncation).
        let result = split_text("Hello world. Goodbye.");
        for s in &result {
            assert!(s.ends_with(' '), "missing trailing space: {s:?}");
        }
    }

    #[test]
    fn test_trailing_space_on_single_sentence() {
        let result = split_text("Just one sentence.");
        assert_eq!(result.len(), 1);
        assert!(
            result[0].ends_with(' '),
            "missing trailing space: {:?}",
            result[0]
        );
    }

    #[test]
    fn test_trailing_space_in_long_chunks() {
        let long = "The quick brown fox jumps over the lazy dog. ".repeat(20);
        let text = long.trim();
        let result = split_text(text);
        assert!(result.len() >= 2);
        for chunk in &result {
            assert!(
                chunk.ends_with(' '),
                "chunk missing trailing space: {chunk:?}"
            );
        }
    }

    #[test]
    fn test_punctuation_preserved_in_words() {
        let text = "The time is 2:30. Call 911. The value is 91.5.";
        let result = split_text(text);
        let all: String = result.concat();
        assert!(all.contains("time"));
        assert!(all.contains("911"));
        assert!(all.contains("91.5"));
    }
}
