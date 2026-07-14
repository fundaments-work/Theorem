import { useEffect, useRef, useCallback } from "react";

export interface KeyboardShortcut {
    
    label: string;
    
    keys: string;
    
    category: string;
    
    handler: () => void;
    
    preventDefault?: boolean;
}

interface RegisteredShortcut extends KeyboardShortcut {
    id: number;
    owner: symbol;
}

interface ShortcutGroup {
    shortcuts: RegisteredShortcut[];
    
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

export function useKeyboardShortcuts(activeRoute?: string, enabled = true): void {
    const activeRouteRef = useRef(activeRoute);
    activeRouteRef.current = activeRoute;

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (!enabled) return;

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
