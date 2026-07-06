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

/**
 * Audiobook-standard speaking rate: ~158 words/min, ~5.1 chars/word.
 * ~13.4 chars/sec. Calibrated from research (Wikipedia, 2012 study
 * across 17 languages: avg reading-aloud speed 184±29 wpm; audiobook
 * guidelines recommend 150-160 wpm for comfortable listening).
 */
const BASE_WPM = 158;
const AVG_CHARS_PER_WORD = 5.1;
const BASE_CHARS_PER_SEC = (BASE_WPM * AVG_CHARS_PER_WORD) / 60; // ≈ 13.43

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
    private fullText: string = '';
    private fullWords: string[] = [];
    private voice: string | null = null;
    private startTime: number = 0;
    private charsPerSec: number = BASE_CHARS_PER_SEC;
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
        this.fullWords = text.trim().split(/\s+/);
        this.voice = voiceParam;
        this.startTime = performance.now();
        this.setState('loading');

        try {
            await invoke("tts_speak", { text, voice: voiceParam || "" });
            this.setState('playing');

            const estimatedMs = Math.max(2000, (text.length / this.charsPerSec) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                // Self-calibrate: adjust rate based on actual vs estimated duration.
                const actualSec = (performance.now() - this.startTime) / 1000;
                const estimatedSec = text.length / this.charsPerSec;
                if (actualSec > 1 && estimatedSec > 1) {
                    // Exponential moving average: 80% old, 20% new observation.
                    const observedCps = text.length / actualSec;
                    this.charsPerSec = this.charsPerSec * 0.8 + observedCps * 0.2;
                }
                this._onDone();
            }, estimatedMs);
        } catch (err: unknown) {
            this._onDone();
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        if (this._state !== 'playing') return;
        const elapsedMs = performance.now() - this.startTime;
        const elapsedSec = elapsedMs / 1000;
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        await this._stop();
        // Estimate how many words were spoken and truncate the text
        // to start from the next whole word (don't cut mid-word).
        const charsSpoken = Math.floor(elapsedSec * this.charsPerSec);
        let charCount = 0;
        let wordsToDrop = 0;
        for (let i = 0; i < this.fullWords.length; i++) {
            charCount += this.fullWords[i].length;
            if (charCount >= charsSpoken) {
                wordsToDrop = i + 1;
                break;
            }
        }
        // Rejoin remaining words into text for resume.
        this.fullText = this.fullWords.slice(wordsToDrop).join(" ");
        this.fullWords = this.fullWords.slice(wordsToDrop);
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused') return;
        const remaining = this.fullText.trim();
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
        this.fullWords = [];
        this.voice = null;
        this.charsPerSec = BASE_CHARS_PER_SEC;
        await this._stop();
        this.setState('idle');
    }

    private _onDone() {
        this.fullText = '';
        this.fullWords = [];
        this.voice = null;
        this.charsPerSec = BASE_CHARS_PER_SEC;
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
