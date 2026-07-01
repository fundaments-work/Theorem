use regex::Regex;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

// ── Pre-compiled regexes (one-time init) ──

static RE_ROOTFILE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"full-path\s*=\s*"([^"]+)""#).unwrap());

static RE_NAV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"<item\s[^>]*?\bproperties\s*=\s*"([^"]*\bnav\b[^"]*)"[^>]*?\bhref\s*=\s*"([^"]+)"[^>]*?"#,
    )
    .unwrap()
});

static RE_NCX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"media-type\s*=\s*"application/x-dtbncx\+xml"[^>]*?\bhref\s*=\s*"([^"]+)"#)
        .unwrap()
});

// ── Helpers ──

fn read_zip_text(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

fn resolve_relative(base: &str, target: &str) -> String {
    let base_dir = Path::new(base).parent().unwrap_or(Path::new(""));
    base_dir.join(target).to_str().unwrap_or(target).to_string()
}

/// Opens a zip file in Rust and returns:
///   (a) an uncompressed-size map of every entry (works for ALL zip-based
///       formats: EPUB, CBZ, FBZ, etc.)
///   (b) for EPUB files: pre-decoded text for container.xml, OPF, nav, NCX,
///       and encryption.xml, with resolved zip paths.
///
/// When the file is not an EPUB (missing container.xml) the command still
/// succeeds with `sizes` and empty optional fields — the JS caller can
/// inject the sizes map for `getSize()` regardless of format.
#[tauri::command]
pub fn prefetch_zip_metadata(path: String) -> Result<ZipPrefetch, String> {
    let file = File::open(&path).map_err(|e| format!("Cannot open {}: {}", path, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip: {}", e))?;

    // 1. Build uncompressed-size map for every zip entry (works for all formats)
    let mut sizes: HashMap<String, u64> = HashMap::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            sizes.insert(f.name().to_string(), f.size());
        }
    }

    // 2. EPUB-specific: try container → OPF → nav/NCX → encryption.
    //    If any step fails the command still succeeds with the sizes map alone.
    let epub = read_epub_metadata(&mut archive);

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
    })
}

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
    let container_text = read_zip_text(archive, "META-INF/container.xml")?;
    let opf_rel = RE_ROOTFILE
        .captures(&container_text)?
        .get(1)?
        .as_str()
        .to_string();
    let opf_path = resolve_relative("META-INF/container.xml", &opf_rel);
    let opf_text = read_zip_text(archive, &opf_path)?;

    let nav_href = RE_NAV
        .captures(&opf_text)
        .and_then(|c| c.get(2))
        .map(|m| m.as_str().to_string());

    let ncx_href = RE_NCX
        .captures(&opf_text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let nav_path = nav_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));
    let ncx_path = ncx_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));

    let nav = nav_path.as_ref().and_then(|p| read_zip_text(archive, p));
    let ncx = ncx_path.as_ref().and_then(|p| read_zip_text(archive, p));
    let encryption = read_zip_text(archive, "META-INF/encryption.xml");

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
}
