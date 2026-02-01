/**
 * Highlights Module
 * Text highlighting system components
 */

export { HighlightColorPicker } from './HighlightColorPicker';
export { NoteEditor } from './NoteEditor';

// Re-export service for external use
export { 
    HighlightService, 
    SVGOverlayer,
    HIGHLIGHT_COLORS,
    HIGHLIGHT_COLORS_DARK,
    highlightService 
} from '@/services/HighlightService';
