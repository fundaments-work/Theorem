/**
 * ImmersionBar - Floating TTS control bar for immersion reading.
 *
 * Renders a pill-shaped toolbar at the bottom of the reader with:
 *   - Play / Pause / Stop controls
 *   - Status indicator with animated bars
 *   - Error display
 *
 * Only synthesizes the current visible page text — not the whole book.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Headphones, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '../../../core';
import { immersionPlayer, type PlaybackState } from '../audio/ImmersionPlayer';

interface ImmersionBarProps {
    /** Text content of the current visible page, extracted by the caller. */
    sectionText: string;
    /** DOM id of the first word in the visible section. */
    startWordId?: string;
    /** Additional classes (e.g. positioning). */
    className?: string;
    /** Whether the bar should be visible. */
    visible?: boolean;
    /** Fired when playback of the current section completes naturally. */
    onComplete?: () => void;
}

export function ImmersionBar({
    sectionText,
    startWordId = 'tts-w-0',
    className,
    visible = true,
    onComplete,
}: ImmersionBarProps) {
    const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
    const [error, setError] = useState<string | null>(null);
    const initializedRef = useRef(false);

    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    const [isContinuousMode, setIsContinuousMode] = useState(false);

    // Initialize the player once
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        immersionPlayer.init({
            onStateChange: (state) => {
                setPlaybackState(state);
            },
            onError: (msg) => {
                setError(msg);
                setIsContinuousMode(false);
            },
            onComplete: () => {
                // We finished reading the page. Turn the page if continuous mode is on.
                onCompleteRef.current?.();
            }
        });

        return () => {
            immersionPlayer.destroy();
            initializedRef.current = false;
            invoke<void>('stop_speech').catch(() => {});
        };
    }, []);

    // ── Actions ────────────────────────────────────────────────────────────

    const lastPlayedTextRef = useRef('');

    const handlePlay = useCallback(async () => {
        const text = sectionText.trim();
        if (!text) return;
        setError(null);

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
        lastPlayedTextRef.current = text;

        try {
            await invoke<number>('generate_speech', {
                text,
                startFromId: startWordId,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setPlaybackState('idle');
            setIsContinuousMode(false);
        }
    }, [sectionText, startWordId, playbackState]);

    const handlePause = useCallback(async () => {
        await immersionPlayer.pause();
        setIsContinuousMode(false);
    }, []);

    const handleStop = useCallback(async () => {
        immersionPlayer.stop();
        setIsContinuousMode(false);
        try { await invoke<void>('stop_speech'); } catch { /* ok */ }
    }, []);

    // Auto-play when section text changes in continuous mode
    useEffect(() => {
        const text = sectionText.trim();
        if (isContinuousMode && playbackState === 'idle' && text && lastPlayedTextRef.current !== text) {
            handlePlay();
        }
    }, [isContinuousMode, playbackState, sectionText, handlePlay]);

    // ── Render ─────────────────────────────────────────────────────────────

    const isActive = playbackState !== 'idle';

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-full',
                'bg-[var(--color-surface)]/95 backdrop-blur-xl',
                'border border-[var(--color-border)]',
                'shadow-[0_8px_32px_rgba(0,0,0,0.18)]',
                'transition-all duration-300',
                !visible && 'opacity-0 pointer-events-none translate-y-4',
                className,
            )}
        >
            {/* Icon badge */}
            <Headphones
                className={cn(
                    'w-4 h-4 shrink-0 transition-colors duration-200',
                    isActive
                        ? 'text-[color:var(--color-accent)]'
                        : 'text-[color:var(--color-text-muted)]',
                )}
            />

            {/* Label */}
            <span
                className={cn(
                    'text-xs font-medium select-none hidden sm:block transition-colors duration-200',
                    isActive
                        ? 'text-[color:var(--color-text-primary)]'
                        : 'text-[color:var(--color-text-muted)]',
                )}
            >
                {playbackState === 'loading'
                    ? 'Loading…'
                    : playbackState === 'playing'
                        ? 'Listening'
                        : playbackState === 'paused'
                            ? 'Paused'
                            : 'Listen'}
            </span>

            {/* Animated playing dots */}
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

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--color-border)] mx-1 shrink-0" />

            {/* Controls */}
            <div className="flex items-center gap-1">
                {playbackState === 'idle' || playbackState === 'loading' ? (
                    <button
                        id="tts-play-btn"
                        onClick={handlePlay}
                        disabled={playbackState === 'loading' || !sectionText.trim()}
                        className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150',
                            'bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]',
                            'hover:bg-[var(--color-accent-hover)] active:scale-90',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                        title="Start immersion reading (reads current page aloud)"
                        aria-label="Play"
                    >
                        <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                ) : (
                    <>
                        {/* Pause / Resume */}
                        <button
                            id="tts-pause-btn"
                            onClick={playbackState === 'playing' ? handlePause : handlePlay}
                            className={cn(
                                'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150',
                                'bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]',
                                'hover:bg-[var(--color-overlay-subtle)] active:scale-90',
                            )}
                            title={playbackState === 'playing' ? 'Pause' : 'Resume'}
                            aria-label={playbackState === 'playing' ? 'Pause' : 'Resume'}
                        >
                            {playbackState === 'playing' ? (
                                <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                                <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                        </button>

                        {/* Stop */}
                        <button
                            id="tts-stop-btn"
                            onClick={handleStop}
                            className={cn(
                                'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150',
                                'bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]',
                                'hover:bg-[var(--color-overlay-subtle)] hover:text-[color:var(--color-error)] active:scale-90',
                            )}
                            title="Stop"
                            aria-label="Stop"
                        >
                            <Square className="w-3 h-3 fill-current" />
                        </button>
                    </>
                )}
            </div>

            {/* Error badge */}
            {error && (
                <div className="flex items-center gap-1 ml-1">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-error)] shrink-0" />
                    <span className="text-[10px] text-[color:var(--color-error)] max-w-[120px] truncate">
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
