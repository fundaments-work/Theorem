/**
 * TTS Manager — audiobook-style Kokoro TTS with Web Audio API playback.
 *
 * Architecture:
 *   Rust:   tts_synthesize(text, voice, speed) → Vec<f32> samples
 *   JS:     AudioContext schedules buffers for seamless streaming playback
 *
 * The Rust backend ONLY handles ONNX model loading and synthesis.
 * All audio playback, scheduling, crossfading, pause/resume, and volume
 * control happens in the frontend via the Web Audio API — eliminating
 * all rodio/ALSA audio device issues.
 *
 * Streaming flow:
 *   1. Split text into sentence-aware chunks
 *   2. Synthesize chunk 0 via IPC → receive f32 samples
 *   3. Create AudioBuffer, schedule playback via AudioBufferSourceNode
 *   4. While chunk 0 plays (~2s), synthesize chunk 1 in parallel
 *   5. Schedule chunk 1 to start exactly when chunk 0 ends
 *   6. Continue until all chunks are done
 *
 * State machine:
 *   idle → loading → ready → playing ↔ paused
 *                            ↓
 *                          error → ready (on stop)
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TtsVoice {
    id: string;
    name: string;
    language: string;
    gender: string;
}

export interface TtsVoiceGroup {
    label: string;
    voices: TtsVoice[];
}

export type TtsStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

export type TtsState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; voices: TtsVoiceGroup[] }
    | { status: "playing" }
    | { status: "paused" }
    | { status: "error"; message: string };

export interface TtsProgress {
    chunk: number;
    total: number;
}

type TtsListener = (state: TtsState, progress: TtsProgress) => void;

interface TtsStatePayload {
    status: string;
    voices: TtsVoiceGroup[] | null;
    message: string | null;
}

/// Max chars per synthesis chunk — keeps first-chunk latency low.
const CHUNK_CHARS = 400;
/// First chunk is shorter for faster time-to-first-audio.
const FIRST_CHUNK_CHARS = 300;
/// Crossfade duration in seconds (10ms — eliminates clicks at boundaries).
const CROSSFADE_SECS = 0.01;
/// Sample rate from Kokoro (always 24kHz).
const SAMPLE_RATE = 24000;
/// Audio gain — Kokoro quantized model can be quiet, but 1.8 causes hard clipping.
const AUDIO_GAIN = 1.0;

/** Split text into sentence chunks for streaming synthesis. */
function splitSentences(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    
    // Avoid positive lookbehind `(?<=...)` because older WebKitGTK throws SyntaxError.
    // Split by punctuation followed by whitespace/newline, OR just newlines.
    // We capture the separator so we can keep the punctuation.
    const parts = trimmed.split(/([.!?]+(?:[\s\n]+|$))|\n+/);
    
    const sentences: string[] = [];
    let current = "";
    
    for (const part of parts) {
        if (!part) continue;
        if (/^[.!?]+(?:[\s\n]+|$)/.test(part) || part === "\n") {
            current += part;
            sentences.push(current.trim());
            current = "";
        } else {
            current += part;
        }
    }
    if (current.trim()) {
        sentences.push(current.trim());
    }
    
    return sentences.filter((s) => s.length > 0);
}

/** Group sentences into chunks of at most maxChars characters. */
function chunkSentences(sentences: string[], maxChars: number): string[] {
    const chunks: string[] = [];
    let current = "";
    
    for (const sentence of sentences) {
        const limit = chunks.length === 0 ? FIRST_CHUNK_CHARS : maxChars;
        
        // If adding this sentence exceeds the limit, push the current chunk.
        if (current.length + sentence.length > limit && current.length > 0) {
            chunks.push(current.trim());
            current = "";
        }
        
        // If the sentence ITSELF is longer than the limit, we MUST split it 
        // forcefully by commas or words, otherwise Kokoro will hang for 20s.
        if (sentence.length > limit) {
            // Push whatever we have so far
            if (current) {
                chunks.push(current.trim());
                current = "";
            }
            
            // Force-split the massive sentence by commas or just maxChars
            const subParts = sentence.split(/([,;:]\s+)/);
            let subCurrent = "";
            for (const sub of subParts) {
                if (subCurrent.length + sub.length > limit && subCurrent.length > 0) {
                    chunks.push(subCurrent.trim());
                    subCurrent = "";
                }
                subCurrent += sub;
                // If a single word/part is STILL larger than limit, forcefully slice it
                while (subCurrent.length > limit) {
                    chunks.push(subCurrent.slice(0, limit).trim());
                    subCurrent = subCurrent.slice(limit);
                }
            }
            if (subCurrent.trim()) {
                current = subCurrent;
            }
        } else {
            current = current ? `${current} ${sentence}` : sentence;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

class TtsManager {
    private _state: TtsState = { status: "idle" };
    private _listeners: Set<TtsListener> = new Set();
    private _voiceCache: TtsVoiceGroup[] = [];
    private _selectedVoice = "af_heart";
    private _speed = 1.0;
    private _unlistenState: UnlistenFn | null = null;
    private _listenersPromise: Promise<void> | null = null;
    private _refCount = 0;
    private _engineEverLoaded = false;

    // Web Audio API
    private _audioCtx: AudioContext | null = null;
    private _gainNode: GainNode | null = null;
    private _activeSources: AudioBufferSourceNode[] = [];
    private _nextChunkTime = 0;

    // Sentence tracking for skip/progress
    private _fullText = "";
    private _sentences: string[] = [];
    private _currentSentence = 0;
    private _chunks: string[] = [];
    private _progress: TtsProgress = { chunk: 0, total: 0 };

    // Cancellation flag
    private _playbackId = 0;

    get state(): TtsState {
        return this._state;
    }

    get progress(): TtsProgress {
        return this._progress;
    }

    get selectedVoice(): string {
        return this._selectedVoice;
    }

    get speed(): number {
        return this._speed;
    }

    subscribe(listener: TtsListener): () => void {
        this._listeners.add(listener);
        this._refCount++;
        listener(this._state, this._progress);
        return () => {
            this._refCount--;
            this._listeners.delete(listener);
        };
    }

    private emit(state: TtsState) {
        const prev = this._state.status;
        const next = state.status;
        if (prev !== next) {
            console.log(`[TTS] ${prev} → ${next}`);
        }
        this._state = state;
        for (const l of this._listeners) l(state, this._progress);
    }

    private async _ensureEventListeners(): Promise<void> {
        if (this._listenersPromise) return this._listenersPromise;
        if (this._unlistenState) return;

        this._listenersPromise = this._setupListeners();
        try {
            await this._listenersPromise;
        } finally {
            this._listenersPromise = null;
        }
    }

    private async _setupListeners(): Promise<void> {
        this._unlistenState = await listen<TtsStatePayload>("tts-state", (event) => {
            const p = event.payload;
            switch (p.status) {
                case "ready":
                    this._voiceCache = p.voices ?? this._voiceCache;
                    this._engineEverLoaded = true;
                    this.emit({ status: "ready", voices: this._voiceCache });
                    break;
                case "loading":
                    this.emit({ status: "loading" });
                    break;
                case "error":
                    this.emit({ status: "error", message: p.message ?? "Unknown error" });
                    break;
                default:
                    break;
            }
        });
    }

    async prepare(): Promise<void> {
        await this._ensureEventListeners();

        if (this._engineEverLoaded) {
            if (this._state.status !== "ready") {
                this.emit({ status: "ready", voices: this._voiceCache });
            }
            return;
        }

        // Skip tts_is_ready — it's a Rust command that locks INNER,
        // and if the background preload is loading the model, it would
        // block. Just call tts_load directly — it handles deduplication
        // via IS_LOADING + Condvar and is async (non-blocking).
        try {
            await invoke("tts_load");
            // Wait for the "ready" event from tts_load
            await this._waitForStatus("ready");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit({ status: "error", message });
            throw err;
        }
    }

    private async _waitForStatus(
        target: "ready" | "error",
        timeoutMs = 30000,
    ): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (this._state.status === target) return;
            if (this._state.status === "error") return;
            await new Promise((r) => setTimeout(r, 50));
        }
        console.warn(`[TTS] Timed out waiting for "${target}" after ${timeoutMs}ms`);
    }

    setVoice(voiceId: string) {
        this._selectedVoice = voiceId;
    }

    setSpeed(speed: number) {
        this._speed = Math.max(0.5, Math.min(2.0, speed));
    }

    /** Initialize the Web Audio API context. */
    private _ensureAudioContext(): void {
        if (this._audioCtx) return;
        // Don't request a specific sample rate — the WebView may not support
        // custom rates. AudioBuffer specifies its own rate and the Web Audio
        // API resamples automatically.
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this._audioCtx = new Ctx();
        this._gainNode = this._audioCtx.createGain();
        this._gainNode.gain.value = AUDIO_GAIN;
        this._gainNode.connect(this._audioCtx.destination);
        console.log("[TTS] AudioContext created, state:", this._audioCtx.state, "sampleRate:", this._audioCtx.sampleRate);
    }

    /**
     * Create and resume the AudioContext — MUST be called synchronously
     * from a user gesture (e.g. click handler) BEFORE any await.
     *
     * Browsers/WebKitGTK require a user gesture to start audio.
     * If we call resume() after an await, the gesture has expired
     * and the AudioContext stays suspended forever → silence.
     */
    prepareAudio(): void {
        this._ensureAudioContext();
        if (this._audioCtx!.state === "suspended") {
            // Fire and forget — don't await, we're in a sync click handler
            void this._audioCtx!.resume().then(() => {
                console.log("[TTS] AudioContext resumed, state:", this._audioCtx?.state);
            }).catch((err) => {
                console.error("[TTS] AudioContext resume failed:", err);
            });
        } else {
            console.log("[TTS] AudioContext already running, state:", this._audioCtx!.state);
        }
    }

    /** Create an AudioBuffer from raw f32 samples with a fixed gain to prevent whispering. */
    private _createAudioBuffer(samples: number[]): AudioBuffer {
        const ctx = this._audioCtx!;
        const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
        const channelData = buffer.getChannelData(0);
        
        let maxAbs = 0;
        for (let i = 0; i < samples.length; i++) {
            let v = samples[i];
            // Filter out NaN values which break playback
            if (Number.isNaN(v)) v = 0;
            
            if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
            
            // Apply a safe, fixed gain instead of dynamic normalization.
            // Dynamic normalization causes "whispering" if the AI generates a single loud pop artifact.
            channelData[i] = Math.max(-1.0, Math.min(1.0, v * 1.5));
        }
        
        console.log(`[TTS] AudioBuffer created: ${samples.length} samples, ${(buffer.duration).toFixed(2)}s, original_peak=${maxAbs.toFixed(4)}`);
        return buffer;
    }

    /** Schedule an AudioBuffer to play at the specified time. */
    private _scheduleBuffer(buffer: AudioBuffer, startTime: number): AudioBufferSourceNode {
        const ctx = this._audioCtx!;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this._gainNode!);
        source.start(startTime);
        this._activeSources.push(source);
        source.onended = () => {
            const idx = this._activeSources.indexOf(source);
            if (idx >= 0) this._activeSources.splice(idx, 1);
        };
        console.log(`[TTS] Scheduled buffer at ${startTime.toFixed(3)}s (ctx.currentTime=${ctx.currentTime.toFixed(3)}s, ctx.state=${ctx.state})`);
        return source;
    }

    /** Synthesize a single chunk via IPC and return the samples. */
    private async _synthesizeChunk(text: string): Promise<number[]> {
        return await invoke<number[]>("tts_synthesize", {
            text,
            voice: this._selectedVoice,
            speed: this._speed,
        });
    }

    /** Start playing text from the beginning (or a specific sentence index). */
    async speak(text: string, startSentence = 0): Promise<void> {
        await this._ensureEventListeners();
        this.stop();

        await this.prepare();
        if (this._state.status !== "ready") {
            console.error("[TTS] Cannot speak: engine not ready, state =", this._state.status);
            return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
            console.warn("[TTS] No text to speak");
            return;
        }

        // Increment playback ID
        this._playbackId++;
        const currentPlaybackId = this._playbackId;

        this._fullText = trimmed;
        // Split text into sentences for skip tracking, then into chunks for synthesis
        this._sentences = splitSentences(trimmed);
        this._currentSentence = Math.min(startSentence, this._sentences.length - 1);
        const remainingText = this._sentences.slice(this._currentSentence).join(" ");
        this._chunks = chunkSentences(splitSentences(remainingText), CHUNK_CHARS);
        this._progress = { chunk: 0, total: this._chunks.length };

        if (this._chunks.length === 0) {
            console.warn("[TTS] No chunks to synthesize");
            return;
        }

        // AudioContext was already created/resumed by prepareAudio()
        // in the click handler. Just verify it's running.
        this._ensureAudioContext();
        if (this._audioCtx!.state === "suspended") {
            // Try to resume again — shouldn't be needed but just in case
            await this._audioCtx!.resume();
        }
        console.log("[TTS] AudioContext state before playback:", this._audioCtx!.state);

        this.emit({ status: "playing" });
        console.log(`[TTS] Starting playback: ${this._chunks.length} chunks, ${trimmed.length} chars`);

        // Start the streaming synthesis + playback loop
        this._streamPlayback(currentPlaybackId).catch((err) => {
            console.error("[TTS] Streaming playback error:", err);
            this.emit({ status: "error", message: String(err) });
        });
    }

    /** Streaming synthesis + playback loop. */
    private async _streamPlayback(playbackId: number): Promise<void> {
        const ctx = this._audioCtx!;
        this._nextChunkTime = ctx.currentTime + 0.05; // small buffer before first audio
        let chunkIdx = 0;

        // Synthesize first chunk
        const firstChunk = this._chunks[0];
        console.log(`[TTS] Synthesizing chunk 1/${this._chunks.length} (${firstChunk.length} chars)...`);

        let samples: number[];
        try {
            samples = await this._synthesizeChunk(firstChunk);
        } catch (err) {
            if (this._playbackId !== playbackId) return;
            console.error("[TTS] First chunk synthesis failed:", err);
            this.emit({ status: "error", message: String(err) });
            return;
        }

        if (this._playbackId !== playbackId) return;

        const buffer = this._createAudioBuffer(samples);
        this._scheduleBuffer(buffer, this._nextChunkTime);
        this._nextChunkTime += buffer.duration - CROSSFADE_SECS;
        this._progress = { chunk: 1, total: this._chunks.length };
        for (const l of this._listeners) l(this._state, this._progress);
        console.log(`[TTS] Chunk 1 playing (${(buffer.duration).toFixed(1)}s)`);

        chunkIdx = 1;

        // Synthesize remaining chunks while previous ones play
        while (chunkIdx < this._chunks.length) {
            if (this._playbackId !== playbackId) return;

            const chunk = this._chunks[chunkIdx];
            console.log(`[TTS] Synthesizing chunk ${chunkIdx + 1}/${this._chunks.length} (${chunk.length} chars)...`);

            try {
                samples = await this._synthesizeChunk(chunk);
            } catch (err) {
                if (this._playbackId !== playbackId) return;
                console.error(`[TTS] Chunk ${chunkIdx + 1} synthesis failed:`, err);
                // Don't stop on single chunk failure — skip and continue
                chunkIdx++;
                continue;
            }

            if (this._playbackId !== playbackId) return;

            if (samples.length === 0) {
                console.warn(`[TTS] Chunk ${chunkIdx + 1} produced empty samples, skipping`);
                chunkIdx++;
                continue;
            }

            const buf = this._createAudioBuffer(samples);

            // If synthesis took longer than expected, we may have fallen behind.
            // Schedule at max(currentTime, nextChunkTime) to avoid overlap.
            const scheduleTime = Math.max(ctx.currentTime + 0.01, this._nextChunkTime);
            this._scheduleBuffer(buf, scheduleTime);
            this._nextChunkTime = scheduleTime + buf.duration - CROSSFADE_SECS;

            this._progress = { chunk: chunkIdx + 1, total: this._chunks.length };
            for (const l of this._listeners) l(this._state, this._progress);
            console.log(`[TTS] Chunk ${chunkIdx + 1} scheduled (${(buf.duration).toFixed(1)}s audio)`);

            chunkIdx++;
        }

        // Wait for all audio to finish playing
        const totalDuration = this._nextChunkTime - ctx.currentTime;
        console.log(`[TTS] All chunks synthesized. Waiting ${totalDuration.toFixed(1)}s for playback to finish...`);

        await new Promise<void>((resolve) => {
            const check = () => {
                if (this._playbackId !== playbackId) {
                    resolve();
                    return;
                }
                if (ctx.currentTime >= this._nextChunkTime) {
                    resolve();
                    return;
                }
                setTimeout(check, 100);
            };
            check();
        });

        if (this._playbackId !== playbackId) return;

        // Playback finished
        this._progress = { chunk: 0, total: 0 };
        this.emit({ status: "ready", voices: this._voiceCache });
        console.log("[TTS] Playback finished");
    }

    /** Skip to the next sentence. */
    skipForward(): void {
        if (this._currentSentence + 1 >= this._sentences.length) return;
        this.speak(this._fullText, this._currentSentence + 1);
    }

    /** Skip to the previous sentence. */
    skipBack(): void {
        if (this._currentSentence === 0) return;
        this.speak(this._fullText, this._currentSentence - 1);
    }

    pause(): void {
        if (this._audioCtx && this._state.status === "playing") {
            this._audioCtx.suspend();
            this.emit({ status: "paused" });
            console.log("[TTS] Paused");
        }
    }

    resume(): void {
        if (this._audioCtx && this._state.status === "paused") {
            this._audioCtx.resume();
            this.emit({ status: "playing" });
            console.log("[TTS] Resumed");
        }
    }

    stop(): void {
        this._playbackId++;
        this._sentences = [];
        this._currentSentence = 0;
        this._chunks = [];
        this._progress = { chunk: 0, total: 0 };

        // Stop all active audio sources
        for (const source of this._activeSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {
                // Already stopped
            }
        }
        this._activeSources = [];

        // Notify Rust to cancel any in-progress synthesis
        invoke("tts_stop").catch(() => {});

        if (this._state.status === "playing" || this._state.status === "paused" || this._state.status === "error") {
            this.emit({ status: "ready", voices: this._voiceCache });
        }
    }

    dispose() {
        this._refCount--;
        if (this._refCount > 0) return;
        this.stop();
        if (this._audioCtx) {
            this._audioCtx.close();
            this._audioCtx = null;
            this._gainNode = null;
        }
        if (this._unlistenState) {
            this._unlistenState();
            this._unlistenState = null;
        }
    }
}

export const ttsManager = new TtsManager();
