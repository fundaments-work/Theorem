/**
 * Tauri Commands for PDF Rendering
 *
 * Provides PDF rendering capabilities using pdfium-render with:
 * - Document caching via Mutex<HashMap> for thread-safe access
 * - Proper error handling with thiserror
 */

use crate::image_encoder::{self, EncodedImage, JpegQuality};
use image::ImageFormat;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use thiserror::Error;

/// PDF page information sent to frontend
#[derive(Debug, Clone, Serialize)]
pub struct PdfPageData {
    /// Page number (0-indexed)
    pub page_number: usize,
    /// Base64 data URL of the rendered page
    pub data_url: String,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// File size of the encoded image
    pub size_bytes: usize,
    /// Format used ("png" or "jpeg")
    pub format: String,
}

/// PDF document information
#[derive(Debug, Clone, Serialize)]
pub struct PdfDocumentInfo {
    pub page_count: usize,
    pub title: Option<String>,
    pub author: Option<String>,
    pub page_width: f64,
    pub page_height: f64,
}

/// PDF metadata structure
#[derive(Debug, Clone, Serialize)]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
}

/// PDF info returned by load and get_info commands
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    /// Document ID
    pub id: String,
    /// Number of pages
    pub page_count: usize,
    /// Document metadata
    pub metadata: PdfMetadata,
    /// Width of first page (points)
    pub page_width: f64,
    /// Height of first page (points)
    pub page_height: f64,
}

/// Request to render a PDF page
#[derive(Debug, Clone, Deserialize)]
pub struct RenderPageRequest {
    /// Path to the PDF file
    pub file_path: String,
    /// Page number to render (0-indexed)
    pub page_number: usize,
    /// Target width in pixels (maintains aspect ratio)
    pub target_width: Option<u32>,
    /// Image format preference
    pub format: Option<ImageFormatPreference>,
}

/// Format preference for PDF rendering
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormatPreference {
    /// Always use PNG (lossless, larger files)
    Png,
    /// Always use JPEG (lossy, smaller files)
    Jpeg,
    /// Automatically choose based on content
    Auto,
}

impl Default for ImageFormatPreference {
    fn default() -> Self {
        ImageFormatPreference::Auto
    }
}

/// PDF error types
#[derive(Debug, Error, Serialize)]
pub enum PdfError {
    #[error("PDFium not initialized")]
    NotInitialized,
    #[error("Failed to bind to Pdfium: {0}")]
    BindError(String),
    #[error("Failed to load PDF: {0}")]
    LoadError(String),
    #[error("Document not found: {0}")]
    DocumentNotFound(String),
    #[error("Page not found: {0}")]
    PageNotFound(String),
    #[error("Failed to render page: {0}")]
    RenderError(String),
    #[error("Failed to encode image: {0}")]
    EncodeError(String),
    #[error("Lock error: {0}")]
    LockError(String),
}

/// Comparison result for different encoding options
#[derive(Debug, Clone, Serialize)]
pub struct EncodingComparison {
    pub page_number: usize,
    pub png_size: usize,
    pub jpeg_low_size: usize,
    pub jpeg_medium_size: usize,
    pub jpeg_high_size: usize,
    pub recommended_format: String,
}

/// Stored PDF document with metadata and bytes
/// This struct is Send + Sync because it only contains owned data
struct StoredPdf {
    #[allow(dead_code)]
    id: String,
    bytes: Vec<u8>,
    info: PdfInfo,
}

/// State for managing loaded PDFs
/// Uses Mutex for thread-safe access to the HashMap
/// Note: This struct IS Send + Sync because all fields are Send + Sync
pub struct PdfState {
    documents: Mutex<HashMap<String, StoredPdf>>,
}

impl PdfState {
    /// Create a new PDF state
    pub fn new() -> Self {
        Self {
            documents: Mutex::new(HashMap::new()),
        }
    }

    /// Insert a new PDF into the state
    fn insert(&self, id: String, bytes: Vec<u8>, info: PdfInfo) {
        let stored = StoredPdf {
            id: id.clone(),
            bytes,
            info,
        };
        if let Ok(mut docs) = self.documents.lock() {
            docs.insert(id, stored);
        }
    }

    /// Get PDF info by ID
    fn get_info(&self, id: &str) -> Option<PdfInfo> {
        self.documents
            .lock()
            .ok()
            .and_then(|docs| docs.get(id).map(|stored| stored.info.clone()))
    }

    /// Get PDF bytes by ID
    fn get_bytes(&self, id: &str) -> Option<Vec<u8>> {
        self.documents
            .lock()
            .ok()
            .and_then(|docs| docs.get(id).map(|stored| stored.bytes.clone()))
    }

    /// Remove PDF from state
    fn remove(&self, id: &str) -> bool {
        self.documents
            .lock()
            .ok()
            .map(|mut docs| docs.remove(id).is_some())
            .unwrap_or(false)
    }
}

impl Default for PdfState {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a new Pdfium instance with proper bindings
/// This function creates a fresh Pdfium each call since Pdfium is not Send/Sync
fn create_pdfium() -> Result<Pdfium, PdfError> {
    let bindings = Pdfium::bind_to_system_library()
        .or_else(|_| {
            // Try loading from lib/ directory (development)
            let lib_name = Pdfium::pdfium_platform_library_name_at_path("./lib/");
            Pdfium::bind_to_library(lib_name)
        })
        .or_else(|_| {
            // Try loading from current directory (production)
            let lib_name = Pdfium::pdfium_platform_library_name_at_path("./");
            Pdfium::bind_to_library(lib_name)
        })
        .or_else(|_| {
            // Try loading from src-tauri/lib/ (when running from project root)
            let lib_name = Pdfium::pdfium_platform_library_name_at_path("./src-tauri/lib/");
            Pdfium::bind_to_library(lib_name)
        })
        .map_err(|e| PdfError::BindError(e.to_string()))?;
    
    Ok(Pdfium::new(bindings))
}

// =============================================================================
// New State-based Commands
// =============================================================================

/// Load a PDF from bytes and store it in state
#[tauri::command]
pub async fn pdf_load(
    state: State<'_, PdfState>,
    id: String,
    bytes: Vec<u8>,
) -> Result<PdfInfo, PdfError> {
    // Create PDFium instance
    let pdfium = create_pdfium()?;

    // Clone bytes for storage since we need to keep them
    let bytes_for_storage = bytes.clone();
    
    // Load PDF from bytes to extract info
    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| PdfError::LoadError(e.to_string()))?;

    // Extract document info
    let pages = document.pages();
    let page_count = pages.len() as usize;
    let first_page = pages
        .get(0)
        .map_err(|e| PdfError::LoadError(e.to_string()))?;

    // Extract metadata using correct API
    let doc_metadata = document.metadata();
    let title = doc_metadata
        .get(PdfDocumentMetadataTagType::Title)
        .map(|tag| tag.value().to_string());
    let author = doc_metadata
        .get(PdfDocumentMetadataTagType::Author)
        .map(|tag| tag.value().to_string());

    let info = PdfInfo {
        id: id.clone(),
        page_count,
        metadata: PdfMetadata { title, author },
        page_width: first_page.width().value as f64,
        page_height: first_page.height().value as f64,
    };

    // Store the document bytes and info
    state.insert(id, bytes_for_storage, info.clone());

    Ok(info)
}

/// Render a PDF page as base64 PNG
#[tauri::command]
pub async fn pdf_render_page(
    state: State<'_, PdfState>,
    id: String,
    page: u32,
    #[allow(unused_variables)] scale: f32,
) -> Result<String, PdfError> {
    // Get the PDF bytes from state
    let bytes = state
        .get_bytes(&id)
        .ok_or_else(|| PdfError::DocumentNotFound(id.clone()))?;

    // Create PDFium instance
    let pdfium = create_pdfium()?;

    // Load PDF from bytes
    let document = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .map_err(|e| PdfError::LoadError(e.to_string()))?;

    // Get the requested page (convert from 1-indexed to 0-indexed)
    // Frontend sends pages as 1-indexed, but PDFium uses 0-indexed
    let page_index = if page > 0 { (page - 1) as u16 } else { 0 };
    let pdf_page = document
        .pages()
        .get(page_index)
        .map_err(|e| PdfError::PageNotFound(e.to_string()))?;

    // Calculate target width based on scale (default page width at 100% ~ 1200px)
    let target_width: i32 = (1200.0 * scale) as i32;

    // Set up render configuration
    let render_config = PdfRenderConfig::new()
        .set_target_width(target_width)
        .set_maximum_height(4000); // Prevent extremely tall pages

    // Render the page to bitmap
    let bitmap = pdf_page
        .render_with_config(&render_config)
        .map_err(|e| PdfError::RenderError(e.to_string()))?;

    // Convert to DynamicImage
    let dynamic_image = bitmap.as_image();

    // Encode as PNG
    let encoded = image_encoder::encode_to_png_base64(dynamic_image)
        .map_err(|e| PdfError::EncodeError(e.to_string()))?;

    Ok(encoded.data_url)
}

/// Get PDF info by ID
#[tauri::command]
pub async fn pdf_get_info(state: State<'_, PdfState>, id: String) -> Result<PdfInfo, PdfError> {
    state
        .get_info(&id)
        .ok_or_else(|| PdfError::DocumentNotFound(id))
}

/// Close a PDF and remove it from state
#[tauri::command]
pub async fn pdf_close(state: State<'_, PdfState>, id: String) -> Result<(), ()> {
    state.remove(&id);
    Ok(())
}

// =============================================================================
// Legacy Commands (for backward compatibility)
// =============================================================================

/// Initialize the PDFium library
/// Call this once when your app starts (no-op in current implementation)
#[tauri::command]
pub fn initialize_pdfium() -> Result<(), String> {
    // Just verify we can create a Pdfium instance
    create_pdfium().map_err(|e| e.to_string())?;
    Ok(())
}

/// Render a single PDF page and return as base64
///
/// # Arguments
/// * `request` - RenderPageRequest containing file path and page info
///
/// # Returns
/// * `Ok(PdfPageData)` - Rendered page with base64 data
/// * `Err(String)` - Error message
#[tauri::command]
pub async fn render_pdf_page(request: RenderPageRequest) -> Result<PdfPageData, String> {
    // Create PDFium instance
    let pdfium = create_pdfium().map_err(|e| e.to_string())?;

    // Load the PDF document
    let document = pdfium
        .load_pdf_from_file(&request.file_path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Get the requested page
    let page_index = request.page_number as u16;
    let page = document
        .pages()
        .get(page_index)
        .map_err(|e| format!("Failed to get page {}: {}", request.page_number, e))?;

    // Set up render configuration
    let target_width: i32 = request.target_width.unwrap_or(1200) as i32;
    let render_config = PdfRenderConfig::new()
        .set_target_width(target_width)
        .set_maximum_height(2000); // Prevent extremely tall pages

    // Render the page to bitmap
    let bitmap = page
        .render_with_config(&render_config)
        .map_err(|e| format!("Failed to render page: {}", e))?;

    // Convert to DynamicImage
    let dynamic_image = bitmap.as_image();

    // Determine format
    let format_pref = request.format.unwrap_or_default();

    // Encode the image
    let encoded: EncodedImage = match format_pref {
        ImageFormatPreference::Png => image_encoder::encode_to_png_base64(dynamic_image)?,
        ImageFormatPreference::Jpeg => {
            image_encoder::encode_to_jpeg_base64(dynamic_image, JpegQuality::Medium)?
        }
        ImageFormatPreference::Auto => {
            image_encoder::encode_auto(dynamic_image, target_width as u32)?
        }
    };

    Ok(PdfPageData {
        page_number: request.page_number,
        data_url: encoded.data_url,
        width: encoded.width,
        height: encoded.height,
        size_bytes: encoded.size_bytes,
        format: if encoded.format == ImageFormat::Png {
            "png".to_string()
        } else {
            "jpeg".to_string()
        },
    })
}

/// Render multiple PDF pages in a batch
/// More efficient for initial document load
#[tauri::command]
pub async fn render_pdf_pages_batch(
    file_path: String,
    page_numbers: Vec<usize>,
    target_width: Option<u32>,
    format: Option<ImageFormatPreference>,
) -> Result<Vec<PdfPageData>, String> {
    let pdfium = create_pdfium().map_err(|e| e.to_string())?;

    let document = pdfium
        .load_pdf_from_file(&file_path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let target_width: i32 = target_width.unwrap_or(1200) as i32;
    let format_pref = format.unwrap_or_default();

    let mut results = Vec::with_capacity(page_numbers.len());

    for page_number in page_numbers {
        let page_index = page_number as u16;
        let page = document
            .pages()
            .get(page_index)
            .map_err(|e| format!("Failed to get page {}: {}", page_number, e))?;

        let render_config = PdfRenderConfig::new()
            .set_target_width(target_width)
            .set_maximum_height(2000);

        let bitmap = page
            .render_with_config(&render_config)
            .map_err(|e| format!("Failed to render page {}: {}", page_number, e))?;

        let dynamic_image = bitmap.as_image();

        let encoded: EncodedImage = match format_pref {
            ImageFormatPreference::Png => image_encoder::encode_to_png_base64(dynamic_image)?,
            ImageFormatPreference::Jpeg => {
                image_encoder::encode_to_jpeg_base64(dynamic_image, JpegQuality::Medium)?
            }
            ImageFormatPreference::Auto => {
                image_encoder::encode_auto(dynamic_image, target_width as u32)?
            }
        };

        results.push(PdfPageData {
            page_number,
            data_url: encoded.data_url,
            width: encoded.width,
            height: encoded.height,
            size_bytes: encoded.size_bytes,
            format: if encoded.format == ImageFormat::Png {
                "png".to_string()
            } else {
                "jpeg".to_string()
            },
        });
    }

    Ok(results)
}

/// Get PDF document information
#[tauri::command]
pub async fn get_pdf_info(file_path: String) -> Result<PdfDocumentInfo, String> {
    let pdfium = create_pdfium().map_err(|e| e.to_string())?;

    let document = pdfium
        .load_pdf_from_file(&file_path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let pages = document.pages();
    let first_page = pages
        .get(0)
        .map_err(|e| format!("Failed to get first page: {}", e))?;

    // Extract metadata using correct API
    let metadata = document.metadata();
    let title = metadata
        .get(PdfDocumentMetadataTagType::Title)
        .map(|tag| tag.value().to_string());
    let author = metadata
        .get(PdfDocumentMetadataTagType::Author)
        .map(|tag| tag.value().to_string());

    Ok(PdfDocumentInfo {
        page_count: pages.len() as usize,
        title,
        author,
        page_width: first_page.width().value as f64,
        page_height: first_page.height().value as f64,
    })
}

/// Compare different encoding options for a PDF page
/// Useful for determining the best format for a specific document
#[tauri::command]
pub async fn compare_encodings(
    file_path: String,
    page_number: usize,
    target_width: Option<u32>,
) -> Result<EncodingComparison, String> {
    let pdfium = create_pdfium().map_err(|e| e.to_string())?;

    let document = pdfium
        .load_pdf_from_file(&file_path, None)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    let page_index = page_number as u16;
    let page = document
        .pages()
        .get(page_index)
        .map_err(|e| format!("Failed to get page: {}", e))?;

    let target_width: i32 = target_width.unwrap_or(1200) as i32;
    let render_config = PdfRenderConfig::new().set_target_width(target_width);

    let bitmap = page
        .render_with_config(&render_config)
        .map_err(|e| format!("Failed to render page: {}", e))?;

    let dynamic_image = bitmap.as_image();

    // Encode in all formats
    let png = image_encoder::encode_to_png_base64(dynamic_image.clone())?;
    let jpeg_low =
        image_encoder::encode_to_jpeg_base64(dynamic_image.clone(), JpegQuality::Low)?;
    let jpeg_medium =
        image_encoder::encode_to_jpeg_base64(dynamic_image.clone(), JpegQuality::Medium)?;
    let jpeg_high = image_encoder::encode_to_jpeg_base64(dynamic_image, JpegQuality::High)?;

    // Determine recommendation
    let recommended = if png.size_bytes < jpeg_medium.size_bytes * 2 {
        // PNG is not too much larger - use it for quality
        "png"
    } else {
        // JPEG is significantly smaller
        "jpeg"
    };

    Ok(EncodingComparison {
        page_number,
        png_size: png.size_bytes,
        jpeg_low_size: jpeg_low.size_bytes,
        jpeg_medium_size: jpeg_medium.size_bytes,
        jpeg_high_size: jpeg_high.size_bytes,
        recommended_format: recommended.to_string(),
    })
}
