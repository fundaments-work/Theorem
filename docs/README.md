# Theorem — Documentation

## Quick Start

```bash
git clone --recurse-submodules <repo>
pnpm install
pnpm dev          # web (limited — some features need Tauri)
pnpm dev:tauri    # desktop (full experience)
```

## Architecture

| Document | What it covers |
|----------|----------------|
| [CONTEXT.md](../context.md) | Project context, stack choices, design rationale |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, module relationships |

## Features

| Document | Feature |
|----------|---------|
| [reader.md](reader.md) | EPUB/MOBI/PDF/CBR reading, annotations, search |
| [library.md](library.md) | Book import, organization, search, virtual scrolling |
| [sync.md](sync.md) | P2P device sync via iroh |
| [annotations.md](annotations.md) | Highlights, notes, bookmarks |
| [vocabulary.md](vocabulary.md) | Dictionary lookups, StarDict |
| [feeds.md](feeds.md) | RSS/Atom feed subscriptions |
| [vault-sync.md](vault-sync.md) | Markdown export to Obsidian/Logseq |
| [settings.md](settings.md) | App configuration, storage management |
| [statistics.md](statistics.md) | Reading stats and goals |
| [tts.md](tts.md) | Text-to-speech (immersion reading) |
| [persistence.md](persistence.md) | SQLite schema, Zustand stores, data lifecycle |

## Reference

| Document | What it covers |
|----------|----------------|
| [epub-preparser.md](epub-preparser.md) | Rust EPUB ZIP pre-parser |
| [keyboard-shortcuts.md](keyboard-shortcuts.md) | All keyboard shortcuts |
| [onboarding.md](onboarding.md) | First-run flow |
