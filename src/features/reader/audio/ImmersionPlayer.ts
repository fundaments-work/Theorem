/**
 * ImmersionPlayer — system TTS, native on all platforms.
 *
 * Tauri (Android/desktop): Tauri invoke commands → native OS speech engines.
 * Web (browser): Web Speech API (window.speechSynthesis) — real pause/resume,
 *   real completion callbacks, no estimation needed.
 */

let _invoke: any = null;
async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!_invoke) {
        try {
            const mod = await import("@tauri-apps/api/core");
            _invoke = mod.invoke;
        } catch {
            throw new Error("Tauri not available");
        }
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

// ─── Tauri backend (estimate-based, no real completion) ───

const BASE_WPM = 158;
const AVG_CHARS_PER_WORD = 5.1;
const BASE_CHARS_PER_SEC = (BASE_WPM * AVG_CHARS_PER_WORD) / 60; // ≈ 13.43

// ─── Unified player ───

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
    // Tauri estimation state
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

    async speak(text: string, voiceParam: string | null, rate: number = 1) {
        this._clearPending();
        if (!text.trim()) return;

        if (isTauri()) {
            await this._speakTauri(text, voiceParam);
        } else {
            this._speakWeb(text, voiceParam, rate);
        }
    }

    // ─── Tauri path (invoke → OS speech) ───

    private async _speakTauri(text: string, voiceParam: string | null) {
        this.fullText = text;
        this.fullWords = text.trim().split(/\s+/);
        this.voice = voiceParam;
        this.startTime = performance.now();
        this.setState('loading');

        try {
            await tauriInvoke("tts_speak", { text, voice: voiceParam || "" });
            this.setState('playing');
            this._scheduleTauriCompletion(text);
        } catch (err: unknown) {
            this._onDone();
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    private _scheduleTauriCompletion(text: string) {
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
    }

    private async _pauseTauri() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        await tauriInvoke("tts_stop").catch(() => {});
        // Truncate to word boundary at estimated position.
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

    private async _resumeTauri() {
        const remaining = this.fullText.trim();
        if (!remaining) { this._onDone(); return; }
        await this._speakTauri(remaining, this.voice);
    }

    private async _stopTauri() {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }
        await tauriInvoke("tts_stop").catch(() => {});
    }

    // ─── Web path (window.speechSynthesis — real pause/resume) ───

    private _speakWeb(text: string, voiceParam: string | null, rate: number) {
        const s = window.speechSynthesis;
        s.cancel();

        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;

        if (voiceParam) {
            const voices = s.getVoices();
            const match = voices.find(v => v.name === voiceParam);
            if (match) u.voice = match;
        }

        u.onstart = () => this.setState('playing');
        u.onpause = () => this.setState('paused');
        u.onresume = () => this.setState('playing');
        u.onend = () => { this._onDone(); };
        u.onerror = (e) => {
            if (e.error !== 'canceled' && e.error !== 'interrupted') {
                this.callbacks.onError?.(e.error);
            }
            this.setState('idle');
        };

        this.setState('loading');
        s.speak(u);
    }

    private _pauseWeb() {
        window.speechSynthesis.pause();
    }

    private _resumeWeb() {
        window.speechSynthesis.resume();
    }

    private _stopWeb() {
        window.speechSynthesis.cancel();
    }

    // ─── Public controls ───

    async pause() {
        if (this._state !== 'playing') return;
        if (isTauri()) {
            await this._pauseTauri();
        } else {
            this._pauseWeb();
        }
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused') return;
        if (isTauri()) {
            await this._resumeTauri();
        } else {
            this._resumeWeb();
        }
    }

    async stop() {
        this._clearPending();
        if (isTauri()) {
            await this._stopTauri();
        } else {
            this._stopWeb();
        }
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

    // ─── Voices ───

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        if (isTauri()) {
            try {
                const voices = await tauriInvoke("tts_get_voices");
                if (voices.length > 0) {
                    return (voices as Array<{ name: string; locale: string }>).map(v => ({ name: v.name, lang: v.locale }));
                }
            } catch { /* fall through */ }
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
        this._clearPending();
        if (isTauri()) {
            tauriInvoke("tts_stop").catch(() => {});
        } else {
            window.speechSynthesis?.cancel();
        }
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
