const COMMANDS: &[&str] = &[
    "start_worker",
    "stop_worker",
    "update_notification",
    "schedule_periodic_sync",
    "cancel_periodic_sync",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
