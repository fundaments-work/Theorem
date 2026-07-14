import { ask, confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { isMobile, isTauri } from "./env";

interface ConfirmOptions {
    title?: string;
    message: string;
    okLabel?: string;
    cancelLabel?: string;
    kind?: "info" | "warning" | "error";
}

export async function showConfirm(options: ConfirmOptions): Promise<boolean> {
    if (!isTauri()) {
        
        return window.confirm(options.message);
    }

    try {
        const result = await confirm(options.message, {
            title: options.title,
            kind: options.kind || "warning",
            okLabel: options.okLabel || "OK",
            cancelLabel: options.cancelLabel || "Cancel",
        });
        return result;
    } catch (error) {
        
        return window.confirm(options.message);
    }
}

export async function showAsk(options: ConfirmOptions): Promise<boolean> {
    if (!isTauri()) {
        return window.confirm(options.message);
    }

    try {
        const result = await ask(options.message, {
            title: options.title,
            kind: options.kind || "info",
            okLabel: options.okLabel || "Yes",
            cancelLabel: options.cancelLabel || "No",
        });
        return result;
    } catch (error) {
        return window.confirm(options.message);
    }
}

interface MessageOptions {
    title?: string;
    message: string;
    kind?: "info" | "warning" | "error";
    okLabel?: string;
}

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

export async function showOpenFileDialog(options: FileDialogOptions = {}): Promise<string | string[] | null> {
    if (!isTauri()) {
        
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
        return null;
    }
}

export async function showOpenDirectoryDialog(options: DirectoryDialogOptions = {}): Promise<string | null> {
    if (!isTauri()) {
        return null;
    }
    if (isMobile()) {
        return null;
    }

    try {
        const result = await open({
            title: options.title || "Select Directory",
            defaultPath: options.defaultPath,
            directory: true,
            multiple: false,
            recursive: options.recursive ?? true,
            fileAccessMode: "scoped",
        });
        if (Array.isArray(result)) {
            return result[0] ?? null;
        }
        return result;
    } catch (error) {
        return null;
    }
}

interface SaveDialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
}

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
        return null;
    }
}

export async function confirmDeleteBook(bookTitle: string): Promise<boolean> {
    return showConfirm({
        message: `Are you sure you want to delete "${bookTitle}"? This action cannot be undone.`,
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

export async function confirmClearAllData(): Promise<boolean> {
    return showConfirm({
        message: "This will permanently delete all your books, highlights, notes, vocabulary, shelves, and settings. This action cannot be undone.",
        okLabel: "Clear Everything",
        cancelLabel: "Cancel",
        kind: "error",
    });
}

export async function confirmRemoveFromShelf(bookTitle: string, shelfName: string): Promise<boolean> {
    return showConfirm({
        message: `Remove "${bookTitle}" from "${shelfName}"?`,
        okLabel: "Remove",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

export async function confirmDeleteShelf(shelfName: string): Promise<boolean> {
    return showConfirm({
        message: `Delete the shelf "${shelfName}"? Books in this shelf will remain in your library.`,
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

export async function confirmDeleteBookmark(): Promise<boolean> {
    return showConfirm({
        message: "Are you sure you want to delete this bookmark?",
        okLabel: "Delete",
        cancelLabel: "Keep",
        kind: "warning",
    });
}

export async function confirmRemoveDictionary(dictionaryName: string): Promise<boolean> {
    return showConfirm({
        message: `Remove "${dictionaryName}"? Offline word lookups from this dictionary will stop working.`,
        okLabel: "Remove",
        cancelLabel: "Keep",
        kind: "warning",
    });
}
