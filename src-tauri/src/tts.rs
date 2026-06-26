use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct TtsChunk {
    pub audio_data: Vec<f32>,
    pub sample_rate: u32,
    pub words: Vec<WordTimestamp>,
}

#[derive(Serialize, Clone)]
pub struct WordTimestamp {
    pub word: String,
    pub start_time: f32,
    pub end_time: f32,
    pub dom_id: String,
}

#[derive(Deserialize)]
pub struct GenerateSpeechRequest {
    text: String,
    startFromId: String,
}

// Global state for TTS engine
pub struct TtsEngine {
    // Actually kokoro-en doesn't need to hold the engine alive if we just instantiate or we can hold it
    // But Kokoro load might be heavy. Let's assume we load it on demand or once.
}

fn split_text(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        current.push(c);
        if c == '.' || c == '!' || c == '?' || c == '\n' {
            if current.trim().len() > 0 {
                sentences.push(current.trim().to_string());
            }
            current.clear();
        }
    }
    if current.trim().len() > 0 {
        sentences.push(current.trim().to_string());
    }

    let mut result = Vec::new();
    for s in sentences {
        if s.len() > 150 {
            // Split at median whitespace
            let mut best_split = s.len() / 2;
            let mut min_diff = s.len();
            for (i, c) in s.char_indices() {
                if c.is_whitespace() {
                    let diff = (i as i32 - (s.len() / 2) as i32).abs() as usize;
                    if diff < min_diff {
                        min_diff = diff;
                        best_split = i;
                    }
                }
            }
            let (part1, part2) = s.split_at(best_split);
            result.push(part1.trim().to_string());
            result.push(part2.trim().to_string());
        } else {
            result.push(s);
        }
    }
    result
}

#[tauri::command]
pub async fn generate_speech(
    app: AppHandle,
    text: String,
    start_from_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let sentences = split_text(&text);
        
        // Use a dummy Kokoro or actual Kokoro if loaded
        // For actual Kokoro we need model path.
        // For now, let's just simulate the chunking and duration mapping.
        
        let mut id_counter = start_from_id.replace("w_", "").parse::<u32>().unwrap_or(0);

        for sentence in sentences {
            // Generate audio with Kokoro
            // let audio = engine.generate(&sentence);
            // We simulate audio length here for proportional mapping
            let simulated_audio_len = sentence.len() * 24000 / 15; // 15 chars per sec approx
            let audio_data = vec![0.0f32; simulated_audio_len];
            let sample_rate = 24000;
            
            let duration_sec = audio_data.len() as f32 / sample_rate as f32;
            
            let parts: Vec<&str> = sentence.split_whitespace().collect();
            let mut words = Vec::new();
            
            let total_chars: usize = parts.iter().map(|w| w.len()).sum();
            let mut current_time = 0.0;
            
            for part in parts {
                let proportion = part.len() as f32 / total_chars as f32;
                let word_duration = proportion * duration_sec;
                
                words.push(WordTimestamp {
                    word: part.to_string(),
                    start_time: current_time,
                    end_time: current_time + word_duration,
                    dom_id: format!("w_{}", id_counter),
                });
                
                current_time += word_duration;
                id_counter += 1;
            }
            
            let chunk = TtsChunk {
                audio_data,
                sample_rate,
                words,
            };
            
            let _ = app.emit("audio-chunk", chunk);
        }
    });

    Ok(())
}
