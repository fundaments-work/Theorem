const ZERO_WIDTH_OR_INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const NON_STANDARD_SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const UNCOMMON_LINE_BREAK_RE = /[\u0085\u2028\u2029]/g;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const SOFT_HYPHEN_RE = /\u00AD/g;
const SPACE_BEFORE_PUNCTUATION_RE = /\s+([,.!?;:])/g;
const ALPHABETIC_TOKEN_RE = /^[A-Za-z]+$/;
const SHORT_TOKEN_STOPWORDS = new Set([
    "a",
    "i",
    "an",
    "in",
    "on",
    "or",
    "to",
    "of",
    "at",
    "as",
    "is",
    "it",
    "be",
]);

function normalizeWhitespace(value: string): string {
    return value
        .replace(/\r\n?/g, "\n")
        .replace(UNCOMMON_LINE_BREAK_RE, "\n")
        .replace(SOFT_HYPHEN_RE, "")
        .replace(ZERO_WIDTH_OR_INVISIBLE_RE, "")
        .replace(NON_STANDARD_SPACE_RE, " ")
        .replace(CONTROL_CHAR_RE, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function repairSingleLetterRuns(value: string): string {
    return value.replace(/\b([A-Za-z](?:\s+[A-Za-z]){3,})\b/g, (match) => {
        const letters = match.split(/\s+/);
        const isAllUppercase = letters.every((letter) => letter === letter.toUpperCase());
        if (isAllUppercase) {
            return match;
        }
        return letters.join("");
    });
}

function isShortAlphabeticToken(token: string): boolean {
    return ALPHABETIC_TOKEN_RE.test(token) && token.length <= 2;
}

function shouldJoinShortTokenRun(run: string[]): boolean {
    if (run.length < 5) {
        return false;
    }

    const singleLetterCount = run.filter((token) => token.length === 1).length;
    if (singleLetterCount < 2) {
        return false;
    }

    const lowerCaseTokens = run.map((token) => token.toLowerCase());
    if (lowerCaseTokens.some((token) => SHORT_TOKEN_STOPWORDS.has(token))) {
        return false;
    }

    const isAllUppercase = run.every((token) => token === token.toUpperCase());
    return !isAllUppercase;
}

function repairShortTokenRuns(value: string): string {
    const tokens = value.split(" ");
    const rebuilt: string[] = [];
    let index = 0;

    while (index < tokens.length) {
        if (!isShortAlphabeticToken(tokens[index])) {
            rebuilt.push(tokens[index]);
            index += 1;
            continue;
        }

        const run: string[] = [];
        let cursor = index;
        while (cursor < tokens.length && isShortAlphabeticToken(tokens[cursor])) {
            run.push(tokens[cursor]);
            cursor += 1;
        }

        if (shouldJoinShortTokenRun(run)) {
            rebuilt.push(run.join(""));
        } else {
            rebuilt.push(...run);
        }

        index = cursor;
    }

    return rebuilt.join(" ");
}

function normalizeCardText(value: string): string {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
        return "";
    }

    const repairedSingleLetters = repairSingleLetterRuns(normalized);
    const repairedShortTokens = repairShortTokenRuns(repairedSingleLetters);

    return repairedShortTokens
        .replace(SPACE_BEFORE_PUNCTUATION_RE, "$1")
        .trim();
}

/**
 * Normalizes card text before persisting it.
 */
export function normalizeCardTextForStorage(value: string): string {
    return normalizeCardText(value);
}

/**
 * Normalizes card text before rendering it.
 */
export function normalizeCardTextForDisplay(value: string): string {
    return normalizeCardText(value);
}
