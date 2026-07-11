/// Theorem LAN Sync — Cryptographic Primitives
///
/// Provides device identity management, machine fingerprinting,
/// and QR code generation for the peer-to-peer sync feature.
/// Compute a short device ID from the iroh public key bytes.
/// Returns first 16 hex chars of SHA-256(public_key_bytes).
pub fn compute_device_id(public_key_bytes: &[u8; 32]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(public_key_bytes);
    hex::encode(&hash[..8])
}

// ─── Timestamp Utility ───

/// Get current time as ISO 8601 string via the `time` crate.
pub fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

// ─── Device Fingerprint ───

/// Read a stable device fingerprint that survives identity file loss.
///
/// Strategies per platform:
/// - Linux: `/etc/machine-id` (128-bit hex, stable across reboots)
/// - macOS: `IOPlatformUUID` via `ioreg` (too slow, so we use a hash of
///   the system's serial number from `sysctl hw.model`)
/// - Windows: Not yet implemented — uses empty string as fallback
/// - Android: `Settings.Secure.ANDROID_ID` (handled via Tauri plugin)
///
/// If the fingerprint cannot be read, returns an empty string
/// (the sync subsystem will still work, just without dedup).
pub fn read_machine_fingerprint() -> String {
    #[cfg(target_os = "linux")]
    {
        // Try /etc/machine-id first (most Linux distros).
        if let Ok(content) = std::fs::read_to_string("/etc/machine-id") {
            let trimmed = content.trim();
            if !trimmed.is_empty() && trimmed.len() >= 32 {
                return trimmed[..16].to_string();
            }
        }
        // Fallback: /var/lib/dbus/machine-id
        if let Ok(content) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed[..16.min(trimmed.len())].to_string();
            }
        }
        String::new()
    }
    #[cfg(target_os = "macos")]
    {
        // Use IOPlatformUUID via ioreg on macOS
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                for line in stdout.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(uuid_part) = line.split('=').nth(1) {
                            let uuid = uuid_part.trim().trim_matches('"');
                            if !uuid.is_empty() {
                                return sha2_hash_first16(uuid.as_bytes());
                            }
                        }
                    }
                }
            }
        }
        String::new()
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: use a placeholder for now.
        // Could use WMI or registry to read machine GUID.
        String::new()
    }
    #[cfg(target_os = "android")]
    {
        // Android: ANDROID_ID is passed via Tauri plugin
        // For now, fall back to empty (will be overridden by the frontend).
        String::new()
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "windows",
        target_os = "android"
    )))]
    {
        String::new()
    }
}

/// Module-level static for frontend-provided fingerprint override.
use std::sync::OnceLock;
static FRONTEND_FINGERPRINT: OnceLock<String> = OnceLock::new();

/// Helper: SHA-256 hash the input and return the first 16 hex characters.
#[cfg(target_os = "macos")]
fn sha2_hash_first16(data: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(data);
    hex::encode(&hash[..8])
}

/// Set the device fingerprint via a Tauri command (for Android where
/// the machine ID is only accessible from the Java/Kotlin side).
pub fn set_fingerprint_from_frontend(fp: &str) {
    let _ = FRONTEND_FINGERPRINT.set(fp.to_string());
}

/// Get any frontend-overridden fingerprint (for Android).
pub fn get_frontend_fingerprint() -> Option<String> {
    FRONTEND_FINGERPRINT.get().cloned()
}

// ─── QR Code Generation ───

/// Generate a QR code as an SVG string from a JSON payload.
///
/// The returned string is a complete SVG document that can be embedded directly
/// in a frontend `<img>` tag via a data URL or rendered as inner HTML.
pub fn generate_qr_svg(payload_json: &str) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(payload_json.as_bytes())
        .map_err(|e| format!("Failed to encode QR code: {e}"))?;

    let svg_string = code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .max_dimensions(512, 512)
        .quiet_zone(true)
        .build();

    Ok(svg_string)
}

// ─── Tests ───

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_device_id_consistency() {
        let key = [0u8; 32];
        let id1 = compute_device_id(&key);
        let id2 = compute_device_id(&key);
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 16);
    }

    #[test]
    fn test_compute_device_id_different_keys() {
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        let id1 = compute_device_id(&key1);
        let id2 = compute_device_id(&key2);
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_compute_device_id_valid_hex() {
        let key = [0xAB; 32];
        let id = compute_device_id(&key);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_qr_svg_generation() {
        let payload = r#"{"ip":"192.168.1.42","port":38199}"#;
        let svg = generate_qr_svg(payload).expect("QR generation should succeed");

        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
        assert!(svg.len() > 100);
    }
}
