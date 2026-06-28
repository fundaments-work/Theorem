/**
 * ImmersionPlayer — Web Audio playback engine for streamed TTS chunks.
 *
 * Listens for `audio-chunk`, `tts-error`, and `tts-done` Tauri events.
 * Each chunk is scheduled on the Web Audio timeline so playback is
 * gapless and starts as soon as the first chunk arrives.
 *
 * Pitch-preserved speed control via SoundTouch offline time-stretching.
 * Each chunk is stretched before scheduling — synthesis stays at 1×.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

/// Whether to use SoundTouch offline stretching (desktop) or simple
/// playbackRate (mobile). SoundTouch gives pitch-preserved speed but
/// blocks the main thread per chunk — too slow on mobile CPUs.
const USE_SOUNDTOUCH = typeof window !== 'undefined'
    && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/// Output gain boost — Kokoro audio peaks around 0.5, so 3× brings it
/// to a comfortable listening level without clipping.
const OUTPUT_GAIN = 3.0;

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onChunkPlayed?: (chunkIndex: number, totalChunks: number) => void;
    onComplete?: () => void;
    /** Fired when the backend finishes synthesizing ALL chunks (tts-done).
     *  Audio is still playing on the Web Audio timeline — this is the ideal
     *  moment to start preloading the next page's audio. */
    onSynthesisComplete?: () => void;
}

interface TtsChunkPayload {
    audio_data: number[];
    sample_rate: number;
    words: Array<{
        word: string;
        start_time: number;
        end_time: number;
        dom_id: string;
    }>;
    chunk_index: number;
    total_chunks: number;
    generation_id: number;
}

/// Stretch raw audio samples via SoundTouch to the target speed (tempo).
/// Returns a new AudioBuffer with the stretched audio, or the original if speed ≈ 1.
/// On mobile, SoundTouch is skipped — playbackRate is used instead (with
/// pitch shift) to avoid blocking the main thread.
function stretchChunk(
    audioData: number[],
    sampleRate: number,
    speed: number,
    ctx: AudioContext,
): { buffer: AudioBuffer; rate: number } {
    // At 1× speed, or on mobile, just create the buffer directly.
    if (Math.abs(speed - 1.0) < 0.01 || !USE_SOUNDTOUCH) {
        const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
        buffer.getChannelData(0).set(audioData);
        // On mobile, return the rate so handleChunk can set playbackRate.
        return { buffer, rate: USE_SOUNDTOUCH ? 1.0 : speed };
    }

    // Desktop with SoundTouch: stretch offline, return at 1× rate.
    const sourceBuffer = ctx.createBuffer(1, audioData.length, sampleRate);
    sourceBuffer.getChannelData(0).set(audioData);

    const source = new WebAudioBufferSource(sourceBuffer);
    const soundtouch = new SoundTouch();
    soundtouch.tempo = speed;
    const filter = new SimpleFilter(source, soundtouch);

    const CHUNK = 4096;
    const interleaved = new Float32Array(CHUNK * 2);
    const samplesOut: number[] = [];

    let frames: number;
    while ((frames = filter.extract(interleaved, CHUNK)) > 0) {
        for (let i = 0; i < frames; i++) {
            samplesOut.push(interleaved[i * 2]);
        }
    }

    if (samplesOut.length === 0) {
        const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
        buffer.getChannelData(0).set(audioData);
        return { buffer, rate: speed }; // fallback to playbackRate
    }

    const outBuffer = ctx.createBuffer(1, samplesOut.length, sampleRate);
    outBuffer.getChannelData(0).set(new Float32Array(samplesOut));
    return { buffer: outBuffer, rate: 1.0 };
}

export class ImmersionPlayer {
    private audioCtx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private scheduledEnd = 0;
    private callbacks: PlaybackCallbacks = {};
    private unlisteners: UnlistenFn[] = [];
    private _state: PlaybackState = 'idle';
    private chunksReceived = 0;
    private totalChunks = 0;
    private highlightRafId: number | null = null;
    skipOnComplete = false;

    private _speed = 1.0;

    private currentGenId = 0;
    private preloadGenId = 0;
    private preloadChunks: TtsChunkPayload[] = [];
    private preloadChunksReceived = 0;
    private preloadTotalChunks = 0;
    private isPlayingPreload = false;

    get state(): PlaybackState {
        return this._state;
    }

    get speed(): number {
        return this._speed;
    }

    set speed(s: number) {
        this._speed = Math.max(0.25, Math.min(4.0, s));
    }

    private setState(s: PlaybackState) {
        if (this._state === s) return;
        this._state = s;
        this.callbacks.onStateChange?.(s);
    }

    async init(callbacks: PlaybackCallbacks = {}) {
        this.callbacks = callbacks;

        for (const ul of this.unlisteners) ul();
        this.unlisteners = [];

        const u1 = await listen<TtsChunkPayload>('audio-chunk', (event) => {
            const p = event.payload;
            if (p.generation_id === this.preloadGenId && !this.isPlayingPreload) {
                this.bufferChunk(p);
            } else if (p.generation_id === this.currentGenId) {
                this.handleChunk(p);
            }
        });
        const u2 = await listen<{ message: string }>('tts-error', (event) => {
            this.callbacks.onError?.(event.payload.message);
            this.setState('idle');
        });
        const u3 = await listen<{ total_chunks: number }>('tts-done', (event) => {
            this.totalChunks = event.payload.total_chunks;
            this.callbacks.onSynthesisComplete?.();
        });

        this.unlisteners = [u1, u2, u3];
    }

    /** Pre-create the AudioContext within a user-gesture context.
     *  On Android, new AudioContext() must be called synchronously
     *  during a user interaction (click/tap), not in an async callback. */
    prepare(): void {
        this.getAudioCtx();
    }

    setCurrentGenId(id: number) {
        this.currentGenId = id;
        this.isPlayingPreload = false;
    }

    setPreloadGenId(id: number) {
        this.preloadGenId = id;
        this.preloadChunks = [];
        this.preloadChunksReceived = 0;
        this.preloadTotalChunks = 0;
    }

    private bufferChunk(payload: TtsChunkPayload) {
        this.preloadChunks.push(payload);
        this.preloadChunksReceived = payload.chunk_index + 1;
        this.preloadTotalChunks = payload.total_chunks;
    }

    playPreloaded() {
        if (this.preloadGenId === 0 && this.preloadChunks.length === 0) {
            this.preloadChunks = [];
            this.preloadChunksReceived = 0;
            this.preloadTotalChunks = 0;
            return;
        }

        this.clearHighlights();
        this.skipOnComplete = false;

        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
            this.gainNode = null;
        }
        this.scheduledEnd = 0;
        this.chunksReceived = this.preloadChunksReceived;
        this.totalChunks = this.preloadTotalChunks;

        this.currentGenId = this.preloadGenId;
        this.preloadGenId = 0;
        this.isPlayingPreload = false;

        for (const chunk of this.preloadChunks) {
            this.handleChunk(chunk);
        }
        this.preloadChunks = [];
    }

    private getAudioCtx(): AudioContext {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
            // Don't force sampleRate — let the platform choose its native
            // rate to avoid resampling artifacts (especially on Android
            // WebView where 24000 Hz may not be supported).
            this.audioCtx = new AudioContext();
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = OUTPUT_GAIN;
            this.gainNode.connect(this.audioCtx.destination);
        }
        return this.audioCtx;
    }

    private handleChunk(payload: TtsChunkPayload) {
        const ctx = this.getAudioCtx();

        if (ctx.state === 'suspended' && this._state !== 'paused') {
            ctx.resume();
        }

        // Time-stretch the raw audio at the current speed.
        // On mobile, this returns the original buffer + a playbackRate
        // (pitch shifts but no main-thread blocking).
        // On desktop, SoundTouch stretches offline (pitch preserved).
        const { buffer: stretched, rate } = stretchChunk(
            payload.audio_data,
            payload.sample_rate,
            this._speed,
            ctx,
        );

        const source = ctx.createBufferSource();
        source.buffer = stretched;
        source.playbackRate.value = rate;
        // Route through the gain node for volume boost.
        source.connect(this.gainNode ?? ctx.destination);

        const effectiveDuration = stretched.duration / rate;
        const startAt = Math.max(ctx.currentTime, this.scheduledEnd);
        source.start(startAt);
        this.scheduledEnd = startAt + effectiveDuration;
        this.chunksReceived = payload.chunk_index + 1;
        this.totalChunks = payload.total_chunks;

        // Scale word timestamps to match stretched duration ratio
        const stretchRatio = payload.audio_data.length > 0
            ? (stretched.length / rate) / payload.audio_data.length
            : 1.0;
        const scaledWords = payload.words.map((w) => ({
            ...w,
            start_time: w.start_time * stretchRatio,
            end_time: w.end_time * stretchRatio,
        }));

        this.trackHighlight(scaledWords, startAt);

        if (this._state !== 'playing' && this._state !== 'paused') {
            this.setState('playing');
        }

        this.callbacks.onChunkPlayed?.(payload.chunk_index, payload.total_chunks);

        source.onended = () => {
            if (ctx.currentTime < this.scheduledEnd - 0.05) return;
            if (this.totalChunks > 0 && this.chunksReceived >= this.totalChunks) {
                this.clearHighlights();
                this.setState('idle');
                if (!this.skipOnComplete) {
                    this.callbacks.onComplete?.();
                }
            }
        };
    }

    private trackHighlight(
        words: TtsChunkPayload['words'],
        chunkStartTime: number,
    ) {
        if (words.length === 0) return;

        const ctx = this.getAudioCtx();

        const update = () => {
            if (this._state !== 'playing') return;

            const elapsed = ctx.currentTime - chunkStartTime;
            const activeWord = words.find(
                (w) => elapsed >= w.start_time && elapsed <= w.end_time,
            );

            if (activeWord?.dom_id) {
                this.highlightWord(activeWord.dom_id);
            }

            const lastEnd = words[words.length - 1]?.end_time ?? 0;
            if (elapsed < lastEnd) {
                this.highlightRafId = requestAnimationFrame(update);
            }
        };

        this.highlightRafId = requestAnimationFrame(update);
    }

    private highlightWord(domId: string) {
        const container = document.getElementById('foliate-view-container');
        if (!container) return;

        const iframes = container.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const doc = iframe.contentDocument;
                if (!doc) continue;

                doc.querySelectorAll('.tts-word.active').forEach((el) =>
                    el.classList.remove('active'),
                );

                const target = doc.getElementById(domId);
                if (target) {
                    target.classList.add('active');
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                    });
                }
            } catch {
                // Cross-origin — skip
            }
        }
    }

    private clearHighlights() {
        if (this.highlightRafId !== null) {
            cancelAnimationFrame(this.highlightRafId);
            this.highlightRafId = null;
        }

        const container = document.getElementById('foliate-view-container');
        if (!container) return;
        container.querySelectorAll('iframe').forEach((iframe) => {
            try {
                iframe.contentDocument
                    ?.querySelectorAll('.tts-word.active')
                    .forEach((el) => el.classList.remove('active'));
            } catch {
                // skip
            }
        });
    }

    async pause() {
        if (this.audioCtx && this.audioCtx.state === 'running') {
            await this.audioCtx.suspend();
            this.setState('paused');
        }
    }

    async resume() {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
            this.setState('playing');
        }
    }

    stop() {
        this.clearHighlights();
        this.skipOnComplete = false;

        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
            this.gainNode = null;
        }

        this.scheduledEnd = 0;
        this.chunksReceived = 0;
        this.totalChunks = 0;
        this.currentGenId = 0;
        this.preloadGenId = 0;
        this.preloadChunks = [];
        this.preloadChunksReceived = 0;
        this.preloadTotalChunks = 0;
        this.isPlayingPreload = false;
        this.setState('idle');
    }

    destroy() {
        this.stop();
        for (const ul of this.unlisteners) ul();
        this.unlisteners = [];
    }
}

export const immersionPlayer = new ImmersionPlayer();
