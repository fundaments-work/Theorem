import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './env';

export interface EpubPrefetchResult {
    container: string;
    opf_path: string;
    opf: string;
    nav_path?: string;
    nav?: string;
    ncx_path?: string;
    ncx?: string;
    encryption?: string;
    sizes: Record<string, number>;
}

export interface PrefetchCache {
    /** filename → decoded text (fast-path for loadText calls) */
    textCache: Map<string, string>;
    /** filename → uncompressed byte size (fast-path for getSize calls) */
    sizes: Map<string, number>;
}

/**
 * Prefetch OPF + nav/NCX + container XML bytes + entire zip size map from
 * the Rust native parser. On desktop/mobile Tauri this runs the zip in
 * parallel with @zip.js/zip.js's central-directory parse; the first to
 * return wins for the critical-path metadata, and zip sizes are serviced
 * instantly from the Rust-provided map.
 *
 * Returns null on failure so the caller falls through to the standard
 * zip.js path transparently.
 */
export async function tryNativePrefetchEpub(path: string): Promise<PrefetchCache | null> {
    if (!isTauri()) return null;
    try {
        const result: EpubPrefetchResult = await invoke('parse_epub_full', { path });
        const textCache = new Map<string, string>();

        // Inject the pre-decoded XML/HTML bytes under their real zip
        // entry paths so loadText() returns them without touching
        // zip.js at all.
        textCache.set('META-INF/container.xml', result.container);
        textCache.set(result.opf_path, result.opf);
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
