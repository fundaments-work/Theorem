/**
 * ImmersionPlayer — system-native TTS via the Web Speech API.
 *
 * Uses `window.speechSynthesis` which delegates to the platform's
 * native TTS engine (NSSpeechSynthesizer on macOS, SAPI on Windows,
 * speech-dispatcher on Linux, TextToSpeech on Android).
 *
 * Zero binary cost, no Rust IPC needed for playback.
 */
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

    /**
     * Speak the given text. Returns immediately — playback is async.
     * The `onComplete` callback fires when speech ends naturally,
     * enabling auto-advance for immersion/audiobook mode.
     */
    speak(text: string, voice: string | null, rate: number = 1) {
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;

        if (voice) {
            const voices = speechSynthesis.getVoices();
            const match = voices.find(v => v.name === voice || v.lang.startsWith(voice));
            if (match) utterance.voice = match;
        }

        utterance.onstart = () => this.setState('playing');
        utterance.onpause = () => this.setState('paused');
        utterance.onresume = () => this.setState('playing');
        utterance.onend = () => {
            this.setState('idle');
            this.callbacks.onComplete?.();
        };
        utterance.onerror = (event) => {
            this.setState('idle');
            if (event.error !== 'canceled' && event.error !== 'interrupted') {
                this.callbacks.onError?.(event.error);
            }
        };

        this.setState('loading');
        speechSynthesis.speak(utterance);
    }

    pause() {
        speechSynthesis.pause();
    }

    resume() {
        speechSynthesis.resume();
    }

    stop() {
        speechSynthesis.cancel();
        this.setState('idle');
    }

    /** Get available system voices. */
    static getVoices(): SpeechSynthesisVoice[] {
        return speechSynthesis.getVoices();
    }

    /** Preload voices. Call once on user interaction. */
    static loadVoices(): Promise<SpeechSynthesisVoice[]> {
        return new Promise((resolve) => {
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                resolve(voices);
                return;
            }
            speechSynthesis.onvoiceschanged = () => {
                resolve(speechSynthesis.getVoices());
            };
        });
    }

    destroy() {
        this.stop();
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
