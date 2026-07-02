/**
 * ImmersionPlayer — state machine + word-highlighting for TTS.
 *
 * Audio is played entirely by the Rust backend (rodio on desktop,
 * AudioTrack on Android). The JS side only tracks playback state,
 * fires completion callbacks, highlights words, and sends pause/
 * resume/stop commands via invoke.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onChunkPlayed?: (chunkIndex: number, totalChunks: number) => void;
    onComplete?: () => void;
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

export class ImmersionPlayer {
    private callbacks: PlaybackCallbacks = {};
    private unlisteners: UnlistenFn[] = [];
    private _state: PlaybackState = 'idle';
    private chunksReceived = 0;
    private totalChunks = 0;
    skipOnComplete = false;

    private _speed = 1.0;

    private currentGenId = 0;
    private preloadGenId = 0;
    private preloadChunks: TtsChunkPayload[] = [];
    private preloadChunksReceived = 0;
    private preloadTotalChunks = 0;
    private isPlayingPreload = false;

    /** Reference to the pending completion timeout so we can clear it on stop. */
    private completeTimer: ReturnType<typeof setTimeout> | null = null;

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

    private initPromise: Promise<void> | null = null;
    private isDestroyed = false;

    async init(callbacks: PlaybackCallbacks = {}) {
        if (callbacks.onStateChange) this.callbacks.onStateChange = callbacks.onStateChange;
        if (callbacks.onError) this.callbacks.onError = callbacks.onError;
        if (callbacks.onComplete) this.callbacks.onComplete = callbacks.onComplete;
        if (callbacks.onChunkPlayed) this.callbacks.onChunkPlayed = callbacks.onChunkPlayed;
        if (callbacks.onSynthesisComplete) this.callbacks.onSynthesisComplete = callbacks.onSynthesisComplete;

        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.isDestroyed = false;
        this.initPromise = (async () => {
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

            if (this.isDestroyed) {
                u1();
                u2();
                u3();
            } else {
                this.unlisteners = [u1, u2, u3];
            }
        })();

        await this.initPromise;
    }

    /** No-op — AudioContext is no longer used. Native audio plays from Rust. */
    prepare(): void {}

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

    async playPreloaded() {
        if (this.preloadGenId === 0 && this.preloadChunks.length === 0) {
            this.preloadChunks = [];
            this.preloadChunksReceived = 0;
            this.preloadTotalChunks = 0;
            return;
        }

        this.clearHighlights();
        this.skipOnComplete = false;

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

    private handleChunk(payload: TtsChunkPayload) {
        this.chunksReceived = payload.chunk_index + 1;
        this.totalChunks = payload.total_chunks;

        // Highlight the first word immediately — audio plays in step with
        // chunk arrival so the visual cue matches what the user hears.
        if (payload.words.length > 0) {
            this.highlightWord(payload.words[0].dom_id);
        }

        if (this._state !== 'playing' && this._state !== 'paused') {
            this.setState('playing');
        }

        this.callbacks.onChunkPlayed?.(payload.chunk_index, payload.total_chunks);

        // When the final chunk arrives, schedule completion after the
        // estimated playback duration of that last chunk.
        if (this.totalChunks > 0 && this.chunksReceived >= this.totalChunks) {
            this.scheduleCompletion(payload);
        }
    }

    private scheduleCompletion(lastChunk: TtsChunkPayload) {
        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
        }
        const estMs = (lastChunk.audio_data.length / lastChunk.sample_rate) * 1000;
        this.completeTimer = setTimeout(() => {
            this.completeTimer = null;
            this.clearHighlights();
            this.setState('idle');
            if (!this.skipOnComplete) {
                this.callbacks.onComplete?.();
            }
        }, estMs + 300);
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
        try {
            await invoke('pause_speech');
        } catch (e) {
            console.warn('[ImmersionPlayer] pause failed:', e);
        }
        this.setState('paused');
    }

    async resume() {
        try {
            await invoke('resume_speech');
        } catch (e) {
            console.warn('[ImmersionPlayer] resume failed:', e);
        }
        this.setState('playing');
    }

    stop() {
        this.clearHighlights();
        this.skipOnComplete = false;

        if (this.completeTimer) {
            clearTimeout(this.completeTimer);
            this.completeTimer = null;
        }

        invoke('stop_speech').catch((e) => {
            console.warn('[ImmersionPlayer] stop failed:', e);
        });

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
        this.isDestroyed = true;
        for (const ul of this.unlisteners) ul();
        this.unlisteners = [];
        this.initPromise = null;
    }
}

export const immersionPlayer = new ImmersionPlayer();
