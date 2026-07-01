use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

// ── Helpers ──

fn read_zip_entry(archive: &mut zip::ZipArchive<File>, path: &str) -> Option<String> {
    // First try the path as-is
    if let Some(text) = read_zip_by_name(archive, path) {
        return Some(text);
    }
    // Fall back to percent-decoded path (OPF hrefs may be percent-encoded
    // while the zip stores decoded bytes, or vice versa)
    let decoded = percent_encoding::percent_decode(path.as_bytes()).decode_utf8_lossy();
    if decoded.as_ref() != path {
        return read_zip_by_name(archive, decoded.as_ref());
    }
    None
}

fn read_zip_by_name(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

fn resolve_relative(base: &str, target: &str) -> String {
    let base_dir = Path::new(base).parent().unwrap_or(Path::new(""));
    base_dir
        .join(target.split(['?', '#']).next().unwrap_or(target))
        .to_str()
        .unwrap_or(target)
        .to_string()
}

/// Strip a leading UTF-8 or UTF-16 BOM from XML bytes.
fn strip_xml_bom(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use std::borrow::Cow;
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        return Cow::Borrowed(&bytes[3..]);
    }
    if bytes.len() >= 2 {
        let big_endian = bytes[0] == 0xFE && bytes[1] == 0xFF;
        let little_endian = bytes[0] == 0xFF && bytes[1] == 0xFE;
        if big_endian || little_endian {
            let body = &bytes[2..];
            let units: Vec<u16> = body
                .chunks_exact(2)
                .map(|c| {
                    if big_endian {
                        u16::from_be_bytes([c[0], c[1]])
                    } else {
                        u16::from_le_bytes([c[0], c[1]])
                    }
                })
                .collect();
            let s = String::from_utf16_lossy(&units);
            return Cow::Owned(s.into_bytes());
        }
    }
    Cow::Borrowed(bytes)
}

fn local_name(bytes: &[u8]) -> &[u8] {
    match bytes.iter().rposition(|b| *b == b':') {
        Some(idx) => &bytes[idx + 1..],
        None => bytes,
    }
}

// ── OPF toc-source location (streaming quick-xml) ──

struct LocatedTocSources {
    nav_href: Option<String>,
    ncx_href: Option<String>,
}

/// Single-pass streaming scan of the OPF to find the nav document href
/// and NCX href. Mirrors foliate-js Resources logic:
///   - nav: first manifest <item> whose `properties` contains the token "nav"
///   - ncx: any <item> with media-type `application/x-dtbncx+xml`
fn locate_toc_sources(opf_bytes: &[u8]) -> Result<LocatedTocSources, String> {
    let normalized = strip_xml_bom(opf_bytes);
    let mut reader = Reader::from_reader(normalized.as_ref());
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    #[derive(Default, Clone)]
    struct Item {
        href: String,
        media_type: String,
        properties: String,
    }

    let mut manifest: HashMap<String, Item> = HashMap::new();
    let mut nav_href: Option<String> = None;
    let mut in_manifest = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if in_manifest && name == b"item" {
                    let mut id = String::new();
                    let mut item = Item::default();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"id" => id = String::from_utf8_lossy(&attr.value).into_owned(),
                            b"href" => {
                                item.href = String::from_utf8_lossy(&attr.value).into_owned()
                            }
                            b"media-type" => {
                                item.media_type = String::from_utf8_lossy(&attr.value).into_owned()
                            }
                            b"properties" => {
                                item.properties = String::from_utf8_lossy(&attr.value).into_owned()
                            }
                            _ => {}
                        }
                    }
                    if nav_href.is_none()
                        && item.properties.split_ascii_whitespace().any(|p| p == "nav")
                        && !item.href.is_empty()
                    {
                        nav_href = Some(item.href.clone());
                    }
                    if !id.is_empty() {
                        manifest.insert(id, item);
                    }
                }
            }
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"manifest" {
                    in_manifest = true;
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"manifest" {
                    in_manifest = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("xml: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let ncx_href = manifest
        .values()
        .find(|it| it.media_type == "application/x-dtbncx+xml")
        .map(|it| it.href.clone());

    Ok(LocatedTocSources { nav_href, ncx_href })
}

fn read_rootfile_path(archive: &mut zip::ZipArchive<File>) -> Option<String> {
    let bytes_str = read_zip_entry(archive, "META-INF/container.xml")?;
    let normalized = strip_xml_bom(bytes_str.as_bytes());
    let mut reader = Reader::from_reader(normalized.as_ref());
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if local_name(e.name().as_ref()) == b"rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            return Some(String::from_utf8_lossy(&attr.value).into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

/// Pre-decoded EPUB metadata: container, OPF, nav, NCX, encryption text.
struct EpubMeta {
    container: Option<String>,
    opf_path: String,
    opf: Option<String>,
    nav_path: Option<String>,
    nav: Option<String>,
    ncx_path: Option<String>,
    ncx: Option<String>,
    encryption: Option<String>,
}

fn read_epub_metadata(archive: &mut zip::ZipArchive<File>) -> Option<EpubMeta> {
    let container_text = read_zip_entry(archive, "META-INF/container.xml")?;
    let opf_rel = read_rootfile_path(archive)?;
    let opf_path = resolve_relative("META-INF/container.xml", &opf_rel);
    let opf_text = read_zip_entry(archive, &opf_path)?;

    let LocatedTocSources { nav_href, ncx_href } = locate_toc_sources(opf_text.as_bytes()).ok()?;

    let nav_path = nav_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));
    let ncx_path = ncx_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));

    let nav = nav_path.as_ref().and_then(|p| read_zip_entry(archive, p));
    let ncx = ncx_path.as_ref().and_then(|p| read_zip_entry(archive, p));
    let encryption = read_zip_entry(archive, "META-INF/encryption.xml");

    Some(EpubMeta {
        container: Some(container_text),
        opf_path,
        opf: Some(opf_text),
        nav_path,
        nav,
        ncx_path,
        ncx,
        encryption,
    })
}

#[derive(serde::Serialize)]
pub struct ZipPrefetch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opf_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opf: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ncx_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ncx: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption: Option<String>,
    pub sizes: HashMap<String, u64>,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    #[serde(default)]
    pub sections: HashMap<String, String>,
}

/// Opens a zip file in Rust and returns:
///   - an uncompressed-size map of every entry
///   - EPUB-specific: pre-decoded text for container, OPF, nav, NCX,
///     encryption.xml, plus ALL HTML/XHTML sections
///
/// The operation runs on the blocking thread pool so 4 concurrent
/// JS `invoke()` calls get true parallelism.
#[tauri::command]
pub async fn prefetch_zip_metadata(
    app: tauri::AppHandle,
    path: String,
) -> Result<ZipPrefetch, String> {
    tauri::async_runtime::spawn_blocking(move || prefetch_sync(&app, &path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn prefetch_sync(_app: &tauri::AppHandle, path: &str) -> Result<ZipPrefetch, String> {
    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("file not found: {path}"));
    }

    let file = File::open(file_path).map_err(|e| format!("Cannot open {path}: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip: {e}"))?;

    // 1. Build uncompressed-size map for every zip entry
    let mut sizes: HashMap<String, u64> = HashMap::with_capacity(archive.len());
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            sizes.insert(f.name().to_string(), f.size());
        }
    }

    // 2. EPUB-specific: container → OPF → nav/NCX → encryption
    let epub = read_epub_metadata(&mut archive);

    // 3. Pre-load HTML/XHTML section content so JS never touches zip for text
    let mut sections: HashMap<String, String> = HashMap::new();
    let section_exts = [".html", ".htm", ".xhtml", ".xml"];
    for name in sizes.keys() {
        let lower = name.to_lowercase();
        if !section_exts.iter().any(|e| lower.ends_with(e)) {
            continue;
        }
        // Skip already-read metadata files
        if epub.as_ref().is_some_and(|e| {
            e.nav_path.as_deref() == Some(name.as_str())
                || e.ncx_path.as_deref() == Some(name.as_str())
                || e.opf_path == *name
        }) {
            continue;
        }
        if name == "META-INF/container.xml" || name == "META-INF/encryption.xml" {
            continue;
        }
        if sections.len() >= 100 {
            break;
        }
        if let Some(text) = read_zip_entry(&mut archive, name) {
            sections.insert(name.clone(), text);
        }
    }

    Ok(ZipPrefetch {
        container: epub.as_ref().and_then(|e| e.container.clone()),
        opf_path: epub.as_ref().map(|e| e.opf_path.clone()),
        opf: epub.as_ref().and_then(|e| e.opf.clone()),
        nav_path: epub.as_ref().and_then(|e| e.nav_path.clone()),
        nav: epub.as_ref().and_then(|e| e.nav.clone()),
        ncx_path: epub.as_ref().and_then(|e| e.ncx_path.clone()),
        ncx: epub.as_ref().and_then(|e| e.ncx.clone()),
        encryption: epub.as_ref().and_then(|e| e.encryption.clone()),
        sizes,
        sections,
    })
}
