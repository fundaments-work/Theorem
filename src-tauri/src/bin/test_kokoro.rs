//! Standalone test: load Kokoro ONNX, synthesize one sentence, write WAV to disk.
//! Run with: cargo run --bin test_kokoro

use kokoro_en::KokoroTts;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

fn write_wav(path: &str, samples: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let num_samples = samples.len() as u32;
    let byte_rate = sample_rate * 2; // 16-bit mono
    let data_size = num_samples * 2;
    let file_size = 36 + data_size;

    let mut f = std::fs::File::create(path)?;

    // RIFF header
    f.write_all(b"RIFF")?;
    f.write_all(&file_size.to_le_bytes())?;
    f.write_all(b"WAVE")?;

    // fmt sub-chunk
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?; // sub-chunk size
    f.write_all(&1u16.to_le_bytes())?; // PCM
    f.write_all(&1u16.to_le_bytes())?; // mono
    f.write_all(&sample_rate.to_le_bytes())?;
    f.write_all(&byte_rate.to_le_bytes())?;
    f.write_all(&2u16.to_le_bytes())?; // block align
    f.write_all(&16u16.to_le_bytes())?; // bits per sample

    // data sub-chunk
    f.write_all(b"data")?;
    f.write_all(&data_size.to_le_bytes())?;

    for &s in samples {
        let clamped = s.max(-1.0).min(1.0);
        let i16_val = (clamped * 32767.0) as i16;
        f.write_all(&i16_val.to_le_bytes())?;
    }

    Ok(())
}

#[tokio::main]
async fn main() {
    let model_path = Path::new("models/kokoro.onnx");
    let voice_path = Path::new("models/voices.bin");

    if !model_path.exists() {
        eprintln!("ERROR: {} not found!", model_path.display());
        eprintln!("Download it first:");
        eprintln!("  python -c \"from huggingface_hub import hf_hub_download; import shutil; shutil.copy(hf_hub_download('onnx-community/Kokoro-82M-ONNX', 'onnx/model_quantized.onnx'), 'models/kokoro.onnx')\"");
        std::process::exit(1);
    }
    if !voice_path.exists() {
        eprintln!("ERROR: {} not found!", voice_path.display());
        std::process::exit(1);
    }

    println!("=== Kokoro TTS Test ===");
    println!("Model: {}", model_path.display());
    println!("Voice: {}", voice_path.display());

    // 1. Load model
    let t0 = Instant::now();
    println!("\n[1/3] Loading model...");
    let tts = KokoroTts::new(model_path, voice_path)
        .await
        .expect("Failed to load Kokoro model");
    let load_time = t0.elapsed();
    println!("  Model loaded in {:.2}s", load_time.as_secs_f64());

    // 2. Synthesize a short sentence
    let text = "Hello! This is a test of the Kokoro text to speech engine running inside Theorem.";
    println!("\n[2/3] Synthesizing: \"{}\"", text);
    let t1 = Instant::now();
    let (audio, duration) = tts
        .synth(text, "af_bella")
        .await
        .expect("Synthesis failed");
    let synth_time = t1.elapsed();

    println!("  Synth completed in {:.2}s", synth_time.as_secs_f64());
    println!("  Audio duration: {:.2}s", duration.as_secs_f64());
    println!("  Samples: {} ({:.1} kHz)", audio.len(), audio.len() as f64 / duration.as_secs_f64() / 1000.0);
    println!("  Real-time factor: {:.2}x", duration.as_secs_f64() / synth_time.as_secs_f64());

    // 3. Write to WAV
    let wav_path = "models/test_output.wav";
    println!("\n[3/3] Writing WAV to {}", wav_path);
    write_wav(wav_path, &audio, 24000).expect("Failed to write WAV");

    let wav_size = std::fs::metadata(wav_path).map(|m| m.len()).unwrap_or(0);
    println!("  WAV file size: {} bytes ({:.1} KB)", wav_size, wav_size as f64 / 1024.0);

    println!("\n✅ SUCCESS! Play the output:");
    println!("  aplay {} OR mpv {}", wav_path, wav_path);

    // 4. Test a second sentence to measure warm inference
    let text2 = "The quick brown fox jumps over the lazy dog.";
    println!("\n[BONUS] Warm inference test: \"{}\"", text2);
    let t2 = Instant::now();
    let (audio2, dur2) = tts
        .synth(text2, "af_bella")
        .await
        .expect("Second synthesis failed");
    let synth2_time = t2.elapsed();
    println!("  Synth time: {:.2}s | Audio: {:.2}s | RTF: {:.2}x",
        synth2_time.as_secs_f64(), dur2.as_secs_f64(),
        dur2.as_secs_f64() / synth2_time.as_secs_f64());

    let wav2_path = "models/test_output_2.wav";
    write_wav(wav2_path, &audio2, 24000).expect("Failed to write WAV 2");
    println!("  Written to {}", wav2_path);
}
