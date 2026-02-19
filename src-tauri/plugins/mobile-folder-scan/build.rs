const COMMANDS: &[&str] = &["pick_folder", "scan_folder"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
