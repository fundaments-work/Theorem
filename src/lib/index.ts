/**
 * Library Exports
 */

// Storage utilities
export {
    saveBookData,
    getBookData,
    getBookBlob,
    deleteBookData,
    saveBookMetadata,
    getBookMetadata,
    getStorageStats,
    saveCoverImage,
    getCoverImage,
    deleteCoverImage,
} from "./storage";

// Environment detection
export { isTauri, isMobile } from "./env";

// Cover extraction
export {
    extractMetadata,
    extractCover,
    type ExtractedMetadata,
} from "./cover-extractor";

// Dialog utilities
export {
    showOpenFileDialog,
    showSaveFileDialog,
    showMessage,
    showConfirm,
} from "./dialogs";

// Design tokens
export {
    APP_THEME_PALETTES,
    DESIGN_TOKEN_VARS,
    DESIGN_TOKENS,
    HIGHLIGHT_COLOR_TOKENS,
    HIGHLIGHT_COLORS,
    HIGHLIGHT_COLORS_DARK,
    HIGHLIGHT_SOLID_COLORS,
    HIGHLIGHT_PICKER_COLORS,
    HIGHLIGHT_PICKER_ACTIVE_COLORS,
    SHELF_COLOR_PALETTE,
    READER_THEME_PREVIEWS,
    type ThemeSemanticPalette,
    type DesignTokenVars,
    type HighlightColorToken,
    type ShelfColorToken,
} from "./design-tokens";
