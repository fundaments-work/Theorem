#!/usr/bin/env python3
"""Strip comments from source files.

For TS/TSX/JS: remove all comments (//, /* */, /** */, {/* */}) including JSDoc.
               Handle string, template, and regex literals correctly.
For CSS: remove /* */ comments.
For Rust: remove all comments (//, ///, //!, /* */, /** */).
"""

import os
from pathlib import Path

EXCLUDE_DIRS = {"target", "gen", "node_modules", ".git"}
EXCLUDE_PATTERNS = [
    "src/features/reader/foliate-js/",
    "src/features/reader/foliate-js-runtime/vendor/",
]

RE_OPENER = set("=([,!:&|?;{~%^*-+/")


def is_excluded(path: str) -> bool:
    return any(p in path for p in EXCLUDE_PATTERNS)


def _last_nw(lst):
    for c in reversed(lst):
        if not c.isspace() and c not in "\n\r":
            return c
    return ""


def _last_two_nw(chars):
    nw = []
    for c in reversed(chars):
        if not c.isspace() and c not in "\n\r":
            nw.append(c)
            if len(nw) == 2:
                break
    return nw


def strip_ts_js(code):
    """Strip all comments from TS/TSX/JS code including JSDoc."""
    result = []
    i = 0
    n = len(code)

    def is_regex_start():
        last = _last_nw(result)
        if not last:
            return True
        if last in RE_OPENER:
            return True
        # > can be from => (arrow fn, should allow regex) or /> (JSX close, should not)
        if last == ">":
            last_two = _last_two_nw(result)
            if len(last_two) >= 2 and last_two[1] == "=":
                return True  # => /regex/ - arrow function
            return False  # /> or </tag> in JSX
        if last.isdigit() or last.isalpha() or last in (")", "]", "}", "<"):
            return False
        if last in ("'", '"', "`"):
            return False
        return True

    while i < n:
        c = code[i]

        # --- String literal "..." ---
        if c == '"':
            result.append('"')
            i += 1
            while i < n:
                if code[i] == "\\" and i + 1 < n:
                    result.append(code[i])
                    result.append(code[i + 1])
                    i += 2
                elif code[i] == '"':
                    result.append('"')
                    i += 1
                    break
                else:
                    result.append(code[i])
                    i += 1
            continue

        # --- String literal '...' ---
        if c == "'":
            result.append("'")
            i += 1
            while i < n:
                if code[i] == "\\" and i + 1 < n:
                    result.append(code[i])
                    result.append(code[i + 1])
                    i += 2
                elif code[i] == "'":
                    result.append("'")
                    i += 1
                    break
                else:
                    result.append(code[i])
                    i += 1
            continue

        # --- Template literal `...` ---
        if c == "`":
            result.append("`")
            i += 1
            while i < n:
                if code[i] == "\\" and i + 1 < n:
                    result.append(code[i])
                    result.append(code[i + 1])
                    i += 2
                elif code[i] == "`":
                    result.append("`")
                    i += 1
                    break
                elif code[i] == "$" and i + 1 < n and code[i + 1] == "{":
                    result.append("$")
                    result.append("{")
                    i += 2
                    depth = 1
                    while i < n and depth > 0:
                        if code[i] == "{":
                            depth += 1
                        elif code[i] == "}":
                            depth -= 1
                            if depth == 0:
                                result.append("}")
                                i += 1
                                break
                            result.append(code[i])
                        else:
                            result.append(code[i])
                        i += 1
                    continue
                else:
                    result.append(code[i])
                    i += 1
            continue

        # --- Regex literal /.../ ---
        if c == "/" and i + 1 < n and code[i + 1] not in ("/", "*") and is_regex_start():
            result.append("/")
            i += 1
            in_regex = True
            while i < n and in_regex:
                if code[i] == "\\" and i + 1 < n:
                    result.append(code[i])
                    result.append(code[i + 1])
                    i += 2
                elif code[i] == "[":
                    # Character class — skip to ] without treating / as delimiter
                    result.append("[")
                    i += 1
                    while i < n and code[i] != "]":
                        if code[i] == "\\" and i + 1 < n:
                            result.append(code[i])
                            result.append(code[i + 1])
                            i += 2
                        else:
                            result.append(code[i])
                            i += 1
                    if i < n:
                        result.append("]")
                        i += 1
                elif code[i] == "/":
                    result.append("/")
                    i += 1
                    while i < n and code[i].isalpha():
                        result.append(code[i])
                        i += 1
                    in_regex = False
                else:
                    result.append(code[i])
                    i += 1
            continue

        # --- JSX comment {/* ... */} ---
        if c == "{" and i + 3 < n and code[i + 1] == "/" and code[i + 2] == "*":
            # {/* ... */} and {/** ... */} — remove both
            j = i + 3
            while j + 1 < n:
                if code[j] == "*" and code[j + 1] == "/":
                    i = j + 2
                    break
                j += 1
            else:
                result.append(c)
                i += 1
                continue
            if i < n and code[i] == "}":
                i += 1
            continue

        # --- Block comment /* ... */ or /** ... */ — remove ---
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = i + 2
            depth = 1
            while j + 1 < n and depth > 0:
                if code[j] == "/" and code[j + 1] == "*":
                    depth += 1
                    j += 2
                elif code[j] == "*" and code[j + 1] == "/":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            i = j
            continue

        # --- Line comment // — remove (but preserve /// <reference directives) ---
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            # Preserve TypeScript triple-slash directives like /// <reference types="..." />
            if i + 2 < n and code[i + 2] == "/":
                # Copy the entire directive line
                while i < n and code[i] != "\n":
                    result.append(code[i])
                    i += 1
                if i < n:
                    result.append(code[i])
                    i += 1
                continue
            j = i + 2
            while j < n and code[j] != "\n":
                j += 1
            result.append("\n")
            i = j + 1 if j < n else j
            continue

        result.append(c)
        i += 1

    output = "".join(result)
    # Clean up consecutive blank lines
    cleaned = []
    prev_blank = False
    for line in output.split("\n"):
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        cleaned.append(line)
        prev_blank = is_blank
    return "\n".join(cleaned)


def strip_rust(code):
    """Strip all Rust comments (//, ///, //!, /* */, /** */)."""
    result = []
    i = 0
    n = len(code)

    while i < n:
        c = code[i]

        # String literal
        if c == '"':
            result.append('"')
            i += 1
            while i < n:
                if code[i] == "\\" and i + 1 < n:
                    result.append(code[i])
                    result.append(code[i + 1])
                    i += 2
                elif code[i] == '"':
                    result.append('"')
                    i += 1
                    break
                else:
                    result.append(code[i])
                    i += 1
            continue

        # Raw string r"...", r#"..."#
        if c == "r" and i + 1 < n and code[i + 1] == '"':
            result.append("r")
            i += 1
            hashes = 0
            while i < n and code[i] == "#":
                result.append("#")
                hashes += 1
                i += 1
            if i < n and code[i] == '"':
                result.append('"')
                i += 1
                close_hashes = 0
                while i < n:
                    result.append(code[i])
                    if code[i] == '"':
                        j = i + 1
                        while j < n and code[j] == "#" and close_hashes < hashes:
                            close_hashes += 1
                            result.append(code[j])
                            j += 1
                        if close_hashes == hashes:
                            i = j
                            break
                        close_hashes = 0
                        i = j
                        continue
                    i += 1
            continue

        # Character literal
        if c == "'" and i + 2 < n:
            nc = code[i + 1]
            if nc == "\\" and i + 3 < n:
                result.append(code[i])
                result.append(code[i + 1])
                result.append(code[i + 2])
                i += 3
                if i < n and code[i] == "'":
                    result.append("'")
                    i += 1
                continue
            elif nc != "'" and code[i + 2] == "'":
                result.append(code[i])
                result.append(code[i + 1])
                result.append(code[i + 2])
                i += 3
                continue

        # Line comment // (///, //!) — remove
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            j = i + 2
            while j < n and code[j] != "\n":
                j += 1
            result.append("\n")
            i = j + 1 if j < n else j
            continue

        # Block comment /* */ or /** */ — remove
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = i + 2
            depth = 1
            while j + 1 < n and depth > 0:
                if code[j] == "/" and code[j + 1] == "*":
                    depth += 1
                    j += 2
                elif code[j] == "*" and code[j + 1] == "/":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            i = j
            continue

        result.append(c)
        i += 1

    output = "".join(result)
    cleaned = []
    prev_blank = False
    for line in output.split("\n"):
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        cleaned.append(line)
        prev_blank = is_blank
    return "\n".join(cleaned)


def strip_css(code):
    """Strip /* */ comments from CSS."""
    result = []
    i = 0
    n = len(code)

    while i < n:
        c = code[i]
        if c in ('"', "'"):
            result.append(c)
            i += 1
            while i < n and code[i] != c:
                result.append(code[i])
                i += 1
            if i < n:
                result.append(code[i])
                i += 1
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = i + 2
            while j + 1 < n:
                if code[j] == "*" and code[j + 1] == "/":
                    i = j + 2
                    break
                j += 1
            else:
                result.append(c)
                i += 1
            continue
        result.append(c)
        i += 1

    return "".join(result)


def process_file(filepath):
    ext = os.path.splitext(filepath)[1]
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        original = f.read()

    if ext in (".ts", ".tsx", ".js", ".jsx"):
        stripped = strip_ts_js(original)
    elif ext == ".rs":
        stripped = strip_rust(original)
    elif ext == ".css":
        stripped = strip_css(original)
    else:
        return False

    if stripped != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(stripped)
        return True
    return False


def main():
    root = Path(__file__).resolve().parent.parent
    changed = 0
    total = 0
    extensions = (".ts", ".tsx", ".js", ".jsx", ".css")

    for f in (root / "src").rglob("*"):
        if f.suffix not in extensions:
            continue
        if is_excluded(str(f.relative_to(root))):
            continue
        total += 1
        if process_file(str(f)):
            changed += 1
            print(f"  {f.relative_to(root)}")

    for f in (root / "src-tauri").rglob("*.rs"):
        rel = str(f.relative_to(root))
        if any(ex in rel for ex in EXCLUDE_DIRS):
            continue
        total += 1
        if process_file(str(f)):
            changed += 1
            print(f"  {rel}")

    print(f"\nProcessed {total} files, {changed} modified")


if __name__ == "__main__":
    main()
