/// Theorem — iroh P2P Sync Transport
use std::path::PathBuf;

use iroh::endpoint::{self, presets::Minimal, RelayMode};
use iroh::{EndpointAddr, PublicKey, SecretKey};
use tokio::sync::Mutex;

const ALPN: &[u8] = b"theorem-sync/v1";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IrohPeerInfo {
    pub public_key: PublicKey,
    pub device_id: String,
    pub device_name: String,
    pub fingerprint: String,
}

pub struct IrohSyncEndpoint {
    pub endpoint: iroh::endpoint::Endpoint,
    pub public_key: PublicKey,
    pub peer_info: IrohPeerInfo,
    peers: Mutex<std::collections::HashMap<String, IrohPeerInfo>>,
}

impl IrohSyncEndpoint {
    pub async fn new(
        key_path: &PathBuf,
        device_id: String,
        device_name: String,
        fingerprint: String,
    ) -> Result<Self, String> {
        let secret_key = load_or_create_key(key_path)?;
        let public_key = secret_key.public();
        let endpoint = iroh::endpoint::Endpoint::builder(Minimal)
            .secret_key(secret_key)
            .alpns(vec![ALPN.to_vec()])
            .relay_mode(RelayMode::Default)
            .bind()
            .await
            .map_err(|e| format!("iroh bind: {e}"))?;
        Ok(Self {
            endpoint,
            public_key,
            peer_info: IrohPeerInfo {
                public_key,
                device_id,
                device_name,
                fingerprint,
            },
            peers: Mutex::new(std::collections::HashMap::new()),
        })
    }

    pub fn public_key_string(&self) -> String {
        self.public_key.to_string()
    }

    pub async fn add_peer(&self, peer: IrohPeerInfo) {
        self.peers.lock().await.insert(peer.device_id.clone(), peer);
    }

    pub async fn connect(&self, device_id: &str) -> Result<endpoint::Connection, String> {
        let peer = self
            .peers
            .lock()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(|| format!("peer {device_id} not found"))?;
        self.endpoint
            .connect(EndpointAddr::new(peer.public_key), ALPN)
            .await
            .map_err(|e| format!("connect: {e}"))
    }

    pub async fn accept(&self) -> Result<endpoint::Connection, String> {
        let Some(c) = self.endpoint.accept().await else {
            return Err("closed".into());
        };
        c.await.map_err(|e| format!("accept: {e}"))
    }

    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

fn load_or_create_key(path: &PathBuf) -> Result<SecretKey, String> {
    if let Ok(bytes) = std::fs::read(path) {
        if let Ok(arr) = <[u8; 32]>::try_from(bytes) {
            return Ok(SecretKey::from_bytes(&arr));
        }
    }
    let key = SecretKey::generate();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).ok();
    }
    std::fs::write(path, key.to_bytes()).map_err(|e| e.to_string())?;
    Ok(key)
}

pub async fn send_json(
    conn: &endpoint::Connection,
    data: &impl serde::Serialize,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let json = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let len = (json.len() as u32).to_be_bytes();
    let (mut s, _) = conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;
    s.write_all(&len).await.map_err(|e| format!("write: {e}"))?;
    s.write_all(&json)
        .await
        .map_err(|e| format!("write: {e}"))?;
    s.finish().map_err(|e| format!("finish: {e}"))
}

pub async fn recv_json<T: serde::de::DeserializeOwned>(
    conn: &endpoint::Connection,
) -> Result<T, String> {
    use tokio::io::AsyncReadExt;
    let (mut s, mut r) = conn
        .accept_bi()
        .await
        .map_err(|e| format!("accept_bi: {e}"))?;
    let mut lb = [0u8; 4];
    r.read_exact(&mut lb)
        .await
        .map_err(|e| format!("read: {e}"))?;
    let len = u32::from_be_bytes(lb) as usize;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)
        .await
        .map_err(|e| format!("read: {e}"))?;
    s.finish().map_err(|e| format!("finish: {e}"))?;
    serde_json::from_slice(&buf).map_err(|e| format!("parse: {e}"))
}

pub async fn pairing_handshake(
    conn: &endpoint::Connection,
    info: &IrohPeerInfo,
) -> Result<IrohPeerInfo, String> {
    send_json(conn, info).await?;
    recv_json(conn).await
}
