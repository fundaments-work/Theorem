# Theorem

**Own your reading data. Forever.**

[![Latest Release](https://img.shields.io/github/v/release/fundaments-work/theorem?label=latest&style=flat-square)](https://github.com/fundaments-work/theorem/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux%20|%20macos%20|%20windows%20|%20android-8A2BE2?style=flat-square)](https://github.com/fundaments-work/theorem/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/fundaments-work/theorem/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/fundaments-work/theorem/actions)

Theorem is a free, open-source, local-first reading app built with [Tauri](https://tauri.app). It runs on **Linux, macOS, Windows, and Android** with a shared codebase.

Read PDFs, EPUBs, MOBI, FB2, CBZ, and RSS in one workspace. Highlight and annotate anything. Sync everything to local Markdown files in your Obsidian or Logseq vault.

No cloud account. No subscription wall. No vendor lock-in.

## Download

| Platform | Download |
|----------|----------|
| Linux | `.deb` or `.AppImage` |
| macOS (Intel) | `.dmg` |
| macOS (Apple Silicon) | `.dmg` |
| Windows | `.msi` or `.exe` |
| Android | `.apk` |

All builds are available on the [Releases page](https://github.com/fundaments-work/theorem/releases/latest).

## Features

- **Multi-format reader** — EPUB, MOBI, AZW, AZW3, FB2, CBZ, PDF, and RSS feeds
- **Highlights & annotations** — capture passages and notes with color-coded highlights
- **Device sync** — encrypted LAN pairing keeps books, progress, and annotations in sync across your devices
- **Markdown export** — highlights and notes sync to local Markdown for Obsidian, Logseq, or any PKM tool
- **Built-in dictionary** — look up words while reading, with StarDict dictionary support
- **Vocabulary workspace** — track and review words you've looked up
- **RSS reader** — follow feeds and read articles with the same annotation tools
- **Offline-first** — all data stored locally. Works without an internet connection

## Built for PKM Workflows

Theorem is designed for knowledge workers using Obsidian, Logseq, Zettelkasten methods, and second-brain workflows.

If your stack is "read → highlight → connect ideas in Markdown," Theorem removes the export friction.

## Development

### Prerequisites

- **Node.js 22+** and **pnpm 10+**
- **Rust** (stable, via [rustup](https://rustup.rs))
- **System libraries**: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Quick Start

```bash
git clone https://github.com/fundaments-work/theorem.git
cd theorem
pnpm install
pnpm dev          # Web dev server (port 1420)
pnpm dev:tauri    # Desktop dev (Tauri + Vite)
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm dev:tauri` | Start Tauri desktop app in dev mode |
| `pnpm build` | Typecheck + production build |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm test` | Run Vitest unit tests |
| `pnpm package:linux` | Build Linux release package |

### Architecture

See [AGENTS.md](./AGENTS.md) for the full repository map, import conventions, placement rules, and anti-patterns.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on setup, commit conventions, and testing.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Follow [conventional commits](https://www.conventionalcommits.org/)
4. Open a Pull Request

## FAQ

**Is my data safe?** — Yes. Everything is stored locally. No cloud account required.

**Can I migrate away?** — Yes. Exports are plain Markdown files, portable to any tool.

**Is this a Readwise alternative?** — Yes. Local-first reading, annotation, and Markdown export without a paid subscription.

**Does it work with Obsidian and Logseq?** — Yes. Markdown sync is designed for vault-based workflows.

**Is there device sync?** — Yes. Encrypted LAN pairing and peer-to-peer sync between Theorem installs.

## License

MIT License — see [LICENSE](./LICENSE) for details.
