mod database;
mod sync_commands;
mod sync_crypto;
mod sync_protocol;
mod sync_server;

use reqwest::blocking::Client;
use serde::Serialize;
use std::env;
/**
 * Tauri Library Module
 */
use std::fs;
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
    let bytes =
        fs::read(&path).map_err(|e| format!("Failed to read PDF file '{}': {}", path, e))?;

    // Basic PDF metadata extraction by parsing the header and info dictionary
    let metadata = extract_pdf_metadata(&bytes);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    apply_linux_webkit_workarounds();

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
        .plugin(tauri_plugin_mobile_folder_scan::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // Called when a secondary instance is invoked (e.g. "Open With").
        let paths = collect_open_paths(argv, Some(&cwd));
        enqueue_open_paths(app, paths, true);
    }));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .setup(|app| {
            // Initialize LAN sync subsystem.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            let device_name = std::env::var("HOSTNAME")
                .or_else(|_| std::env::var("COMPUTERNAME"))
                .unwrap_or_else(|_| "Theorem Device".to_string());

            match sync_commands::init_sync(app_data_dir, device_name, app.handle().clone()) {
                Ok(sync_state) => {
                    app.manage(sync_state);
                }
                Err(e) => {
                    eprintln!("[theorem] Warning: Failed to initialize sync: {}", e);
                }
            }

            // Collect any file association / CLI open targets at startup so the frontend can
            // import and open them once it is ready.
            let startup_args: Vec<String> = std::env::args().skip(1).collect();
            let open_paths = collect_open_paths(startup_args, None);
            enqueue_open_paths(app.handle(), open_paths, false);

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
            read_file,
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
            database::sqlite_set_kv,
            database::sqlite_delete_kv,
            database::sqlite_count_kv_by_prefix,
            database::sqlite_delete_kv_by_prefix,
            database::sqlite_set_blob,
            database::sqlite_get_blob,
            database::sqlite_delete_blob,
            database::sqlite_delete_blobs_by_prefix,
            database::sqlite_get_blob_stats,
            // LAN sync commands
            sync_commands::start_sync_server,
            sync_commands::stop_sync_server,
            sync_commands::generate_pairing_qr,
            sync_commands::submit_pairing_code,
            sync_commands::get_device_identity,
            sync_commands::get_paired_devices,
            sync_commands::unpair_device,
            sync_commands::set_sync_data,
            sync_commands::get_incoming_sync_data,
            sync_commands::update_peer_address,
            sync_commands::discover_peer,
            sync_commands::initiate_sync,
            sync_commands::pull_book_files,
            sync_commands::pull_book_covers,
            hide_to_tray,
            download_and_extract_stardict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    tokio::task::spawn_blocking(move || {
        let response = shared_http_client()
            .get(&url)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .map_err(|e| format!("Download failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Server returned HTTP {}", status.as_u16()));
        }

        let body = response
            .bytes()
            .map_err(|e| format!("Failed to read response body: {e}"))?;

        let is_zip = url.ends_with(".zip");

        let (ifo, idx, dict, syn) = if is_zip {
            extract_stardict_parts_from_zip(&body)?
        } else {
            extract_stardict_parts_from_tar_bz2(&body)?
        };

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
    })
    .await
    .map_err(|e| format!("Download task failed: {e}"))?
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
