/**
 * TTS Manager — orchestrates Kokoro TTS lifecycle.
 *
 * Audio playback runs natively via rodio in the Rust backend.
 * Commands are relayed through Tauri IPC; state changes arrive via events.
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

type TtsListener = (state: TtsState) => void;

interface TtsStatePayload {
    status: string;
    voices: TtsVoiceGroup[] | null;
    message: string | null;
}

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _unlistenState: UnlistenFn | null = null;

    get state(): TtsState {
        return this._state;
    }

    get selectedVoice(): string {
        return this._selectedVoice;
    }

    subscribe(listener: TtsListener): () => void {
        this._listeners.add(listener);
        listener(this._state);
        return () => this._listeners.delete(listener);
    }

    private emit(state: TtsState) {
        this._state = state;
        for (const l of this._listeners) l(state);
    }

    private async _ensureEventListener(): Promise<void> {
        if (this._unlistenState) return;
        this._unlistenState = await listen<TtsStatePayload>("tts-state", (event) => {
            const p = event.payload;
            const status = p.status;
            switch (status) {
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
                case "error":
                    this.emit({ status: "error", message: p.message ?? "Unknown error" });
                    break;
                default:
                    break;
            }
        });
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

    /** Start synthesizing and playing text via Kokoro. */
    async speak(text: string): Promise<void> {
        await this._ensureEventListener();

        if (this._state.status === "playing" || this._state.status === "paused") {
            this.stop();
        }

        // Ensure engine is loaded and ready
        if (this._state.status !== "ready") {
            await this.prepare();
        }
        if (this._state.status !== "ready") {
            return;
        }

        const trimmed = text.trim();
        if (!trimmed) return;

        try {
            await invoke("tts_play", {
                text: trimmed,
                voice: this._selectedVoice,
                speed: this._speed,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[TTS] Play failed:", message);
            this.emit({ status: "error", message });
        }
    }

    pause(): void {
        invoke("tts_pause").catch(() => {});
    }

    resume(): void {
        invoke("tts_resume").catch(() => {});
    }

    stop(): void {
        invoke("tts_stop").catch(() => {});
        if (this._state.status === "playing" || this._state.status === "paused" || this._state.status === "error") {
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    /** Release event listeners (call when reader closes). */
    dispose() {
        this.stop();
        if (this._unlistenState) {
            this._unlistenState();
            this._unlistenState = null;
        }
    }
}

export const ttsManager = new TtsManager();
