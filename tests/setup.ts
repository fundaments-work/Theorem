class MemoryStorage implements Storage {
    private readonly data = new Map<string, string>();

    get length(): number {
        return this.data.size;
    }

    clear(): void {
        this.data.clear();
    }

    getItem(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }

    key(index: number): string | null {
        const keys = Array.from(this.data.keys());
        return keys[index] ?? null;
    }

    removeItem(key: string): void {
        this.data.delete(String(key));
    }

    setItem(key: string, value: string): void {
        this.data.set(String(key), String(value));
    }
}

if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== "function") {
    Object.defineProperty(globalThis, "localStorage", {
        value: new MemoryStorage(),
        configurable: true,
    });
}

if (!globalThis.sessionStorage || typeof globalThis.sessionStorage.setItem !== "function") {
    Object.defineProperty(globalThis, "sessionStorage", {
        value: new MemoryStorage(),
        configurable: true,
    });
}

if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    });
}

if (typeof window !== "undefined" && !window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(performance.now()), 16);
    };
}

if (typeof window !== "undefined" && !window.cancelAnimationFrame) {
    window.cancelAnimationFrame = (handle: number) => {
        window.clearTimeout(handle);
    };
}
