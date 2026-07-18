use std::path::{Path, PathBuf};

use iroh::endpoint;
use iroh::protocol::ProtocolHandler;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

const FILE_TRANSFER_ALPN: &[u8] = b"theorem-file/v1";

pub const ALPN_BYTES: &[u8] = FILE_TRANSFER_ALPN;

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
    fn open_read_db(data_dir: &Path) -> Result<rusqlite::Connection, String> {
        let db_path = data_dir.join("theorem.db");
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("open db: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| format!("pragma: {e}"))?;
        Ok(conn)
    }

    async fn read_cover(data_dir: &Path, book_id: &str) -> Result<Vec<u8>, String> {
        let conn = Self::open_read_db(data_dir)?;
        let cover_key = format!("cover:{}", book_id);
        let mut stmt = conn
            .prepare("SELECT value FROM blob_store WHERE key = ?1")
            .map_err(|e| format!("prepare: {e}"))?;
        let cover_blob: Vec<u8> = stmt
            .query_row(rusqlite::params![cover_key], |row| row.get(0))
            .map_err(|_| format!("cover not found: {book_id}"))?;
        Ok(cover_blob)
    }

    async fn read_book_data(data_dir: &Path, book_id: &str) -> Result<Vec<u8>, String> {
        let conn = Self::open_read_db(data_dir)?;
        let mut stmt = conn
            .prepare("SELECT data FROM books WHERE id = ?1 AND data IS NOT NULL")
            .map_err(|e| format!("prepare: {e}"))?;
        let book_data: Vec<u8> = stmt
            .query_row(rusqlite::params![book_id], |row| row.get(0))
            .map_err(|_| format!("book data not found in sqlite: {book_id}"))?;
        Ok(book_data)
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
                match tokio::fs::read(&path).await {
                    Ok(data) => Ok(data),
                    Err(fs_err) => Self::read_book_data(&self.data_dir, &request)
                        .await
                        .map_err(|_| format!("book not found in book-cache or sqlite: {fs_err}")),
                }
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
