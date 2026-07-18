# Text-to-Speech (Immersion Reading)

## Why Platform-Specific Backends

TTS requires native OS speech synthesis. There is no cross-platform Rust library that provides consistent quality across Linux, macOS, Windows, and Android. Each platform has its own system:

| Platform | Backend | Why |
|----------|---------|-----|
| Linux | `spd-say` (speech-dispatcher) | Standard Linux speech interface |
| macOS | `say` command | Built-in, high-quality voices |
| Windows | PowerShell `System.Speech` | .NET speech synthesis |
| Android | Native TTS plugin | Android's TextToSpeech API |

## How It Works

**Frontend** (`ImmersionPlayer.ts`):
- Manages playback state (playing, paused, stopped)
- Tracks the current word position for visual highlighting
- Sends the current sentence/chunk to the Rust backend via `invoke('tts_speak', { text, voice })`

**Backend** (Rust):
- `tts_speak` invokes the platform-specific command/API
- `tts_stop` kills the speech process or calls the platform stop API
- `tts_pause` and `tts_resume` are macOS-only concepts — on other platforms, pause is stop (resume restarts from the last synced position)

**Immersion Reading UI** (`ImmersionBar.tsx`, lazy loaded):
- Shows the current sentence with the active word highlighted
- Speed control slider
- Play/pause/stop controls
- Voice selector (from `tts_get_voices`)

## Word Tracking

The frontend splits text into sentences, sends them one at a time, and estimates word timing based on the configured speed. The currently spoken word is highlighted in the reader viewport by:
1. Maintaining a word offset within the current sentence
2. Calculating approximate timing from the configured WPM (words per minute)
3. Sending word position updates to the foliate iframe for visual synchronization

This is approximate — exact word-level timing would require audio waveform analysis on each platform. The approximation works well enough for immersion reading (following along visually while listening).
