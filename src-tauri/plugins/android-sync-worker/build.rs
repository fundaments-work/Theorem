const COMMANDS: &[&str] = &["start_worker", "stop_worker"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
