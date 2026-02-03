/**
 * Library Utilities Export
 */

export {
    cn,
    formatReadingTime,
    formatProgress,
    truncate,
    debounce,
    formatFileSize,
    formatRelativeDate,
} from "./utils";

export { isTauri, isMobile, isTouchDevice } from "./env";

export {
    saveBookData,
    getBookData,
    getBookBlob,
    deleteBookData,
    saveBookMetadata,
    getBookMetadata,
    getStorageStats,
} from "./storage";

export {
    getBookFormat,
    pickBookFiles,
    readBookFile,
    extractFilenameMetadata,
    createBookEntry,
    importBooks,
    pickAndImportBooks,
    scanFolderForBooks,
} from "./import";

export { flattenToc, findSectionAtFraction, buildSections } from "./toc";

export {
    applyReaderStyles,
    getEngineSettings,
    getSettingsChanges,
    createReaderCSS,
    initReaderStyles,
    getCurrentReaderSettings,
    getThemeColors,
    registerEngineStyleCallback,
} from "./reader-styles";

export {
    pdfApi,
    usePDF,
    type PdfInfo,
    type RenderOptions,
    type UsePDFReturn,
} from "./pdf-api";
