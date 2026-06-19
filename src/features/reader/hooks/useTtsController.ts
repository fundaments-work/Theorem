import { useRef, useCallback, useMemo } from "react";
import type { ReadAloudController } from "../components/ReadAloudBar";

export function useTtsController(getCurrentSectionText: () => string): ReadAloudController | null {
    const chunkIndexRef = useRef(0);
    const chunksRef = useRef<string[]>([]);

    const currentText = getCurrentSectionText();

    const chunks = useMemo(() => {
        if (!currentText) {
            chunksRef.current = [];
            chunkIndexRef.current = 0;
            return [] as string[];
        }
        const raw = currentText.split(/[.!?]+\s+/g).filter(Boolean);
        const sentences = raw.map((s) => s.trim()).filter(Boolean);
        chunksRef.current = sentences;
        chunkIndexRef.current = 0;
        return sentences;
    }, [currentText]);

    const getNextChunk = useCallback((): string | null => {
        if (chunkIndexRef.current >= chunks.length) return null;
        const chunk = chunks[chunkIndexRef.current];
        chunkIndexRef.current++;
        return chunk;
    }, [chunks]);

    const getPrevChunk = useCallback((): string | null => {
        if (chunkIndexRef.current <= 0) return null;
        chunkIndexRef.current--;
        return chunks[chunkIndexRef.current] ?? null;
    }, [chunks]);

    const getCurrentChunk = useCallback((): string | null => {
        if (chunkIndexRef.current >= chunks.length) return null;
        return chunks[chunkIndexRef.current] ?? null;
    }, [chunks]);

    return useMemo(() => ({
        getNextChunk,
        getPrevChunk,
        getCurrentChunk,
    }), [getNextChunk, getPrevChunk, getCurrentChunk]);
}

export default useTtsController;
