import type { StateStorage } from 'zustand/middleware';
import { isTauri } from './env';
import { sqliteDeleteKv, sqliteGetKv, sqliteSetKv } from './sqlite-storage';

const SQLITE_PERSIST_KEY_PREFIX = 'zustand:';

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

export const theoremPersistStorage: StateStorage = {
    async getItem(name) {
        if (!isTauri()) {
            return getLocalItem(name);
        }

        const sqliteKey = asSqlitePersistKey(name);

        try {
            const sqliteValue = await sqliteGetKv(sqliteKey);
            if (sqliteValue != null) {
                return sqliteValue;
            }

            const legacyValue = getLocalItem(name);
            if (legacyValue != null) {
                await sqliteSetKv(sqliteKey, legacyValue);
                return legacyValue;
            }

            return null;
        } catch (error) {
            console.error('[PersistStorage] Failed to read persisted key from SQLite:', name, error);
            return getLocalItem(name);
        }
    },

    async setItem(name, value) {
        if (!isTauri()) {
            setLocalItem(name, value);
            return;
        }

        const sqliteKey = asSqlitePersistKey(name);

        try {
            await sqliteSetKv(sqliteKey, value);
            removeLocalItem(name);
        } catch (error) {
            console.error('[PersistStorage] Failed to write persisted key to SQLite:', name, error);
            setLocalItem(name, value);
        }
    },

    async removeItem(name) {
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
