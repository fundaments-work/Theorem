import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './env';

export interface EpubPrefetchResult {
    container?: string;
    opf_path?: string;
    opf?: string;
    nav_path?: string;
    nav?: string;
    ncx_path?: string;
    ncx?: string;
    encryption?: string;
    sizes: Record<string, number>;
}

export interface PrefetchCache {
    textCache: Map<string, string>;
    sizes: Map<string, number>;
}

/**
 * Opens the book zip in Rust, returns the uncompressed-size map for EVERY
 * entry (works for all zip-based formats: EPUB, CBZ, FBZ) plus, for EPUB
 * files, pre-decoded container/OPF/nav/NCX/encryption text.
 *
 * On Tauri desktop/mobile, zip.js getEntries() and this command run in
 * parallel; the first to return wins for the critical path. For CBZ/FBZ
 * the sizes map alone makes getSize() instant for every entry.
 *
 * Returns null on any failure so the caller falls through to the zip.js
 * path transparently.
 */
export async function tryNativePrefetchEpub(path: string): Promise<PrefetchCache | null> {
    if (!isTauri()) return null;
    try {
        const result: EpubPrefetchResult = await invoke('prefetch_zip_metadata', { path });
        const textCache = new Map<string, string>();

        if (result.container) {
            textCache.set('META-INF/container.xml', result.container);
        }
        if (result.opf_path && result.opf) {
            textCache.set(result.opf_path, result.opf);
        }
        if (result.nav_path && result.nav) {
            textCache.set(result.nav_path, result.nav);
        }
        if (result.ncx_path && result.ncx) {
            textCache.set(result.ncx_path, result.ncx);
        }
        if (result.encryption) {
            textCache.set('META-INF/encryption.xml', result.encryption);
        }

        const sizes = new Map<string, number>(Object.entries(result.sizes));

        return { textCache, sizes };
    } catch {
        return null;
    }
}
