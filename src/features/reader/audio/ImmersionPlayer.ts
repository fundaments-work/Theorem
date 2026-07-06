/**
 * ImmersionPlayer — native platform TTS.
 *
 * Desktop: Web Speech API (window.speechSynthesis) which delegates to
 *   speech-dispatcher on Linux, NSSpeechSynthesizer on macOS, SAPI on Windows.
 *   Real pause/resume, real completion callbacks, voice selection.
 *
 * Android: android.speech.tts.TextToSpeech via Tauri plugin.
 */
import { invoke } from "@tauri-apps/api/core";

// ─── Platform detection ───

let _isAndroid: boolean | null = null;

function isAndroid(): boolean {
    if (_isAndroid !== null) return _isAndroid;
    try {
        _isAndroid = !!(window as any).__TAURI_INTERNALS__ &&
            navigator.userAgent.toLowerCase().includes('android');
    } catch {
        _isAndroid = false;
    }
    return _isAndroid;
}

function synthAvailable(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
}

// ─── Types ───

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onComplete?: () => void;
}

// ─── Player ───

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
    // Tauri estimation state (Android only — no real pause/reume)
    private fullText: string = '';
    private fullWords: string[] = [];
    private voice: string | null = null;
    private startTime: number = 0;
    private completeTimer: ReturnType<typeof setTimeout> | null = null;

    get state(): PlaybackState { return this._state; }

    private setState(s: PlaybackState) {
        if (this._state === s) return;
        this._state = s;
        this.callbacks.onStateChange?.(s);
    }

    init(callbacks: PlaybackCallbacks = {}) {
        this.callbacks = callbacks;
    }

    // ─── Speak ───

    async speak(text: string, voiceParam: string | null, rate: number = 1) {
        this._clearPending();
        if (!text.trim()) return;

        if (isAndroid()) {
            await this._speakAndroid(text, voiceParam);
        } else if (synthAvailable()) {
            this._speakWeb(text, voiceParam, rate);
        }
        // No TTS available: silently ignore
    }

    // ─── Android (invoke → TextToSpeech plugin) ───

    private async _speakAndroid(text: string, voiceParam: string | null) {
        const BASE_CHARS_PER_SEC = (158 * 5.1) / 60; // 158 wpm × 5.1 chars = ~13.4 cps
        this.fullText = text;
        this.fullWords = text.trim().split(/\s+/);
        this.voice = voiceParam;
        this.startTime = performance.now();
        this.setState('loading');
        try {
            await invoke("tts_speak", { text, voice: voiceParam || "" });
            this.setState('playing');
            const estimatedMs = Math.max(2000, (text.length / BASE_CHARS_PER_SEC) * 1000);
            this.completeTimer = setTimeout(() => {
                this.completeTimer = null;
                this._onDone();
            }, estimatedMs);
        } catch (err: unknown) {
            this._onDone();
            this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
    }

    private async _pauseAndroid() {
        if (this.completeTimer) { clearTimeout(this.completeTimer); this.completeTimer = null; }
        await invoke("tts_stop").catch(() => {});
        const elapsedSec = (performance.now() - this.startTime) / 1000;
        const charsSpoken = Math.floor(elapsedSec * ((158 * 5.1) / 60));
        let charCount = 0, wordsToDrop = 0;
        for (let i = 0; i < this.fullWords.length; i++) {
            charCount += this.fullWords[i].length;
            if (charCount >= charsSpoken) { wordsToDrop = i + 1; break; }
        }
        this.fullText = this.fullWords.slice(wordsToDrop).join(" ");
        this.fullWords = this.fullWords.slice(wordsToDrop);
    }

    private async _resumeAndroid() {
        const remaining = this.fullText.trim();
        if (!remaining) { this._onDone(); return; }
        await this._speakAndroid(remaining, this.voice);
    }

    // ─── Web Speech API (desktop) ───

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
        u.onend = () => this._onDone();
        u.onerror = (e) => {
            this.setState('idle');
            if (e.error !== 'canceled' && e.error !== 'interrupted') {
                this.callbacks.onError?.(e.error);
            }
        };

        this.setState('loading');
        s.speak(u);
    }

    // ─── Public controls ───

    async pause() {
        if (this._state !== 'playing') return;
        if (isAndroid()) {
            await this._pauseAndroid();
        } else if (synthAvailable()) {
            window.speechSynthesis.pause();
            return; // state set by onpause callback
        }
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused') return;
        if (isAndroid()) {
            await this._resumeAndroid();
        } else if (synthAvailable()) {
            window.speechSynthesis.resume();
            return; // state set by onresume callback
        }
    }

    async stop() {
        this._clearPending();
        if (isAndroid()) {
            await invoke("tts_stop").catch(() => {});
        } else if (synthAvailable()) {
            window.speechSynthesis.cancel();
        }
        this.fullText = ''; this.fullWords = []; this.voice = null;
        this.setState('idle');
    }

    private _clearPending() {
        if (this.completeTimer) { clearTimeout(this.completeTimer); this.completeTimer = null; }
    }

    private _onDone() {
        this.fullText = ''; this.fullWords = []; this.voice = null;
        this.setState('idle');
        this.callbacks.onComplete?.();
    }

    // ─── Voices ───

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        if (isAndroid()) {
            try {
                const v = await invoke<Array<{ name: string; locale: string }>>("tts_get_voices");
                if (v.length > 0) return v.map(x => ({ name: x.name, lang: x.locale }));
            } catch { /* fall through */ }
        }
        if (synthAvailable()) {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) return voices.map(v => ({ name: v.name, lang: v.lang }));
        }
        return [];
    }

    static async loadVoices(): Promise<{ name: string; lang: string }[]> {
        if (isAndroid()) {
            const v = await ImmersionPlayer.getVoices();
            if (v.length > 0) return v;
        }
        if (!synthAvailable()) return [];
        return new Promise(resolve => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) { resolve(voices.map(v => ({ name: v.name, lang: v.lang }))); return; }
            window.speechSynthesis.onvoiceschanged = () => {
                resolve(window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang })));
            };
        });
    }

    destroy() {
        this._clearPending();
        if (isAndroid()) { invoke("tts_stop").catch(() => {}); }
        else if (synthAvailable()) { window.speechSynthesis.cancel(); }
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
