//! Desktop-native audio playback for TTS via `rodio`.
//! On Android the `android-tts-audio` plugin handles output.
//! This module is a no-op when compiled for Android.

use std::num::{NonZeroU16, NonZeroU32};
use std::sync::{LazyLock, Mutex};

#[cfg(not(target_os = "android"))]
use rodio::{buffer::SamplesBuffer, MixerDeviceSink, Player};

/// Lazily-initialised global audio output.
/// `sink` must outlive `player` — dropping the sink stops playback.
#[cfg(not(target_os = "android"))]
static AUDIO: LazyLock<Mutex<Option<(MixerDeviceSink, Player)>>> =
    LazyLock::new(|| Mutex::new(None));

/// Write (play) a chunk of audio samples on the default audio device.
/// On non-Android this queues the chunk on rodio's playback thread.
/// On Android this is a no-op (android-tts-audio plugin handles it).
pub fn write_audio(samples: Vec<f32>, sample_rate: u32) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let mut guard = AUDIO.lock().map_err(|e| e.to_string())?;
        let (_, player) = guard.get_or_insert_with(|| {
            let sink = rodio::DeviceSinkBuilder::open_default_sink()
                .expect("rodio: failed to open default audio output");
            let player = Player::connect_new(sink.mixer());
            (sink, player)
        });

        let channels = NonZeroU16::new(1).unwrap();
        let rate = NonZeroU32::new(sample_rate).unwrap();
        let source = SamplesBuffer::new(channels, rate, samples);
        player.append(source);
    }
    #[cfg(target_os = "android")]
    let _ = (samples, sample_rate);
    Ok(())
}

/// Stop playback and clear the queued audio.
pub fn stop_audio() {
    #[cfg(not(target_os = "android"))]
    if let Ok(guard) = AUDIO.lock() {
        if let Some((_, player)) = guard.as_ref() {
            player.stop();
        }
    }
}

/// Pause playback (keeps the queue, can be resumed).
pub fn pause_audio() {
    #[cfg(not(target_os = "android"))]
    if let Ok(guard) = AUDIO.lock() {
        if let Some((_, player)) = guard.as_ref() {
            player.pause();
        }
    }
}

/// Resume paused playback.
pub fn resume_audio() {
    #[cfg(not(target_os = "android"))]
    if let Ok(guard) = AUDIO.lock() {
        if let Some((_, player)) = guard.as_ref() {
            player.play();
        }
    }
}
