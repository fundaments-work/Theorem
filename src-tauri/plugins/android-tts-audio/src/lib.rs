use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
use serde::Deserialize;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "work.fundamentals.theorem.ttsaudio";

#[cfg(target_os = "android")]
struct TtsAudioPluginState<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
fn get_audio_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<tauri::State<'_, TtsAudioPluginState<R>>, String> {
    app.try_state::<TtsAudioPluginState<R>>()
        .ok_or_else(|| "Android TTS audio plugin is not initialized.".to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-tts-audio")
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            {
                let _ = (&app, &api);
            }
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "TtsAudioPlugin")?;
                app.manage(TtsAudioPluginState { handle });
            }
            Ok(())
        })
        .build()
}

/// Prepare (create) the AudioTrack for the given sample rate.
/// Must be called before the first write_audio.
#[cfg(target_os = "android")]
pub fn prepare_audio<R: Runtime>(app: &AppHandle<R>, sample_rate: u32) -> Result<(), String> {
    let state = get_audio_state(app)?;
    state
        .handle
        .run_mobile_plugin::<serde_json::Value>(
            "prepareAudio",
            serde_json::json!({ "sampleRate": sample_rate }),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn prepare_audio<R: Runtime>(_app: &AppHandle<R>, _sample_rate: u32) -> Result<(), String> {
    Ok(())
}

/// Write a chunk of audio samples to the AudioTrack for playback.
/// On non-Android platforms this is a no-op.
#[cfg(target_os = "android")]
pub fn write_audio<R: Runtime>(
    app: &AppHandle<R>,
    samples: Vec<f32>,
    sample_rate: u32,
    generation_id: u64,
    chunk_index: u32,
) -> Result<(), String> {
    let state = get_audio_state(app)?;
    state
        .handle
        .run_mobile_plugin::<serde_json::Value>(
            "writeAudio",
            serde_json::json!({
                "samples": samples,
                "sampleRate": sample_rate,
                "generationId": generation_id,
                "chunkIndex": chunk_index,
            }),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn write_audio<R: Runtime>(
    _app: &AppHandle<R>,
    _samples: Vec<f32>,
    _sample_rate: u32,
    _generation_id: u64,
    _chunk_index: u32,
) -> Result<(), String> {
    Ok(())
}

/// Stop audio playback and release the AudioTrack.
#[cfg(target_os = "android")]
pub fn stop_audio<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = get_audio_state(app)?;
    state
        .handle
        .run_mobile_plugin::<serde_json::Value>("stopAudio", serde_json::json!({}))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn stop_audio<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

/// Pause (suspend) audio playback.
#[cfg(target_os = "android")]
pub fn pause_audio<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = get_audio_state(app)?;
    state
        .handle
        .run_mobile_plugin::<serde_json::Value>("pauseAudio", serde_json::json!({}))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn pause_audio<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

/// Resume (un-pause) audio playback.
#[cfg(target_os = "android")]
pub fn resume_audio<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = get_audio_state(app)?;
    state
        .handle
        .run_mobile_plugin::<serde_json::Value>("resumeAudio", serde_json::json!({}))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn resume_audio<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}
