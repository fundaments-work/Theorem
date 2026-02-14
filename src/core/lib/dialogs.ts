import { ask, confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./env";

/**
 * Native Tauri Dialog Utilities
 * Provides native OS dialogs for confirmations, messages, and file operations
 */

interface ConfirmOptions {
    title?: string;
    message: string;
    okLabel?: string;
    cancelLabel?: string;
    kind?: "info" | "warning" | "error";
}

/**
 * Shows a native confirmation dialog and waits for user choice
 * @returns Promise<boolean> - true if user confirmed, false if cancelled
 */
export async function showConfirm(options: ConfirmOptions): Promise<boolean> {
    if (!isTauri()) {
        // Fallback for web mode
        return window.confirm(options.message);
    }

    try {
        const result = await confirm(options.message, {
            title: options.title || "Confirm",
            kind: options.kind || "warning",
            okLabel: options.okLabel || "OK",
            cancelLabel: options.cancelLabel || "Cancel",
        });
        return result;
    } catch (error) {
        console.error("Error showing confirmation dialog:", error);
        // Fallback to browser confirm
        return window.confirm(options.message);
    }
}

/**
 * Shows a native ask dialog (Yes/No) and waits for user choice
 * @returns Promise<boolean> - true if Yes, false if No
 */
export async function showAsk(options: ConfirmOptions): Promise<boolean> {
    if (!isTauri()) {
        return window.confirm(options.message);
    }

    try {
        const result = await ask(options.message, {
            title: options.title || "Question",
            kind: options.kind || "info",
            okLabel: options.okLabel || "Yes",
            cancelLabel: options.cancelLabel || "No",
        });
        return result;
    } catch (error) {
        console.error("Error showing ask dialog:", error);
        return window.confirm(options.message);
    }
}

interface MessageOptions {
    title?: string;
    message: string;
    kind?: "info" | "warning" | "error";
    okLabel?: string;
}

/**
 * Shows a native message dialog
 */
export async function showMessage(options: MessageOptions): Promise<void> {
    if (!isTauri()) {
        window.alert(options.message);
        return;
    }

    try {
        await message(options.message, {
            title: options.title || "Message",
            kind: options.kind || "info",
            okLabel: options.okLabel || "OK",
        });
    } catch (error) {
        console.error("Error showing message dialog:", error);
        window.alert(options.message);
    }
}

interface FileDialogOptions {
    title?: string;
    multiple?: boolean;
    filters?: { name: string; extensions: string[] }[];
    defaultPath?: string;
}

interface DirectoryDialogOptions {
    title?: string;
    defaultPath?: string;
    recursive?: boolean;
}

/**
 * Shows a native file open dialog
 * @returns Promise<string | string[] | null> - selected file path(s) or null if cancelled
 */
export async function showOpenFileDialog(options: FileDialogOptions = {}): Promise<string | string[] | null> {
    if (!isTauri()) {
        // Web fallback - create hidden file input
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = options.multiple || false;
            input.accept = options.filters?.map(f => f.extensions.map(e => `.${e}`).join(",")).join(",") || "*";
            
            input.onchange = () => {
                const files = Array.from(input.files || []);
                if (files.length === 0) {
                    resolve(null);
                } else if (options.multiple) {
                    resolve(files.map(f => f.name));
                } else {
                    resolve(files[0]?.name || null);
                }
            };
            
            input.oncancel = () => resolve(null);
            input.click();
        });
    }

    try {
        const result = await open({
            title: options.title || "Open File",
            multiple: options.multiple || false,
            filters: options.filters,
            defaultPath: options.defaultPath,
        });
        return result;
    } catch (error) {
        console.error("Error showing open file dialog:", error);
        return null;
    }
}

/**
 * Shows a native directory picker dialog
 * @returns Promise<string | null> - selected directory path or null if cancelled
 */
export async function showOpenDirectoryDialog(options: DirectoryDialogOptions = {}): Promise<string | null> {
    if (!isTauri()) {
        return null;
    }

    try {
        const result = await open({
            title: options.title || "Select Directory",
            defaultPath: options.defaultPath,
            directory: true,
            multiple: false,
            recursive: options.recursive ?? true,
        });
        if (Array.isArray(result)) {
            return result[0] ?? null;
        }
        return result;
    } catch (error) {
        console.error("Error showing directory picker dialog:", error);
        return null;
    }
}

interface SaveDialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
}

/**
 * Shows a native file save dialog
 * @returns Promise<string | null> - selected file path or null if cancelled
 */
export async function showSaveFileDialog(options: SaveDialogOptions = {}): Promise<string | null> {
    if (!isTauri()) {
        return null;
    }

    try {
        const result = await save({
            title: options.title || "Save File",
            defaultPath: options.defaultPath,
            filters: options.filters,
        });
        return result;
    } catch (error) {
        console.error("Error showing save file dialog:", error);
        return null;
    }
}

// Predefined confirmation helpers for common scenarios

/**
 * Confirmation for deleting a book
 */
export async function confirmDeleteBook(bookTitle: string): Promise<boolean> {
    return showConfirm({
        title: "Delete Book",
        message: `Are you sure you want to delete "${bookTitle}"? This action cannot be undone.`,
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

/**
 * Confirmation for clearing all data
 */
export async function confirmClearAllData(): Promise<boolean> {
    return showConfirm({
        title: "Clear All Data",
        message: "This will permanently delete all your books, highlights, notes, vocabulary, shelves, and settings. This action cannot be undone.",
        okLabel: "Clear Everything",
        cancelLabel: "Cancel",
        kind: "error",
    });
}

/**
 * Confirmation for removing a book from a shelf
 */
export async function confirmRemoveFromShelf(bookTitle: string, shelfName: string): Promise<boolean> {
    return showConfirm({
        title: "Remove from Shelf",
        message: `Remove "${bookTitle}" from "${shelfName}"?`,
        okLabel: "Remove",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

/**
 * Confirmation for deleting a shelf
 */
export async function confirmDeleteShelf(shelfName: string): Promise<boolean> {
    return showConfirm({
        title: "Delete Shelf",
        message: `Delete the shelf "${shelfName}"? Books in this shelf will remain in your library.`,
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

/**
 * Confirmation for deleting a bookmark
 */
export async function confirmDeleteBookmark(): Promise<boolean> {
    return showConfirm({
        title: "Delete Bookmark",
        message: "Are you sure you want to delete this bookmark?",
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}
