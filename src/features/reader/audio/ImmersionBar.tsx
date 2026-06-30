import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Headphones, Volume2, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { cn, useSettingsStore } from '../../../core';
import { immersionPlayer, type PlaybackState } from '../audio/ImmersionPlayer';

interface ImmersionBarProps {
    sectionText: string;
    startWordId?: string;
    pageCfi?: string;
    className?: string;
    visible?: boolean;
    onComplete?: () => void;
    onSynthesisComplete?: () => void;
}

const VOICES = [
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
    const [hasError, setHasError] = useState(false);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const initializedRef = useRef(false);
    const ttsVoice = useSettingsStore((s) => s.settings.tts.voice);
    const updateTtsSettings = useSettingsStore((s) => s.updateTtsSettings);

    const showError = useCallback(() => {
        setHasError(true);
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setHasError(false), 4000);
    }, []);

    const clearError = useCallback(() => {
        setHasError(false);
        clearTimeout(errorTimerRef.current);
    }, []);

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

    useEffect(() => {
        immersionPlayer.speed = 1.0;
    }, []);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        immersionPlayer.speed = 1.0;

        immersionPlayer.init({
            onStateChange: (state) => {
                setPlaybackState(state);
                if (state === 'playing') {
                    transitioningRef.current = false;
                }
            },
            onError: (msg) => {
                console.error('[ImmersionBar]', msg);
                showError();
                setIsContinuousMode(false);
                transitioningRef.current = false;
            },
            onComplete: () => {
                transitioningRef.current = true;
                setTimeout(() => { transitioningRef.current = false; }, 2000);
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

    const lastPlayedCfiRef = useRef('');

    const handlePlay = useCallback(async () => {
        const text = sectionText.trim();
        if (!text) return;
        clearError();
        console.time('[ImmersionBar] play→genId');

        if (playbackState === 'paused') {
            await immersionPlayer.resume();
            setIsContinuousMode(true);
            return;
        }

        if (playbackState === 'playing') {
            immersionPlayer.stop();
            try { await invoke<void>('stop_speech'); } catch { /* ok */ }
        }

        setPlaybackState('loading');
        setIsContinuousMode(true);
        lastPlayedCfiRef.current = pageCfi || '';

        immersionPlayer.prepare();

        try {
            const genId = await invoke<number>('generate_speech', {
                text,
                startFromId: startWordId,
                voice: ttsVoice,
            });
            console.timeEnd('[ImmersionBar] play→genId');
            immersionPlayer.setCurrentGenId(genId);
        } catch (err: unknown) {
            console.error('[ImmersionBar]', err instanceof Error ? err.message : String(err));
            showError();
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

    const cycleVoice = useCallback(() => {
        const idx = VOICES.findIndex(v => v.value === ttsVoice);
        const next = VOICES[(idx + 1) % VOICES.length];
        updateTtsSettings({ voice: next.value });
    }, [ttsVoice, updateTtsSettings]);

    useEffect(() => {
        if (transitioningRef.current) return;
        const text = sectionText.trim();
        if (isContinuousMode && playbackState === 'idle' && text && pageCfi && lastPlayedCfiRef.current !== pageCfi) {
            handlePlay();
        }
    }, [isContinuousMode, playbackState, sectionText, pageCfi, handlePlay]);

    const prevVoiceRef = useRef(ttsVoice);
    useEffect(() => {
        if (prevVoiceRef.current === ttsVoice) return;
        prevVoiceRef.current = ttsVoice;

        if (playbackState === 'playing' || playbackState === 'loading') {
            handlePlay();
        }
    }, [ttsVoice, playbackState, handlePlay]);

    const isActive = playbackState !== 'idle';
    const currentVoiceLabel = VOICES.find(v => v.value === ttsVoice)?.label.split(' ')[0] || 'Voice';

    return (
        <>
            <div
                className={cn(
                    'flex items-center gap-1 sm:gap-1.5 overflow-x-auto',
                    'w-full sm:w-auto sm:px-4 pt-2 px-2 sm:py-2.5',
                    'sm:rounded-full rounded-t-xl rounded-b-none',
                    'bg-[var(--color-surface)]/95 backdrop-blur-xl',
                    'border border-[var(--color-border)]',
                    'shadow-[0_8px_32px_rgba(0,0,0,0.18)]',
                    'transition-all duration-300',
                    !visible && 'opacity-0 pointer-events-none translate-y-4',
                    className,
                )}
                style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
                {/* Icon + status */}
                <div className="flex items-center gap-1 shrink-0">
                    <Headphones
                        className={cn(
                            'w-3.5 h-3.5 shrink-0 transition-colors duration-200',
                            isActive ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-muted)]',
                        )}
                    />
                    {playbackState === 'loading' && (
                        <span className="w-3 h-3 border-[2px] border-[var(--color-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
                    )}
                    {playbackState === 'paused' && (
                        <span className="text-[10px] font-medium text-[color:var(--color-text-muted)] select-none shrink-0">Paused</span>
                    )}
                    {playbackState === 'playing' && (
                        <div className="flex items-end gap-[2px] h-3 shrink-0">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="w-[2.5px] rounded-full bg-[var(--color-accent)]"
                                    style={{
                                        animation: `tts-bar-bounce 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                                        height: '60%',
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="w-px h-4 bg-[var(--color-border)] shrink-0" />

                {/* Voice — cycle on click */}
                <button
                    onClick={cycleVoice}
                    className="flex items-center justify-center h-7 px-1.5 rounded text-[11px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors shrink-0"
                    title="Voice"
                >
                    {currentVoiceLabel}
                </button>

                {/* Test voice */}
                <button
                    onClick={() => handleTestVoice(ttsVoice)}
                    className="flex items-center justify-center w-6 h-6 rounded text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent)] hover:bg-[var(--color-overlay-subtle)] shrink-0"
                    title="Test this voice"
                    aria-label="Test voice"
                >
                    <Volume2 className="w-3 h-3" />
                </button>

                <div className="w-px h-4 bg-[var(--color-border)] shrink-0" />

                {/* Controls */}
                <div className="flex items-center gap-1 shrink-0">
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
                            title="Start immersion reading"
                            aria-label="Play"
                        >
                            <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                    ) : (
                        <>
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
            </div>

            {/* Error toast - floats above the bar */}
            {hasError && (
                <div className="fixed left-1/2 -translate-x-1/2 bottom-[3.5rem] z-50 pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-error)]/50 shadow-lg">
                        <AlertCircle className="w-3.5 h-3.5 text-[color:var(--color-error)] shrink-0" />
                        <span className="text-[12px] font-medium text-[color:var(--color-error)] whitespace-nowrap">Something went wrong</span>
                    </div>
                </div>
            )}
        </>
    );
}

export default ImmersionBar;
