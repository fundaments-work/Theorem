# Theorem

**Own your reading data. Forever.**

Theorem is a free, open-source, local-first reading app for people who care about plain text, privacy, and long-term access to their notes.

Read PDFs, EPUBs, and RSS in one workspace. Highlight and annotate anything. Sync everything to local Markdown files in your Obsidian or Logseq vault.

No cloud account. No subscription wall. No vendor lock-in.

## Download Theorem

[![Latest Release](https://img.shields.io/github/v/release/fundaments-work/theorem?label=latest&style=flat-square)](https://github.com/fundaments-work/theorem/releases/latest)

- [Download for Linux](https://github.com/fundaments-work/theorem/releases/latest) (`.deb` or `.AppImage`)
- [Star on GitHub](https://github.com/fundaments-work/theorem/stargazers)
- [View Source Code](https://github.com/fundaments-work/theorem)
- [Join Community Discussions](https://github.com/fundaments-work/theorem/discussions)

## Why People Switch

- You should not pay monthly just to access your own highlights.
- Your reading notes should not be trapped in proprietary clouds.
- One app should handle books, papers, and feeds without splitting your workflow.
- Your second brain should stay in plain text you can open in 10 years.

## What You Can Do

- **Read across formats:** EPUB, MOBI, AZW, AZW3, FB2, CBZ, PDF, and RSS.
- **Highlight and annotate:** Capture passages and notes while you read.
- **Sync between devices:** Pair Theorem installs over your local network and keep books, progress, and annotations in sync.
- **Sync to Markdown:** Export highlights, notes, and vocabulary to local files.
- **Build vocabulary:** Use built-in dictionary flows during reading.
- **Stay offline-first:** Use Theorem without an account or cloud dependency.

## How It Works

1. Import books, papers, or RSS feeds into Theorem.
2. Highlight and annotate while reading.
3. Get Markdown output in your local vault, ready for your PKM workflow.

## Built for Obsidian and Logseq Workflows

Theorem is designed for knowledge workers using PKM systems, Zettelkasten methods, and second-brain workflows.

If your stack is "read -> highlight -> connect ideas in Markdown," Theorem removes the export friction.

## FAQ

### Is my data safe?

Your reading data and exports are stored locally. There is no required cloud account.

### Can I migrate away later?

Yes. Exports are plain Markdown files, so you can move or process them with any tool.

### Is this a Readwise alternative?

Yes. Theorem focuses on local-first reading, annotation, and Markdown export without a paid subscription.

### Does it work with Obsidian and Logseq?

Yes. Markdown sync is designed for vault-based workflows.

### Is there built-in device sync?

Yes. Device Sync is available in beta for encrypted LAN pairing and sync between Theorem installs.

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+
- Rust stable
- Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and other [Tauri dependencies](https://tauri.app/start/prerequisites/)

### Setup

```bash
pnpm install
```

### Commands

```bash
pnpm dev          # Web dev server (port 1420)
pnpm dev:tauri    # Desktop dev (Tauri + Vite)
pnpm typecheck    # TypeScript type checking
pnpm build        # Production build (typecheck + vite)
pnpm preview      # Preview production build
pnpm test         # Run Vitest unit tests
pnpm tauri        # Raw Tauri CLI access
```

### Building for Release

```bash
# Linux (.deb auto-detected)
pnpm package:linux

# Specific formats
pnpm package:linux:deb
pnpm package:linux:rpm
pnpm package:linux:appimage
```

Generated packages are copied to `dist/packages/linux/`.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](./LICENSE) for details.
