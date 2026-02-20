# Theorem

**Own your reading data. Forever.**

Theorem is a free, open-source, local-first reading app for people who care about plain text, privacy, and long-term access to their notes.

Read PDFs, EPUBs, and RSS in one workspace. Highlight and annotate anything. Sync everything to local Markdown files in your Obsidian or Logseq vault.

No cloud account. No subscription wall. No vendor lock-in.

## Download Theorem v1.0

- [Download Linux AppImage](https://github.com/sapienskid/theorem/releases/latest)
- [Download Android APK](https://github.com/sapienskid/theorem/releases/latest)
- [Star on GitHub](https://github.com/sapienskid/theorem/stargazers)
- [View Source Code](https://github.com/sapienskid/theorem)
- [Join Community Discussions](https://github.com/sapienskid/theorem/discussions)

## Why People Switch

- You should not pay monthly just to access your own highlights.
- Your reading notes should not be trapped in proprietary clouds.
- One app should handle books, papers, and feeds without splitting your workflow.
- Your second brain should stay in plain text you can open in 10 years.

## What You Can Do in v1.0

- **Read across formats:** EPUB, MOBI, AZW, AZW3, FB2, CBZ, PDF, and RSS.
- **Highlight and annotate:** Capture passages and notes while you read.
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

## Honest Status

Theorem v1.0 is early but functional. It is already useful for daily reading and note capture, with a clear local-first architecture and transparent open-source code.

Current limitations to know up front:
- Cross-device sync is not built in yet.
- You are responsible for backups (your data is local).
- CBR is recognized for compatibility but intentionally unsupported for import/render.

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

Not in v1.0. Today, Theorem prioritizes local ownership and exportability.

## Development

### Project Layout

- `src`: React frontend entry and UI
- `src/core`: shared domain models, stores, and services
- `src/shell`: app shell components (titlebar, sidebar, branding, error boundary)
- `src/ui`: reusable UI primitives
- `src/features/*`: reader, library, settings, statistics, vocabulary, and feeds modules
- `src-tauri`: Rust backend and desktop packaging config

### Commands

```bash
# Install dependencies
pnpm install

# Start web app (Vite)
pnpm dev

# Start desktop app (Tauri + Vite)
pnpm dev:tauri
# or
pnpm tauri dev

# Typecheck app + imported modules
pnpm typecheck

# Production build
pnpm build

# Preview web build
pnpm preview
```
