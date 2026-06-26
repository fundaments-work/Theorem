import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export class ImmersionPlayer {
    audioCtx: AudioContext;
    playbackQueue: Array<{ buffer: AudioBuffer, words: any[] }>;
    isPlaying: boolean;
    startTimeOffset: number;
    globalTimelineClock: number;

    constructor() {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        this.playbackQueue = [];
        this.isPlaying = false;
        this.startTimeOffset = 0;
        this.globalTimelineClock = 0;
    }

    async init() {
        // Listen to real-time events coming over the Tauri IPC channel
        await listen('audio-chunk', (event: any) => {
            this.enqueueChunk(event.payload);
        });
    }

    enqueueChunk(payload: any) {
        // payload: { audio_data: [...], words: [...] }
        const buffer = this.audioCtx.createBuffer(1, payload.audio_data.length, payload.sample_rate);
        buffer.getChannelData(0).set(new Float32Array(payload.audio_data));

        this.playbackQueue.push({
            buffer: buffer,
            words: payload.words
        });

        if (!this.isPlaying) {
            this.playNext();
        }
    }

    playNext() {
        if (this.playbackQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const currentChunk = this.playbackQueue.shift()!;
        const source = this.audioCtx.createBufferSource();
        source.buffer = currentChunk.buffer;
        source.connect(this.audioCtx.destination);

        const chunkStartTime = this.audioCtx.currentTime;

        // Trigger high-frequency tracking loop for highlighting
        this.trackHighlight(currentChunk.words, chunkStartTime);

        source.onended = () => {
            this.playNext();
        };

        source.start(0);
    }

    trackHighlight(wordMap: any[], chunkStartTime: number) {
        const update = () => {
            if (!this.isPlaying) return;

            const elapsed = this.audioCtx.currentTime - chunkStartTime;

            // Locate the active word according to current elapsed audio time
            const activeWord = wordMap.find(w => elapsed >= w.start_time && elapsed <= w.end_time);

            if (activeWord) {
                // Clear old highlights safely
                const doc = document; // The iframe document logic needs to be handled, or we querySelector across active docs.
                // Assuming words have IDs we can look up globally or within the foliate container
                const container = document.getElementById('foliate-view-container');
                if (container) {
                    // Foliate uses shadow DOM and iframes, we might need a deep query or just query the iframe body
                    // We'll rely on the global style logic as instructed, but let's query the specific ID.
                    const iframe = container.querySelector('iframe');
                    const targetDoc = iframe?.contentDocument || document;
                    
                    targetDoc.querySelectorAll('.tts-word.active').forEach(el => el.classList.remove('active'));

                    const domNode = targetDoc.getElementById(activeWord.dom_id);
                    if (domNode) {
                        domNode.classList.add('active');

                        // Auto Scroll Check: Trigger smooth center scroll when approaching viewport boundaries
                        domNode.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                            inline: 'nearest'
                        });
                    }
                }
            }

            // Keep animation frame running if chunk is still executing
            if (wordMap.length > 0 && elapsed < wordMap[wordMap.length - 1].end_time) {
                requestAnimationFrame(update);
            }
        };

        requestAnimationFrame(update);
    }

    stopAllPlayback() {
        this.isPlaying = false;
        this.playbackQueue = [];
        // The AudioContext suspend/resume or creating a new context can stop current nodes.
        this.audioCtx.close();
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
}

export const immersionPlayer = new ImmersionPlayer();
