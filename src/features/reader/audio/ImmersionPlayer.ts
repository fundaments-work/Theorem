/**
 * ImmersionPlayer — Web Audio playback engine for streamed TTS chunks.
 *
 * Listens for `audio-chunk`, `tts-error`, and `tts-done` Tauri events.
 * Each chunk is scheduled on the Web Audio timeline so playback is
 * gapless and starts as soon as the first chunk arrives.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackCallbacks {
    onStateChange?: (state: PlaybackState) => void;
    onError?: (message: string) => void;
    onChunkPlayed?: (chunkIndex: number, totalChunks: number) => void;
    onComplete?: () => void;
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
}

export class ImmersionPlayer {
    private audioCtx: AudioContext | null = null;
    private scheduledEnd = 0; // The audio-time at which the last scheduled buffer ends
    private callbacks: PlaybackCallbacks = {};
    private unlisteners: UnlistenFn[] = [];
    private _state: PlaybackState = 'idle';
    private chunksReceived = 0;
    private totalChunks = 0;
    private highlightRafId: number | null = null;
    /** When true, onComplete callback is suppressed (used for voice testing). */
    skipOnComplete = false;

    get state(): PlaybackState {
        return this._state;
    }

    private setState(s: PlaybackState) {
        if (this._state === s) return;
        this._state = s;
        this.callbacks.onStateChange?.(s);
    }

    /** Must be called once at app startup to wire up Tauri event listeners. */
    async init(callbacks: PlaybackCallbacks = {}) {
        this.callbacks = callbacks;

        // Clean up any old listeners
        for (const ul of this.unlisteners) ul();
        this.unlisteners = [];

        const u1 = await listen<TtsChunkPayload>('audio-chunk', (event) => {
            this.handleChunk(event.payload);
        });
        const u2 = await listen<{ message: string }>('tts-error', (event) => {
            console.error('[ImmersionPlayer] TTS error:', event.payload.message);
            this.callbacks.onError?.(event.payload.message);
            this.setState('idle');
        });
        const u3 = await listen<{ total_chunks: number }>('tts-done', (event) => {
            console.log('[ImmersionPlayer] TTS done, total chunks:', event.payload.total_chunks);
            this.totalChunks = event.payload.total_chunks;
        });

        this.unlisteners = [u1, u2, u3];
    }

    /** Get or lazily create an AudioContext (requires user gesture on first call). */
    private getAudioCtx(): AudioContext {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
            this.audioCtx = new AudioContext({ sampleRate: 24000 });
        }
        return this.audioCtx;
    }

    /** Handle an incoming audio chunk from the backend. */
    private handleChunk(payload: TtsChunkPayload) {
        const ctx = this.getAudioCtx();

        // If we're suspended (paused), resume — the chunk will play once resumed
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        // Create the buffer
        const buffer = ctx.createBuffer(1, payload.audio_data.length, payload.sample_rate);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < payload.audio_data.length; i++) {
            channelData[i] = payload.audio_data[i];
        }

        // Schedule gaplessly on the timeline
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const startAt = Math.max(ctx.currentTime, this.scheduledEnd);
        source.start(startAt);
        this.scheduledEnd = startAt + buffer.duration;
        this.chunksReceived = payload.chunk_index + 1;
        this.totalChunks = payload.total_chunks;

        // Start highlight tracking for this chunk
        this.trackHighlight(payload.words, startAt);

        // Transition to playing on first chunk
        if (this._state !== 'playing' && this._state !== 'paused') {
            this.setState('playing');
        }

        // Notify progress
        this.callbacks.onChunkPlayed?.(payload.chunk_index, payload.total_chunks);

        // When the last scheduled source ends, go idle
        source.onended = () => {
            // Check if this was the last chunk and nothing else is scheduled
            if (ctx.currentTime >= this.scheduledEnd - 0.05) {
                this.clearHighlights();
                this.setState('idle');
                
                // If we've received all chunks, we naturally finished the section
                if (this.totalChunks > 0 && this.chunksReceived === this.totalChunks) {
                    if (!this.skipOnComplete) {
                        this.callbacks.onComplete?.();
                    }
                }
            }
        };
    }

    /** Track word highlighting during playback of a chunk. */
    private trackHighlight(
        words: TtsChunkPayload['words'],
        chunkStartTime: number,
    ) {
        // For now, since we're sending whole-sentence words with start=0/end=duration,
        // we just highlight the dom_id for the duration of the chunk.
        // This will get per-word granularity once we add phoneme alignment.
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

            // Keep running while chunk is active
            const lastEnd = words[words.length - 1]?.end_time ?? 0;
            if (elapsed < lastEnd) {
                this.highlightRafId = requestAnimationFrame(update);
            }
        };

        this.highlightRafId = requestAnimationFrame(update);
    }

    private highlightWord(domId: string) {
        // Search inside foliate iframes
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

        // Clear in iframes
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

    /** Pause playback (keeps position). */
    async pause() {
        if (this.audioCtx && this.audioCtx.state === 'running') {
            await this.audioCtx.suspend();
            this.setState('paused');
        }
    }

    /** Resume playback from paused state. */
    async resume() {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
            this.setState('playing');
        }
    }

    /** Hard stop — discards all queued audio. */
    stop() {
        this.clearHighlights();
        this.skipOnComplete = false;

        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
        }

        this.scheduledEnd = 0;
        this.chunksReceived = 0;
        this.totalChunks = 0;
        this.setState('idle');
    }

    /** Clean up everything (call on unmount). */
    destroy() {
        this.stop();
        for (const ul of this.unlisteners) ul();
        this.unlisteners = [];
    }
}

/** Singleton instance. */
export const immersionPlayer = new ImmersionPlayer();
