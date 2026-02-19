use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "work.fundamentals.theorem.libraryscan";

#[cfg(target_os = "android")]
struct MobileFolderScan<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct PickFolderResponse {
    uri: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFolderPayload<'a> {
    tree_uri: &'a str,
    recursive: bool,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct ScanFolderResponse {
    files: Vec<String>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-folder-scan")
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            {
                let _ = (&app, &api);
            }
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "FolderScanPlugin")?;
                app.manage(MobileFolderScan { handle });
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
pub fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let state = app.state::<MobileFolderScan<R>>();
    let response = state
        .handle
        .run_mobile_plugin::<PickFolderResponse>("pickFolder", serde_json::json!({}))
        .map_err(|error| error.to_string())?;

    Ok(response.uri.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }))
}

#[cfg(target_os = "android")]
pub fn scan_folder<R: Runtime>(app: &AppHandle<R>, tree_uri: &str) -> Result<Vec<String>, String> {
    let state = app.state::<MobileFolderScan<R>>();
    let response = state
        .handle
        .run_mobile_plugin::<ScanFolderResponse>(
            "scanFolder",
            ScanFolderPayload {
                tree_uri,
                recursive: true,
            },
        )
        .map_err(|error| error.to_string())?;

    Ok(response.files)
}
