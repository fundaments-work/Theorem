/**
 * ImmersionPlayer — native platform TTS via Tauri commands.
 *
 * Desktop: platform shell commands (say/spd-say/espeak-ng/PowerShell).
 * Android: android.speech.tts.TextToSpeech via plugin.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauriAvailable(): boolean {
    try {
        return !!(window as any).__TAURI_INTERNALS__;
    } catch {
        return false;
    }
}

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onComplete?: () => void;
}

/** Rough chars-per-second at 150 words/min, ~5 chars/word. */
const CHARS_PER_SEC = (150 * 5) / 60; // 12.5

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
    private fullText: string = '';
    private voice: string | null = null;
    private startTime: number = 0;
    private charsSpoken: number = 0;
    private completeTimer: ReturnType<typeof setTimeout> | null = null;

    get state(): PlaybackState {
        return this._state;
    }

    private setState(s: PlaybackState) {
        if (this._state === s) return;
        this._state = s;
        this.callbacks.onStateChange?.(s);
    }

    init(callbacks: PlaybackCallbacks = {}) {
        this.callbacks = callbacks;
    }

    async speak(text: string, voiceParam: string | null, _rate: number = 1) {
        await this._stop();
        if (!text.trim()) return;

        this.fullText = text;
        this.voice = voiceParam;
        this.charsSpoken = 0;
        this.startTime = performance.now();
        this.setState('loading');

        try {
            await invoke("tts_speak", { text, voice: voiceParam || "" });
            this.setState('playing');

            const estimatedMs = Math.max(1000, (text.length / CHARS_PER_SEC) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                this._onDone();
            }, estimatedMs);
        } catch (err: unknown) {
            this._onDone();
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        if (this._state !== 'playing') return;
        // Record how many chars were spoken before stopping.
        const elapsed = (performance.now() - this.startTime) / 1000;
        this.charsSpoken += Math.floor(elapsed * CHARS_PER_SEC);
        // Kill completion timer so onComplete doesn't fire.
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        await this._stop();
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused') return;
        // Speak only the remaining portion of the text.
        const remaining = this.fullText.slice(this.charsSpoken).trim();
        if (!remaining) {
            this._onDone();
            return;
        }
        await this.speak(remaining, this.voice);
    }

    async stop() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        this.fullText = '';
        this.voice = null;
        this.charsSpoken = 0;
        await this._stop();
        this.setState('idle');
    }

    private _onDone() {
        this.fullText = '';
        this.voice = null;
        this.charsSpoken = 0;
        this.setState('idle');
        this.callbacks.onComplete?.();
    }

    private async _stop() {
        if (isTauriAvailable()) {
            await invoke("tts_stop").catch(() => {});
        }
    }

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        if (isTauriAvailable()) {
            try {
                const voices = await invoke<Array<{ name: string; locale: string }>>("tts_get_voices");
                if (voices.length > 0) {
                    return voices.map(v => ({ name: v.name, lang: v.locale }));
                }
            } catch {
                // fall through
            }
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                return voices.map(v => ({ name: v.name, lang: v.lang }));
            }
        }
        return [];
    }

    static async loadVoices(): Promise<{ name: string; lang: string }[]> {
        return ImmersionPlayer.getVoices();
    }

    destroy() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        if (isTauriAvailable()) {
            invoke("tts_stop").catch(() => {});
        }
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
