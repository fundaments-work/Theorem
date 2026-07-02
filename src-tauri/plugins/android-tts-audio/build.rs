const COMMANDS: &[&str] = &[
    "prepare_audio",
    "write_audio",
    "stop_audio",
    "pause_audio",
    "resume_audio",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
