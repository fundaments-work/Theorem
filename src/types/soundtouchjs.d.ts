declare module 'soundtouchjs' {
    export class SoundTouch {
        constructor();
        tempo: number;
        pitch: number;
        rate: number;
        readonly inputBuffer: FifoSampleBuffer;
        readonly outputBuffer: FifoSampleBuffer;
        process(): void;
        clear(): void;
    }

    export class WebAudioBufferSource {
        constructor(buffer: AudioBuffer);
        extract(target: Float32Array, numFrames: number, position: number): number;
    }

    export class SimpleFilter {
        constructor(source: WebAudioBufferSource, pipe: SoundTouch, callback?: () => void);
        extract(target: Float32Array, numFrames: number): number;
    }

    export class FifoSampleBuffer {
        frameCount: number;
        putSamples(samples: Float32Array, position: number, numFrames: number): void;
        extract(output: Float32Array, position: number, numFrames: number): void;
        receive(numFrames: number): void;
        receiveSamples(output: Float32Array, numFrames: number): void;
        clear(): void;
    }

    export class PitchShifter {
        constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
        tempo: number;
        connect(node: AudioNode): void;
        disconnect(): void;
        node: ScriptProcessorNode;
    }

    export class RateTransposer {}
    export class Stretch {}
    export class AbstractFifoSamplePipe {}
    export function getWebAudioNode(): ScriptProcessorNode;
}
