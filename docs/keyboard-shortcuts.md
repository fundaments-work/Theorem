# Keyboard Shortcuts

## Global (Universal)

| Shortcut | Action |
|----------|--------|
| `Ctrl+1` | Go to Library |
| `Ctrl+2` | Go to Vocabulary |
| `Ctrl+3` | Go to Shelves |
| `Ctrl+4` | Go to Annotations |
| `Ctrl+5` | Go to Bookmarks |
| `Ctrl+6` | Go to Settings |
| `Ctrl+7` | Go to Feeds |
| `Shift+?` | Show shortcuts help |
| `Ctrl+F` | Focus search (context-dependent) |
| `Escape` | Close panels / dialogs |

## Reader

| Shortcut | Action |
|----------|--------|
| `Left` / `Right` | Previous / Next page |
| `Space` | Next page (scroll/paged) |
| `+` / `-` | Zoom in / Zoom out |
| `F` | Toggle fullscreen |
| `T` | Toggle table of contents |
| `S` | Focus search |
| `A` | Toggle annotations panel |
| `B` | Toggle bookmarks panel |
| `R` | Start/stop TTS (immersion reading) |
| `Escape` | Exit fullscreen / close settings |

## Library

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `g` | Toggle grid/list view |
| `a` | Select all (multi-select mode) |
| `Ctrl+A` | Select all books |
| `Delete` | Delete selected books |

## Implementation

Shortcuts are registered via `registerShortcuts()` in `src/core/lib/keyboard-shortcuts.ts`. The system is route-scoped — shortcuts only fire when their route is active. Global shortcuts (navigation, help) always work.

The `useKeyboardShortcuts()` hook registers/unregisters shortcuts on mount/unmount, using `useEffect` cleanup. This prevents shortcuts from leaking across routes.
