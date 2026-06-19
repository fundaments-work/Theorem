import { useEffect, useRef, useCallback } from "react";

export interface KeyboardShortcut {
    /** Display name shown in the help modal */
    label: string;
    /** The key combo string, e.g. "Ctrl+F", "Escape", "j" */
    keys: string;
    /** Category for grouping in the help modal */
    category: string;
    /** The handler to invoke when the shortcut is pressed */
    handler: () => void;
    /** If true, prevent default browser behavior */
    preventDefault?: boolean;
}

interface RegisteredShortcut extends KeyboardShortcut {
    id: number;
    owner: symbol;
}

interface ShortcutGroup {
    shortcuts: RegisteredShortcut[];
    /** If set, this group only activates when this route matches */
    route?: string;
}

let nextId = 0;
const shortcutsByGroup = new Map<string, ShortcutGroup>();

function parseCombo(keys: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean } {
    const parts = keys.toLowerCase().split("+").map((p) => p.trim());
    const key = parts[parts.length - 1];
    return {
        key,
        ctrl: parts.includes("ctrl") || parts.includes("control"),
        shift: parts.includes("shift"),
        alt: parts.includes("alt"),
        meta: parts.includes("meta") || parts.includes("cmd"),
    };
}

function matchesCombo(event: KeyboardEvent, combo: ReturnType<typeof parseCombo>): boolean {
    const eventKey = event.key.toLowerCase();
    const comboKey = combo.key;

    if (eventKey !== comboKey && event.code !== undefined) {
        const codeKey = event.code.toLowerCase().replace("key", "");
        if (codeKey !== comboKey) return false;
    }

    if (event.ctrlKey !== combo.ctrl) return false;
    if (event.shiftKey !== combo.shift) return false;
    if (event.altKey !== combo.alt) return false;
    if (event.metaKey !== combo.meta) return false;

    return true;
}

/**
 * Register a group of keyboard shortcuts.
 *
 * @param groupId - Unique string ID for this group (e.g. "reader", "library")
 * @param shortcuts - Array of shortcuts
 * @param route - Optional route to scope shortcuts to
 *
 * Returns a cleanup function to unregister all shortcuts in the group.
 */
export function registerShortcuts(
    groupId: string,
    shortcuts: KeyboardShortcut[],
    route?: string,
): () => void {
    const owner = Symbol(groupId);
    const group: ShortcutGroup = {
        shortcuts: shortcuts.map((s) => ({
            ...s,
            id: nextId++,
            owner,
        })),
        route,
    };
    shortcutsByGroup.set(groupId, group);

    return () => {
        shortcutsByGroup.delete(groupId);
    };
}

/**
 * Get all currently registered shortcuts for display in a help modal.
 */
export function getAllShortcuts(): KeyboardShortcut[] {
    const result: KeyboardShortcut[] = [];
    for (const group of shortcutsByGroup.values()) {
        for (const s of group.shortcuts) {
            result.push({
                label: s.label,
                keys: s.keys,
                category: s.category,
                handler: s.handler,
                preventDefault: s.preventDefault,
            });
        }
    }
    return result;
}

const DISPLAY_KEY_MAP: Record<string, string> = {
    ctrl: "Ctrl",
    control: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    meta: "Cmd",
    cmd: "Cmd",
    escape: "Esc",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    " ": "Space",
};

export function formatShortcutKeys(keys: string): string {
    const parts = keys.split("+").map((p) => p.trim());
    return parts.map((p) => DISPLAY_KEY_MAP[p.toLowerCase()] ?? p.length === 1 ? p.toUpperCase() : p).join(" + ");
}

/**
 * React hook that listens for keyboard events and dispatches to registered shortcuts.
 *
 * @param activeRoute - The current route, used to filter route-scoped shortcuts
 * @param enabled - When false, all shortcuts are disabled (e.g. when a modal is open)
 */
export function useKeyboardShortcuts(activeRoute?: string, enabled = true): void {
    const activeRouteRef = useRef(activeRoute);
    activeRouteRef.current = activeRoute;

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (!enabled) return;

            // Skip if target is an input, textarea, or contenteditable
            const target = event.target as HTMLElement | null;
            if (
                target
                && (target.tagName === "INPUT"
                    || target.tagName === "TEXTAREA"
                    || target.tagName === "SELECT"
                    || target.isContentEditable)
            ) {
                return;
            }

            // Escape always closes things even without a registered shortcut
            if (event.key === "Escape") {
                return;
            }

            for (const group of shortcutsByGroup.values()) {
                if (group.route && group.route !== activeRouteRef.current) {
                    continue;
                }

                for (const shortcut of group.shortcuts) {
                    const combo = parseCombo(shortcut.keys);
                    if (matchesCombo(event, combo)) {
                        event.preventDefault();
                        shortcut.handler();
                        return;
                    }
                }
            }
        },
        [enabled],
    );

    useEffect(() => {
        if (!enabled) return;

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, [enabled, handleKeyDown]);
}
