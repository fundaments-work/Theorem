/// Theorem — magic-wormhole Pairing + File Transfer
///
/// Wraps the magic-wormhole crate to replace custom X25519 + HKDF pairing
/// (~300 lines in sync_crypto.rs + sync_server.rs + sync_commands.rs) and
/// custom chunked file transfer (~350 lines).
///
/// When the magic-wormhole library stabilizes its non-CLI Rust API, the
/// ~500 lines of custom protocol collapse to calls through this module.
use std::path::Path;

#[allow(dead_code)]
pub async fn pair_via_wormhole(
    _app_data_dir: &Path,
    _device_name: &str,
) -> Result<(Vec<u8>, String), String> {
    Err("magic-wormhole non-CLI API not yet stable".into())
}

#[allow(dead_code)]
pub async fn send_file_via_wormhole(_file_path: &Path, _code: &str) -> Result<(), String> {
    Err("magic-wormhole file transfer not yet wired".into())
}

#[allow(dead_code)]
pub async fn receive_file_via_wormhole(_code: &str, _output_dir: &Path) -> Result<(), String> {
    Err("magic-wormhole file receive not yet wired".into())
}
