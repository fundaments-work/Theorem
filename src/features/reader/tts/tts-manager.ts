/**
 * TTS Manager — orchestrates Kokoro TTS lifecycle.
 *
 * Handles model download, voice selection, text-to-speech generation
 * with streaming playback, and UI state.
 */
import { invoke } from "@tauri-apps/api/core";
import { textToTokens, splitIntoSentences } from "./kokoro-phonemizer";

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
    | { status: "downloading" }
    | { status: "loading" }
    | { status: "ready"; voices: TtsVoiceGroup[] }
    | { status: "playing"; currentText: string; totalChunks: number; currentChunk: number }
    | { status: "error"; message: string };

type TtsListener = (state: TtsState) => void;

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _audioContext: AudioContext | null = null;
    private _currentSource: AudioBufferSourceNode | null = null;
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _abortController: AbortController | null = null;

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

    /** Ensure the ONNX model and voices are downloaded and loaded. */
    async prepare(): Promise<void> {
        try {
            // Check if already ready
            const ready = await invoke<boolean>("kokoro_is_ready");
            if (ready) {
                this._voiceCache = await invoke<TtsVoiceGroup[]>("kokoro_list_voices");
                this.emit({ status: "ready", voices: this._voiceCache });
                return;
            }

            this.emit({ status: "downloading" });

            await invoke("kokoro_prepare");

            this._voiceCache = await invoke<TtsVoiceGroup[]>("kokoro_list_voices");
            this.emit({ status: "ready", voices: this._voiceCache });
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

    /** Start speaking the given text, streaming audio chunks. */
    async speak(text: string): Promise<void> {
        if (this._state.status === "playing") {
            this.stop();
        }

        // If prepare already failed, don't retry — the error message is already shown
        if (this._state.status === "error") {
            return;
        }

        // Ensure engine is loaded before generating
        if (this._state.status !== "ready") {
            await this.prepare();
        }
        if (this._state.status !== "ready") {
            return;
        }

        const sentences = splitIntoSentences(text.trim());
        if (sentences.length === 0) return;

        this._abortController = new AbortController();
        const signal = this._abortController.signal;

        this.emit({
            status: "playing",
            currentText: text,
            totalChunks: sentences.length,
            currentChunk: 0,
        });

        try {
            for (let i = 0; i < sentences.length; i++) {
                if (signal.aborted) break;

                const tokens = await textToTokens(sentences[i]);
                if (tokens.length === 0) continue;

                const audio = await invoke<number[]>("kokoro_generate", {
                    tokens,
                    voice: this._selectedVoice,
                    speed: this._speed,
                });

                if (signal.aborted) break;

                await this._playAudio(audio);

                this.emit({
                    status: "playing",
                    currentText: text,
                    totalChunks: sentences.length,
                    currentChunk: i + 1,
                });
            }
        } catch (err) {
            if (!signal.aborted) {
                const message = err instanceof Error ? err.message : String(err);
                this.emit({ status: "error", message });
                return;
            }
        }

        if (!signal.aborted) {
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    /** Play raw f32 PCM audio at 24kHz via Web Audio API. */
    private async _playAudio(samples: number[]): Promise<void> {
        if (!this._audioContext) {
            this._audioContext = new AudioContext({ sampleRate: 24000 });
        }

        const ctx = this._audioContext;
        if (ctx.state === "suspended") {
            await ctx.resume();
        }

        // Convert f32 samples to f32 AudioBuffer
        const buffer = ctx.createBuffer(1, samples.length, 24000);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
            channel[i] = samples[i];
        }

        return new Promise<void>((resolve) => {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);

            source.onended = () => {
                this._currentSource = null;
                resolve();
            };

            this._currentSource = source;
            source.start();
        });
    }

    stop() {
        this._abortController?.abort();
        this._abortController = null;

        if (this._currentSource) {
            try {
                this._currentSource.stop();
            } catch {
                // May have already stopped
            }
            this._currentSource = null;
        }

        if (this._state.status === "playing" || this._state.status === "error") {
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    /** Release the audio context (call when reader closes). */
    dispose() {
        this.stop();
        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }
    }
}

export const ttsManager = new TtsManager();
