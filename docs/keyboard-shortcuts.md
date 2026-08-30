# Keyboard Shortcuts

## Global (Universal)

| Shortcut | Action |
|----------|--------|
| `Ctrl+1` | Go to Library |
| `Ctrl+2` | Go to Shelves |
| `Ctrl+3` | Go to Feeds |
| `Ctrl+4` | Go to Workbench (Annotations & Vocab) |
| `Ctrl+5` | Go to Statistics |
| `Ctrl+7` | Go to Bookmarks |
| `Ctrl+,` | Go to Settings |
| `Ctrl+F` | Focus search bar |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+A` | Select all (Library/Shelves/Bookmarks) |
| `Shift+?` | Show shortcuts help modal |
| `Escape` | Close panels / popovers / dialogs |

## Reader

| Shortcut | Action |
|----------|--------|
| `Left` / `Right` | Previous / Next page |
| `Space` | Next page |
| `+` / `-` | Zoom in / Zoom out |
| `Ctrl+F` | Find in book |
| `Ctrl+D` | Bookmark current page |
| `Ctrl+T` | Toggle table of contents |
| `Ctrl+S` | Open reader settings |
| `Ctrl+A` | Open annotations panel |
| `F` | Toggle fullscreen |
| `Escape` | Exit fullscreen / close Theorem Lens / close panels |

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
