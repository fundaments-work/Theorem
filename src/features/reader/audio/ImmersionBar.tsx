/**
 * ImmersionBar - Floating TTS control bar for immersion reading.
 *
 * Mobile-first responsive design:
 *   Small screens (< 640px) → full-width bottom bar, horizontal scroll
 *   Desktop (≥ 640px)      → pill-shaped centered toolbar
 *
 * Controls:
 *   - Play / Pause / Stop
 *   - Speed selector (0.5× – 2×, pitch-preserved)
 *   - Voice selector (6 English voices: 3 female + 3 male)
 *   - Status indicator with animated bars
 *   - Test voice
 *   - Error display
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Headphones, X, Volume2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { cn, useSettingsStore } from '../../../core';
import { immersionPlayer, type PlaybackState } from '../audio/ImmersionPlayer';
import { Dropdown } from '../../../ui';

interface ImmersionBarProps {
    /** Text content of the current visible page, extracted by the caller. */
    sectionText: string;
    /** DOM id of the first word in the visible section. */
    startWordId?: string;
    /** Canonical CFI of the current page location (used for page-change detection). */
    pageCfi?: string;
    /** Additional classes (e.g. positioning). */
    className?: string;
    /** Whether the bar should be visible. */
    visible?: boolean;
    /** Fired when playback of the current section completes naturally. */
    onComplete?: () => void;
    /** Fired when the backend finishes synthesizing ALL chunks (tts-done).
     *  Audio is still playing — ideal moment to preload the next page. */
    onSynthesisComplete?: () => void;
}

const SPEED_OPTIONS = [
    { value: "0.5", label: "0.5×" },
    { value: "0.75", label: "0.75×" },
    { value: "1", label: "1×" },
    { value: "1.25", label: "1.25×" },
    { value: "1.5", label: "1.5×" },
    { value: "2", label: "2×" },
];

const SAMPLE_VOICES: { value: string; label: string }[] = [
    { value: "af_bella", label: "Bella (US F)" },
    { value: "af_nicole", label: "Nicole (US F)" },
    { value: "af_sarah", label: "Sarah (US F)" },
    { value: "am_adam", label: "Adam (US M)" },
    { value: "am_michael", label: "Michael (US M)" },
    { value: "bm_george", label: "George (UK M)" },
];

export function ImmersionBar({
    sectionText,
    startWordId = 'tts-w-0',
    pageCfi,
    className,
    visible = true,
    onComplete,
    onSynthesisComplete,
}: ImmersionBarProps) {
    const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
    const [error, setError] = useState<string | null>(null);
    const initializedRef = useRef(false);
    const ttsVoice = useSettingsStore((s) => s.settings.tts.voice);
    const ttsSpeed = useSettingsStore((s) => s.settings.tts.speed);
    const updateTtsSettings = useSettingsStore((s) => s.updateTtsSettings);

    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    const onSynthesisCompleteRef = useRef(onSynthesisComplete);
    useEffect(() => {
        onSynthesisCompleteRef.current = onSynthesisComplete;
    }, [onSynthesisComplete]);

    const [isContinuousMode, setIsContinuousMode] = useState(false);
    const transitioningRef = useRef(false);

    // Sync speed to ImmersionPlayer whenever it changes
    useEffect(() => {
        immersionPlayer.speed = ttsSpeed;
    }, [ttsSpeed]);

    // Initialize the player once
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        immersionPlayer.speed = ttsSpeed;

        immersionPlayer.init({
            onStateChange: (state) => {
                setPlaybackState(state);
                if (state === 'playing') {
                    transitioningRef.current = false;
                }
            },
            onError: (msg) => {
                setError(msg);
                setIsContinuousMode(false);
                transitioningRef.current = false;
            },
            onComplete: () => {
                transitioningRef.current = true;
                // Safety timeout — if preloaded audio doesn't start within 2s
                // (e.g. no next page text), let auto-play fall through.
                setTimeout(() => { transitioningRef.current = false; }, 2000);
                // We finished reading the page. Turn the page if continuous mode is on.
                onCompleteRef.current?.();
            },
            onSynthesisComplete: () => {
                onSynthesisCompleteRef.current?.();
            }
        });

        return () => {
            immersionPlayer.destroy();
            initializedRef.current = false;
            invoke<void>('stop_speech').catch(() => {});
        };
    }, []);

    // ── Actions ────────────────────────────────────────────────────────────

    const lastPlayedCfiRef = useRef('');

    const handlePlay = useCallback(async () => {
        const text = sectionText.trim();
        if (!text) return;
        setError(null);
        console.time('[ImmersionBar] play→genId');

        if (playbackState === 'paused') {
            await immersionPlayer.resume();
            setIsContinuousMode(true);
            return;
        }

        // Stop any existing playback first
        if (playbackState === 'playing') {
            immersionPlayer.stop();
            try { await invoke<void>('stop_speech'); } catch { /* ok */ }
        }

        setPlaybackState('loading');
        setIsContinuousMode(true);
        lastPlayedCfiRef.current = pageCfi || '';

        try {
            const genId = await invoke<number>('generate_speech', {
                text,
                startFromId: startWordId,
                voice: ttsVoice,
            });
            console.timeEnd('[ImmersionBar] play→genId');
            console.log('[ImmersionBar] got genId:', genId);
            immersionPlayer.setCurrentGenId(genId);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setPlaybackState('idle');
            setIsContinuousMode(false);
        }
    }, [sectionText, startWordId, playbackState, ttsVoice]);

    const handlePause = useCallback(async () => {
        await immersionPlayer.pause();
        setIsContinuousMode(false);
    }, []);

    const handleStop = useCallback(async () => {
        immersionPlayer.stop();
        setIsContinuousMode(false);
        try { await invoke<void>('stop_speech'); } catch { /* ok */ }
    }, []);

    const handleTestVoice = useCallback(async (voice: string) => {
        immersionPlayer.stop();
        immersionPlayer.skipOnComplete = true;
        setIsContinuousMode(false);
        try { await invoke<void>('stop_speech'); } catch { /* ok */ }
        const sample = "Hello, this is " + voice.replace(/^[a-z]+_/, '') + " speaking.";
        try {
            const genId = await invoke<number>('generate_speech', {
                text: sample,
                startFromId: 'tts-w-0',
                voice,
            });
            immersionPlayer.setCurrentGenId(genId);
            setPlaybackState('loading');
        } catch { /* sample playback is best-effort */ }
    }, []);

    // Auto-play when page changes in continuous mode
    useEffect(() => {
        if (transitioningRef.current) return;
        const text = sectionText.trim();
        if (isContinuousMode && playbackState === 'idle' && text && pageCfi && lastPlayedCfiRef.current !== pageCfi) {
            handlePlay();
        }
    }, [isContinuousMode, playbackState, sectionText, pageCfi, handlePlay]);

    // Restart playback when voice changes during active playback.
    const prevVoiceRef = useRef(ttsVoice);
    useEffect(() => {
        if (prevVoiceRef.current === ttsVoice) return;
        prevVoiceRef.current = ttsVoice;

        // Only restart if actively playing or loading (not idle/paused)
        if (playbackState === 'playing' || playbackState === 'loading') {
            handlePlay();
        }
    }, [ttsVoice, playbackState, handlePlay]);

    // ── Render ─────────────────────────────────────────────────────────────

    const isActive = playbackState !== 'idle';

    return (
        <div
            className={cn(
                'flex items-center gap-1.5 sm:gap-2 flex-wrap',
                'w-full sm:w-auto sm:px-4 py-2 px-2 sm:py-2.5',
                'sm:rounded-full rounded-xl',
                'bg-[var(--color-surface)]/95 backdrop-blur-xl',
                'border border-[var(--color-border)]',
                'shadow-[0_8px_32px_rgba(0,0,0,0.18)]',
                'transition-all duration-300',
                !visible && 'opacity-0 pointer-events-none translate-y-4',
                className,
            )}
        >
            {/* Icon badge + Label */}
            <div className="flex items-center gap-1 shrink-0">
                <Headphones
                    className={cn(
                        'w-4 h-4 shrink-0 transition-colors duration-200',
                        isActive
                            ? 'text-[color:var(--color-accent)]'
                            : 'text-[color:var(--color-text-muted)]',
                    )}
                />
                <span
                    className={cn(
                        'text-xs font-medium select-none transition-colors duration-200',
                        isActive
                            ? 'text-[color:var(--color-text-primary)]'
                            : 'text-[color:var(--color-text-muted)]',
                    )}
                >
                    {playbackState === 'loading'
                        ? '…'
                        : playbackState === 'playing'
                            ? ''
                            : playbackState === 'paused'
                                ? 'Paused'
                                : ''}
                </span>

                {/* Animated playing dots — inline with icon */}
                {playbackState === 'playing' && (
                    <div className="flex items-end gap-[3px] h-4 shrink-0">
                        {[0, 1, 2].map((i) => (
                            <div
                                key={i}
                                className="w-[3px] rounded-full bg-[var(--color-accent)]"
                                style={{
                                    animation: `tts-bar-bounce 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                                    height: '60%',
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Loading spinner */}
                {playbackState === 'loading' && (
                    <span className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
                )}
            </div>

            {/* Spacer */}
            <div className="w-px h-5 bg-[var(--color-border)] shrink-0 mx-0.5" />

            {/* Speed control */}
            <Dropdown
                value={String(ttsSpeed)}
                onChange={(v) => {
                    const s = parseFloat(v);
                    if (!isNaN(s)) updateTtsSettings({ speed: s });
                }}
                options={SPEED_OPTIONS}
                size="sm"
                variant="filled"
                className="min-w-0 w-auto shrink-0"
                dropdownClassName="bottom-full mb-1 mt-0 w-24"
            />

            {/* Spacer */}
            <div className="w-px h-5 bg-[var(--color-border)] shrink-0 mx-0.5" />

            {/* Voice selector */}
            <Dropdown
                value={ttsVoice}
                onChange={(v) => updateTtsSettings({ voice: v })}
                options={SAMPLE_VOICES}
                size="sm"
                variant="filled"
                className="min-w-0 w-auto shrink-0"
                dropdownClassName="bottom-full mb-1 mt-0 w-48"
            />

            <button
                onClick={() => handleTestVoice(ttsVoice)}
                className="flex items-center justify-center w-6 h-6 sm:w-5 sm:h-5 rounded text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent)] hover:bg-[var(--color-overlay-subtle)] shrink-0"
                title="Test this voice"
                aria-label="Test voice"
            >
                <Volume2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
            </button>

            {/* Spacer */}
            <div className="w-px h-5 bg-[var(--color-border)] shrink-0 mx-0.5" />

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0">
                {playbackState === 'idle' || playbackState === 'loading' ? (
                    <button
                        id="tts-play-btn"
                        onClick={handlePlay}
                        disabled={playbackState === 'loading' || !sectionText.trim()}
                        className={cn(
                            'flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-full transition-all duration-150',
                            'bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]',
                            'hover:bg-[var(--color-accent-hover)] active:scale-90',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                        title="Start immersion reading"
                        aria-label="Play"
                    >
                        <Play className="w-4 h-4 sm:w-3.5 sm:h-3.5 fill-current" />
                    </button>
                ) : (
                    <>
                        {/* Pause / Resume */}
                        <button
                            id="tts-pause-btn"
                            onClick={playbackState === 'playing' ? handlePause : handlePlay}
                            className={cn(
                                'flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-full transition-all duration-150',
                                'bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]',
                                'hover:bg-[var(--color-overlay-subtle)] active:scale-90',
                            )}
                            title={playbackState === 'playing' ? 'Pause' : 'Resume'}
                            aria-label={playbackState === 'playing' ? 'Pause' : 'Resume'}
                        >
                            {playbackState === 'playing' ? (
                                <Pause className="w-4 h-4 sm:w-3.5 sm:h-3.5 fill-current" />
                            ) : (
                                <Play className="w-4 h-4 sm:w-3.5 sm:h-3.5 fill-current" />
                            )}
                        </button>

                        {/* Stop */}
                        <button
                            id="tts-stop-btn"
                            onClick={handleStop}
                            className={cn(
                                'flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-full transition-all duration-150',
                                'bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]',
                                'hover:bg-[var(--color-overlay-subtle)] hover:text-[color:var(--color-error)] active:scale-90',
                            )}
                            title="Stop"
                            aria-label="Stop"
                        >
                            <Square className="w-4 h-4 sm:w-3 sm:h-3 fill-current" />
                        </button>
                    </>
                )}
            </div>

            {/* Error badge */}
            {error && (
                <div className="flex items-center gap-1 shrink-0 ml-0.5">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-error)] shrink-0" />
                    <span className="text-[10px] text-[color:var(--color-error)] max-w-[100px] sm:max-w-[120px] truncate">
                        {error}
                    </span>
                    <button
                        onClick={() => setError(null)}
                        className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                        aria-label="Dismiss error"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}

export default ImmersionBar;
