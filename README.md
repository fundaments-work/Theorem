# Theorem

**Own your reading data. Forever.**

[![Latest Release](https://img.shields.io/github/v/release/fundaments-work/theorem?label=latest&style=flat-square)](https://github.com/fundaments-work/theorem/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows%20%7C%20android-8A2BE2?style=flat-square)](https://github.com/fundaments-work/theorem/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/fundaments-work/theorem/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/fundaments-work/theorem/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-~6.0-3178C6?style=flat-square)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.85+-DEA584?style=flat-square)](https://www.rust-lang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/fundaments-work/theorem/pulls)

Theorem is a **free, open-source, local-first** reading app built with [Tauri](https://tauri.app). It runs on **Linux, macOS, Windows, and Android** from a shared codebase.

Read PDFs, EPUBs, MOBI, FB2, CBZ, and RSS feeds — all in one workspace. Highlight and annotate anything. Look up words with offline dictionaries. Listen with neural text-to-speech. Sync everything to Markdown files in your Obsidian or Logseq vault.

**No cloud account. No subscription wall. No vendor lock-in.**

---

## Features

### 📖 Multi-Format Reader
- EPUB, MOBI, AZW, AZW3, FB2, CBZ, PDF, and RSS articles
- Foliate-based reflowable book rendering with pagination and scroll modes
- PDF.js-based PDF rendering with zoom, fit modes, and outlines
- Full table of contents navigation
- Reading progress saved per-book across sessions

### 🖍️ Highlights & Annotations
- Color-coded highlights (yellow, green, blue, pink, orange)
- Add notes to any highlight
- Annotation panel for quick navigation
- Works across all formats including PDF

### 🎧 Neural Text-to-Speech (Immersion Reading)
- Kokoro ONNX neural TTS engine — no cloud API needed
- 6 distinct voices (Bella, Nicole, Sarah, Adam, Michael, George)
- Pitch-preserved playback speed control (0.5×–2×)
- Gapless audio with per-word highlighting
- Preloads next page for seamless page turns
- Auto-downloads model on first use, cancel/resume/delete supported

### 📚 Vocabulary Builder
- Look up words while reading with built-in dictionary
- Offline StarDict dictionary support
- Pronunciation display with optional audio
- Vocabulary review workspace

### 📡 RSS Reader
- Subscribe to feeds and read articles with full annotation tools
- Article extraction via Mozilla Readability
- Offline article storage

### 🔗 Markdown Export (Obsidian / Logseq)
- Export highlights and annotations to local Markdown files
- Designed for vault-based PKM workflows (Obsidian, Logseq, Zettelkasten)
- Customizable export templates and naming

### 🔐 LAN Device Sync
- Encrypted peer-to-peer sync between Theorem installs on local network
- Syncs books, reading progress, annotations, and settings
- QR-based device pairing
- No cloud relay — fully local

### 📊 Reading Statistics
- Track reading time, pages completed, and streaks
- Daily activity log

### 🎨 Customizable Reading Experience
- Font, size, line-height, and margin controls
- Light, dark, and system theme modes
- Paged and scroll layout modes
- Full-screen reading
- Search within books

### 📱 Cross-Platform
- Desktop: Linux (.deb, .AppImage), macOS (.dmg), Windows (.msi, .exe)
- Mobile: Android (.apk)
- Web: Browser fallback for development
- All from a single codebase

---

## Download

| Platform | Download |
|----------|----------|
| Linux | `.deb` or `.AppImage` |
| macOS (Intel) | `.dmg` |
| macOS (Apple Silicon) | `.dmg` |
| Windows | `.msi` or `.exe` |
| Android | `.apk` |

All builds are available on the [Releases page](https://github.com/fundaments-work/theorem/releases/latest).

---

## Why Theorem?

Theorem is built for **knowledge workers** who want to own their reading data:

- **Your data stays local** — everything is stored on your device. No cloud, no tracking, no data mining.
- **Portable by design** — exports are plain Markdown files. Move to any tool anytime.
- **True offline-first** — works completely without internet. Sync when you choose.
- **No subscriptions** — free and open-source. Always.

### Is Theorem a Readwise alternative?

Yes. Local-first reading, annotation, and Markdown export without a paid subscription.

---

## Quick Start (Development)

### Prerequisites

- **Node.js 22+** and **pnpm 10+**
- **Rust** (stable, via [rustup](https://rustup.rs))
- **System libraries**: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/fundaments-work/theorem.git
cd theorem
pnpm install
```

### Run

```bash
pnpm dev          # Web dev server (http://localhost:1420)
pnpm dev:tauri    # Desktop app in dev mode
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm dev:tauri` | Start Tauri desktop app |
| `pnpm build` | Typecheck + production build |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm test` | Run Vitest unit tests |
| `pnpm test:coverage` | Tests with coverage report |
| `pnpm package:linux` | Build Linux release package |

### Architecture

The frontend is built with **React 19**, **TypeScript**, **Zustand** for state, and **Tailwind CSS v4** for styling. The desktop backend is **Tauri 2** with Rust commands for file I/O, TTS, sync, and platform integration.

Rendering engines:
- **Foliate.js** (vendored) — reflowable ebook formats
- **PDF.js** — PDF rendering and annotation
- **Mozilla Readability** — RSS article extraction

See [AGENTS.md](./AGENTS.md) for the full repository map.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite 8 |
| State | Zustand 5 (persisted + migrated) |
| Styling | Tailwind CSS v4, CSS design tokens |
| Desktop | Tauri 2 (Rust) |
| Mobile | Tauri 2 Android |
| PDF | PDF.js 6 |
| Ebook | Foliate.js (vendored) |
| TTS | Kokoro ONNX (Rust) |
| Dictionary | StarDict |
| RSS | Mozilla Readability |
| Testing | Vitest + jsdom |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Follow [conventional commits](https://www.conventionalcommits.org/)
4. Open a Pull Request

---

## FAQ

**Is my data safe?** — Yes. Everything is stored locally. No cloud account required.

**Can I migrate away?** — Yes. Exports are plain Markdown files, portable to any tool.

**Does it work with Obsidian and Logseq?** — Yes. Markdown sync is designed for vault-based workflows.

**Is there device sync?** — Yes. Encrypted LAN pairing between Theorem installs.

**Does TTS work offline?** — Yes. The Kokoro model runs entirely on-device.

**Is CBR supported?** — Recognized for compatibility but intentionally not supported for import/render.

---

## License

MIT License — see [LICENSE](./LICENSE) for details.
