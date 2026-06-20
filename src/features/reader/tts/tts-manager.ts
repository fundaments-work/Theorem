/**
 * TTS Manager — audiobook-style Kokoro TTS orchestrator.
 *
 * Sends full text to the Rust backend for continuous streaming playback.
 * The backend splits internally and emits progress events.
 * Frontend tracks sentence position for skip controls.
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

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _unlistenState: UnlistenFn | null = null;
    private _unlistenProgress: UnlistenFn | null = null;
    private _listenersPromise: Promise<void> | null = null;

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

    subscribe(listener: TtsListener): () => void {
        this._listeners.add(listener);
        listener(this._state, this._progress);
        return () => this._listeners.delete(listener);
    }

    private emit(state: TtsState) {
        this._state = state;
        for (const l of this._listeners) l(state, this._progress);
    }

    private async _ensureEventListeners(): Promise<void> {
        // Race-safe: if setup is in flight, return the same promise
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

    /** Ensure the ONNX model and voices are downloaded and loaded. */
    async prepare(): Promise<void> {
        await this._ensureEventListeners();
        try {
            const ready = await invoke<boolean>("tts_is_ready");
            if (ready) {
                if (this._voiceCache.length === 0) {
                    this._voiceCache = await invoke<TtsVoiceGroup[]>("tts_get_voices");
                }
                this.emit({ status: "ready", voices: this._voiceCache });
                return;
            }
            await invoke("tts_load");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit({ status: "error", message });
            throw err;
        }
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

        // CRITICAL FIX: Always ensure engine is loaded.
        // prepare() is idempotent — fast return if already loaded.
        // Do NOT gate this on UI state; stop() sets state to "ready"
        // even when the engine isn't actually initialized yet.
        await this.prepare();

        if (this._state.status !== "ready") {
            console.error("[TTS] Cannot speak: engine not ready after prepare(), state =", this._state.status);
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

    /** Release event listeners. */
    dispose() {
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
