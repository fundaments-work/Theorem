/**
 * ImmersionPlayer — native platform TTS.
 * Android: TextToSpeech plugin. Desktop: shell commands via invoke.
 * All Tauri platforms share the same estimation-based pause/resume.
 */
import { invoke } from "@tauri-apps/api/core";

let _isAndroid: boolean | null = null;

function isAndroid(): boolean {
    if (_isAndroid !== null) return _isAndroid;
    try {
        _isAndroid = !!(window as any).__TAURI_INTERNALS__ &&
            navigator.userAgent.toLowerCase().includes('android');
    } catch { _isAndroid = false; }
    return _isAndroid;
}

function isTauri(): boolean {
    try { return !!(window as any).__TAURI_INTERNALS__; }
    catch { return false; }
}

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onComplete?: () => void;
}

const BASE_CHARS_PER_SEC = (158 * 5.1) / 60;

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private _state: PlaybackState = 'idle';
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

    init(callbacks: PlaybackCallbacks = {}) { this.callbacks = callbacks; }

    async speak(text: string, voiceParam: string | null, _rate: number = 1) {
        this._clearPending();
        if (!text.trim() || !isTauri()) return;

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
            this._onError(err instanceof Error ? err.message : String(err));
        }
    }

    async pause() {
        if (this._state !== 'playing') return;
        if (this.completeTimer) { clearTimeout(this.completeTimer); this.completeTimer = null; }
        await invoke("tts_stop").catch(e => console.error("[catch]", e));
        // Estimate position and truncate to word boundary.
        const elapsedSec = (performance.now() - this.startTime) / 1000;
        const charsSpoken = Math.floor(elapsedSec * BASE_CHARS_PER_SEC);
        let charCount = 0, wordsToDrop = 0;
        for (let i = 0; i < this.fullWords.length; i++) {
            charCount += this.fullWords[i].length;
            if (charCount >= charsSpoken) { wordsToDrop = i + 1; break; }
        }
        this.fullText = this.fullWords.slice(wordsToDrop).join(" ");
        this.fullWords = this.fullWords.slice(wordsToDrop);
        this.setState('paused');
    }

    async resume() {
        if (this._state !== 'paused' || !isTauri()) return;
        const remaining = this.fullText.trim();
        if (!remaining) { this._onDone(); return; }
        await this.speak(remaining, this.voice);
    }

    async stop() {
        this._clearPending();
        if (isTauri()) await invoke("tts_stop").catch(e => console.error("[catch]", e));
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

    private _onError(msg: string) {
        this.fullText = ''; this.fullWords = []; this.voice = null;
        this.setState('idle');
        this.callbacks.onError?.(msg);
    }

    static async getVoices(): Promise<{ name: string; lang: string }[]> {
        if (isAndroid()) {
            try {
                const v = await invoke<Array<{ name: string; locale: string }>>("tts_get_voices");
                if (v.length > 0) return v.map(x => ({ name: x.name, lang: x.locale }));
            } catch { /* fall through */ }
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) return voices.map(v => ({ name: v.name, lang: v.lang }));
        }
        return [];
    }

    static async loadVoices(): Promise<{ name: string; lang: string }[]> {
        return ImmersionPlayer.getVoices();
    }

    destroy() {
        this._clearPending();
        if (isTauri()) invoke("tts_stop").catch(e => console.error("[catch]", e));
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
