/**
 * React hook for Kokoro TTS — audiobook-style controls.
 */
import { useCallback, useEffect, useState } from "react";
import { ttsManager, type TtsState, type TtsVoiceGroup, type TtsProgress } from "./tts-manager";

interface UseKokoroTtsReturn {
    state: TtsState;
    voices: TtsVoiceGroup[];
    selectedVoice: string;
    speed: number;
    progress: TtsProgress;
    isSpeaking: boolean;
    isPaused: boolean;
    isReady: boolean;
    isLoading: boolean;
    prepare: () => Promise<void>;
    speak: (text: string, startIndex?: number) => Promise<void>;
    stop: () => void;
    pause: () => void;
    resume: () => void;
    skipForward: () => void;
    skipBack: () => void;
    setVoice: (voiceId: string) => void;
    setSpeed: (speed: number) => void;
}

export function useKokoroTts(): UseKokoroTtsReturn {
    const [state, setState] = useState<TtsState>(ttsManager.state);
    const [voices, setVoices] = useState<TtsVoiceGroup[]>([]);
    const [selectedVoice, setSelectedVoice] = useState(ttsManager.selectedVoice);
    const [speed, setSpeedState] = useState(1.0);
    const [progress, setProgress] = useState<TtsProgress>({ current: 0, total: 0 });

    useEffect(() => {
        const unsub = ttsManager.subscribe((s, p) => {
            setState(s);
            setProgress(p);
            if (s.status === "ready") {
                setVoices(s.voices);
            }
        });
        return unsub;
    }, []);

    const prepare = useCallback(async () => {
        await ttsManager.prepare();
    }, []);

    const speak = useCallback(async (text: string, startIndex?: number) => {
        await ttsManager.speak(text, startIndex);
    }, []);

    const stop = useCallback(() => {
        ttsManager.stop();
    }, []);

    const pause = useCallback(() => {
        ttsManager.pause();
    }, []);

    const resume = useCallback(() => {
        ttsManager.resume();
    }, []);

    const skipForward = useCallback(() => {
        ttsManager.skipForward();
    }, []);

    const skipBack = useCallback(() => {
        ttsManager.skipBack();
    }, []);

    const setVoice = useCallback((voiceId: string) => {
        setSelectedVoice(voiceId);
        ttsManager.setVoice(voiceId);
    }, []);

    const setSpeed = useCallback((value: number) => {
        setSpeedState(value);
        ttsManager.setSpeed(value);
    }, []);

    useEffect(() => {
        return () => {
            ttsManager.dispose();
        };
    }, []);

    return {
        state,
        voices,
        selectedVoice,
        speed,
        progress,
        isSpeaking: state.status === "playing",
        isPaused: state.status === "paused",
        isReady: state.status === "ready",
        isLoading: state.status === "loading",
        prepare,
        speak,
        stop,
        pause,
        resume,
        skipForward,
        skipBack,
        setVoice,
        setSpeed,
    };
}
