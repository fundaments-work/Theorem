use reqwest::blocking::Client;
use serde::Serialize;
use std::env;
/**
 * Tauri Library Module
 */
use std::fs;

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
fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    // Try to read the file directly using standard fs
    // The Tauri FS plugin's scope permissions are checked on the frontend side
    // when reading from app storage, so by the time we get here, the path
    // should be accessible.
    fs::read(&path).map_err(|e| format!("Failed to read PDF file '{}': {}", path, e))
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
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
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

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    ];

    let mut last_error: Option<String> = None;
    for user_agent in user_agents {
        let response = client
            .get(parsed_url.clone())
            .header("User-Agent", user_agent)
            .header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Referer", &referer)
            .header("Upgrade-Insecure-Requests", "1")
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
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
        if status.as_u16() == 403 {
            last_error = Some(format!(
                "HTTP error: {} {}",
                status,
                status.canonical_reason().unwrap_or("Forbidden")
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_pdf_file,
            get_pdf_metadata,
            fetch_rss_feed,
            fetch_url_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
