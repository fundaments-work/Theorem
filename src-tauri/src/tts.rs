use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Emitter};

/// A chunk of TTS audio with per-word timing metadata.
#[derive(Serialize, Clone)]
pub struct TtsChunk {
    pub audio_data: Vec<f32>,
    pub sample_rate: u32,
    pub words: Vec<WordTimestamp>,
}

/// Per-word timing entry, matched to a DOM span by `dom_id`.
#[derive(Serialize, Clone)]
pub struct WordTimestamp {
    pub word: String,
    pub start_time: f32,
    pub end_time: f32,
    pub dom_id: String,
}

/// Split text into ≤150-char chunks on sentence boundaries.
pub fn split_text(text: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        current.push(c);
        if matches!(c, '.' | '!' | '?' | '\n') && !current.trim().is_empty() {
            sentences.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    let mut result = Vec::new();
    for s in sentences {
        if s.len() > 150 {
            // Find the whitespace closest to the midpoint
            let mid = s.len() / 2;
            let best_split = s
                .char_indices()
                .filter(|(_, c)| c.is_whitespace())
                .min_by_key(|(i, _)| ((*i as isize) - mid as isize).unsigned_abs())
                .map(|(i, _)| i)
                .unwrap_or(mid);

            let (part1, part2) = s.split_at(best_split);
            result.push(part1.trim().to_string());
            result.push(part2.trim().to_string());
        } else {
            result.push(s);
        }
    }
    result
}

/// Synthesize PCM audio for `text` using the system `espeak-ng` binary.
/// Returns raw `f32` samples at 22050 Hz, or falls back to a sine-wave
/// test tone when espeak-ng is unavailable.
pub fn synthesize_pcm(text: &str) -> (Vec<f32>, u32) {
    const SAMPLE_RATE: u32 = 22050;

    // Try running `espeak-ng` with raw 16-bit PCM output to stdout
    let result = Command::new("espeak-ng")
        .args([
            "--stdout", "-z", // no final silence
            "-s", "160", // words per minute
            "-a", "100", // amplitude 0-200
            text,
        ])
        .output();

    match result {
        Ok(output) if output.status.success() && output.stdout.len() >= 44 => {
            // espeak-ng writes raw RIFF/WAV bytes to stdout; strip the 44-byte header
            let pcm_bytes = &output.stdout[44..];
            let samples: Vec<f32> = pcm_bytes
                .chunks_exact(2)
                .map(|b| {
                    let s = i16::from_le_bytes([b[0], b[1]]);
                    s as f32 / 32768.0
                })
                .collect();
            (samples, SAMPLE_RATE)
        }
        _ => {
            // espeak-ng not available – generate an audible sine-wave tone
            // so the audio pipeline can still be tested.
            eprintln!("[tts] espeak-ng unavailable, using fallback sine tone");
            let duration_secs = text.split_whitespace().count() as f32 * 0.3; // ~0.3 s/word
            let num_samples = (SAMPLE_RATE as f32 * duration_secs) as usize;
            let tone: Vec<f32> = (0..num_samples)
                .map(|i| {
                    let t = i as f32 / SAMPLE_RATE as f32;
                    (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.4
                })
                .collect();
            (tone, SAMPLE_RATE)
        }
    }
}

/// Build per-word timing from samples based on character-proportion heuristics.
pub fn build_word_timestamps(
    words: &[&str],
    audio_len: usize,
    sample_rate: u32,
    id_offset: u32,
) -> Vec<WordTimestamp> {
    let duration_sec = audio_len as f32 / sample_rate as f32;
    let total_chars: usize = words.iter().map(|w| w.len()).sum::<usize>().max(1);
    let mut current_time = 0.0f32;

    words
        .iter()
        .enumerate()
        .map(|(i, word)| {
            let proportion = word.len() as f32 / total_chars as f32;
            let word_duration = proportion * duration_sec;
            let ts = WordTimestamp {
                word: word.to_string(),
                start_time: current_time,
                end_time: current_time + word_duration,
                dom_id: format!("w_{}", id_offset + i as u32),
            };
            current_time += word_duration;
            ts
        })
        .collect()
}

/// Tauri command: chunk `text`, synthesize each chunk, emit `audio-chunk` events.
#[tauri::command]
pub async fn generate_speech(
    app: AppHandle,
    text: String,
    start_from_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let sentences = split_text(&text);
        let mut id_counter = start_from_id
            .trim_start_matches("w_")
            .parse::<u32>()
            .unwrap_or(0);

        for sentence in &sentences {
            let (audio_data, sample_rate) = synthesize_pcm(sentence);
            let word_parts: Vec<&str> = sentence.split_whitespace().collect();
            let words =
                build_word_timestamps(&word_parts, audio_data.len(), sample_rate, id_counter);

            id_counter += word_parts.len() as u32;

            let chunk = TtsChunk {
                audio_data,
                sample_rate,
                words,
            };

            if let Err(e) = app.emit("audio-chunk", chunk) {
                eprintln!("[tts] emit error: {e}");
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Write a minimal PCM WAV so we can inspect the output with any audio player.
    fn write_wav(path: &str, samples: &[f32], sample_rate: u32) {
        let pcm_bytes: Vec<u8> = samples
            .iter()
            .flat_map(|&s| {
                let clamped = s.clamp(-1.0, 1.0);
                let i16_sample = (clamped * 32767.0) as i16;
                i16_sample.to_le_bytes()
            })
            .collect();

        let data_size = pcm_bytes.len() as u32;
        let chunk_size = 36 + data_size;
        let byte_rate = sample_rate * 2; // 1 channel, 16-bit

        let mut f = std::fs::File::create(path).expect("create wav");

        // RIFF header
        f.write_all(b"RIFF").unwrap();
        f.write_all(&chunk_size.to_le_bytes()).unwrap();
        f.write_all(b"WAVE").unwrap();
        // fmt  sub-chunk
        f.write_all(b"fmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap(); // sub-chunk size
        f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
        f.write_all(&1u16.to_le_bytes()).unwrap(); // mono
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap(); // block align
        f.write_all(&16u16.to_le_bytes()).unwrap(); // bits per sample
                                                    // data sub-chunk
        f.write_all(b"data").unwrap();
        f.write_all(&data_size.to_le_bytes()).unwrap();
        f.write_all(&pcm_bytes).unwrap();
    }

    // ── unit tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_split_text_basic() {
        let text = "Hello world. How are you? I am fine!";
        let chunks = split_text(text);
        assert_eq!(chunks.len(), 3, "Expected 3 sentences, got: {chunks:?}");
        assert_eq!(chunks[0], "Hello world.");
        assert_eq!(chunks[1], "How are you?");
        assert_eq!(chunks[2], "I am fine!");
    }

    #[test]
    fn test_split_text_long_sentence() {
        // A sentence with a terminator that is >150 chars should be bisected.
        let long_with_period = format!("{}.", "word ".repeat(40).trim());
        let chunks = split_text(&long_with_period);
        assert_eq!(
            chunks.len(),
            2,
            "Long sentence should be bisected into 2 chunks, got: {chunks:?}"
        );
        for c in &chunks {
            assert!(
                c.len() <= 150,
                "Each chunk ≤ 150 chars, got '{}' ({})",
                c,
                c.len()
            );
        }

        // Text with NO sentence-ender is a single logical sentence. If >150 chars it gets bisected.
        let no_period = "word ".repeat(40);
        let chunks2 = split_text(no_period.trim());
        // The text has no `.!?\n` so split_text sees it as 1 sentence → bisected into 2
        assert_eq!(
            chunks2.len(),
            2,
            "No-terminator long text → bisected, got: {chunks2:?}"
        );
    }

    #[test]
    fn test_split_text_empty() {
        assert!(split_text("").is_empty());
        assert!(split_text("   ").is_empty());
    }

    #[test]
    fn test_word_timestamps_proportional() {
        let words = vec!["Hello", "world"];
        let sample_rate = 22050u32;
        let audio_len = sample_rate as usize; // 1 second
        let ts = build_word_timestamps(&words, audio_len, sample_rate, 0);

        assert_eq!(ts.len(), 2);
        assert_eq!(ts[0].dom_id, "w_0");
        assert_eq!(ts[1].dom_id, "w_1");
        // Total duration should equal 1 second
        let total = ts.last().unwrap().end_time;
        assert!((total - 1.0).abs() < 0.01, "total={total}");
        // Words should be ordered chronologically
        assert!(ts[0].end_time <= ts[1].start_time + 0.001);
    }

    #[test]
    fn test_synthesize_pcm_produces_samples() {
        let text = "Hello immersion reader.";
        let (samples, sample_rate) = synthesize_pcm(text);

        assert!(sample_rate == 22050, "expected 22050 Hz, got {sample_rate}");
        assert!(!samples.is_empty(), "Should produce audio samples");

        let max_amp = samples.iter().cloned().fold(0.0f32, f32::max);
        println!(
            "[test] samples={} max_amplitude={:.4}",
            samples.len(),
            max_amp
        );

        // Write a WAV for manual listening
        let wav_path = "/tmp/theorem_tts_test.wav";
        write_wav(wav_path, &samples, sample_rate);
        println!("[test] Audio written to {wav_path} — open it to verify sound");

        assert!(
            std::path::Path::new(wav_path).exists(),
            "WAV file not created"
        );
    }

    #[test]
    fn test_synthesize_full_pipeline() {
        let text = "The quick brown fox jumps over the lazy dog. \
                    This sentence tests the chunking system!";

        let sentences = split_text(text);
        assert!(
            !sentences.is_empty(),
            "Should produce at least one sentence"
        );

        let mut all_samples: Vec<f32> = Vec::new();
        let mut id_counter = 0u32;

        for sentence in &sentences {
            let (audio_data, sample_rate) = synthesize_pcm(sentence);
            let word_parts: Vec<&str> = sentence.split_whitespace().collect();
            let ts = build_word_timestamps(&word_parts, audio_data.len(), sample_rate, id_counter);

            println!(
                "[test] sentence='{sentence}' words={} samples={} duration={:.2}s",
                ts.len(),
                audio_data.len(),
                audio_data.len() as f32 / sample_rate as f32
            );

            for w in &ts {
                println!(
                    "       [{:.3}→{:.3}] '{}' dom_id={}",
                    w.start_time, w.end_time, w.word, w.dom_id
                );
            }

            // timestamps must be monotonically increasing and non-negative
            for w in &ts {
                assert!(w.start_time >= 0.0);
                assert!(
                    w.end_time > w.start_time,
                    "end_time must be after start_time"
                );
            }

            id_counter += word_parts.len() as u32;
            all_samples.extend_from_slice(&audio_data);
        }

        // Write combined WAV
        let wav_path = "/tmp/theorem_tts_pipeline_test.wav";
        write_wav(wav_path, &all_samples, 22050);
        println!("[test] Full pipeline audio → {wav_path}");
    }
}
