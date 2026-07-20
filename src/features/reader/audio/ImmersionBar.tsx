import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Headphones, AlertCircle } from 'lucide-react';
import { cn } from '../../../core/lib/utils';
import { useSettingsStore } from '../../../core/store';
import { immersionPlayer, type PlaybackState } from '../audio/ImmersionPlayer';

interface ImmersionBarProps {
    sectionText: string;
    className?: string;
    visible?: boolean;
    onComplete?: () => void;
}

export function ImmersionBar({
    sectionText,
    className,
    visible = true,
    onComplete,
}: ImmersionBarProps) {
    const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
    const [hasError, setHasError] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const initializedRef = useRef(false);
    const ttsVoice = useSettingsStore((s) => s.settings.tts.voice);

    const showError = useCallback((msg?: string) => {
        setErrorMsg(msg || 'Unknown error');
        setHasError(true);
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setHasError(false), 8000);
    }, []);

    const clearError = useCallback(() => {
        setHasError(false);
        clearTimeout(errorTimerRef.current);
    }, []);

    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        immersionPlayer.init({
            onStateChange: (state) => {
                setPlaybackState(state);
            },
            onError: (msg) => {
                showError(msg);
            },
            onComplete: () => {
                onCompleteRef.current?.();
            },
        });

        return () => {
            immersionPlayer.destroy();
            initializedRef.current = false;
        };
    }, []);

    const handlePlay = useCallback(() => {
        const text = sectionText.trim();
        if (!text) return;
        clearError();

        if (playbackState === 'paused') {
            immersionPlayer.resume();
            return;
        }

        if (playbackState === 'loading') return;

        immersionPlayer.speak(text, ttsVoice);
    }, [sectionText, playbackState, ttsVoice]);

    const handlePause = useCallback(() => {
        immersionPlayer.pause();
    }, []);

    const handleStop = useCallback(() => {
        immersionPlayer.stop();
    }, []);

    const isActive = playbackState !== 'idle';

    return (
        <>
            <div
                className={cn(
                    'flex items-center justify-center gap-2 sm:gap-1.5 overflow-x-auto',
                    'w-full px-4 sm:w-auto sm:px-4',
                    'py-3 sm:py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                    'sm:rounded-full rounded-xl',
                    'bg-[var(--color-surface)]/95 backdrop-blur-xl',
                    'border border-[var(--color-border)]',
                    'shadow-[0_8px_32px_rgba(0,0,0,0.18)]',
                    'transition-colors duration-300',
                    !visible && 'opacity-0 pointer-events-none translate-y-4',
                    className,
                )}
            >
                <div className="flex items-center gap-2 shrink-0">
                    <Headphones
                        className={cn(
                            'w-4 sm:w-3.5 h-4 sm:h-3.5 shrink-0 transition-colors duration-200',
                            isActive ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-muted)]',
                        )}
                    />
                    {playbackState === 'loading' && (
                        <span className="w-4 h-4 border-[2px] border-[var(--color-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
                    )}
                    {playbackState === 'playing' && (
                        <div className="flex items-end gap-[3px] h-4 shrink-0">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="w-[3px] rounded-full bg-[var(--color-accent)]"
                                    style={{
                                        animation: `tts-bar-bounce 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                                        height: '70%',
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    {playbackState === 'idle' || playbackState === 'loading' ? (
                        <button
                            id="tts-play-btn"
                            onClick={handlePlay}
                            disabled={playbackState === 'loading' || !sectionText.trim()}
                            className={cn(
                                'flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-150',
                                'bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]',
                                'hover:bg-[var(--color-accent-hover)] active:scale-90',
                                'disabled:opacity-40 disabled:cursor-not-allowed',
                            )}
                            title="Start immersion reading"
                            aria-label="Play"
                        >
                            <Play className="w-4 h-4 fill-current" />
                        </button>
                    ) : (
                        <>
                            <button
                                id="tts-pause-btn"
                                onClick={playbackState === 'playing' ? handlePause : handlePlay}
                                className={cn(
                                    'flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-150',
                                    'bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]',
                                    'hover:bg-[var(--color-overlay-subtle)] active:scale-90',
                                )}
                                title={playbackState === 'playing' ? 'Pause' : 'Resume'}
                                aria-label={playbackState === 'playing' ? 'Pause' : 'Resume'}
                            >
                                {playbackState === 'playing' ? (
                                    <Pause className="w-4 h-4 fill-current" />
                                ) : (
                                    <Play className="w-4 h-4 fill-current" />
                                )}
                            </button>
                            <button
                                id="tts-stop-btn"
                                onClick={handleStop}
                                className={cn(
                                    'flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-150',
                                    'bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]',
                                    'hover:bg-[var(--color-overlay-subtle)] hover:text-[color:var(--color-error)] active:scale-90',
                                )}
                                title="Stop"
                                aria-label="Stop"
                            >
                                <Square className="w-4 h-4 fill-current" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {hasError && (
                <div className="fixed left-1/2 -translate-x-1/2 bottom-[3.5rem] z-50 pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-error)]/50 shadow-lg">
                        <AlertCircle className="w-3.5 h-3.5 text-[color:var(--color-error)] shrink-0" />
                        <span className="text-[12px] font-medium text-[color:var(--color-error)] whitespace-nowrap">{errorMsg}</span>
                    </div>
                </div>
            )}

            <div role="status" aria-live="polite" className="sr-only">
                {playbackState === "loading" ? "Loading"
                    : playbackState === "playing" ? "Playing"
                    : playbackState === "paused" ? "Paused"
                    : hasError ? "Error"
                    : ""}
            </div>
        </>
    );
}

export default ImmersionBar;
