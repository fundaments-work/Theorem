/**
 * TTS Manager — audiobook-style Kokoro TTS orchestrator.
 *
 * Splits text into sentence chunks, plays them sequentially with auto-advance,
 * and tracks progress for skip forward/back controls.
 * Audio playback runs natively via rodio in the Rust backend.
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
    current: number;
    total: number;
}

type TtsListener = (state: TtsState, progress: TtsProgress) => void;

interface TtsStatePayload {
    status: string;
    voices: TtsVoiceGroup[] | null;
    message: string | null;
}

/** Split text into sentence chunks for sequential playback. */
function splitSentences(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    // Split on sentence-ending punctuation followed by whitespace, or newlines.
    // Keeps the punctuation with the sentence.
    const parts = trimmed.split(/(?<=[.!?])\s+|\n+/);
    return parts
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _unlistenState: UnlistenFn | null = null;

    // Chunk tracking
    private _chunks: string[] = [];
    private _currentChunk = 0;
    private _isPlayingSequence = false;

    get state(): TtsState {
        return this._state;
    }

    get progress(): TtsProgress {
        return { current: this._currentChunk, total: this._chunks.length };
    }

    get selectedVoice(): string {
        return this._selectedVoice;
    }

    subscribe(listener: TtsListener): () => void {
        this._listeners.add(listener);
        listener(this._state, this.progress);
        return () => this._listeners.delete(listener);
    }

    private emit(state: TtsState) {
        this._state = state;
        for (const l of this._listeners) l(state, this.progress);
    }

    private _emitProgress() {
        for (const l of this._listeners) l(this._state, this.progress);
    }

    private async _ensureEventListener(): Promise<void> {
        if (this._unlistenState) return;
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
                    this._onChunkFinished();
                    break;
                case "error":
                    this._isPlayingSequence = false;
                    this.emit({ status: "error", message: p.message ?? "Unknown error" });
                    break;
                default:
                    break;
            }
        });
    }

    /** Called when a single chunk finishes playing — auto-advance to next. */
    private _onChunkFinished() {
        if (!this._isPlayingSequence) {
            this.emit({ status: "ready", voices: this._voiceCache });
            return;
        }

        this._currentChunk++;
        this._emitProgress();

        if (this._currentChunk < this._chunks.length) {
            this._playChunk(this._currentChunk);
        } else {
            // All chunks done
            this._isPlayingSequence = false;
            this._chunks = [];
            this._currentChunk = 0;
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    /** Play a single chunk via the Rust backend. */
    private async _playChunk(index: number): Promise<void> {
        const chunk = this._chunks[index];
        if (!chunk) return;

        try {
            await invoke("tts_play", {
                text: chunk,
                voice: this._selectedVoice,
                speed: this._speed,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[TTS] Play failed:", message);
            this._isPlayingSequence = false;
            this.emit({ status: "error", message });
        }
    }

    /** Ensure the ONNX model and voices are downloaded and loaded. */
    async prepare(): Promise<void> {
        await this._ensureEventListener();

        try {
            const ready = await invoke<boolean>("tts_is_ready");
            if (ready) {
                this._voiceCache = await invoke<TtsVoiceGroup[]>("tts_get_voices");
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

    /** Start playing text from the beginning (or a specific chunk index). */
    async speak(text: string, startIndex = 0): Promise<void> {
        await this._ensureEventListener();

        // Stop any current playback
        this.stop();

        // Ensure engine is loaded
        if (this._state.status !== "ready") {
            await this.prepare();
        }
        if (this._state.status !== "ready") {
            return;
        }

        const chunks = splitSentences(text);
        if (chunks.length === 0) return;

        this._chunks = chunks;
        this._currentChunk = Math.min(startIndex, chunks.length - 1);
        this._isPlayingSequence = true;

        this.emit({ status: "playing" });
        await this._playChunk(this._currentChunk);
    }

    /** Skip to the next sentence. */
    skipForward(): void {
        if (!this._isPlayingSequence) return;
        if (this._currentChunk + 1 >= this._chunks.length) return;

        invoke("tts_stop").catch(() => {});
        this._currentChunk++;
        this._emitProgress();
        this.emit({ status: "playing" });
        this._playChunk(this._currentChunk);
    }

    /** Skip to the previous sentence. */
    skipBack(): void {
        if (!this._isPlayingSequence) return;
        if (this._currentChunk === 0) return;

        invoke("tts_stop").catch(() => {});
        this._currentChunk--;
        this._emitProgress();
        this.emit({ status: "playing" });
        this._playChunk(this._currentChunk);
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
        this._isPlayingSequence = false;
        this._chunks = [];
        this._currentChunk = 0;
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
    }
}

export const ttsManager = new TtsManager();
