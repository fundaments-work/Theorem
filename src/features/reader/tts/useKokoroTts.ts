/**
 * React hook for Kokoro TTS integration in the reader.
 *
 * Provides speak/stop/pause/resume controls and reactive state for UI components.
 */
import { useCallback, useEffect, useState } from "react";
import { ttsManager, type TtsState, type TtsVoiceGroup } from "./tts-manager";

interface UseKokoroTtsReturn {
    state: TtsState;
    voices: TtsVoiceGroup[];
    selectedVoice: string;
    isSpeaking: boolean;
    isPaused: boolean;
    isReady: boolean;
    prepare: () => Promise<void>;
    speak: (text: string) => Promise<void>;
    stop: () => void;
    pause: () => void;
    resume: () => void;
    setVoice: (voiceId: string) => void;
}

export function useKokoroTts(): UseKokoroTtsReturn {
    const [state, setState] = useState<TtsState>(ttsManager.state);
    const [voices, setVoices] = useState<TtsVoiceGroup[]>([]);
    const [selectedVoice, setSelectedVoice] = useState(ttsManager.selectedVoice);

    useEffect(() => {
        const unsub = ttsManager.subscribe((s) => {
            setState(s);
            if (s.status === "ready") {
                setVoices(s.voices);
            }
        });
        return unsub;
    }, []);

    const prepare = useCallback(async () => {
        await ttsManager.prepare();
    }, []);

    const speak = useCallback(async (text: string) => {
        await ttsManager.speak(text);
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

    const setVoice = useCallback((voiceId: string) => {
        setSelectedVoice(voiceId);
        ttsManager.setVoice(voiceId);
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
        isSpeaking: state.status === "playing",
        isPaused: state.status === "paused",
        isReady: state.status === "ready",
        prepare,
        speak,
        stop,
        pause,
        resume,
        setVoice,
    };
}
