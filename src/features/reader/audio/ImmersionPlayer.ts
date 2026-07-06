/**
 * ImmersionPlayer — native platform TTS via Tauri commands.
 *
 * Desktop: uses the `tts` Rust crate (speech-dispatcher/NSSpeechSynthesizer/SAPI).
 * Android: uses android.speech.tts.TextToSpeech via plugin.
 *
 * Voice discovery on desktop uses window.speechSynthesis (queries the same
 * system voices — read-only). Actual playback is always through the Rust backend.
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
        await this.stop();
        if (!text.trim()) return;
        this.setState('loading');

        try {
            await invoke("tts_speak", { text, voice: voice || "" });
            this.setState('playing');

            // Approximate completion: TextToSpeech on Android and `tts` crate on
            // desktop both return after queuing — they don't signal completion.
            // Rough estimate: 150 words/min → chars/11.25 per second.
            const estimatedMs = Math.max(1000, (text.length / 11.25) * 1000);
            setTimeout(() => {
                this.setState('idle');
                this.callbacks.onComplete?.();
            }, estimatedMs);
        } catch (err: unknown) {
            this.setState('idle');
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        // Android TextToSpeech doesn't support pause; `tts` crate on desktop does.
        // Stop is the safe universal fallback.
        await this.stop();
    }

    async resume() {
        // Not supported cross-platform. User must re-speak.
    }

    async stop() {
        if (isTauriAvailable()) {
            await invoke("tts_stop").catch(() => {});
        }
        this.setState('idle');
    }

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        // On Tauri (both desktop and Android): use invoke to query native voices.
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
        // Desktop web fallback: system voices via read-only Web Speech API query.
        if (typeof window !== "undefined" && window.speechSynthesis) {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                return voices.map(v => ({ name: v.name, lang: v.lang }));
            }
        }
        return [];
    }

    static async loadVoices(): Promise<{ name: string; lang: string }[]> {
        if (isTauriAvailable()) {
            const voices = await ImmersionPlayer.getVoices();
            if (voices.length > 0) return voices;
        }
        return ImmersionPlayer.getVoices();
    }

    destroy() {
        if (isTauriAvailable()) {
            invoke("tts_stop").catch(() => {});
        }
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
