import type { StateStorage } from 'zustand/middleware';
import { isTauri } from './env';
import { sqliteDeleteKv, sqliteGetKv, sqliteSetKv } from './sqlite-storage';

const SQLITE_PERSIST_KEY_PREFIX = 'zustand:';
const PERSIST_WRITE_DEBOUNCE_MS = 350;

const inMemoryPersistCache = new Map<string, string | null>();
const pendingPersistWrites = new Map<string, string>();
const pendingPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
let flushHandlersInstalled = false;

function asSqlitePersistKey(name: string): string {
    return `${SQLITE_PERSIST_KEY_PREFIX}${name}`;
}

function getLocalItem(name: string): string | null {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    return localStorage.getItem(name);
}

function setLocalItem(name: string, value: string): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.setItem(name, value);
}

function removeLocalItem(name: string): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.removeItem(name);
}

function clearPendingPersistWrite(name: string): void {
    const timer = pendingPersistTimers.get(name);
    if (timer) {
        clearTimeout(timer);
        pendingPersistTimers.delete(name);
    }
    pendingPersistWrites.delete(name);
}

async function flushPersistWrite(name: string): Promise<void> {
    const pendingValue = pendingPersistWrites.get(name);
    if (pendingValue == null) {
        return;
    }

    clearPendingPersistWrite(name);

    if (!isTauri()) {
        setLocalItem(name, pendingValue);
        return;
    }

    const sqliteKey = asSqlitePersistKey(name);

    try {
        await sqliteSetKv(sqliteKey, pendingValue);
        removeLocalItem(name);
    } catch (error) {
        console.error('[PersistStorage] Failed to flush persisted key to SQLite:', name, error);
        setLocalItem(name, pendingValue);
    }
}

async function flushAllPersistWrites(): Promise<void> {
    const names = [...pendingPersistWrites.keys()];
    if (names.length === 0) {
        return;
    }
    await Promise.allSettled(names.map((name) => flushPersistWrite(name)));
}

function schedulePersistWrite(name: string, value: string): void {
    pendingPersistWrites.set(name, value);

    const existingTimer = pendingPersistTimers.get(name);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
        pendingPersistTimers.delete(name);
        void flushPersistWrite(name);
    }, PERSIST_WRITE_DEBOUNCE_MS);
    pendingPersistTimers.set(name, timer);
}

function installFlushHandlers(): void {
    if (flushHandlersInstalled || typeof window === 'undefined') {
        return;
    }

    window.addEventListener('visibilitychange', () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            void flushAllPersistWrites();
        }
    });

    window.addEventListener('beforeunload', () => {
        for (const [name, value] of pendingPersistWrites.entries()) {
            setLocalItem(name, value);
        }
    });

    flushHandlersInstalled = true;
}

export const theoremPersistStorage: StateStorage = {
    async getItem(name) {
        installFlushHandlers();

        const pendingValue = pendingPersistWrites.get(name);
        if (pendingValue != null) {
            return pendingValue;
        }

        if (inMemoryPersistCache.has(name)) {
            return inMemoryPersistCache.get(name) ?? null;
        }

        if (!isTauri()) {
            const localValue = getLocalItem(name);
            inMemoryPersistCache.set(name, localValue);
            return localValue;
        }

        const sqliteKey = asSqlitePersistKey(name);

        try {
            const sqliteValue = await sqliteGetKv(sqliteKey);
            if (sqliteValue != null) {
                inMemoryPersistCache.set(name, sqliteValue);
                return sqliteValue;
            }

            const legacyValue = getLocalItem(name);
            if (legacyValue != null) {
                inMemoryPersistCache.set(name, legacyValue);
                await sqliteSetKv(sqliteKey, legacyValue);
                return legacyValue;
            }

            inMemoryPersistCache.set(name, null);
            return null;
        } catch (error) {
            console.error('[PersistStorage] Failed to read persisted key from SQLite:', name, error);
            const fallbackValue = getLocalItem(name);
            inMemoryPersistCache.set(name, fallbackValue);
            return fallbackValue;
        }
    },

    async setItem(name, value) {
        installFlushHandlers();
        inMemoryPersistCache.set(name, value);
        schedulePersistWrite(name, value);
    },

    async removeItem(name) {
        installFlushHandlers();
        clearPendingPersistWrite(name);
        inMemoryPersistCache.delete(name);

        if (!isTauri()) {
            removeLocalItem(name);
            return;
        }

        const sqliteKey = asSqlitePersistKey(name);

        try {
            await sqliteDeleteKv(sqliteKey);
        } catch (error) {
            console.error('[PersistStorage] Failed to remove persisted key from SQLite:', name, error);
        }

        removeLocalItem(name);
    },
};
