/// Theorem LAN Sync — Cryptographic Primitives
///
/// Provides device identity management, key exchange, authenticated encryption,
/// and QR code generation for the peer-to-peer sync feature.
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey as X25519PublicKey, StaticSecret};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

type HmacSha256 = Hmac<Sha256>;

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

/// An ephemeral keypair used during QR-based pairing.
pub struct EphemeralKeypair {
    pub secret: EphemeralSecret,
    pub public_key: X25519PublicKey,
}

/// Result of encrypting a payload with ChaCha20-Poly1305.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EncryptedPayload {
    /// Nonce counter used for this message.
    pub nonce_counter: u64,
    /// Unix timestamp in milliseconds when the message was created.
    pub timestamp_ms: u64,
    /// Base64-encoded ciphertext (includes AEAD authentication tag).
    pub ciphertext: String,
    /// Base64-encoded HMAC-SHA256 of the plaintext (computed before encryption).
    pub hmac_tag: String,
}

// ─── Device Identity ───

impl DeviceIdentity {
    /// Create a brand new device identity with a random keypair.
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public_key = X25519PublicKey::from(&secret);
        let device_id = Self::compute_device_id(&public_key);
        Self {
            secret,
            public_key,
            device_id,
        }
    }

    /// Load an existing identity from the app data directory, or create one if absent.
    pub fn load_or_create(app_data_dir: &Path) -> Result<Self, String> {
        let identity_path = app_data_dir.join("sync-identity.json");

        if identity_path.exists() {
            let content = fs::read_to_string(&identity_path)
                .map_err(|e| format!("Failed to read identity file: {e}"))?;
            let stored: StoredIdentity = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse identity file: {e}"))?;

            if stored.secret_bytes.len() != 32 {
                return Err("Invalid identity: secret key must be 32 bytes".into());
            }

            let mut key_bytes = [0u8; 32];
            key_bytes.copy_from_slice(&stored.secret_bytes);
            let secret = StaticSecret::from(key_bytes);
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

    /// Perform a Diffie-Hellman key exchange with a peer's public key.
    /// Returns the raw shared secret (must be passed through HKDF before use).
    pub fn diffie_hellman(&self, peer_public: &[u8; 32]) -> [u8; 32] {
        let peer_key = X25519PublicKey::from(*peer_public);
        let shared = self.secret.diffie_hellman(&peer_key);
        *shared.as_bytes()
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

/// Encrypt a plaintext payload using ChaCha20-Poly1305 AEAD.
///
/// Also computes an HMAC-SHA256 of the plaintext for post-decryption integrity verification.
///
/// # Arguments
/// * `key` — 32-byte symmetric key
/// * `nonce_counter` — Monotonic counter (unique per message)
/// * `plaintext` — The data to encrypt
pub fn encrypt_payload(
    key: &[u8; 32],
    nonce_counter: u64,
    plaintext: &[u8],
) -> Result<EncryptedPayload, String> {
    // Compute HMAC on plaintext before encryption.
    let hmac_tag = compute_hmac(key, plaintext)?;

    // Build 12-byte nonce from the counter (padded with zeros).
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[4..12].copy_from_slice(&nonce_counter.to_le_bytes());
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
        nonce_counter,
        timestamp_ms,
        ciphertext: BASE64.encode(&ciphertext),
        hmac_tag: BASE64.encode(&hmac_tag),
    })
}

/// Decrypt a ChaCha20-Poly1305 payload and verify the HMAC-SHA256 integrity tag.
///
/// # Arguments
/// * `key` — 32-byte symmetric key (same as used for encryption)
/// * `payload` — The encrypted payload to decrypt
///
/// # Returns
/// The original plaintext bytes, or an error if decryption or HMAC verification fails.
pub fn decrypt_payload(key: &[u8; 32], payload: &EncryptedPayload) -> Result<Vec<u8>, String> {
    // Reject messages with unreasonable timestamps (±5 minutes).
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let drift = if now_ms > payload.timestamp_ms {
        now_ms - payload.timestamp_ms
    } else {
        payload.timestamp_ms - now_ms
    };
    if drift > 5 * 60 * 1000 {
        return Err("Message timestamp is too far from current time".into());
    }

    // Reconstruct nonce.
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[4..12].copy_from_slice(&payload.nonce_counter.to_le_bytes());
    let nonce = Nonce::from(nonce_bytes);

    let ciphertext = BASE64
        .decode(&payload.ciphertext)
        .map_err(|e| format!("Failed to decode ciphertext: {e}"))?;

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;

    let plaintext = cipher
        .decrypt(&nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed: invalid key or tampered ciphertext".to_string())?;

    // Verify HMAC.
    let expected_hmac = BASE64
        .decode(&payload.hmac_tag)
        .map_err(|e| format!("Failed to decode HMAC tag: {e}"))?;
    verify_hmac(key, &plaintext, &expected_hmac)?;

    Ok(plaintext)
}

// ─── HMAC-SHA256 ───

/// Compute HMAC-SHA256 over the given data using the provided key.
pub fn compute_hmac(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
        .map_err(|e| format!("Failed to create HMAC: {e}"))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

/// Verify an HMAC-SHA256 tag against the given data and key.
pub fn verify_hmac(key: &[u8], data: &[u8], expected_tag: &[u8]) -> Result<(), String> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
        .map_err(|e| format!("Failed to create HMAC: {e}"))?;
    mac.update(data);
    mac.verify_slice(expected_tag)
        .map_err(|_| "HMAC verification failed: data integrity compromised".to_string())
}

// ─── Random Nonce ───

/// Generate a random 32-byte nonce for use as HKDF salt during pairing.
pub fn generate_nonce() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce);
    nonce
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
        let nonce_counter = 42u64;

        let encrypted =
            encrypt_payload(&key, nonce_counter, plaintext).expect("Encryption should succeed");

        assert_ne!(encrypted.ciphertext, BASE64.encode(plaintext));
        assert!(encrypted.timestamp_ms > 0);

        let decrypted = decrypt_payload(&key, &encrypted).expect("Decryption should succeed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = generate_nonce();
        let plaintext = b"Sensitive data";

        let mut encrypted = encrypt_payload(&key, 1, plaintext).expect("Encryption should succeed");

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

        let encrypted = encrypt_payload(&key1, 1, plaintext).expect("Encryption should succeed");

        assert!(decrypt_payload(&key2, &encrypted).is_err());
    }

    #[test]
    fn test_hmac_roundtrip() {
        let key = b"test-key-for-hmac";
        let data = b"some important data";

        let tag = compute_hmac(key, data).expect("HMAC should succeed");
        verify_hmac(key, data, &tag).expect("HMAC verification should succeed");
    }

    #[test]
    fn test_hmac_tampered_data_fails() {
        let key = b"test-key-for-hmac";
        let data = b"some important data";

        let tag = compute_hmac(key, data).expect("HMAC should succeed");
        let result = verify_hmac(key, b"tampered data", &tag);
        assert!(result.is_err());
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
