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

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
    private pausedText: string | null = null;
    private pausedVoice: string | null = null;
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

    async speak(text: string, voice: string | null, _rate: number = 1) {
        await this._stop();
        if (!text.trim()) return;
        this.setState('loading');

        this.pausedText = text;
        this.pausedVoice = voice;

        try {
            await invoke("tts_speak", { text, voice: voice || "" });
            this.setState('playing');

            const estimatedMs = Math.max(1000, (text.length / 11.25) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                this.pausedText = null;
                this.setState('idle');
                this.callbacks.onComplete?.();
            }, estimatedMs);
        } catch (err: unknown) {
            this.setState('idle');
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        if (this._state !== 'playing') return;
        // Kill the completion timer so onComplete doesn't fire (no auto-advance).
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        // Stop the audio but keep the text so we can resume.
        await this._stop();
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused') return;
        if (!this.pausedText) return;
        // Re-speak the current section from the beginning.
        await this.speak(this.pausedText, this.pausedVoice);
    }

    async stop() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        this.pausedText = null;
        this.pausedVoice = null;
        await this._stop();
        this.setState('idle');
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
                // fall through to Web Speech API
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
