const COMMANDS: &[&str] = &["tts_speak", "tts_stop", "tts_get_voices"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
