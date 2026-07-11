/// Theorem — Sync Persistence Helpers
///
/// Shared persistence functions for paired devices.
/// Uses atomic write (write-to-temp + rename) to prevent corruption on crash.
/// Used by both the main app (wrapped by iroh_sync) and the standalone daemon.
use crate::sync_protocol::PairedDevice;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

pub fn load_paired_devices(app_data_dir: &Path) -> HashMap<String, PairedDevice> {
    let path = app_data_dir.join("sync-paired-devices.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            let list: Vec<PairedDevice> = serde_json::from_str(&content).unwrap_or_default();
            list.into_iter().map(|d| (d.device_id.clone(), d)).collect()
        }
        Err(_) => HashMap::new(),
    }
}

pub fn save_paired_devices(
    app_data_dir: &Path,
    devices: &HashMap<String, PairedDevice>,
) -> Result<(), String> {
    let path = app_data_dir.join("sync-paired-devices.json");
    let tmp_path = app_data_dir.join("sync-paired-devices.json.tmp");
    let json = serde_json::to_string_pretty(&devices.values().collect::<Vec<_>>())
        .map_err(|e| format!("serialize: {e}"))?;

    // Atomic write: write to temp file, fsync, then rename.
    // A crash during write only affects the .tmp file, never the real file.
    {
        let mut f = std::fs::File::create(&tmp_path).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("sync tmp: {e}"))?;
    }
    std::fs::rename(&tmp_path, &path).map_err(|e| format!("rename tmp: {e}"))?;
    Ok(())
}
