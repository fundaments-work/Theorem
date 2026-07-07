/// Theorem — Sync Persistence Helpers
///
/// Shared persistence functions for paired devices.
/// Used by both the main app (wrapped by iroh_sync) and the standalone daemon.
use crate::sync_protocol::PairedDevice;
use std::collections::HashMap;
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
    let json = serde_json::to_string_pretty(&devices.values().collect::<Vec<_>>())
        .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write: {e}"))?;
    Ok(())
}
