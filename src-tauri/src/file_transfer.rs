//! Fast file transfer over QUIC streams.
//!
//! Replaces iroh-blobs download path for book files. Uses a custom ALPN
//! (`theorem-file/v1`) with raw QUIC bidirectional streams — no BAO tree
//! verification, no per-file QUIC handshake, no 30s timeouts.
//!
//! Protocol:
//!   1. Client opens bi stream, sends `<book_id>\n` or `cover:<book_id>\n`
//!   2. Server reads book file from `book-cache/<id>.book`
//!      or cover from SQLite database
//!   3. Server sends: `OK <size>\n<bytes>` or `ERR <msg>\n`
//!   4. Stream closes
//!
//! Security: TLS 1.3 via iroh's ed25519 key exchange (same as CRDT/docs sync).

use std::path::{Path, PathBuf};

use iroh::endpoint;
use iroh::protocol::ProtocolHandler;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

const FILE_TRANSFER_ALPN: &[u8] = b"theorem-file/v1";

pub const ALPN_BYTES: &[u8] = FILE_TRANSFER_ALPN;

// ─── ProtocolHandler ───

#[derive(Clone)]
pub struct FileTransferHandler {
    pub data_dir: PathBuf,
}

impl std::fmt::Debug for FileTransferHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileTransferHandler").finish()
    }
}

impl FileTransferHandler {
    /// Read a cover image from the SQLite database by book ID.
    async fn read_cover(data_dir: &Path, book_id: &str) -> Result<Vec<u8>, String> {
        // Open theorem.db and query the covers table
        let db_path = data_dir.join("theorem.db");
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("open db: {e}"))?;
        // Covers are stored in the blob_store table with key prefix "cover:"
        let cover_key = format!("cover:{}", book_id);
        let mut stmt = conn
            .prepare("SELECT value FROM blob_store WHERE key = ?1")
            .map_err(|e| format!("prepare: {e}"))?;
        let cover_blob: Vec<u8> = stmt
            .query_row(rusqlite::params![cover_key], |row| row.get(0))
            .map_err(|_| format!("cover not found: {book_id}"))?;
        Ok(cover_blob)
    }
}

impl ProtocolHandler for FileTransferHandler {
    async fn accept(&self, conn: endpoint::Connection) -> Result<(), iroh::protocol::AcceptError> {
        loop {
            let (mut send, mut recv) = match conn.accept_bi().await {
                Ok(s) => s,
                Err(_) => break,
            };

            let mut reader = BufReader::new(&mut recv);
            let mut line = String::new();
            let request = match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => line.trim().to_string(),
            };

            let result = if let Some(stripped) = request.strip_prefix("cover:") {
                Self::read_cover(&self.data_dir, stripped).await
            } else {
                let path = self
                    .data_dir
                    .join("book-cache")
                    .join(format!("{}.book", request));
                tokio::fs::read(&path).await.map_err(|e| e.to_string())
            };

            match result {
                Ok(data) => {
                    let header = format!("OK {}\n", data.len());
                    let _ = send.write_all(header.as_bytes()).await;
                    let _ = send.write_all(&data).await;
                    let _ = send.finish();
                }
                Err(e) => {
                    let msg = format!("ERR {}\n", e);
                    let _ = send.write_all(msg.as_bytes()).await;
                    let _ = send.finish();
                }
            }
        }
        Ok(())
    }
}

/// Tauri command: request a book file or cover image from a paired peer.
/// Prefix `book_id` with `cover:` to request a cover image.
/// The peer must be online and reachable via iroh (mDNS or relay).
#[tauri::command]
pub async fn request_book_file(
    app: tauri::AppHandle,
    peer_device_id: String,
    book_id: String,
) -> Result<Vec<u8>, String> {
    use crate::sync_commands::{get_or_init_iroh, get_sync_state};

    let ep = get_or_init_iroh(&app).await?;
    let sync_state = get_sync_state(&app)?;

    let (peer_pk, relay_url) = {
        let devices = sync_state.transport_state.paired_devices.lock().await;
        let peer = devices
            .get(&peer_device_id)
            .ok_or("peer not found".to_string())?;
        let pk: iroh::PublicKey = peer
            .iroh_node_id
            .parse()
            .map_err(|e| format!("parse peer key: {e}"))?;
        (pk, peer.peer_relay_url.clone())
    };

    let peer_addr = iroh::EndpointAddr::new(peer_pk);
    // mDNS address lookup on the endpoint discovers LAN addresses automatically.
    // The relay URL from pairing is available as fallback if mDNS fails.
    let peer_addr = if !relay_url.is_empty() {
        if let Ok(url) = relay_url.parse::<iroh::RelayUrl>() {
            peer_addr.with_relay_url(url)
        } else {
            peer_addr
        }
    } else {
        peer_addr
    };

    let conn = ep
        .endpoint
        .connect(peer_addr, FILE_TRANSFER_ALPN)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| format!("open bi: {e}"))?;

    let request = format!("{}\n", book_id);
    send.write_all(request.as_bytes())
        .await
        .map_err(|e| format!("send: {e}"))?;
    send.finish().map_err(|e| format!("finish: {e}"))?;
    drop(send);

    let mut reader = BufReader::new(&mut recv);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .await
        .map_err(|e| format!("read status: {e}"))?;
    let status_line = status_line.trim();

    if let Some(size_str) = status_line.strip_prefix("OK ") {
        let size: usize = size_str
            .parse()
            .map_err(|_| format!("invalid size: {size_str}"))?;
        let mut buf = vec![0u8; size];
        reader
            .read_exact(&mut buf)
            .await
            .map_err(|e| format!("read data: {e}"))?;
        Ok(buf)
    } else if let Some(err_msg) = status_line.strip_prefix("ERR ") {
        Err(format!("peer error: {err_msg}"))
    } else {
        Err(format!("unexpected response: {status_line}"))
    }
}
