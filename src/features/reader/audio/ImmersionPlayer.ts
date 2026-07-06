/**
 * ImmersionPlayer — native platform TTS via Tauri commands.
 *
 * Android: TextToSpeech plugin. Desktop: shell commands.
 * Web: disabled (not supported).
 */

let _invoke: any = null;
async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!_invoke) {
        const mod = await import("@tauri-apps/api/core");
        _invoke = mod.invoke;
    }
    return _invoke(cmd, args);
}

function isTauri(): boolean {
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

// ─── Estimation constants ───
// 158 wpm (audiobook standard), ~5.1 chars/word → ~13.43 chars/sec.

const BASE_WPM = 158;
const AVG_CHARS_PER_WORD = 5.1;
const BASE_CHARS_PER_SEC = (BASE_WPM * AVG_CHARS_PER_WORD) / 60;

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
        if (!isTauri()) return;
        this._clearPending();
        if (!text.trim()) return;

        this.fullText = text;
        this.fullWords = text.trim().split(/\s+/);
        this.voice = voiceParam;
        this.startTime = performance.now();
        this.setState('loading');

        try {
            await tauriInvoke("tts_speak", { text, voice: voiceParam || "" });
            this.setState('playing');

            const estimatedMs = Math.max(2000, (text.length / this.charsPerSec) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                const actualSec = (performance.now() - this.startTime) / 1000;
                const estimatedSec = text.length / this.charsPerSec;
                if (actualSec > 1 && estimatedSec > 1) {
                    this.charsPerSec = this.charsPerSec * 0.8 + (text.length / actualSec) * 0.2;
                }
                this._onDone();
            }, estimatedMs);
        } catch (err: unknown) {
            this._onDone();
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        if (this._state !== 'playing' || !isTauri()) return;
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        // Try real pause first (Linux spd-say supports it). Fall back to stop + estimate.
        try {
            await tauriInvoke("tts_pause");
            // On Linux, real pause succeeded. Start counting elapsed time for resume position.
            const elapsedMs = performance.now() - this.startTime;
            const elapsedSec = elapsedMs / 1000;
            const charsSpoken = Math.floor(elapsedSec * this.charsPerSec);
            let charCount = 0;
            let wordsToDrop = 0;
            for (let i = 0; i < this.fullWords.length; i++) {
                charCount += this.fullWords[i].length;
                if (charCount >= charsSpoken) { wordsToDrop = i + 1; break; }
            }
            this.fullText = this.fullWords.slice(wordsToDrop).join(" ");
            this.fullWords = this.fullWords.slice(wordsToDrop);
        } catch {
            // Not supported — stop instead and estimate position.
            await tauriInvoke("tts_stop").catch(() => {});
            const elapsedSec = (performance.now() - this.startTime) / 1000;
            const charsSpoken = Math.floor(elapsedSec * this.charsPerSec);
            let charCount = 0;
            let wordsToDrop = 0;
            for (let i = 0; i < this.fullWords.length; i++) {
                charCount += this.fullWords[i].length;
                if (charCount >= charsSpoken) { wordsToDrop = i + 1; break; }
            }
            this.fullText = this.fullWords.slice(wordsToDrop).join(" ");
            this.fullWords = this.fullWords.slice(wordsToDrop);
        }
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused' || !isTauri()) return;
        // Try real resume first (Linux spd-say supports it).
        try {
            await tauriInvoke("tts_resume");
            this.startTime = performance.now();
            const remainingLength = this.fullText.length;
            const estimatedMs = Math.max(2000, (remainingLength / this.charsPerSec) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                this._onDone();
            }, estimatedMs);
            this.setState('playing');
            return;
        } catch {
            // Not supported — re-speak the remaining text.
        }
        const remaining = this.fullText.trim();
        if (!remaining) { this._onDone(); return; }
        await this.speak(remaining, this.voice);
    }

    async stop() {
        this._clearPending();
        await tauriInvoke("tts_stop").catch(() => {});
        this._onDone();
    }

    private _clearPending() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
    }

    private _onDone() {
        this.fullText = '';
        this.fullWords = [];
        this.voice = null;
        this.charsPerSec = BASE_CHARS_PER_SEC;
        this.setState('idle');
        this.callbacks.onComplete?.();
    }

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        if (!isTauri()) return [];
        try {
            const voices = await tauriInvoke("tts_get_voices");
            if (voices && voices.length > 0) {
                return (voices as Array<{ name: string; locale: string }>).map(v => ({ name: v.name, lang: v.locale }));
            }
        } catch { /* no voices available */ }
        return [];
    }

    static async loadVoices(): Promise<{ name: string; lang: string }[]> {
        return ImmersionPlayer.getVoices();
    }

    destroy() {
        this._clearPending();
        if (isTauri()) {
            tauriInvoke("tts_stop").catch(() => {});
        }
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
