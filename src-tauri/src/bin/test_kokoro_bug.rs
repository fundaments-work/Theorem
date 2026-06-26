use kokoro_en::KokoroTts;
use std::fs::File;
use std::io::Write;
use std::path::Path;

fn write_wav(path: &str, samples: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let num_samples = samples.len() as u32;
    let byte_rate = sample_rate * 2;
    let data_size = num_samples * 2;
    let file_size = 36 + data_size;

    let mut f = File::create(path)?;
    f.write_all(b"RIFF")?;
    f.write_all(&file_size.to_le_bytes())?;
    f.write_all(b"WAVE")?;
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&sample_rate.to_le_bytes())?;
    f.write_all(&byte_rate.to_le_bytes())?;
    f.write_all(&2u16.to_le_bytes())?;
    f.write_all(&16u16.to_le_bytes())?;
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

    let tts = KokoroTts::new(model_path, voice_dir)
        .await
        .expect("Failed to load Kokoro model");

    let tests = vec!["91.5", "91_.5_"];

    for (i, text) in tests.iter().enumerate() {
        let (audio, _) = tts.synth(text, "af_bella").await.expect("synth failed");
        println!(
            "{:>10} -> {} samples ({:.2}s)",
            text,
            audio.len(),
            audio.len() as f32 / 24000.0
        );

        let path = format!("models/test_{}.wav", i);
        write_wav(&path, &audio, 24000).unwrap();
    }
}
