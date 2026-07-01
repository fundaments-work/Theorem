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
    Regex::new(r#"<item\s[^>]*?\bproperties\s*=\s*"([^"]*\bnav\b[^"]*)"[^>]*?\bhref\s*=\s*"([^"]+)"[^>]*?"#).unwrap()
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

/// Native EPUB prefetch — opens the zip once, reads the OPF + nav/NCX bytes,
/// and builds an uncompressed-size map of *every* entry so JS can skip
/// @zip.js/zip.js for container/OPF/nav text and every getSize() call.
#[tauri::command]
pub fn parse_epub_full(path: String) -> Result<EpubPrefetch, String> {
    let file = File::open(&path).map_err(|e| format!("Cannot open {}: {}", path, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip: {}", e))?;

    // 1. Build uncompressed-size map for every zip entry
    let mut sizes: HashMap<String, u64> = HashMap::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            sizes.insert(f.name().to_string(), f.size());
        }
    }

    // 2. Read container.xml → extract OPF path
    let container_text = read_zip_text(&mut archive, "META-INF/container.xml")
        .ok_or("Missing META-INF/container.xml".to_string())?;
    let opf_rel = RE_ROOTFILE
        .captures(&container_text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Could not find rootfile full-path in container.xml".to_string())?;

    // 3. Read OPF → extract nav / ncx hrefs
    let opf_path = resolve_relative("META-INF/container.xml", &opf_rel);
    let opf_text = read_zip_text(&mut archive, &opf_path)
        .ok_or_else(|| format!("Could not read OPF at {}", opf_path))?;

    let nav_href = RE_NAV
        .captures(&opf_text)
        .and_then(|c| c.get(2))
        .map(|m| m.as_str().to_string());

    let ncx_href = RE_NCX
        .captures(&opf_text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    // 4. Read nav / ncx (resolve relative to OPF directory)
    let nav_path = nav_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));
    let ncx_path = ncx_href
        .as_ref()
        .map(|href| resolve_relative(&opf_path, href));

    let nav = nav_path
        .as_ref()
        .and_then(|p| read_zip_text(&mut archive, p));
    let ncx = ncx_path
        .as_ref()
        .and_then(|p| read_zip_text(&mut archive, p));

    // 5. Encryption.xml is also on the critical init path
    let encryption = read_zip_text(&mut archive, "META-INF/encryption.xml");

    Ok(EpubPrefetch {
        container: container_text,
        opf_path,
        opf: opf_text,
        nav_path,
        nav,
        ncx_path,
        ncx,
        encryption,
        sizes,
    })
}

#[derive(serde::Serialize)]
pub struct EpubPrefetch {
    pub container: String,
    pub opf_path: String,
    pub opf: String,
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
