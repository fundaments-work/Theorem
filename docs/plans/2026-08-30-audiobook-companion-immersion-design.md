# Technical Design: Companion Audiobook & Immersion Player Integration

**Document:** `docs/plans/2026-08-30-audiobook-companion-immersion-design.md`  
**Status:** Planned  
**Target Milestone:** v1.4.0  

---

## 1. Overview & Vision

Instead of splitting audiobooks into a separate app, library tab, or complex server, Theorem treats **audiobooks as companion audio tracks attached directly to individual books**.

A user reading *Dune* or *The Hobbit* can attach a DRM-free `.m4b` or `.mp3` file to that book. When opening the book in Theorem, the existing **Immersion Reader (`ImmersionBar`)** automatically upgrades from synthetic Text-to-Speech (TTS) into a full-fidelity **Human Audiobook Player** with precision speed controls, chapter navigation, sleep timers, and cross-device sync via Iroh P2P.

```
                      ┌───────────────────────────────────────────────┐
                      │              HOW USERS ADD AUDIO              │
                      └───────────────────────┬───────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
        ┌───────────▼───────────┐                           ┌───────────▼───────────┐
        │  Method A: Standalone │                           │  Method B: Companion  │
        │ Drag & drop an .m4b   │                           │ On existing EPUB card:│
        │ or .mp3 into Library. │                           │ "Attach Audiobook..." │
        │ Shows as a book with  │                           │ Links audio to text.  │
        │ a discreet 🎧 badge.  │                           │                       │
        └───────────────────────┘                           └───────────────────────┘
```

---

## 2. Data Schema & Persistence

### 2.1 Book Model Updates (`src/core/types/index.ts`)

```typescript
export interface AudioChapter {
    id: string;
    title: string;
    startSec: number;
    endSec: number;
}

export interface BookAudioTrack {
    filePath: string;           // Local path or storage key to .m4b / .mp3
    format: 'm4b' | 'mp3' | 'aac' | 'm4a';
    durationSec: number;
    currentPositionSec: number;
    playbackSpeed: number;       // e.g. 1.0, 1.25, 1.5, 2.0
    chapters: AudioChapter[];
    lastListenedAt?: string;     // ISO timestamp
}

export interface Book {
    // ... existing fields ...
    audioTrack?: BookAudioTrack;
}
```

### 2.2 SQLite Storage & P2P Sync
* `audioTrack` is serialized to SQLite column `audio_track JSON` in the `books` table.
* Synchronized across paired devices via `iroh-docs` so your listening timestamp is maintained whether on desktop or Android.

---

## 3. Rust Tauri Backend: Fast Metadata & Chapter Parser

### 3.1 Crate Dependencies (`src-tauri/Cargo.toml`)
* `mp4ameta` (for `.m4b` QuickTime atoms: chapters, duration, embedded cover art)
* `id3` (for `.mp3` ID3v2 chapter frames `CHAP`/`CTOC`)

### 3.2 Tauri Commands (`src-tauri/src/audiobook.rs`)
```rust
#[tauri::command]
pub fn extract_audiobook_metadata(path: String) -> Result<AudiobookMetadataPayload, String> {
    // 1. Extract duration, embedded cover image (if any), title, author
    // 2. Parse chapter markers (start_time_ms, end_time_ms, title) in <5ms
    // 3. Return payload to frontend
}
```

---

## 4. Frontend: The Unified Immersion Player

### 4.1 Player Engine (`src/features/reader/audio/ImmersionPlayer.ts`)
* Uses HTML5 `HTMLAudioElement` with local streaming.
* Exposes dual-mode playback:
  - **Mode A (Companion Audio)**: Direct HTML5 streaming from local file path or Tauri asset protocol (`asset://` / `stream`).
  - **Mode B (TTS)**: Existing platform-native TTS fallback.
* Integrates with `navigator.mediaSession` for system lock-screen and headphone controls (Play/Pause, Seek Backward 15s, Seek Forward 15s).

### 4.2 Immersion Bar UI (`src/features/reader/audio/ImmersionBar.tsx`)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🎧 Chapter 3: A Short Rest              [ 12:45 / 38:20 ]    ( 1.25× ) ( ⏱ 30m ) [ ✕ ] │
│ ──────────────────────────────●─────────────────────────────────────────────────────── │
│          [ ⏮ 15s ]             [  ▶ PLAY / ⏸ PAUSE  ]             [ 15s ⏭ ]            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
* **Speed Chips**: `0.75×`, `1.0×`, `1.25×`, `1.5×`, `1.75×`, `2.0×`.
* **Sleep Timer**: `Off`, `15m`, `30m`, `45m`, `End of Chapter`.
* **Chapter Menu**: Quick dropdown to jump to any chapter in the audio track.
* **Auto-Save**: Saves playback position to SQLite on pause, section change, or unmount.

---

## 5. GitHub Issue Draft Template

```markdown
### Feature Request: Companion Audiobook Attachment & In-Reader Immersion Player

#### Problem Statement
Readers often switch between reading text and listening to audiobooks. Currently, users must manage separate audio apps and manually align chapters.

#### Proposed Solution
Allow users to attach `.m4b` or `.mp3` files directly to existing library books as a companion track. When reading, Theorem's Immersion Bar provides native playback with speed controls, chapter navigation, sleep timers, and cross-device sync.

#### Acceptance Criteria
- [ ] "Attach Audiobook..." action on Book Card and Edit Metadata modal.
- [ ] Fast Rust metadata & chapter parser for M4B and MP3 files.
- [ ] In-reader audio player integrated into `ImmersionBar` with speed controls (0.75x–2.0x), ±15s skip, scrubber, and sleep timer.
- [ ] OS `MediaSession` lock screen & headphone controls.
- [ ] Sync playback position across devices via Iroh P2P.
```
