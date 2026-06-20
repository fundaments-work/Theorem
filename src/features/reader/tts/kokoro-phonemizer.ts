/**
 * Kokoro phonemizer — converts English text to Kokoro token IDs.
 *
 * Uses the Kokoro v1.0 vocab (hardcoded, identical to tokenizer.json).
 * Character-level mapping — for best quality install espeak-ng and use
 * a full G2P phonemizer. Character-level still produces intelligible speech.
 */
const SPACE_ID = 16;

/**
 * Convert English text to Kokoro token IDs using character-level mapping.
 */
export function textToTokens(text: string): number[] {
    const ids: number[] = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === " " || ch === "\n" || ch === "\t") {
            if (ids.length > 0 && ids[ids.length - 1] !== SPACE_ID) {
                ids.push(SPACE_ID);
            }
            continue;
        }

        const id = KOKORO_VOCAB[ch];
        if (id !== undefined) {
            ids.push(id);
        } else {
            // Unknown character → skip
        }
    }

    // Trim to max 508 tokens (512 context window minus 2 for padding)
    return ids.slice(0, 508);
}

/**
 * Split text into sentences for streaming TTS.
 * Each chunk fits within the model's 510-token context window.
 */
export function splitIntoSentences(text: string, maxChars = 400): string[] {
    const raw = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const sentence of raw) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        if (current.length + trimmed.length + 1 <= maxChars) {
            current += (current ? " " : "") + trimmed;
        } else {
            if (current) chunks.push(current.trim());
            current = trimmed;
        }
    }

    if (current) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

// Hardcoded Kokoro v1.0 vocab as fallback
const KOKORO_VOCAB: Record<string, number> = {
    ";": 1, ":": 2, ",": 3, ".": 4, "!": 5, "?": 6,
    "—": 9, "…": 10, '"': 11, "(": 12, ")": 13, "\u201c": 14, "\u201d": 15,
    " ": 16, "\u0303": 17, "\u02a3": 18, "\u02a5": 19, "\u02a6": 20, "\u02a8": 21,
    "A": 24, "I": 25, "O": 31, "Q": 33, "S": 35, "T": 36, "W": 39, "Y": 41,
    "a": 43, "b": 44, "c": 45, "d": 46, "e": 47, "f": 48, "h": 50,
    "i": 51, "j": 52, "k": 53, "l": 54, "m": 55, "n": 56, "o": 57,
    "p": 58, "q": 59, "r": 60, "s": 61, "t": 62, "u": 63, "v": 64,
    "w": 65, "x": 66, "y": 67, "z": 68,
    "\u0251": 69, "\u0250": 70, "\u0252": 71, "\u00e6": 72,
    "\u03b2": 75, "\u0254": 76, "\u0255": 77, "\u00e7": 78,
    "\u0256": 80, "\u00f0": 81, "\u02a4": 82, "\u0259": 83,
    "\u025a": 85, "\u025b": 86, "\u025c": 87,
    "\u025f": 90, "\u0261": 92,
    "\u0265": 99, "\u0268": 101, "\u026a": 102, "\u029d": 103,
    "\u026f": 110, "\u0270": 111, "\u014b": 112, "\u0273": 113, "\u0272": 114, "\u0274": 115,
    "\u00f8": 116, "\u0278": 118, "\u03b8": 119, "\u0153": 120,
    "\u0279": 123, "\u027e": 125, "\u027b": 126,
    "\u0281": 128, "\u027d": 129, "\u0282": 130, "\u0283": 131,
    "\u0288": 132, "\u02a7": 133, "\u028a": 135, "\u028b": 136,
    "\u028c": 138, "\u0263": 139, "\u0264": 140,
    "\u03c7": 142, "\u028e": 143, "\u0292": 147, "\u0294": 148,
    "\u02c8": 156, "\u02cc": 157, "\u02d0": 158,
    "\u02b0": 162, "\u02b2": 164,
    "\u2193": 169, "\u2192": 171, "\u2197": 172, "\u2198": 173,
    "\u1d7b": 177,
};
