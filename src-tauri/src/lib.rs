/**
 * Tauri Library Module
 *
 * Exports image encoding utilities and PDF commands for the Tauri application.
 */

pub mod image_encoder;
pub mod pdf_commands;

use pdf_commands::PdfState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        // Manage PDF state for state-based commands
        .manage(PdfState::new())
        // Register PDF commands
        .invoke_handler(tauri::generate_handler![
            // State-based PDF commands
            pdf_commands::pdf_load,
            pdf_commands::pdf_render_page,
            pdf_commands::pdf_get_info,
            pdf_commands::pdf_close,
            // Legacy PDF commands (for backward compatibility)
            pdf_commands::initialize_pdfium,
            pdf_commands::render_pdf_page,
            pdf_commands::render_pdf_pages_batch,
            pdf_commands::get_pdf_info,
            pdf_commands::compare_encodings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Re-exports for binary targets
pub use image_encoder::{
    encode_auto, encode_to_jpeg_base64, encode_to_jpeg_base64_with_quality,
    encode_to_png_base64, encode_to_png_base64_with_settings, EncodedImage, JpegQuality,
};

/// Re-export PDF types for external use
pub use pdf_commands::{PdfError, PdfInfo};
