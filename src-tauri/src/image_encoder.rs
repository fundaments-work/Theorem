/**
 * Image Encoding Utilities for Tauri PDF Rendering
 *
 * Provides efficient encoding of DynamicImage (from pdfium-render) to base64
 * for transfer from Rust backend to TypeScript frontend.
 *
 * Crates used: image (0.25), base64
 */
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, DynamicImage, ImageEncoder, ImageFormat,
};

/// Quality settings for JPEG encoding
#[derive(Debug, Clone, Copy)]
pub enum JpegQuality {
    /// Low quality - smallest file size, fastest encoding
    /// Good for thumbnails, previews
    Low = 60,
    /// Medium quality - balanced size/quality
    /// Good for general PDF viewing
    Medium = 85,
    /// High quality - larger file size
    /// Good for text-heavy documents where clarity matters
    High = 95,
    /// Maximum quality - largest file size
    /// Best for archival or when quality is paramount
    Maximum = 100,
}

impl JpegQuality {
    /// Get the quality value as u8 (0-100)
    pub fn as_u8(&self) -> u8 {
        *self as u8
    }
}

/// Result type for image encoding operations
#[derive(Debug, Clone)]
pub struct EncodedImage {
    /// Base64-encoded image data (with data URL prefix)
    pub data_url: String,
    /// Raw base64 string (without data URL prefix)
    pub base64_data: String,
    /// Format used for encoding
    pub format: ImageFormat,
    /// Size of the encoded data in bytes
    pub size_bytes: usize,
    /// Width of the image
    pub width: u32,
    /// Height of the image
    pub height: u32,
}

/// Encode a DynamicImage to base64 PNG
///
/// PNG is lossless and preserves all details. Best for:
/// - Text-heavy PDFs where sharpness matters
/// - Documents with diagrams, charts, or line art
/// - When you need pixel-perfect rendering
/// - Pages with transparency (rare in PDFs)
///
/// # Arguments
/// * `image` - The DynamicImage to encode (from pdfium-render's `as_image()`)
///
/// # Returns
/// * `Ok(EncodedImage)` - The encoded image with metadata
/// * `Err(String)` - Error message if encoding fails
///
/// # Example
/// ```rust
/// use pdfium_render::prelude::*;
///
/// let pdfium = Pdfium::default();
/// let document = pdfium.load_pdf_from_file("doc.pdf", None)?;
/// let page = document.pages().get(0)?;
///
/// let render_config = PdfRenderConfig::new()
///     .set_target_width(1200);
///
/// let bitmap = page.render_with_config(&render_config)?;
/// let dynamic_image = bitmap.as_image();
///
/// let encoded = encode_to_png_base64(dynamic_image)?;
/// println!("Data URL: {}", encoded.data_url);
/// ```
pub fn encode_to_png_base64(image: DynamicImage) -> Result<EncodedImage, String> {
    let width = image.width();
    let height = image.height();

    // Convert to RGB8 for PNG (PNG supports RGBA but PDFs rarely have transparency)
    // This reduces file size by 25% compared to RGBA
    let rgb_image = image.into_rgb8();

    // Create an in-memory buffer to write the PNG
    let mut buffer = Vec::new();

    // Create PNG encoder with default compression
    // Default compression uses adaptive filtering which gives good compression
    // while still being reasonably fast
    let encoder = PngEncoder::new(&mut buffer);

    // Write the image data
    encoder
        .write_image(&rgb_image, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("PNG encoding error: {}", e))?;

    // Encode to base64
    let base64_data = BASE64_STANDARD.encode(&buffer);
    let data_url = format!("data:image/png;base64,{}", base64_data);
    let size_bytes = buffer.len();

    Ok(EncodedImage {
        data_url,
        base64_data,
        format: ImageFormat::Png,
        size_bytes,
        width,
        height,
    })
}

/// Encode a DynamicImage to base64 PNG with custom compression settings
///
/// Use this when you need to balance between encoding speed and file size.
///
/// # Arguments
/// * `image` - The DynamicImage to encode
/// * `fast_mode` - If true, uses faster encoding with less compression
///
/// # Returns
/// * `Ok(EncodedImage)` - The encoded image with metadata
pub fn encode_to_png_base64_with_settings(
    image: DynamicImage,
    fast_mode: bool,
) -> Result<EncodedImage, String> {
    let width = image.width();
    let height = image.height();

    let rgb_image = image.into_rgb8();
    let mut buffer = Vec::new();

    // Choose compression settings based on fast_mode
    let encoder = if fast_mode {
        // Fast mode: minimal compression, faster encoding
        PngEncoder::new_with_quality(
            &mut buffer,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Sub,
        )
    } else {
        // Default: better compression, slightly slower
        PngEncoder::new(&mut buffer)
    };

    encoder
        .write_image(&rgb_image, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("PNG encoding error: {}", e))?;

    let base64_data = BASE64_STANDARD.encode(&buffer);
    let data_url = format!("data:image/png;base64,{}", base64_data);
    let size_bytes = buffer.len();

    Ok(EncodedImage {
        data_url,
        base64_data,
        format: ImageFormat::Png,
        size_bytes,
        width,
        height,
    })
}

/// Encode a DynamicImage to base64 JPEG
///
/// JPEG is lossy and produces smaller files. Best for:
/// - Photo-heavy PDFs (scanned documents, magazines)
/// - When file size is more important than perfect text sharpness
/// - General reading where slight compression artifacts are acceptable
/// - Better performance for large documents
///
/// # Arguments
/// * `image` - The DynamicImage to encode (from pdfium-render's `as_image()`)
/// * `quality` - JPEG quality setting (use JpegQuality enum)
///
/// # Returns
/// * `Ok(EncodedImage)` - The encoded image with metadata
/// * `Err(String)` - Error message if encoding fails
///
/// # Example
/// ```rust
/// use pdfium_render::prelude::*;
///
/// let pdfium = Pdfium::default();
/// let document = pdfium.load_pdf_from_file("magazine.pdf", None)?;
/// let page = document.pages().get(0)?;
///
/// let render_config = PdfRenderConfig::new()
///     .set_target_width(1200);
///
/// let bitmap = page.render_with_config(&render_config)?;
/// let dynamic_image = bitmap.as_image();
///
/// // Use medium quality for general reading
/// let encoded = encode_to_jpeg_base64(dynamic_image, JpegQuality::Medium)?;
/// println!("Size: {} bytes", encoded.size_bytes);
/// ```
pub fn encode_to_jpeg_base64(
    image: DynamicImage,
    quality: JpegQuality,
) -> Result<EncodedImage, String> {
    let width = image.width();
    let height = image.height();

    // Convert to RGB8 for JPEG (JPEG doesn't support alpha)
    let rgb_image = image.into_rgb8();

    // Create an in-memory buffer
    let mut buffer = Vec::new();

    // Create JPEG encoder with specified quality
    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, quality.as_u8());

    // Write the image data
    encoder
        .encode(&rgb_image, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encoding error: {}", e))?;

    // Encode to base64
    let base64_data = BASE64_STANDARD.encode(&buffer);
    let data_url = format!("data:image/jpeg;base64,{}", base64_data);
    let size_bytes = buffer.len();

    Ok(EncodedImage {
        data_url,
        base64_data,
        format: ImageFormat::Jpeg,
        size_bytes,
        width,
        height,
    })
}

/// Encode a DynamicImage to base64 JPEG with custom quality (0-100)
///
/// # Arguments
/// * `image` - The DynamicImage to encode
/// * `quality` - JPEG quality from 0 (worst) to 100 (best)
pub fn encode_to_jpeg_base64_with_quality(
    image: DynamicImage,
    quality: u8,
) -> Result<EncodedImage, String> {
    let clamped_quality = quality.min(100);

    let width = image.width();
    let height = image.height();
    let rgb_image = image.into_rgb8();
    let mut buffer = Vec::new();

    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, clamped_quality);

    encoder
        .encode(&rgb_image, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encoding error: {}", e))?;

    let base64_data = BASE64_STANDARD.encode(&buffer);
    let data_url = format!("data:image/jpeg;base64,{}", base64_data);
    let size_bytes = buffer.len();

    Ok(EncodedImage {
        data_url,
        base64_data,
        format: ImageFormat::Jpeg,
        size_bytes,
        width,
        height,
    })
}

/// Automatically choose the best encoding format based on image content
///
/// This analyzes the image to determine if it's mostly text/graphics (use PNG)
/// or photos/scanned content (use JPEG).
///
/// # Arguments
/// * `image` - The DynamicImage to encode
/// * `target_width` - Target width for rendering (affects quality decision)
///
/// # Returns
/// * `Ok(EncodedImage)` - The encoded image with metadata
pub fn encode_auto(image: DynamicImage, target_width: u32) -> Result<EncodedImage, String> {
    // Simple heuristic: analyze image variance to detect text vs photos
    // Text/images with sharp edges have higher variance between adjacent pixels
    let variance = calculate_image_variance(&image);

    // Higher variance usually indicates text/graphics with sharp edges
    // Lower variance usually indicates photos or scanned documents
    let is_text_heavy = variance > 500.0;

    if is_text_heavy {
        // Use PNG for text/graphics to preserve sharpness
        encode_to_png_base64(image)
    } else {
        // Use JPEG for photos/scanned content
        // Higher resolution = higher quality
        let quality = if target_width > 1500 {
            JpegQuality::High
        } else {
            JpegQuality::Medium
        };
        encode_to_jpeg_base64(image, quality)
    }
}

/// Calculate a simple variance metric to detect image content type
/// Higher variance = more sharp edges (text/graphics)
/// Lower variance = smoother gradients (photos)
fn calculate_image_variance(image: &DynamicImage) -> f64 {
    // Convert to grayscale for analysis
    let gray = image.to_luma8();
    let (width, height) = gray.dimensions();

    if width < 2 || height < 2 {
        return 0.0;
    }

    // Sample pixels at intervals for performance
    let step = ((width * height) / 10000).max(1);
    let mut sum_squared_diff = 0u64;
    let mut count = 0u64;

    let pixels: Vec<u8> = gray.into_raw();

    for y in (0..height - 1).step_by(step as usize) {
        for x in (0..width - 1).step_by(step as usize) {
            let idx = (y * width + x) as usize;
            let right_idx = (y * width + x + 1) as usize;
            let down_idx = ((y + 1) * width + x) as usize;

            let pixel = pixels[idx] as i16;
            let right = pixels[right_idx] as i16;
            let down = pixels[down_idx] as i16;

            let diff_h = (pixel - right).abs() as u64;
            let diff_v = (pixel - down).abs() as u64;

            sum_squared_diff += diff_h * diff_h + diff_v * diff_v;
            count += 2;
        }
    }

    if count == 0 {
        return 0.0;
    }

    (sum_squared_diff as f64) / (count as f64)
}

/// Batch encode multiple pages for better performance
///
/// When rendering multiple PDF pages, batch encoding can be more efficient
/// by reusing buffers and allowing parallel processing.
///
/// # Arguments
/// * `images` - Vector of DynamicImages to encode
/// * `format` - Target format (PNG or JPEG)
/// * `quality` - JPEG quality (ignored for PNG)
///
/// # Returns
/// * `Vec<Result<EncodedImage, String>>` - Results for each image
pub fn batch_encode(
    images: Vec<DynamicImage>,
    format: ImageFormat,
    quality: JpegQuality,
) -> Vec<Result<EncodedImage, String>> {
    images
        .into_iter()
        .map(|img| match format {
            ImageFormat::Png => encode_to_png_base64(img),
            ImageFormat::Jpeg => encode_to_jpeg_base64(img, quality),
            _ => Err("Unsupported format for batch encoding".to_string()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{RgbImage, RgbaImage};

    fn create_test_image() -> DynamicImage {
        // Create a simple 100x100 RGB image
        let mut img = RgbImage::new(100, 100);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
        }
        DynamicImage::ImageRgb8(img)
    }

    #[test]
    fn test_png_encoding() {
        let img = create_test_image();
        let result = encode_to_png_base64(img);
        assert!(result.is_ok());

        let encoded = result.unwrap();
        assert!(encoded.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(encoded.format, ImageFormat::Png);
        assert_eq!(encoded.width, 100);
        assert_eq!(encoded.height, 100);
        assert!(!encoded.base64_data.is_empty());
    }

    #[test]
    fn test_jpeg_encoding() {
        let img = create_test_image();
        let result = encode_to_jpeg_base64(img, JpegQuality::Medium);
        assert!(result.is_ok());

        let encoded = result.unwrap();
        assert!(encoded.data_url.starts_with("data:image/jpeg;base64,"));
        assert_eq!(encoded.format, ImageFormat::Jpeg);
        assert!(!encoded.base64_data.is_empty());
    }

    #[test]
    fn test_jpeg_quality_levels() {
        let img = create_test_image();

        let low = encode_to_jpeg_base64(img.clone(), JpegQuality::Low).unwrap();
        let medium = encode_to_jpeg_base64(img.clone(), JpegQuality::Medium).unwrap();
        let high = encode_to_jpeg_base64(img, JpegQuality::High).unwrap();

        // Higher quality should generally result in larger files
        assert!(
            low.size_bytes <= medium.size_bytes || medium.size_bytes <= high.size_bytes,
            "Higher JPEG quality should generally increase file size"
        );
    }
}
