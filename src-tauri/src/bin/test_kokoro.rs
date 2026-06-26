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
    let voice_dir = Path::new("models/voices");

    if !model_path.exists() {
        eprintln!("ERROR: {} not found!", model_path.display());
        eprintln!("Download it first:");
        eprintln!("  python -c \"from huggingface_hub import hf_hub_download; import shutil; shutil.copy(hf_hub_download('onnx-community/Kokoro-82M-ONNX', 'onnx/model_quantized.onnx'), 'models/kokoro.onnx')\"");
        std::process::exit(1);
    }
    let voice_path: &Path = if voice_dir.is_dir() {
        println!("Using voices directory: {}", voice_dir.display());
        voice_dir
    } else {
        let fallback = Path::new("models/voices.bin");
        eprintln!(
            "WARN: voices dir not found, using fallback: {}",
            fallback.display()
        );
        fallback
    };

    println!("=== Kokoro TTS Test ===");
    println!("Model: {}", model_path.display());
    println!("Voice source: {}", voice_path.display());

    // 1. Load model
    let t0 = Instant::now();
    println!("\n[1/3] Loading model...");
    let tts = KokoroTts::new(model_path, voice_path)
        .await
        .expect("Failed to load Kokoro model");
    let load_time = t0.elapsed();
    println!("  Model loaded in {:.2}s", load_time.as_secs_f64());

    // 2. Synthesize with two different voices and compare
    let text = "Hello! This is a test of the Kokoro text to speech engine running inside Theorem.";

    println!("\n[2/4] Synthesizing with af_bella...");
    let t1 = Instant::now();
    let (audio_bella, _) = tts.synth(text, "af_bella").await.expect("af_bella failed");
    println!(
        "  af_bella: {} samples in {:.2}s",
        audio_bella.len(),
        t1.elapsed().as_secs_f64()
    );

    println!("\n[3/4] Synthesizing with am_adam...");
    let t2 = Instant::now();
    let (audio_adam, _) = tts.synth(text, "am_adam").await.expect("am_adam failed");
    println!(
        "  am_adam: {} samples in {:.2}s",
        audio_adam.len(),
        t2.elapsed().as_secs_f64()
    );

    // Compare
    let min_len = audio_bella.len().min(audio_adam.len());
    let diff_sum: f32 = audio_bella[..min_len]
        .iter()
        .zip(audio_adam[..min_len].iter())
        .map(|(a, b)| (a - b).abs())
        .sum();
    let diff_avg = diff_sum / min_len as f32;
    println!("\n[4/4] Voice comparison:");
    println!("  Bella samples: {}", audio_bella.len());
    println!("  Adam samples: {}", audio_adam.len());
    println!("  Average sample diff: {:.6}", diff_avg);
    if diff_avg < 0.0001 {
        println!("  ⚠️  WARNING: Voices appear IDENTICAL (diff < 0.0001)");
        println!("  The directory loading may not be working correctly.");
    } else {
        println!("  ✅ Voices are DIFFERENT (diff = {:.6})", diff_avg);
    }

    // Write both to WAV for listening
    write_wav("models/test_output_bella.wav", &audio_bella, 24000)
        .expect("Failed to write bella WAV");
    write_wav("models/test_output_adam.wav", &audio_adam, 24000).expect("Failed to write adam WAV");
    println!("\n✅ WAV files written:");
    println!("  models/test_output_bella.wav  (af_bella)");
    println!("  models/test_output_adam.wav   (am_adam)");
    println!("\nPlay to compare:");
    println!("  aplay models/test_output_bella.wav");
    println!("  aplay models/test_output_adam.wav");
}
