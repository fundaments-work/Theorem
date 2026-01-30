/**
 * Document Engines
 * Provides unified rendering for different document formats
 */

// EPUB.js engine - Fast rendering with proper pagination
export { EpubjsEngine } from './epubjs-engine'

// Types
export type { DocLocation, TocItem, DocMetadata, ThemeSettings, HighlightColor } from '@/types'

// DEFAULT: Use EpubjsEngine for better performance
export { EpubjsEngine as default } from './epubjs-engine'
