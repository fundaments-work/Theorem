/**
 * PDF.js configuration for Tauri v2
 * 
 * This file provides a placeholder for PDF.js configuration.
 * The actual initialization is done dynamically in pdfjs-engine.tsx
 * to avoid issues with worker loading in different environments.
 */

// Re-export types for convenience
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// Placeholder - actual initialization happens in the component
export const PDFJS_VERSION = "4.10.38";
