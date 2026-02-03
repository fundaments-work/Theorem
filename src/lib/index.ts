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
