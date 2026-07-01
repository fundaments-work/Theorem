use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "work.fundamentals.theorem.syncworker";

#[cfg(target_os = "android")]
struct SyncWorkerPluginState<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct StartWorkerPayload {
    notification_title: String,
    notification_text: String,
    sync_interval_secs: u64,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[allow(dead_code)]
struct WorkerStatusResponse {
    running: bool,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-sync-worker")
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            {
                let _ = (&app, &api);
            }
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin(PLUGIN_IDENTIFIER, "SyncWorkerPlugin")?;
                app.manage(SyncWorkerPluginState { handle });
            }
            Ok(())
        })
        .build()
}

/// Start the background sync ForegroundService on Android.
/// On non-Android platforms this is a no-op.
#[cfg(target_os = "android")]
pub fn start_worker<R: Runtime>(
    app: &AppHandle<R>,
    notification_title: &str,
    notification_text: &str,
    sync_interval_secs: u64,
) -> Result<(), String> {
    let state = app.state::<SyncWorkerPluginState<R>>();
    state
        .handle
        .run_mobile_plugin::<WorkerStatusResponse>(
            "startWorker",
            StartWorkerPayload {
                notification_title: notification_title.to_string(),
                notification_text: notification_text.to_string(),
                sync_interval_secs,
            },
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Stop the background sync ForegroundService on Android.
/// On non-Android platforms this is a no-op.
#[cfg(target_os = "android")]
pub fn stop_worker<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<SyncWorkerPluginState<R>>();
    state
        .handle
        .run_mobile_plugin::<WorkerStatusResponse>(
            "stopWorker",
            serde_json::json!({}),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
