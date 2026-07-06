/**
 * ImmersionPlayer — system-native TTS via the Web Speech API.
 *
 * Uses `window.speechSynthesis` which delegates to the platform's
 * native TTS engine (NSSpeechSynthesizer on macOS, SAPI on Windows,
 * speech-dispatcher on Linux, TextToSpeech on Android).
 *
 * Zero binary cost, no Rust IPC needed for playback.
 */

function synth(): SpeechSynthesis {
    return window.speechSynthesis;
}

function synthAvailable(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
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

    speak(text: string, voice: string | null, rate: number = 1) {
        if (!synthAvailable()) return;
        synth().cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;

        if (voice) {
            const voices = synth().getVoices();
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
        synth().speak(utterance);
    }

    pause() {
        if (synthAvailable()) synth().pause();
    }

    resume() {
        if (synthAvailable()) synth().resume();
    }

    stop() {
        if (synthAvailable()) synth().cancel();
        this.setState('idle');
    }

    static getVoices(): SpeechSynthesisVoice[] {
        if (!synthAvailable()) return [];
        return synth().getVoices();
    }

    static loadVoices(): Promise<SpeechSynthesisVoice[]> {
        return new Promise((resolve) => {
            if (!synthAvailable()) {
                resolve([]);
                return;
            }
            const voices = synth().getVoices();
            if (voices.length > 0) {
                resolve(voices);
                return;
            }
            synth().onvoiceschanged = () => {
                resolve(synth().getVoices());
            };
        });
    }

    destroy() {
        this.stop();
        this.callbacks = {};
    }
}

export const immersionPlayer = new ImmersionPlayer();
