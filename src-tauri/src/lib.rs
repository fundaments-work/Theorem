mod database;
mod epub_parser;
mod iroh_sync;
mod sync_commands;
#[cfg(target_os = "linux")]
mod tts_linux;

use reqwest::blocking::Client;
use serde::Serialize;
use std::env;
/**
 * Tauri Library Module
 */
use std::fs;
#[cfg(not(target_os = "android"))]
use std::io::{Cursor, Write};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Response;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

fn shared_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
            .build()
            .expect("Failed to create shared HTTP client — install OpenSSL (libssl-dev)")
    })
}

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;

#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

fn decode_percent_escapes(value: &str) -> String {
    fn from_hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (from_hex(bytes[index + 1]), from_hex(bytes[index + 2]))
            {
                output.push(high << 4 | low);
                index += 3;
                continue;
            }
        }

        output.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&output).to_string()
}

fn file_uri_to_path(candidate: &str) -> Option<String> {
    if !candidate.starts_with("file://") {
        return None;
    }

    let mut rest = candidate.trim_start_matches("file://");
    if let Some(after_localhost) = rest.strip_prefix("localhost") {
        rest = after_localhost;
    }

    let decoded = decode_percent_escapes(rest);

    // Windows file URL shape: file:///C:/Users/...
    if decoded.starts_with('/') {
        let bytes = decoded.as_bytes();
        if bytes.len() > 3 && bytes[2] == b':' {
            return Some(decoded.trim_start_matches('/').to_string());
        }
    }

    Some(decoded)
}

fn is_supported_open_path(candidate: &str) -> bool {
    let lower = candidate.to_ascii_lowercase();
    lower.ends_with(".epub")
        || lower.ends_with(".mobi")
        || lower.ends_with(".azw")
        || lower.ends_with(".azw3")
        || lower.ends_with(".fb2")
        || lower.ends_with(".fbz")
        || lower.ends_with(".fb2.zip")
        || lower.ends_with(".cbz")
        || lower.ends_with(".cbr")
        || lower.ends_with(".pdf")
}

fn normalize_open_path(candidate: &str, cwd: Option<&str>) -> Option<String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    // Ignore non-file scheme arguments.
    if trimmed.contains("://") && !trimmed.starts_with("file://") {
        return None;
    }

    let candidate_path = file_uri_to_path(trimmed).unwrap_or_else(|| trimmed.to_string());
    let mut path = PathBuf::from(&candidate_path);
    if !path.is_absolute() {
        if let Some(cwd) = cwd {
            path = Path::new(cwd).join(path);
        }
    }

    let as_string = path.to_string_lossy().to_string();
    if !is_supported_open_path(&as_string) {
        return None;
    }

    if path.exists() {
        Some(as_string)
    } else {
        None
    }
}

fn collect_open_paths(args: Vec<String>, cwd: Option<&str>) -> Vec<String> {
    args.into_iter()
        .filter_map(|arg| normalize_open_path(&arg, cwd))
        .collect()
}

fn enqueue_open_paths(app: &tauri::AppHandle, paths: Vec<String>, emit_event: bool) {
    if paths.is_empty() {
        return;
    }

    {
        let state = app.state::<PendingOpenFiles>();
        let mut guard = state.0.lock().unwrap_or_else(|poison| poison.into_inner());
        guard.extend(paths.clone());
    }

    if emit_event {
        let _ = app.emit("theorem://open-files", paths);
    }

    // Window management is handled by the frontend
    // The window should already be visible when the app starts
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<PendingOpenFiles>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap_or_else(|poison| poison.into_inner());
    guard.drain(..).collect()
}

/**
 * Metadata structure for PDF documents.
 */
#[derive(Serialize)]
struct PdfMetadata {
    title: Option<String>,
    author: Option<String>,
    pages: Option<u32>,
    creator: Option<String>,
    producer: Option<String>,
    creation_date: Option<String>,
    modification_date: Option<String>,
}

/**
 * Reads a file from the given path and returns its contents as bytes.
 * Used for loading PDF and other document files.
 *
 * # Arguments
 * * `path` - The absolute path to the file to read
 *
 * # Returns
 * * `Ok(Vec<u8>)` - The file contents as bytes
 * * `Err(String)` - Error message if reading fails
 */
#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// Reads a CBR (RAR comic archive) file and converts it to CBZ (ZIP) format
/// in memory. The resulting ZIP bytes can be passed to the existing CBZ
/// reading pipeline unchanged.
///
/// CBR conversion requires the unrar-ng crate which bundles native C++
/// unrar code — this does not cross-compile for the Android NDK, so the
/// command is a no-op on Android (CBR must be pre-converted before transfer).
#[tauri::command]
#[allow(unused_variables)]
fn read_cbr_as_cbz(path: String) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "android")]
    return Err("CBR conversion is not supported on Android".into());
    #[cfg(not(target_os = "android"))]
    {
        let archive = unrar_ng::Archive::new(&path)
            .open_for_processing()
            .map_err(|e| format!("Failed to open CBR archive '{}': {}", path, e))?;
        let mut zip_buffer = Cursor::new(Vec::new());
        {
            let mut zip_writer = zip::ZipWriter::new(&mut zip_buffer);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            let mut archive = archive;
            loop {
                let entry = archive
                    .read_header()
                    .map_err(|e| format!("Failed to read CBR header: {}", e))?;
                let Some(entry) = entry else { break };
                let filename = entry.entry().filename.to_string_lossy().to_string();
                if entry.entry().is_file() {
                    let (data, next_archive) = entry
                        .read()
                        .map_err(|e| format!("Failed to extract '{}': {}", filename, e))?;
                    zip_writer
                        .start_file(filename.clone(), options)
                        .map_err(|e| format!("Failed to write ZIP entry '{}': {}", filename, e))?;
                    zip_writer.write_all(&data).map_err(|e| {
                        format!("Failed to write ZIP data for '{}': {}", filename, e)
                    })?;
                    archive = next_archive;
                } else {
                    archive = entry
                        .skip()
                        .map_err(|e| format!("Failed to skip entry '{}': {}", filename, e))?;
                }
            }
            zip_writer
                .finish()
                .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
        }
        Ok(zip_buffer.into_inner())
    }
}

/**
 * Reads a PDF file from the given path and returns its contents as bytes.
 * Supports both absolute paths and app storage paths.
 *
 * The storage path in the frontend is constructed as:
 * `${appDataDir}/books/${id}.book`
 *
 * Since the Tauri FS plugin on the frontend side handles scoped permissions,
 * this command just needs to use standard fs::read for the resolved paths.
 *
 * # Arguments
 * * `path` - The file path (can be absolute or from app storage)
 *
 * # Returns
 * * `Ok(Vec<u8>)` - The PDF file contents as bytes
 * * `Err(String)` - Error message if reading fails
 */
#[tauri::command]
fn read_pdf_file(path: String) -> Result<Response, String> {
    // Try to read the file directly using standard fs
    // The Tauri FS plugin's scope permissions are checked on the frontend side
    // when reading from app storage, so by the time we get here, the path
    // should be accessible.
    let data = fs::read(&path).map_err(|e| format!("Failed to read PDF file '{}': {}", path, e))?;
    Ok(Response::new(data))
}

#[tauri::command]
fn read_pdf_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|metadata| metadata.len())
        .map_err(|e| format!("Failed to read PDF file metadata '{}': {}", path, e))
}

#[tauri::command]
fn read_pdf_range(path: String, offset: u64, length: u64) -> Result<Response, String> {
    if length == 0 {
        return Ok(Response::new(Vec::new()));
    }

    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to read PDF file metadata '{}': {}", path, e))?;
    let file_size = metadata.len();
    if offset >= file_size {
        return Ok(Response::new(Vec::new()));
    }

    let clamped_len = length.min(file_size.saturating_sub(offset));
    let read_len = usize::try_from(clamped_len).map_err(|_| {
        format!(
            "Requested PDF range is too large for this platform: {}",
            clamped_len
        )
    })?;

    let mut file =
        fs::File::open(&path).map_err(|e| format!("Failed to open PDF file '{}': {}", path, e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek PDF file '{}': {}", path, e))?;

    let mut buffer = vec![0_u8; read_len];
    file.read_exact(&mut buffer)
        .map_err(|e| format!("Failed to read PDF range from '{}': {}", path, e))?;

    Ok(Response::new(buffer))
}

/**
 * Extracts metadata from a PDF file.
 *
 * # Arguments
 * * `path` - The absolute path to the PDF file
 *
 * # Returns
 * * `Ok(PdfMetadata)` - The extracted PDF metadata
 * * `Err(String)` - Error message if reading fails
 */
#[tauri::command]
fn get_pdf_metadata(path: String) -> Result<PdfMetadata, String> {
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to read PDF file metadata '{}': {}", path, e))?;
    let file_size = metadata.len();

    const HEAD_SIZE: u64 = 65536; // 64KB for header + Info dict
    let first_chunk_size = HEAD_SIZE.min(file_size);

    let mut file =
        fs::File::open(&path).map_err(|e| format!("Failed to open PDF file '{}': {}", path, e))?;

    let mut first_bytes = vec![0_u8; first_chunk_size as usize];
    file.read_exact(&mut first_bytes)
        .map_err(|e| format!("Failed to read PDF header from '{}': {}", path, e))?;

    let metadata = extract_pdf_metadata(&first_bytes);

    // If no title found in the first 64KB, the Info dict might be near the end.
    // Try the last 64KB as a fallback.
    if metadata.title.is_none() && file_size > HEAD_SIZE {
        let tail_size = HEAD_SIZE.min(file_size);
        let tail_offset = file_size.saturating_sub(tail_size);

        file.seek(SeekFrom::Start(tail_offset))
            .map_err(|e| format!("Failed to seek PDF tail '{}': {}", path, e))?;

        let mut tail_bytes = vec![0_u8; tail_size as usize];
        file.read_exact(&mut tail_bytes)
            .map_err(|e| format!("Failed to read PDF tail from '{}': {}", path, e))?;

        let tail_metadata = extract_pdf_metadata(&tail_bytes);

        let title = metadata.title.or(tail_metadata.title);
        let author = metadata.author.or(tail_metadata.author);
        let creator = metadata.creator.or(tail_metadata.creator);
        let producer = metadata.producer.or(tail_metadata.producer);
        let creation_date = metadata.creation_date.or(tail_metadata.creation_date);
        let modification_date = metadata
            .modification_date
            .or(tail_metadata.modification_date);

        return Ok(PdfMetadata {
            title,
            author,
            pages: metadata.pages,
            creator,
            producer,
            creation_date,
            modification_date,
        });
    }

    Ok(metadata)
}

/**
 * Extracts metadata from PDF bytes by parsing the document structure.
 * This is a basic parser that extracts info from the PDF header and Info dictionary.
 */
fn extract_pdf_metadata(bytes: &[u8]) -> PdfMetadata {
    let content = String::from_utf8_lossy(bytes);

    // Extract page count by counting /Type /Page occurrences (approximation)
    let pages = content
        .matches("/Type /Page")
        .count()
        .try_into()
        .ok()
        .filter(|&n: &u32| n > 0);

    // Try to extract fields from the Info dictionary
    let title = extract_pdf_string(&content, "/Title");
    let author = extract_pdf_string(&content, "/Author");
    let creator = extract_pdf_string(&content, "/Creator");
    let producer = extract_pdf_string(&content, "/Producer");
    let creation_date = extract_pdf_string(&content, "/CreationDate");
    let modification_date = extract_pdf_string(&content, "/ModDate");

    PdfMetadata {
        title,
        author,
        pages,
        creator,
        producer,
        creation_date,
        modification_date,
    }
}

/**
 * Extracts a string value for a given key from PDF content.
 * Handles PDF string literals (both parentheses and angle bracket encodings).
 */
fn extract_pdf_string(content: &str, key: &str) -> Option<String> {
    if let Some(pos) = content.find(key) {
        let after_key = &content[pos + key.len()..];
        let trimmed = after_key.trim_start();

        // Handle parenthesis-enclosed strings: (value)
        if let Some(rest) = trimmed.strip_prefix('(') {
            if let Some(end_pos) = find_closing_paren(rest) {
                let value = &rest[..end_pos];
                return Some(decode_pdf_string(value));
            }
        }

        // Handle hex strings: <hexvalue>
        if let Some(rest) = trimmed.strip_prefix('<') {
            if let Some(end_pos) = rest.find('>') {
                let hex = &rest[..end_pos];
                return decode_hex_string(hex);
            }
        }
    }
    None
}

/**
 * Finds the position of the closing parenthesis, handling escaped parentheses.
 */
fn find_closing_paren(s: &str) -> Option<usize> {
    let mut depth = 1;
    let mut escaped = false;

    for (i, c) in s.chars().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }

        match c {
            '\\' => escaped = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/**
 * Decodes a PDF string literal, handling escape sequences.
 */
fn decode_pdf_string(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('b') => result.push('\x08'),
                Some('f') => result.push('\x0c'),
                Some('\n') => {} // Line continuation, skip
                Some(d) if d.is_ascii_digit() => {
                    // Octal escape sequence
                    let mut octal = String::new();
                    octal.push(d);
                    for _ in 0..2 {
                        if let Some(&next) = chars.peek() {
                            if next.is_ascii_digit() {
                                octal.push(chars.next().unwrap());
                            } else {
                                break;
                            }
                        }
                    }
                    if let Ok(val) = u8::from_str_radix(&octal, 8) {
                        result.push(val as char);
                    }
                }
                Some(c) => result.push(c),
                None => break,
            }
        } else {
            result.push(c);
        }
    }

    result
}

/**
 * Decodes a hex-encoded PDF string.
 */
fn decode_hex_string(hex: &str) -> Option<String> {
    let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();

    (0..cleaned.len())
        .step_by(2)
        .map(|i| {
            let byte_str = &cleaned[i..i + 2.min(cleaned.len() - i)];
            u8::from_str_radix(byte_str, 16).ok()
        })
        .collect::<Option<Vec<u8>>>()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

/**
 * Fetches RSS feed content from a URL using native HTTP client.
 * This bypasses browser CORS restrictions.
 *
 * # Arguments
 * * `url` - The URL of the RSS feed to fetch
 *
 * # Returns
 * * `Ok(String)` - The feed content as a string
 * * `Err(String)` - Error message if fetching fails
 */
#[tauri::command]
fn fetch_rss_feed(url: String) -> Result<String, String> {
    let response = shared_http_client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, */*")
        .send()
        .map_err(|e| format!("Failed to fetch feed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP error: {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        ));
    }

    response
        .text()
        .map_err(|e| format!("Failed to read response: {}", e))
}

/**
 * Fetches generic URL content using native HTTP client.
 * Primarily used to fetch full article HTML for RSS items.
 *
 * # Arguments
 * * `url` - The URL to fetch
 *
 * # Returns
 * * `Ok(String)` - The response body as text
 * * `Err(String)` - Error message if fetching fails
 */
#[tauri::command]
fn fetch_url_content(url: String) -> Result<String, String> {
    let parsed_url =
        reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL '{}': {}", url, e))?;
    let referer = {
        let mut origin = parsed_url.clone();
        origin.set_path("/");
        origin.set_query(None);
        origin.set_fragment(None);
        origin.to_string()
    };

    let user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    ];

    let mut last_error: Option<String> = None;
    for (attempt, user_agent) in user_agents.iter().enumerate() {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        let response = shared_http_client()
            .get(parsed_url.clone())
            .timeout(std::time::Duration::from_secs(45))
            .header("User-Agent", *user_agent)
            .header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Referer", &referer)
            .header("Upgrade-Insecure-Requests", "1")
            .header("DNT", "1")
            .send();

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(format!("Failed to fetch URL content: {}", error));
                continue;
            }
        };

        if response.status().is_success() {
            return response
                .text()
                .map_err(|e| format!("Failed to read response: {}", e));
        }

        let status = response.status();
        let status_code = status.as_u16();

        if status_code == 429 || status_code == 403 {
            if status_code == 429 {
                let retry_after = response
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(3)
                    .clamp(2, 8);
                std::thread::sleep(std::time::Duration::from_secs(retry_after));
            }
            last_error = Some(format!(
                "HTTP error: {} {}",
                status,
                status.canonical_reason().unwrap_or(if status_code == 429 {
                    "Too Many Requests"
                } else {
                    "Forbidden"
                })
            ));
            continue;
        }

        return Err(format!(
            "HTTP error: {} {}",
            status,
            status.canonical_reason().unwrap_or("Unknown")
        ));
    }

    Err(last_error.unwrap_or_else(|| "Failed to fetch URL content".to_string()))
}

/**
 * Fetches binary URL content (for example PDF files) using native HTTP client.
 * Returns raw bytes so the frontend can store the document in app storage.
 */
#[tauri::command]
fn fetch_binary_content(url: String) -> Result<Vec<u8>, String> {
    let parsed_url =
        reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL '{}': {}", url, e))?;
    let referer = {
        let mut origin = parsed_url.clone();
        origin.set_path("/");
        origin.set_query(None);
        origin.set_fragment(None);
        origin.to_string()
    };

    let response = shared_http_client()
        .get(parsed_url)
        .timeout(std::time::Duration::from_secs(90))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        )
        .header("Accept", "application/pdf,application/octet-stream,*/*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", &referer)
        .send()
        .map_err(|e| format!("Failed to fetch binary content: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP error: {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        ));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read binary response: {}", e))?;
    Ok(bytes.to_vec())
}

#[tauri::command]
fn pick_library_folder_mobile(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_mobile_folder_scan::pick_folder(&app)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Mobile folder selection is only available on Android.".to_string())
    }
}

#[tauri::command]
fn scan_library_folder_mobile(
    app: tauri::AppHandle,
    tree_uri: String,
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_mobile_folder_scan::scan_folder(&app, &tree_uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, tree_uri);
        Err("Mobile folder scanning is only available on Android.".to_string())
    }
}

#[tauri::command]
fn scan_library_folder_desktop(folder_path: String) -> Result<Vec<String>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = folder_path;
        Err("Desktop folder scanning is only available on desktop.".to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let path = Path::new(&folder_path);
        if !path.is_dir() {
            return Err(format!("Not a directory: {}", folder_path));
        }

        const SUPPORTED_EXTENSIONS: &[&str] = &[
            ".epub", ".mobi", ".azw", ".azw3", ".fb2", ".fbz", ".fb2.zip", ".cbz", ".cbr", ".pdf",
        ];

        let mut book_files: Vec<String> = Vec::new();

        for entry in walkdir::WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                let entry_path = entry.path();
                let name_lower = entry_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_lowercase())
                    .unwrap_or_default();

                if SUPPORTED_EXTENSIONS
                    .iter()
                    .any(|ext| name_lower.ends_with(ext))
                {
                    book_files.push(entry_path.to_string_lossy().to_string());
                }
            }
        }

        // Sort for deterministic order
        book_files.sort();
        Ok(book_files)
    }
}

#[tauri::command]
async fn save_share_image_mobile(
    app: tauri::AppHandle,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_mobile_folder_scan::save_image(&app, &filename, &base64_data)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, filename, base64_data);
        Err("Mobile image saving is only available on Android.".to_string())
    }
}

#[tauri::command]
async fn materialize_android_content_uri(
    app: tauri::AppHandle,
    uri: String,
    file_name: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_mobile_folder_scan::materialize_content_uri(&app, &uri, &file_name)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, uri, file_name);
        Err("Content URI materialization is only available on Android.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn apply_linux_webkit_workarounds() {
    // Allow advanced users to disable these workarounds for troubleshooting:
    // THEOREM_WEBKIT_WORKAROUNDS=0
    if env::var("THEOREM_WEBKIT_WORKAROUNDS")
        .map(|value| value == "0")
        .unwrap_or(false)
    {
        return;
    }

    // WebKitGTK fallback for known Linux compositor/acceleration regressions.
    if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    // Helps with fractional-scaling blur regressions in GTK/WebKit paths.
    let existing_gdk_debug = env::var("GDK_DEBUG").unwrap_or_default();
    if existing_gdk_debug
        .split(',')
        .all(|flag| flag.trim() != "gl-no-fractional")
    {
        let merged = if existing_gdk_debug.trim().is_empty() {
            "gl-no-fractional".to_string()
        } else {
            format!("{},gl-no-fractional", existing_gdk_debug)
        };
        env::set_var("GDK_DEBUG", merged);
    }
}

// ─── TTS Commands ───
// Linux: spd-say CLI. macOS: say command. Windows: PowerShell SAPI. Android: plugin.

#[tauri::command]
#[allow(unused_variables, unreachable_code)]
fn tts_speak(app: tauri::AppHandle, text: String, voice: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_android_tts_audio::tts_speak(&app, text, voice);
    #[cfg(target_os = "linux")]
    return tts_linux::linux_tts_speak(&text);
    #[cfg(target_os = "macos")]
    {
        let mut c = std::process::Command::new("say");
        if !voice.is_empty() {
            c.arg("-v").arg(&voice);
        }
        c.arg(&text)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        c.spawn().map_err(|e| format!("say: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("powershell").args([
            "-NoProfile", "-Command",
            &format!(r#"Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('{}')"#, text.replace('"', "'")),
        ]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().map_err(|e| format!("TTS: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[allow(unused_variables, unreachable_code)]
fn tts_stop(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_android_tts_audio::tts_stop(&app);
    #[cfg(target_os = "linux")]
    return tts_linux::linux_tts_stop();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("killall")
            .arg("say")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok();
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskkill")
            .args(["/F", "/IM", "powershell.exe"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok();
    }
    Ok(())
}

#[tauri::command]
fn tts_pause(app: tauri::AppHandle) -> Result<(), String> {
    tts_stop(app)
}

#[tauri::command]
fn tts_resume(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[allow(unused_variables, unreachable_code)]
fn tts_get_voices(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_android_tts_audio::tts_get_voices(&app);
    let _ = app;
    Ok(Vec::new())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    apply_linux_webkit_workarounds();

    // Install the default crypto provider for rustls (used by reqwest v0.13 via iroh).
    // iroh's reqwest dependency uses `rustls-no-provider`, so no provider is set by
    // default — without this, any reqwest TLS connection will panic with "No provider set".
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default()
        .manage(PendingOpenFiles::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of closing — user must use tray "Quit"
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_app::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_mobile_folder_scan::init())
        .plugin(tauri_plugin_android_sync_worker::init())
        .plugin(tauri_plugin_android_tts_audio::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // Called when a secondary instance is invoked (e.g. "Open With" or relaunch).
        let paths = collect_open_paths(argv, Some(&cwd));
        enqueue_open_paths(app, paths, true);
        // Show and focus the existing window (it may be hidden to tray).
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .setup(|app| {
            // Initialize iroh P2P sync subsystem.
            // On Android, app_data_dir can fail to resolve, so we try
            // multiple fallback paths before giving up.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .or_else(|_| app.path().app_cache_dir())
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            let device_name = std::env::var("HOSTNAME")
                .or_else(|_| std::env::var("COMPUTERNAME"))
                .unwrap_or_else(|_| "Theorem Device".to_string());

            #[allow(unused_variables)]
            let daemon_data_dir = app_data_dir.clone();
            match sync_commands::init_sync(app_data_dir, device_name, app.handle().clone()) {
                Ok(sync_state) => {
                    app.manage(sync_state);
                }
                Err(e) => {
                    eprintln!("[theorem] Warning: Failed to initialize sync: {}", e);
                }
            }

            // Manage background sync handle (used by Android ForegroundService
            // and desktop background scheduler).
            use sync_commands::BackgroundSyncHandle;
            app.manage(BackgroundSyncHandle {
                cancel: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
                running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                data_version: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
                wake: std::sync::Arc::new(tokio::sync::Notify::new()),
            });

            // Collect any file association / CLI open targets at startup so the frontend can
            // import and open them once it is ready.
            let startup_args: Vec<String> = std::env::args().skip(1).collect();
            let open_paths = collect_open_paths(startup_args, None);
            enqueue_open_paths(app.handle(), open_paths, false);

            // ── Launch sync-daemon (Linux only) ──
            #[cfg(target_os = "linux")]
            {
                use std::sync::Mutex;
                let daemon_data_dir = daemon_data_dir.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let daemon_path = std::env::var("HOME")
                        .map(|h| std::path::PathBuf::from(h).join(".local/lib/theorem/sync-daemon"))
                        .ok();
                    let daemon_path = match daemon_path {
                        Some(p) if p.exists() => p,
                        _ => return,
                    };
                    match tokio::process::Command::new(&daemon_path)
                        .arg(daemon_data_dir.to_string_lossy().as_ref())
                        .kill_on_drop(true)
                        .spawn()
                    {
                        Ok(child) => {
                            eprintln!("[sync-daemon] launched (pid={})", child.id().unwrap_or(0));
                            #[allow(dead_code)]
                            struct DaemonChild {
                                inner: Mutex<Option<tokio::process::Child>>,
                            }
                            handle.manage(DaemonChild {
                                inner: Mutex::new(Some(child)),
                            });
                        }
                        Err(e) => {
                            eprintln!("[sync-daemon] spawn failed: {e}");
                        }
                    }
                });
            }

            // ── System tray (desktop only) ──
            #[cfg(desktop)]
            {
                let show = MenuItemBuilder::with_id("show", "Show Theorem").build(app)?;
                let sync_now = MenuItemBuilder::with_id("sync_now", "Sync Now").build(app)?;
                let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

                let menu = MenuBuilder::new(app)
                    .item(&show)
                    .item(&sync_now)
                    .separator()
                    .item(&quit)
                    .build()?;

                TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Theorem")
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "sync_now" => {
                            let _ = app.emit("tray-sync-now", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tts_speak,
            tts_stop,
            tts_pause,
            tts_resume,
            tts_get_voices,
            epub_parser::prefetch_zip_metadata,
            read_file,
            read_cbr_as_cbz,
            read_pdf_file,
            read_pdf_file_size,
            read_pdf_range,
            get_pdf_metadata,
            take_pending_open_files,
            fetch_rss_feed,
            fetch_url_content,
            fetch_binary_content,
            pick_library_folder_mobile,
            scan_library_folder_mobile,
            scan_library_folder_desktop,
            save_share_image_mobile,
            materialize_android_content_uri,
            database::sqlite_save_book_data,
            database::sqlite_get_book_data,
            database::sqlite_delete_book_data,
            database::sqlite_get_materialized_book_path,
            database::sqlite_save_cover_image,
            database::sqlite_get_cover_image,
            database::sqlite_delete_cover_image,
            database::sqlite_get_storage_stats,
            database::sqlite_cleanup_orphaned_storage,
            database::sqlite_clear_all_storage,
            database::sqlite_get_kv,
            database::sqlite_batch_get_kv,
            database::sqlite_set_kv,
            database::sqlite_delete_kv,
            database::sqlite_count_kv_by_prefix,
            database::sqlite_delete_kv_by_prefix,
            database::sqlite_set_blob,
            database::sqlite_get_blob,
            database::sqlite_delete_blob,
            database::sqlite_delete_blobs_by_prefix,
            database::sqlite_get_blob_stats,
            database::sqlite_index_book_fts,
            database::sqlite_index_books_fts_batch,
            database::sqlite_search_books,
            database::sqlite_save_book_metadata,
            database::sqlite_get_book_metadata,
            database::sqlite_save_book_annotations,
            database::sqlite_get_book_annotations,
            // Android auto-sync flag
            set_auto_sync_flag,
            // iroh P2P sync commands
            sync_commands::iroh_start,
            sync_commands::iroh_stop,
            sync_commands::iroh_pair,
            // Pairing + device management
            sync_commands::generate_pairing_qr,
            sync_commands::submit_pairing_code,
            sync_commands::get_device_identity,
            sync_commands::set_device_fingerprint,
            sync_commands::get_paired_devices,
            sync_commands::unpair_device,
            // Sync data provisioning
            sync_commands::set_sync_data,
            sync_commands::get_incoming_sync_data,
            sync_commands::update_peer_address,
            // iroh-based sync + file transfer
            sync_commands::initiate_sync,
            sync_commands::sync_now,
            sync_commands::pull_book_files,
            sync_commands::pull_book_covers,
            // Background sync
            sync_commands::start_background_sync,
            sync_commands::stop_background_sync,
            sync_commands::wake_background_sync,
            set_android_fingerprint,
            start_android_sync_worker,
            stop_android_sync_worker,
            update_sync_notification,
            schedule_sync_work,
            cancel_sync_work,
            hide_to_tray,
            download_and_extract_stardict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// On Android, reads ANDROID_ID via the mobile-folder-scan plugin and
/// sets it as the device fingerprint. No-op on other platforms.
#[tauri::command]
async fn set_android_fingerprint(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        match tauri_plugin_mobile_folder_scan::get_android_id(&app) {
            Ok(android_id) if !android_id.is_empty() => {
                theorem_sync_core::sync_crypto::set_fingerprint_from_frontend(&android_id);
                eprintln!("[sync] Android fingerprint set from ANDROID_ID");
            }
            _ => {
                // Fallback: generate a placeholder fingerprint.
                theorem_sync_core::sync_crypto::set_fingerprint_from_frontend("android:unknown");
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
    }
    Ok(())
}

/// Start the Android sync ForegroundService (keeps process alive for
/// background sync). On non-Android platforms this is a no-op.
#[tauri::command]
async fn start_android_sync_worker(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_android_sync_worker::start_worker(
            &app,
            "Theorem Sync Active",
            "Syncing data with paired devices",
            300,
        )?;
        eprintln!("[sync] Android sync worker started");
    }
    let _ = &app;
    Ok(())
}

/// Stop the Android sync ForegroundService.
#[tauri::command]
async fn stop_android_sync_worker(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        tauri_plugin_android_sync_worker::stop_worker(&app)?;
        eprintln!("[sync] Android sync worker stopped");
    }
    let _ = &app;
    Ok(())
}

/// Update the Android sync notification text.
#[tauri::command]
async fn update_sync_notification(app: tauri::AppHandle, text: String) -> Result<(), String> {
    tauri_plugin_android_sync_worker::update_notification(&app, &text)?;
    Ok(())
}

/// Schedule periodic WorkManager background sync (Android).
#[tauri::command]
async fn schedule_sync_work(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_android_sync_worker::schedule_periodic_sync(&app)?;
    eprintln!("[sync] Periodic WorkManager sync scheduled");
    Ok(())
}

/// Cancel periodic WorkManager background sync (Android).
#[tauri::command]
async fn cancel_sync_work(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_android_sync_worker::cancel_periodic_sync(&app)?;
    eprintln!("[sync] Periodic WorkManager sync cancelled");
    Ok(())
}

/// Write or delete the auto-sync-disabled flag file for JNI worker.
#[tauri::command]
async fn set_auto_sync_flag(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let flag = data_dir.join("auto-sync-disabled");
    if enabled {
        let _ = std::fs::remove_file(&flag);
    } else {
        let _ = std::fs::write(&flag, "1");
    }
    Ok(())
}

/// Standalone background sync round — called from WorkManager via JNI.
/// Uses the proper JNI naming convention so Android can find it.
/// Runs without the Tauri runtime: loads sync identity, starts the
/// sync server, waits for incoming syncs for 3 min, then shuts down.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn Java_work_fundamentals_theorem_syncworker_SyncWorker_runBackgroundSync(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    j_data_dir: jni::objects::JString,
) -> jni::sys::jboolean {
    let data_dir_str: String = match env.get_string(&j_data_dir) {
        Ok(s) => s.into(),
        Err(_) => ".".to_string(),
    };

    let data_dir = std::path::PathBuf::from(&data_dir_str);
    eprintln!("[background-sync] JNI sync round in {}", data_dir_str);

    // Check if auto-sync is disabled (flag file written by JS stopAutoSync).
    let disabled_flag = data_dir.join("auto-sync-disabled");
    if disabled_flag.exists() {
        eprintln!("[background-sync] Auto-sync disabled, skipping JNI round");
        return 0;
    }

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[background-sync] Failed to create runtime: {}", e);
            return 0;
        }
    };

    let result = rt.block_on(async {
        let identity =
            match theorem_sync_core::sync_crypto::DeviceIdentity::load_or_create(&data_dir) {
                Ok(id) => id,
                Err(e) => {
                    eprintln!("[background-sync] Failed to load identity: {}", e);
                    return false;
                }
            };

        let paired_devices = theorem_sync_core::sync_persistence::load_paired_devices(&data_dir);

        let device_id = identity.device_id.clone();
        let paired_devices = tokio::sync::Mutex::new(paired_devices);
        let sync_data: tokio::sync::Mutex<Option<serde_json::Value>> =
            tokio::sync::Mutex::new(None);

        // ── Outbound sync: push our data to each paired peer ──
        let client = reqwest::Client::new();
        for (_peer_id, peer) in paired_devices.lock().await.iter() {
            let peer_url = format!("http://{}:{}", peer.last_ip, peer.last_port);
            let manifest = theorem_sync_core::sync_protocol::SyncManifest {
                device_id: device_id.clone(),
                domains: Default::default(),
                last_sync_at: None,
            };
            let _ = client
                .post(format!("{peer_url}/sync/manifest"))
                .json(&manifest)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
        }

        // Persist any incoming data received from peers during this window.
        let incoming_cache_path = data_dir.join("sync-incoming-cache.json");
        let sync_data_guard = sync_data.lock().await;
        if let Some(ref snapshot) = *sync_data_guard {
            let incoming: std::collections::HashMap<String, String> = snapshot
                .as_object()
                .map(|obj| {
                    obj.iter()
                        .filter(|(k, _)| k.starts_with("incoming_"))
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            if !incoming.is_empty() {
                if let Ok(json) = serde_json::to_string_pretty(&incoming) {
                    if let Err(e) = std::fs::write(&incoming_cache_path, &json) {
                        eprintln!("[background-sync] Failed to persist incoming data cache: {e}");
                    } else {
                        eprintln!(
                            "[background-sync] Persisted {} incoming domain(s) to {}",
                            incoming.len(),
                            incoming_cache_path.display()
                        );
                    }
                }
            }
        }
        drop(sync_data_guard);

        eprintln!("[background-sync] JNI sync round complete");
        true
    });

    if result {
        1
    } else {
        0
    }
}

#[cfg(not(target_os = "android"))]
#[no_mangle]
pub extern "C" fn Java_work_fundamentals_theorem_syncworker_SyncWorker_runBackgroundSync() -> u8 {
    0
}

/// Initialize the ndk-context global so hickory-resolver (used by iroh DNS)
/// can access the Android JVM and application context on tokio worker threads.
/// Called from MainActivity.onCreate() before the Tauri setup callback fires.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn Java_work_fundamentals_theorem_MainActivity_initNdkContext(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
) {
    let jvm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => {
            eprintln!("[ndk-context] Failed to get JavaVM: {e}");
            return;
        }
    };
    let jvm_ptr = jvm.get_java_vm_pointer() as *mut std::ffi::c_void;

    let context = match get_application_context(&mut env) {
        Some(ctx) => ctx,
        None => {
            eprintln!("[ndk-context] Failed to get application context");
            return;
        }
    };

    unsafe {
        ndk_context::initialize_android_context(jvm_ptr, context);
    }
    eprintln!("[ndk-context] Initialized via JNI");
}

#[cfg(target_os = "android")]
fn get_application_context(env: &mut jni::JNIEnv) -> Option<*mut std::ffi::c_void> {
    let activity_thread = env.find_class("android/app/ActivityThread").ok()?;
    let current_app = env
        .call_static_method(
            activity_thread,
            "currentApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .ok()?;
    let app_obj = current_app.l().ok()?;
    let global_ref = env.new_global_ref(app_obj).ok()?;
    let raw_ptr = global_ref.as_raw() as *mut std::ffi::c_void;
    std::mem::forget(global_ref);
    Some(raw_ptr)
}

/// Hide the main window to the system tray.
/// The app continues running in the background with the sync server alive.
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .hide()
            .map_err(|e| format!("Failed to hide window: {e}"))
    } else {
        Ok(())
    }
}

/// Download and extract a StarDict dictionary from a URL.
/// Supports both .tar.bz2 and .zip archives.
/// Writes extracted files directly to SQLite blob storage and returns
/// dictionary metadata so the frontend never handles large blobs over IPC.
/// Runs the download on a blocking thread so the UI stays responsive.
#[tauri::command]
async fn download_and_extract_stardict(
    app: AppHandle,
    url: String,
) -> Result<serde_json::Value, String> {
    use futures::StreamExt;

    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Server returned HTTP {}", status.as_u16()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut body = Vec::new();

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        body.extend_from_slice(&chunk);

        if total_size > 0 {
            let percent = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit(
                "dictionary-download-progress",
                serde_json::json!({
                    "percent": percent,
                    "downloaded": downloaded,
                    "total": total_size,
                }),
            );
        }
    }

    let is_zip = url.ends_with(".zip");

    let (ifo, idx, dict, syn) = tokio::task::spawn_blocking(move || {
        if is_zip {
            extract_stardict_parts_from_zip(&body)
        } else {
            extract_stardict_parts_from_tar_bz2(&body)
        }
    })
    .await
    .map_err(|e| format!("Extraction task failed: {e}"))?
    .map_err(|e| format!("Extraction failed: {e}"))?;

    // Parse .ifo to get dictionary metadata
    let ifo_text = String::from_utf8_lossy(&ifo);
    let mut name = String::from("Unknown Dictionary");
    let mut lang = String::from("en");
    for line in ifo_text.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("bookname=") {
            name = value.trim().to_string();
        } else if trimmed.starts_with("sametypesequence=") {
            // Dictionary format indicator — captured for info, not needed elsewhere
        }
    }
    // Derive language from URL (e.g., .../file/en/dict-en-en.zip)
    if let Some(segments) = url.split('/').nth(4) {
        if segments.len() == 2 {
            lang = segments.to_string();
        }
    }

    let id = uuid_v4();
    let size_bytes =
        (ifo.len() + idx.len() + dict.len() + syn.as_ref().map_or(0, |s| s.len())) as u64;

    let manifest_key = format!("theorem-stardict:{id}:manifest");
    let manifest = serde_json::json!({
        "id": id,
        "name": name,
        "language": lang,
        "sizeBytes": size_bytes,
        "hasSyn": syn.is_some(),
    });
    database::sqlite_set_kv(
        app.clone(),
        manifest_key,
        serde_json::to_string(&manifest).map_err(|e| e.to_string())?,
    )?;

    database::sqlite_set_blob(app.clone(), format!("theorem-stardict:{id}:ifo"), ifo)?;
    database::sqlite_set_blob(app.clone(), format!("theorem-stardict:{id}:idx"), idx)?;
    database::sqlite_set_blob(app.clone(), format!("theorem-stardict:{id}:dict"), dict)?;
    if let Some(syn_data) = syn {
        database::sqlite_set_blob(app, format!("theorem-stardict:{id}:syn"), syn_data)?;
    }

    Ok(serde_json::json!({
        "id": id,
        "name": name,
        "language": lang,
        "sizeBytes": size_bytes,
    }))
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let random_part: u128 = now.as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (random_part >> 96) as u32,
        ((random_part >> 80) & 0xFFFF) as u16,
        ((random_part >> 64) & 0x0FFF) as u16,
        ((random_part >> 48) & 0xFFFF) as u16,
        random_part & 0xFFFFFFFFFFFF,
    )
}

type StardictParts = (Vec<u8>, Vec<u8>, Vec<u8>, Option<Vec<u8>>);

fn extract_stardict_parts_from_zip(data: &[u8]) -> Result<StardictParts, String> {
    let reader = std::io::Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("ZIP parsing failed: {e}"))?;

    let mut ifo_bytes: Option<Vec<u8>> = None;
    let mut idx_bytes: Option<Vec<u8>> = None;
    let mut dict_bytes: Option<Vec<u8>> = None;
    let mut syn_bytes: Option<Vec<u8>> = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP entry error: {e}"))?;
        let name = entry.name().to_owned();
        let mut data = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut data)
            .map_err(|e| format!("Failed to read ZIP entry '{name}': {e}"))?;

        if name.ends_with(".ifo") {
            ifo_bytes = Some(data);
        } else if name.ends_with(".idx") && !name.ends_with(".idx.gz") {
            idx_bytes = Some(data);
        } else if name.ends_with(".dict.dz") || name.ends_with(".dict") {
            dict_bytes = Some(data);
        } else if name.ends_with(".syn") {
            syn_bytes = Some(data);
        }
    }

    let ifo = ifo_bytes.ok_or("Archive missing .ifo file")?;
    let idx = idx_bytes.ok_or("Archive missing .idx file")?;
    let dict = dict_bytes.ok_or("Archive missing .dict.dz/.dict file")?;

    Ok((ifo, idx, dict, syn_bytes))
}

fn extract_stardict_parts_from_tar_bz2(data: &[u8]) -> Result<StardictParts, String> {
    let decompressed = {
        let mut decoder = bzip2::read::BzDecoder::new(data);
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut decoder, &mut buf)
            .map_err(|e| format!("Bzip2 decompression failed: {e}"))?;
        buf
    };

    let mut archive = tar::Archive::new(&decompressed[..]);

    let mut ifo_bytes: Option<Vec<u8>> = None;
    let mut idx_bytes: Option<Vec<u8>> = None;
    let mut dict_bytes: Option<Vec<u8>> = None;
    let mut syn_bytes: Option<Vec<u8>> = None;

    for entry in archive
        .entries()
        .map_err(|e| format!("Tar parsing failed: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("Tar entry error: {e}"))?;
        let name = {
            let path = entry.path().map_err(|e| format!("Tar path error: {e}"))?;
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_owned()
        };

        let mut data = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut data)
            .map_err(|e| format!("Failed to read tar entry '{name}': {e}"))?;

        if name.ends_with(".ifo") {
            ifo_bytes = Some(data);
        } else if name.ends_with(".idx") && !name.ends_with(".idx.gz") {
            idx_bytes = Some(data);
        } else if name.ends_with(".dict.dz") || name.ends_with(".dict") {
            dict_bytes = Some(data);
        } else if name.ends_with(".syn") {
            syn_bytes = Some(data);
        }
    }

    let ifo = ifo_bytes.ok_or("Archive missing .ifo file")?;
    let idx = idx_bytes.ok_or("Archive missing .idx file")?;
    let dict = dict_bytes.ok_or("Archive missing .dict.dz/.dict file")?;

    Ok((ifo, idx, dict, syn_bytes))
}
