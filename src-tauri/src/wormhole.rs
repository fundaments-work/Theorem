/// Theorem — magic-wormhole Pairing Integration
///
/// Uses magic-wormhole 0.7.7 library API to replace the custom
/// X25519 + HKDF pairing handshake (~300 lines across sync_crypto.rs,
/// sync_server.rs, sync_commands.rs).
///
/// magic-wormhole provides SPAKE2 PAKE, relay-negotiated NAT traversal,
/// and the "speak a code / scan QR" pairing UX out of the box.
///
/// File transfer via wormhole's transit module is deferred to a future
/// release — the existing HTTP chunked transfer remains in place.
use magic_wormhole::{AppConfig, AppID, Code, MailboxConnection, Wormhole};

const APP_ID: &str = "work.fundamentals.theorem";

fn app_config() -> AppConfig<()> {
    AppConfig {
        id: AppID::new(APP_ID),
        rendezvous_url: "ws://relay.magic-wormhole.io:4000".into(),
        app_version: (),
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct WormholeDeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub public_key_hex: String,
    pub fingerprint: String,
}

/// Sender: create a pairing code. Returns the code (show as QR) and
/// a pair that will be joined when the receiver connects.
pub async fn pair_create(
    my_info: WormholeDeviceInfo,
) -> Result<(String, WormholeDeviceInfo), String> {
    let mailbox = MailboxConnection::create(app_config(), 2)
        .await
        .map_err(|e| e.to_string())?;
    let code = mailbox.code().clone();
    let mut wormhole = Wormhole::connect(mailbox)
        .await
        .map_err(|e| e.to_string())?;

    let my_json = serde_json::to_vec(&my_info).map_err(|e| e.to_string())?;
    wormhole.send(my_json).await.map_err(|e| e.to_string())?;

    let peer_json = wormhole.receive().await.map_err(|e| e.to_string())?;
    let peer_info: WormholeDeviceInfo =
        serde_json::from_slice(&peer_json).map_err(|e| e.to_string())?;

    Ok((code.to_string(), peer_info))
}

/// Receiver: join a pairing session with the code the sender displays.
pub async fn pair_join(
    code_str: &str,
    my_info: WormholeDeviceInfo,
) -> Result<WormholeDeviceInfo, String> {
    let code: Code = code_str.parse().map_err(|e| format!("invalid code: {e}"))?;
    let mailbox = MailboxConnection::connect(app_config(), code, true)
        .await
        .map_err(|e| e.to_string())?;
    let mut wormhole = Wormhole::connect(mailbox)
        .await
        .map_err(|e| e.to_string())?;

    let peer_json = wormhole.receive().await.map_err(|e| e.to_string())?;
    let peer_info: WormholeDeviceInfo =
        serde_json::from_slice(&peer_json).map_err(|e| e.to_string())?;

    let my_json = serde_json::to_vec(&my_info).map_err(|e| e.to_string())?;
    wormhole.send(my_json).await.map_err(|e| e.to_string())?;

    Ok(peer_info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_wormhole_pairing_roundtrip() {
        let sender_info = WormholeDeviceInfo {
            device_id: "sender-1".into(),
            device_name: "Test Sender".into(),
            public_key_hex: "ab".repeat(32),
            fingerprint: "fp-sender".into(),
        };
        let receiver_info = WormholeDeviceInfo {
            device_id: "receiver-1".into(),
            device_name: "Test Receiver".into(),
            public_key_hex: "cd".repeat(32),
            fingerprint: "fp-receiver".into(),
        };

        let (code, peer) = pair_create(sender_info.clone()).await.unwrap();
        let peer_from_receiver = pair_join(&code, receiver_info.clone()).await.unwrap();

        assert_eq!(peer.device_id, receiver_info.device_id);
        assert_eq!(peer_from_receiver.device_id, sender_info.device_id);
    }
}
