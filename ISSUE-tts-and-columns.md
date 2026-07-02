# Issue: TTS autoplay + doubling + column misalignment on desktop

Papercuts that need a fresh pair of eyes.  **Desktop only** (Linux/Tauri/WebKitGTK);
mobile (Android WebView) does not exhibit these problems.

---

## 1. TTS plays immediately when a book opens (no user click)

- Open **any** non-PDF book (EPUB, etc.).
- Do **not** press the TTS play button or the headphone icon.
- Within seconds, audio starts speaking book content out loud.

### Relevant files
- `src/features/reader/audio/ImmersionBar.tsx`
- `src/features/reader/audio/ImmersionPlayer.ts`
- `src/features/reader/Reader.tsx` (especially how `ImmersionBar` is mounted)
- `src/features/reader/hooks/useDocumentReader.ts`
- `src/core/store/index.ts` (`tts.enabled` default)

### What you need to trace
- Find **every** call to `invoke('generate_speech', …)` in the frontend.
- For each call site, determine: who triggers it, when, and under what conditions.
- The Rust `generate_speech` command in `src-tauri/src/tts.rs` **always plays audio
  out loud** (rodio on desktop, AudioTrack on Android).  There is no "preload"
  or "synthesize-only" mode.
- So **any** frontend call to `generate_speech` = audible output.
- Find why a `generate_speech` call fires **without** the user pressing play.

### Likely suspects
- `ImmersionBar` was previously mounted whenever `isBookReady && !isPdfFormat`
  (regardless of `immersionMode`), registering a `tts-done` → `onSynthesisComplete`
  chain.  That mounting condition may still exist.
- `onTtsWordClick` in `ReaderViewport.tsx` (line ~160) — a click on a `.tts-word`
  span in the iframe fires `generate_speech`.  Could a programmatic or synthetic
  click trigger this?
- The `isContinuousMode` auto-play `useEffect` in `ImmersionBar.tsx` (line ~182)
  may fire `handlePlay()` when `playbackState === 'idle'` and section text changes.
- `immersionMode` may be persisted as `true` from a previous session (Zustand
  store in `src/core/store/index.ts`), causing `ImmersionBar` to mount immediately
  with active listeners.

---

## 2. TTS repeats every word twice during playback

When TTS is playing, every spoken word is heard **twice** (doubled output).

### What to investigate
- Are there **two** concurrent `generate_speech` invocations for the same page?
- Check if the old `handleTtsSynthesisComplete` preload chain is **definitely
  removed** from `Reader.tsx`.
- Check if `ImmersionPlayer`'s `audio-chunk` listener fires twice per chunk
  (duplicate `listen()` calls from re-initialization).
- `ImmersionPlayer.init()` is called from **two** places:
  1. `ReaderViewport.tsx` ~line 394 – no callbacks, bare init
  2. `ImmersionBar.tsx` ~line 71 – with callbacks
  Both call `init()` on the same module-level singleton (`immersionPlayer`).
  If both fire, the event listeners may be registered twice → duplicate
  `audio-chunk` → doubled word highlights and possibly doubled Rust-side audio.

### Rust-side check
- `src-tauri/src/tts.rs`: the `generate_speech` command bumps a `generation_id`
  atom.  Older in-flight generations abort when they see the ID change.  Verify
  this abort logic works correctly — a stale generation that wasn't properly
  aborted could still be playing audio.

---

## 3. Column layout is broken after chapter navigation (desktop only)

**Symptoms:**
- Two-column layout has one column cut off / overflowing the viewport.
- Sometimes the entire reader area is a blank white rectangle.
- Clicking any zoom control (in/out/reset) instantly fixes the layout.
- This happens when:
  - Opening a book.
  - Clicking a chapter in the TOC / bottom nav bar / menu.
  - Using keyboard (Left/Right arrows) to page-turn across a **chapter
    boundary** (e.g. from chapter 5 back into chapter 4).

**What zoom controls do:**
- `setZoomLevel()` → changes `this.zoom_level` → calls `applyZoomSync()`.
- `applyZoomSync()`:
  1. calls `applyZoomToDocument(doc)` — sets inline `font-size` and
     `--reader-zoom` CSS variable on each content doc.
  2. calls `renderer.render()` — the paginator re-measures its container
     and recalculates CSS columns (`columnize()` + `expand()`).

This exact same path is already called after navigation, but it does NOT
fix the problem.  Something about the **timing** or **state** during a
chapter transition makes the paginator's column math produce wrong results.

### Relevant internals to understand
- `src/features/reader/foliate-js/paginator.js` – the closed-shadow-DOM
  custom element that owns the CSS grid and does column math:
  - `#createView()` (line 666): destroys old view, creates new, appends to
    shadow-DOM `#container`.
  - `View.load()` (line 253): inside the iframe `load` event → calls
    `afterLoad()` (which eventually runs `setStyles()` and dispatches `load`
    event) → `beforeRender()` (measures container) → `View.render()` →
    `columnize()` → `expand()` (sets new iframe/element sizes).
  - `Paginator.render()` (line 754): re-measures container + re-columnizes.
  - `setStyles()` (line 1100): writes CSS stylesheet into `<style>` elements
    inside the iframe.  The CSS includes `font-size: calc(…)` with
    `var(--reader-zoom, 1)`.
- `src/features/reader/engines/foliate-engine.ts` – `FoliateEngine` class:
  - `applyZoomSync()` (line ~1290): applies inline zoom + calls `renderer.render()`.
  - `applySettingsAsync()` (line ~900): rebuilds the full CSS stylesheet and
    calls `renderer.setStyles(cssResult)` which writes it into the iframe's
    `<style>` elements.
  - `scheduleSettingsUpdate()` (line ~1100): RAF-batched
    `applySettingsSync()` + `applySettingsAsync()`.
  - Navigation methods (`goTo`, `goToFraction`, `open`) already call
    `applyZoomSync()` + `scheduleSettingsUpdate()` after navigation.

### What the current fix does (and why it might still fail)
- After every chapter navigation, `applyZoomSync()` runs on the same frame
  and `scheduleSettingsUpdate()` schedules a RAF that re-applies the full CSS.
- The relocate handler detects section-index changes from page-turn wraps
  (`next()`/`prev()` crossing chapters) and does the same.
- **But**: on desktop (WebKitGTK), the iframe's `load` event may fire
  before the browser has **painted** the new content.  The initial
  `beforeRender()` inside `View.load()` then measures the container at a
  moment when the shadow-DOM CSS grid's track sizes might still be stale
  (zero or transient).
- The subsequent `applyZoomSync()` → `render()` runs **after** one RAF,
  but if the grid layout is still resolving, the `getBoundingClientRect()`
  inside `#beforeRender()` returns incorrect dimensions.

### Ideas to investigate
1. **Add a force-reflow** between `afterLoad()` and `beforeRender()` inside
   the paginator's `View.load()` — e.g., read `getBoundingClientRect()`
   on the `#container` to force synchronous layout before measuring.
   (This would be in `src/features/reader/foliate-js/paginator.js`, which
   is **vendored** code — prefer fixing in the runtime wrapper
   `foliate-js-runtime/` or in `foliate-engine.ts`.)

2. **Detect bad dimensions** after `applyZoomSync()`'s render.  If the
   paginator reports zero pages or a zero viewSize, schedule a retry.

3. **Move the column fix into the paginator** by patching the
   `foliate-js-runtime/view.js` wrapper — e.g., in the `FoliateView`'s
   `#onLoad` handler, after the load event, schedule a deferred
   `renderer.render()` on the next frame.

4. **Use `createDocument()` to pre-warm** the section content before
   the paginator loads it, so the browser has already parsed the HTML
   by the time `View.load()` fires.

5. **Check if `container-type: size`** on `:host` (paginator.js line 457)
   affects the timing of `getBoundingClientRect()` on `#container` in
   WebKitGTK — size containment may defer layout differently than in
   Chromium-based WebViews.

### Testing guidance
- Reproduce: open an EPUB, navigate to any chapter via TOC → check columns.
- Use keyboard arrows to page past a chapter boundary → check columns.
- Click zoom in/out → verify the fix, then navigate again → verify it breaks.
- Compare behavior between desktop (Tauri) and web (pnpm dev in browser).

---

## Helpful file map
```
src/
  features/reader/
    Reader.tsx                    # Main reader orchestration
    engines/foliate-engine.ts     # Engine: applyZoomSync, goTo, scheduleSettingsUpdate
    components/ReaderViewport.tsx # React wrapper, onTtsWordClick handler
    audio/
      ImmersionBar.tsx            # TTS control bar UI + play/stop logic
      ImmersionPlayer.ts          # Singleton: audio-chunk/tts-done listeners
    foliate-js/
      paginator.js                # VENDORED: Paginator, View, columnize, expand
    foliate-js-runtime/
      view.js                     # OUR wrapper: FoliateView custom element
src-tauri/src/
  tts.rs                          # Rust TTS: generate_speech, stop_speech
  desktop_audio.rs                # rodio-based audio output (desktop)
core/store/index.ts               # Zustand: tts.enabled default
```
