/// Theorem LAN Sync — Cryptographic Primitives
///
/// Provides device identity management, key exchange, authenticated encryption,
/// and QR code generation for the peer-to-peer sync feature.
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey as X25519PublicKey, StaticSecret};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Persistent device identity backed by an X25519 static secret.
/// The device ID is a short hex string derived from the public key hash.
pub struct DeviceIdentity {
    secret: StaticSecret,
    pub public_key: X25519PublicKey,
    pub device_id: String,
}

/// Serializable form of device identity for disk storage.
#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    secret_bytes: Vec<u8>,
}

/// Result of encrypting a payload with ChaCha20-Poly1305.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EncryptedPayload {
    /// Base64-encoded random 12-byte nonce used for this message.
    /// Each encryption MUST use a unique nonce with the same key.
    pub nonce_b64: String,
    /// Unix timestamp in milliseconds when the message was created.
    pub timestamp_ms: u64,
    /// Base64-encoded ciphertext (includes AEAD authentication tag).
    pub ciphertext: String,
    /// Kept for wire-format compatibility. AEAD provides authentication;
    /// no separate HMAC is computed. Always empty in current code.
    #[serde(default)]
    pub hmac_tag: String,
}

// ─── Device Identity ───

impl DeviceIdentity {
    /// Generate a new random device identity.
    fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public_key = X25519PublicKey::from(&secret);
        let device_id = Self::compute_device_id(&public_key);
        Self {
            secret,
            public_key,
            device_id,
        }
    }

    /// Load existing identity from disk, or create and persist a new one.
    pub fn load_or_create(app_data_dir: &Path) -> Result<Self, String> {
        let identity_path = app_data_dir.join("sync-identity.json");

        // Try to load existing identity.
        if identity_path.exists() {
            let content = fs::read_to_string(&identity_path)
                .map_err(|e| format!("Failed to read identity file: {e}"))?;
            let stored: StoredIdentity = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse identity file: {e}"))?;
            let secret_bytes: [u8; 32] = stored
                .secret_bytes
                .try_into()
                .map_err(|_| "Invalid secret key length".to_string())?;
            let secret = StaticSecret::from(secret_bytes);
            let public_key = X25519PublicKey::from(&secret);
            let device_id = Self::compute_device_id(&public_key);
            return Ok(Self {
                secret,
                public_key,
                device_id,
            });
        }

        // Generate fresh identity and persist it.
        let identity = Self::generate();
        let stored = StoredIdentity {
            secret_bytes: identity.secret.to_bytes().to_vec(),
        };
        let content = serde_json::to_string_pretty(&stored)
            .map_err(|e| format!("Failed to serialize identity: {e}"))?;

        if let Some(parent) = identity_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create identity directory: {e}"))?;
        }

        fs::write(&identity_path, content)
            .map_err(|e| format!("Failed to write identity file: {e}"))?;

        Ok(identity)
    }

    /// Compute a short device ID from the public key (first 16 hex chars of SHA-256).
    fn compute_device_id(public_key: &X25519PublicKey) -> String {
        use sha2::Digest;
        let hash = sha2::Sha256::digest(public_key.as_bytes());
        hex::encode(&hash[..8])
    }

    /// Get the public key bytes for sharing with a peer.
    pub fn public_key_bytes(&self) -> [u8; 32] {
        *self.public_key.as_bytes()
    }
}

// ─── Ephemeral Key Exchange (for pairing) ───

/// Generate an ephemeral X25519 keypair for the pairing handshake.
/// The secret is consumed after the ECDH exchange.
pub fn generate_ephemeral_keypair() -> (EphemeralSecret, X25519PublicKey) {
    let secret = EphemeralSecret::random_from_rng(OsRng);
    let public = X25519PublicKey::from(&secret);
    (secret, public)
}

// ─── Timestamp Utility ───

/// Get current time as ISO 8601 string without pulling in the chrono crate.
pub fn now_iso8601() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    let mut year = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days: [i64; 12] = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u32;
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// Derive a 32-byte symmetric key from a shared secret using HKDF-SHA256.
///
/// # Arguments
/// * `shared_secret` — Raw shared secret from ECDH
/// * `salt` — Unique salt (e.g., the pairing nonce)
/// * `info` — Context string (e.g., "theorem-sync-v1")
pub fn derive_symmetric_key(
    shared_secret: &[u8; 32],
    salt: &[u8],
    info: &[u8],
) -> Result<[u8; 32], String> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), shared_secret);
    let mut key = [0u8; 32];
    hkdf.expand(info, &mut key)
        .map_err(|e| format!("HKDF expansion failed: {e}"))?;
    Ok(key)
}

// ─── Authenticated Encryption ───

/// Encrypt a plaintext payload using ChaCha20-Poly1305 AEAD with a random nonce.
///
/// Note: AEAD already provides authentication, so no separate HMAC is computed.
/// The `hmac_tag` field is set to an empty string for wire-format compatibility.
///
/// # Arguments
/// * `key` — 32-byte symmetric key
/// * `plaintext` — The data to encrypt
pub fn encrypt_payload(key: &[u8; 32], plaintext: &[u8]) -> Result<EncryptedPayload, String> {
    // Generate a random 12-byte nonce for each encryption.
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(EncryptedPayload {
        nonce_b64: BASE64.encode(nonce_bytes),
        timestamp_ms,
        ciphertext: BASE64.encode(&ciphertext),
        hmac_tag: String::new(),
    })
}

/// Decrypt a ChaCha20-Poly1305 payload.
///
/// AEAD decryption already verifies authenticity and integrity, so no separate
/// HMAC check is performed. The `hmac_tag` field is accepted but ignored.
///
/// # Arguments
/// * `key` — 32-byte symmetric key (same as used for encryption)
/// * `payload` — The encrypted payload to decrypt
///
/// # Returns
/// The original plaintext bytes, or an error if decryption fails.
pub fn decrypt_payload(key: &[u8; 32], payload: &EncryptedPayload) -> Result<Vec<u8>, String> {
    // Reject messages with unreasonable timestamps (±5 minutes).
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let drift = now_ms.abs_diff(payload.timestamp_ms);
    if drift > 5 * 60 * 1000 {
        return Err("Message timestamp is too far from current time".into());
    }

    // Decode the nonce from nonce_b64.
    let nonce_bytes: [u8; 12] = {
        let decoded = BASE64
            .decode(&payload.nonce_b64)
            .map_err(|e| format!("Failed to decode nonce: {e}"))?;
        decoded
            .try_into()
            .map_err(|_| "Nonce must be exactly 12 bytes".to_string())?
    };
    let nonce = Nonce::from(nonce_bytes);

    let ciphertext = BASE64
        .decode(&payload.ciphertext)
        .map_err(|e| format!("Failed to decode ciphertext: {e}"))?;

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;

    let plaintext = cipher
        .decrypt(&nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed: invalid key or tampered ciphertext".to_string())?;

    // Note: HMAC verification removed — AEAD already provides authentication.
    // The hmac_tag field is accepted but ignored for backward compatibility.

    Ok(plaintext)
}

// ─── Random Nonce ───

/// Generate a random 32-byte nonce for use as HKDF salt during pairing.
pub fn generate_nonce() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce);
    nonce
}

// ─── Chunked Encryption for File Transfer ───

/// The chunk size for file transfers: 4 MiB.
/// Larger chunks reduce the number of encrypt/decrypt round-trips and
/// base64-encoding overhead per file (a 20 MB EPUB → 5 chunks instead of 20).
pub const FILE_CHUNK_SIZE: usize = 4 * 1024 * 1024;

/// Encrypts a single chunk of data. Used to avoid building massive Vecs in memory.
pub fn encrypt_single_file_chunk(key: &[u8; 32], chunk_data: &[u8]) -> Result<String, String> {
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);

    let ciphertext = cipher
        .encrypt(&nonce, chunk_data)
        .map_err(|e| format!("Chunk encryption failed: {e}"))?;

    let mut wire = Vec::with_capacity(12 + ciphertext.len());
    wire.extend_from_slice(&nonce_bytes);
    wire.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&wire))
}

/// Decrypt a single encrypted chunk (produced by encrypt_file_chunks).
/// Input: base64-encoded wire format (12-byte nonce || ciphertext+tag).
/// Returns the decrypted plaintext bytes.
pub fn decrypt_file_chunk(key: &[u8; 32], chunk_b64: &str) -> Result<Vec<u8>, String> {
    let wire = BASE64
        .decode(chunk_b64)
        .map_err(|e| format!("Failed to decode chunk: {e}"))?;

    if wire.len() < 12 {
        return Err("Chunk too small to contain nonce".into());
    }

    let nonce_bytes: [u8; 12] = wire[..12]
        .try_into()
        .map_err(|_| "Failed to extract nonce".to_string())?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = &wire[12..];

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;

    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| "Chunk decryption failed: invalid key or tampered data".to_string())
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
    fn test_device_identity_generation() {
        let identity = DeviceIdentity::generate();
        assert_eq!(identity.device_id.len(), 16);
        assert_eq!(identity.public_key_bytes().len(), 32);
    }

    #[test]
    fn test_device_id_deterministic() {
        let identity = DeviceIdentity::generate();
        let id1 = DeviceIdentity::compute_device_id(&identity.public_key);
        let id2 = DeviceIdentity::compute_device_id(&identity.public_key);
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_nonce(); // 32 bytes
        let plaintext = b"Hello, Theorem sync!";

        let encrypted = encrypt_payload(&key, plaintext).expect("Encryption should succeed");

        assert_ne!(encrypted.ciphertext, BASE64.encode(plaintext));
        assert!(encrypted.timestamp_ms > 0);
        assert!(!encrypted.nonce_b64.is_empty());

        let decrypted = decrypt_payload(&key, &encrypted).expect("Decryption should succeed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_unique_nonces_per_encryption() {
        let key = generate_nonce();
        let plaintext = b"Same plaintext";

        let enc1 = encrypt_payload(&key, plaintext).unwrap();
        let enc2 = encrypt_payload(&key, plaintext).unwrap();

        // Each encryption should produce a different nonce
        assert_ne!(enc1.nonce_b64, enc2.nonce_b64);
        // And therefore different ciphertexts
        assert_ne!(enc1.ciphertext, enc2.ciphertext);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = generate_nonce();
        let plaintext = b"Sensitive data";

        let mut encrypted = encrypt_payload(&key, plaintext).expect("Encryption should succeed");

        // Tamper with the ciphertext.
        let mut ct_bytes = BASE64.decode(&encrypted.ciphertext).unwrap();
        if !ct_bytes.is_empty() {
            ct_bytes[0] ^= 0xFF;
        }
        encrypted.ciphertext = BASE64.encode(&ct_bytes);

        assert!(decrypt_payload(&key, &encrypted).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = generate_nonce();
        let key2 = generate_nonce();
        let plaintext = b"Secret message";

        let encrypted = encrypt_payload(&key1, plaintext).expect("Encryption should succeed");

        assert!(decrypt_payload(&key2, &encrypted).is_err());
    }

    #[test]
    fn test_key_derivation() {
        let shared_secret = generate_nonce();
        let salt = b"unique-pairing-salt";
        let info = b"theorem-sync-v1";

        let key1 =
            derive_symmetric_key(&shared_secret, salt, info).expect("Key derivation should work");
        let key2 =
            derive_symmetric_key(&shared_secret, salt, info).expect("Key derivation should work");

        assert_eq!(key1, key2, "Same inputs should produce same key");
        assert_ne!(key1, [0u8; 32], "Derived key should not be all zeros");
    }

    #[test]
    fn test_different_salts_produce_different_keys() {
        let shared_secret = generate_nonce();

        let key1 = derive_symmetric_key(&shared_secret, b"salt-a", b"info").unwrap();
        let key2 = derive_symmetric_key(&shared_secret, b"salt-b", b"info").unwrap();

        assert_ne!(key1, key2);
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
