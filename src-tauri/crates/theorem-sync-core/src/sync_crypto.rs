pub fn compute_device_id(public_key_bytes: &[u8; 32]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(public_key_bytes);
    hex::encode(&hash[..8])
}

pub fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

pub fn read_machine_fingerprint() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/etc/machine-id") {
            let trimmed = content.trim();
            if !trimmed.is_empty() && trimmed.len() >= 32 {
                return trimmed[..16].to_string();
            }
        }

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
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                for line in stdout.lines() {
                    if line.contains("MachineGuid") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if let Some(guid) = parts.last() {
                            let trimmed = guid.trim();
                            if !trimmed.is_empty() {
                                use sha2::Digest;
                                let hash = sha2::Sha256::digest(trimmed.as_bytes());
                                return hex::encode(&hash[..8]);
                            }
                        }
                    }
                }
            }
        }
        String::new()
    }
    #[cfg(target_os = "android")]
    {
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

use std::sync::OnceLock;
static FRONTEND_FINGERPRINT: OnceLock<String> = OnceLock::new();

#[cfg(target_os = "macos")]
fn sha2_hash_first16(data: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(data);
    hex::encode(&hash[..8])
}

pub fn set_fingerprint_from_frontend(fp: &str) {
    let _ = FRONTEND_FINGERPRINT.set(fp.to_string());
}

pub fn get_frontend_fingerprint() -> Option<String> {
    FRONTEND_FINGERPRINT.get().cloned()
}

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
