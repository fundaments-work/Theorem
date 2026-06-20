/**
 * TTS Manager — audiobook-style Kokoro TTS orchestrator.
 *
 * Sends full text to the Rust backend for continuous streaming playback.
 * The backend splits internally and emits progress events.
 * Frontend tracks sentence position for skip controls.
 *
 * State machine:
 *   idle → loading → ready → playing ↔ paused
 *                            ↓
 *                          error → ready (on stop)
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TtsVoice {
    id: string;
    name: string;
    language: string;
    gender: string;
}

export interface TtsVoiceGroup {
    label: string;
    voices: TtsVoice[];
}

export type TtsStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

export type TtsState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; voices: TtsVoiceGroup[] }
    | { status: "playing" }
    | { status: "paused" }
    | { status: "error"; message: string };

export interface TtsProgress {
    chunk: number;
    total: number;
}

type TtsListener = (state: TtsState, progress: TtsProgress) => void;

interface TtsStatePayload {
    status: string;
    voices: TtsVoiceGroup[] | null;
    message: string | null;
}

/** Split text into sentence chunks for skip tracking. */
function splitSentences(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parts = trimmed.split(/(?<=[.!?])\s+|\n+/);
    return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Valid transitions: [from, to][] */
const VALID_TRANSITIONS: [TtsStatus, TtsStatus][] = [
    ["idle", "loading"],
    ["loading", "ready"],
    ["loading", "error"],
    ["ready", "playing"],
    ["ready", "loading"],
    ["playing", "paused"],
    ["paused", "playing"],
    ["playing", "ready"],
    ["playing", "error"],
    ["paused", "ready"],
    ["paused", "error"],
    ["error", "ready"],
    ["error", "loading"],
    ["error", "idle"],
    ["ready", "idle"],
];

function isValidTransition(from: TtsStatus, to: TtsStatus): boolean {
    return VALID_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _unlistenState: UnlistenFn | null = null;
    private _unlistenProgress: UnlistenFn | null = null;
    private _listenersPromise: Promise<void> | null = null;
    private _refCount = 0; // safety: multiple components can hold listeners

    // Once the engine has been successfully loaded, we skip ALL Rust IPC
    // (tts_is_ready, tts_get_voices, tts_load) to avoid blocking on mutexes.
    private _engineEverLoaded = false;

    // Sentence tracking for skip/progress
    private _sentences: string[] = [];
    private _currentSentence = 0;
    private _progress: TtsProgress = { chunk: 0, total: 0 };

    get state(): TtsState {
        return this._state;
    }

    get progress(): TtsProgress {
        return this._progress;
    }

    get selectedVoice(): string {
        return this._selectedVoice;
    }

    get speed(): number {
        return this._speed;
    }

    subscribe(listener: TtsListener): () => void {
        this._listeners.add(listener);
        this._refCount++;
        listener(this._state, this._progress);
        return () => {
            this._refCount--;
            this._listeners.delete(listener);
            // Don't dispose here — other components may still be listening.
        };
    }

    private emit(state: TtsState) {
        const prev = this._state.status;
        const next = state.status;
        if (!isValidTransition(prev, next)) {
            // Allow same-status re-emits (e.g. ready→ready with updated voices)
            if (prev !== next) {
                console.warn(
                    `[TTS] Unexpected transition: ${prev} → ${next}`,
                );
            }
        } else if (prev !== next) {
            console.log(`[TTS] ${prev} → ${next}`);
        }
        this._state = state;
        for (const l of this._listeners) l(state, this._progress);
    }

    private async _ensureEventListeners(): Promise<void> {
        if (this._listenersPromise) {
            return this._listenersPromise;
        }
        if (this._unlistenState) {
            return;
        }

        this._listenersPromise = this._setupListeners();
        try {
            await this._listenersPromise;
        } finally {
            this._listenersPromise = null;
        }
    }

    private async _setupListeners(): Promise<void> {
        this._unlistenState = await listen<TtsStatePayload>("tts-state", (event) => {
            const p = event.payload;
            switch (p.status) {
                case "ready":
                    this._voiceCache = p.voices ?? this._voiceCache;
                    this._engineEverLoaded = true;
                    this.emit({ status: "ready", voices: this._voiceCache });
                    break;
                case "loading":
                    this.emit({ status: "loading" });
                    break;
                case "playing":
                    this.emit({ status: "playing" });
                    break;
                case "paused":
                    this.emit({ status: "paused" });
                    break;
                case "finished":
                    this._progress = { chunk: 0, total: 0 };
                    this.emit({ status: "ready", voices: this._voiceCache });
                    break;
                case "error":
                    this.emit({ status: "error", message: p.message ?? "Unknown error" });
                    break;
                default:
                    break;
            }
        });

        this._unlistenProgress = await listen<{ chunk: number; total: number }>(
            "tts-progress",
            (event) => {
                this._progress = event.payload;
                for (const l of this._listeners) l(this._state, this._progress);
            },
        );
    }

    /**
     * Ensure the ONNX model and voices are downloaded and loaded.
     * Idempotent — fast return if engine was already loaded.
     */
    async prepare(): Promise<void> {
        await this._ensureEventListeners();

        // If the engine was ever successfully loaded, all state is cached.
        // Avoid ALL Rust IPC to prevent blocking on INNER/PARAMS mutexes.
        if (this._engineEverLoaded) {
            if (this._state.status !== "ready") {
                this.emit({ status: "ready", voices: this._voiceCache });
            }
            return;
        }

        try {
            const ready = await invoke<boolean>("tts_is_ready");
            if (ready) {
                if (this._voiceCache.length === 0) {
                    this._voiceCache = await invoke<TtsVoiceGroup[]>("tts_get_voices");
                }
                this._engineEverLoaded = true;
                this.emit({ status: "ready", voices: this._voiceCache });
                return;
            }
            await invoke("tts_load");
            // After tts_load resolves, poll until the "ready" event has been
            // processed by our listener — the event may arrive after the IPC
            // promise resolves due to Tauri event loop timing.
            await this._waitForStatus("ready");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit({ status: "error", message });
            throw err;
        }
    }

    /** Poll _state until it reaches the expected status or errors out. */
    private async _waitForStatus(
        target: "ready" | "error",
        timeoutMs = 1000,
    ): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (this._state.status === target) return;
            if (this._state.status === "error") return;
            // yield to the event loop so listeners can process incoming events
            await new Promise((r) => setTimeout(r, 10));
        }
        console.warn(
            `[TTS] Timed out waiting for "${target}" status after ${timeoutMs}ms`,
        );
    }

    setVoice(voiceId: string) {
        this._selectedVoice = voiceId;
    }

    setSpeed(speed: number) {
        this._speed = Math.max(0.5, Math.min(2.0, speed));
    }

    /** Start playing text from the beginning (or a specific sentence index). */
    async speak(text: string, startSentence = 0): Promise<void> {
        await this._ensureEventListeners();

        // Stop any current playback first
        this.stop();

        // Ensure engine is loaded (idempotent, fast if cached)
        await this.prepare();

        if (this._state.status !== "ready") {
            console.error(
                "[TTS] Cannot speak: engine not ready, state =",
                this._state.status,
            );
            return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
            console.warn("[TTS] No text to speak");
            return;
        }

        // Store sentences for skip tracking
        this._sentences = splitSentences(trimmed);
        this._currentSentence = Math.min(startSentence, this._sentences.length - 1);
        this._progress = { chunk: 0, total: 0 };

        // Send full text to Rust for continuous streaming playback
        try {
            console.log("[TTS] Starting playback, text length:", trimmed.length);
            await invoke("tts_play", {
                text: trimmed,
                voice: this._selectedVoice,
                speed: this._speed,
            });
            this.emit({ status: "playing" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[TTS] Play failed:", message);
            this.emit({ status: "error", message });
        }
    }

    /** Skip to the next sentence — stop current and restart from next. */
    skipForward(): void {
        if (this._currentSentence + 1 >= this._sentences.length) return;
        this._currentSentence++;
        const remaining = this._sentences.slice(this._currentSentence).join(" ");
        this.speak(remaining, 0);
    }

    /** Skip to the previous sentence — stop current and restart from previous. */
    skipBack(): void {
        if (this._currentSentence === 0) return;
        this._currentSentence--;
        const remaining = this._sentences.slice(this._currentSentence).join(" ");
        this.speak(remaining, 0);
    }

    pause(): void {
        invoke("tts_pause").catch(() => {});
        if (this._state.status === "playing") {
            this.emit({ status: "paused" });
        }
    }

    resume(): void {
        invoke("tts_resume").catch(() => {});
        if (this._state.status === "paused") {
            this.emit({ status: "playing" });
        }
    }

    stop(): void {
        this._sentences = [];
        this._currentSentence = 0;
        this._progress = { chunk: 0, total: 0 };
        invoke("tts_stop").catch(() => {});
        if (this._state.status === "playing" || this._state.status === "paused" || this._state.status === "error") {
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    /** Release event listeners only when ALL subscribers are gone. */
    dispose() {
        this._refCount--;
        if (this._refCount > 0) return;
        // Actually last subscriber — tear down
        this.stop();
        if (this._unlistenState) {
            this._unlistenState();
            this._unlistenState = null;
        }
        if (this._unlistenProgress) {
            this._unlistenProgress();
            this._unlistenProgress = null;
        }
    }
}

export const ttsManager = new TtsManager();
