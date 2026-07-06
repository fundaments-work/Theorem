# Theorem — New Features Architecture

## Table of Contents

1. [Newsletter / Email Subscription](#1-newsletter--email-subscription)
2. [Accent Color Customization](#2-accent-color-customization)
3. [File-Based Sync (Syncthing-Compatible)](#3-file-based-sync-syncthing-compatible)
4. [Cloudflare Server Sync Readiness](#4-cloudflare-server-sync-readiness)

---

## 1. Newsletter / Email Subscription

### 1.1 Overview

Inbox-style newsletter reading. Users subscribe to newsletters with a unique email address. Incoming emails are converted to readable articles processed through the same `@mozilla/readability` pipeline already used for RSS.

### 1.2 Unique Email Address Per User

**Mechanism**: Cloudflare Email Routing subaddressing (RFC 5233).

Cloudflare Email Routing supports "plus addressing" natively. When enabled:
- A routing rule for `newsletter@theorem.app` also matches `newsletter+<anything>@theorem.app`
- The `+<anything>` part is preserved in `message.to` and readable by the Worker

**Implementation**:

```
1. Enable subaddressing in Cloudflare Email Routing settings
2. Create ONE catch-all rule: *@theorem.app → Worker
3. User's ID (UUID) generates their address: newsletter+{userId}@theorem.app
4. Worker reads message.to, extracts userId from the +part
5. Worker parses email with postal-mime → extracts HTML → @mozilla/readability
6. Worker stores article in user's Durable Object or R2 bucket
7. App pulls/polls from DO via WebSocket or REST API
```

**Libraries**:

| Library | npm Package | Purpose |
|---------|------------|---------|
| `postal-mime` | `postal-mime` | Parse raw MIME email into structured object (headers, text, HTML, attachments) |
| `@mozilla/readability` | Already in project | Extract clean article content from HTML email body |

### 1.3 Worker Pseudocode

```ts
import PostalMime from 'postal-mime'

export default {
  async email(message, env, ctx) {
    const recipient = message.to                // "newsletter+xk3f9a2b@theorem.app"
    const localPart = recipient.split('@')[0]   // "newsletter+xk3f9a2b"
    const detail = localPart.split('+')[1]      // "xk3f9a2b" (user ID)

    if (!detail) { message.setReject('Invalid recipient'); return }

    const parsed = await PostalMime.parse(message.raw)
    const html = parsed.html || parsed.text || ''
    const userId = detail

    const article = {
      id: crypto.randomUUID(),
      from: message.from,
      subject: parsed.subject,
      html,
      receivedAt: new Date().toISOString(),
    }

    const userDO = env.SYNC_DO.get(env.SYNC_DO.idFromName(userId))
    await userDO.fetch(new Request('https://do/article', {
      method: 'POST',
      body: JSON.stringify(article),
    }))
  }
}
```

### 1.4 Zero Per-User Configuration

One routing rule handles all users. No SMTP server to run. Entirely within Cloudflare free tier (unlimited inbound emails on Email Routing). No per-user DNS records, no individual routing rules.

### 1.5 Privacy Options

| Tier | Approach | Privacy Level |
|------|----------|--------------|
| Default | Cloudflare Email Routing → Worker → DO | Medium (email passes through Cloudflare) |
| Advanced | Self-hosted SMTP receiver | High (zero third-party) |
| Hybrid | Cloudflare for most users, manual IMAP polling for privacy users | Flexible |

### 1.6 Integration with Existing RSS Pipeline

The article object from email parsing feeds into the same `RssService` / `useRssStore` pipeline. No new renderer needed — `ArticleViewer` already handles HTML content. The only new concept: a "newsletter" subscription type that maps to an email address instead of an RSS URL.

---

## 2. Accent Color Customization

### 2.1 Overview

Obsidian-style accent color picker. User chooses any hex color; the app generates a full palette of semantic color tokens that propagate through all components via CSS custom properties.

### 2.2 Architecture

Theorem already has the correct architecture in `src/core/styles/design-tokens.css`:

```css
@theme {
    --color-accent: var(--app-accent, #1a1a1a);
    --color-accent-hover: var(--app-accent-hover, #000000);
    --color-accent-light: var(--app-accent-light, #f4f4f4);
    --color-accent-contrast: var(--app-accent-contrast, #ffffff);
}
```

The `--app-*` variables are the "input" layer (set by JS). The `--color-*` variables are the "semantic" layer (used by all components). Changing `--app-accent` on `:root` propagates everywhere instantly.

### 2.3 Palette Generation

```ts
import { colord, extend } from "colord"
import a11yPlugin from "colord/plugins/a11y"
extend([a11yPlugin])

function generateAccentPalette(hexAccent: string, isDark: boolean) {
  const accent = colord(hexAccent)
  const hsl = accent.toHsl()

  return {
    "--app-accent": hexAccent,
    "--app-accent-hover": colord({
      h: hsl.h, s: hsl.s,
      l: isDark ? Math.min(hsl.l + 10, 85) : Math.max(hsl.l - 10, 15)
    }).toHex(),
    "--app-accent-light": colord({
      h: hsl.h, s: Math.max(hsl.s - 15, 0),
      l: isDark ? 14 : 93
    }).toHex(),
    "--app-accent-contrast": accent.isReadable("#000") ? "#000" : "#fff",
  }
}

function applyAccentTheme(hex: string) {
  const palette = generateAccentPalette(hex, isDarkMode())
  Object.entries(palette).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value)
  })
}
```

### 2.4 Libraries

| Library | npm Package | Size | Purpose |
|---------|------------|------|---------|
| `colord` | `colord` | 2KB | Color manipulation: hex/rgb/hsl conversion, contrast checks, luminance |
| `react-colorful` | `react-colorful` | 2.8KB | Lightweight color picker. Zero deps, TypeScript, WAI-ARIA accessible. |

`colord` is the same library many Obsidian themes use. `react-colorful` is 13× smaller than `react-color` with no DOM issues in Tauri webview.

### 2.5 Implementation Steps

1. Add `accentColor: string | null` to `useSettingsStore` (with migration version bump)
2. On app rehydrate + on setting change: call `applyAccentTheme()`
3. Add color picker UI in Settings → Appearance tab
4. Handle dark/light mode: regenerate palette on theme toggle
5. All existing components automatically pick up the change via `var(--color-accent)` — **zero component changes needed**

### 2.6 Dark/Light Palette Differences

The palette generator takes `isDark` into account:
- Dark mode: hover is *lighter* than accent, background tint is very dark (l:14)
- Light mode: hover is *darker* than accent, background tint is very light (l:93)
- Contrast color: auto-selected via `colord.isReadable()` (black or white text on accent)

---

## 3. File-Based Sync (Syncthing-Compatible)

### 3.1 Overview

Store all non-blob user data as JSON files in a user-configurable directory. Users point Syncthing/Dropbox/Resilio at this directory for zero-config file-based sync. Similar to how Obsidian (Markdown files), Logseq (Markdown files), and KeePass (kdbx file) work with file sync tools.

### 3.2 Format: Individual JSON Files Per Entity

```
theorem-data/                    ← user-configurable, point Syncthing here
  .stignore                     ← ignore tmp/wal/shm/lock files
  .stfolder                     ← Syncthing marker
  books/
    <uuid>.json                 ← one file per book (metadata + reading position)
  annotations/
    <uuid>.json                 ← one file per annotation
  collections/
    <uuid>.json                 ← one file per collection
  vocabulary/
    <uuid>.json                 ← one file per vocabulary term
  feeds.json                    ← RSS feed subscriptions (single file, rarely conflicts)
  settings.json                 ← app settings (single file, rarely conflicts)
  stats.json                    ← reading statistics
  blobs/                        ← binary blobs (book content, covers) — by hash
    <sha256-hash>.blob
  lock                          ← PID + timestamp, prevents dual-instance writes
```

### 3.3 Why This Works With Syncthing

- **Per-file conflict granularity**: If user highlights on two devices, only that one annotation file conflicts. Not the entire database.
- **Syncthing's atomic writes**: Syncthing writes to `.syncthing.<name>.tmp` then renames. The filesystem only ever sees complete files.
- **`.sync-conflict-*` files**: Syncthing renames the older copy on conflict. App detects these on startup and offers merge.
- **Zero file locking**: Syncthing can read files while app writes (app uses atomic write-then-rename, not in-place modification).

### 3.4 Atomic Writes (Critical for Sync Compatibility)

```rust
fn atomic_write(path: &Path, content: &[u8]) -> Result<(), Error> {
    let tmp = path.with_extension("tmp");
    let mut f = File::create(&tmp)?;
    f.write_all(content)?;
    f.sync_all()?;           // Flush OS buffers to disk
    rename(&tmp, path)?;     // Atomic on same filesystem
    Ok(())
}
```

**Golden rule**: Never modify files in place. Always write to `.tmp`, `sync_all`, then `rename`. This is what Syncthing itself does internally and what it expects from synced apps.

### 3.5 SQLite + File Sync Coexistence

SQLite remains the primary local store for performance. JSON files are **exported snapshots** on every mutation. On startup, if JSON snapshots are newer than SQLite (checked via timestamps), import them.

```rust
// On mutation
db.execute("UPDATE books SET ... WHERE id = ?", [id])?;            // SQLite (fast)
atomic_write_json(&format!("theorem-data/books/{id}.json"), data)?; // Sync-compatible

// On startup
for conflict_file in glob("theorem-data/books/*.sync-conflict*") {
    resolve_conflict(conflict_file);  // Offer merge or manual choice
}
for json_file in glob("theorem-data/books/*.json") {
    let json_mtime = json_file.metadata()?.modified()?;
    let db_mtime = db.query("SELECT updated_at FROM books WHERE id = ?", [id])?;
    if json_mtime > db_mtime {
        db.import_from_json(&json_file)?;
    }
}
```

### 3.6 Conflict Resolution Strategy

When Syncthing creates a `.sync-conflict-*` file:
1. On startup, scan for `*.sync-conflict-*` in all entity directories
2. For each conflict, read both the main file and the conflict file
3. **Per-field LWW merge**: Extract the `updatedAt` timestamp from both versions. The newer version's fields win. For arrays (tags, bookIds), union the two sets.
4. Write the merged result as the new canonical file
5. Move the conflict file to `.resolved/` (keep for audit)
6. If merge fails (malformed JSON, unresolvable conflict), keep both and surface in UI

### 3.7 `.stignore` Rules

```
# Transient/temporary files
*.tmp
*.wal
*.shm

# Lock file (prevents dual-instance writes on same machine)
lock

# Resolved conflicts (don't re-sync)
.resolved/

# Syncthing internal folder
.stfolder
```

### 3.8 Libraries

No external "file sync library" needed. Syncthing handles transport + conflict detection. The app needs:
- Atomic file writes: ~10 lines of Rust (no library needed)
- File watcher: `notify` crate (Rust, 5k stars) to detect external JSON changes while app is running
- JSON merge: simple per-field LWW (custom, ~30 lines)

---

## 4. Cloudflare Server Sync Readiness

### 4.1 Architecture Today → Tomorrow

The goal: architect the app so that adding Cloudflare-based server sync later is a configuration change, not a rewrite.

### 4.2 Abstraction Layer

Define interfaces that both local and cloud backends implement:

```typescript
interface SyncTransport {
  connect(): Promise<void>
  disconnect(): void
  onSync(doc: Y.Doc): void
}

interface BlobStore {
  get(hash: string): Promise<ArrayBuffer>
  put(hash: string, data: ArrayBuffer): Promise<void>
  has(hash: string): Promise<boolean>
}

// Local backends (current)
class LanSyncTransport implements SyncTransport { ... }   // mDNS + WebSocket
class IrohSyncTransport implements SyncTransport { ... }  // QUIC P2P
class DiskBlobStore implements BlobStore { ... }          // local files

// Cloud backends (future)
class CloudflareSyncTransport implements SyncTransport { ... }  // WebSocket → DO
class R2BlobStore implements BlobStore { ... }                  // R2 bucket
```

### 4.3 Cloudflare Services (All Free Tier)

| Service | Use | Free Tier |
|---------|-----|-----------|
| **Durable Objects** | Holds canonical Y.Doc per user. WebSocket-native sync endpoint. Single-threaded = safe CRDT merge. | 1M requests/month |
| **R2** | Binary book file storage. S3-compatible API. | 10 GB, 1M Class A ops |
| **Workers** | REST API + auth endpoints | 100K requests/day |
| **Queues** | Async processing (heavy imports, email fetch) | 1M ops/month |
| **Email Routing** | Newsletter subscription (see section 1) | Unlimited inbound |
| **Turnstile** | Bot protection on web endpoints | 1M siteverify/month |

### 4.4 Durable Object: The Sync Server

```ts
export class SyncDO extends DurableObject {
  private doc: Y.Doc

  constructor(ctx, env) {
    super(ctx, env)
    this.doc = new Y.Doc()
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get('yjs-doc')
      if (stored) Y.applyUpdate(this.doc, stored)
    })
  }

  async fetch(request) {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const wsProvider = new WebsocketProvider(server)
    // ...y-sync protocol setup...

    this.doc.on('update', async (update) => {
      await this.ctx.storage.put('yjs-doc', update)
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}
```

**Key property**: The DO is single-threaded. Only one request executes at a time per DO instance. When multiple devices connect, the DO serializes their updates deterministically — no locks, no race conditions, no merge conflicts.

### 4.5 Auth Pattern: Device-Based (No User Accounts)

Keep the existing device identity model — no email/password, no OAuth, no user database:

1. Device generates X25519 keypair → device_id
2. User authorizes a new device by scanning QR from an already-authorized device
3. Authorized device POSTs `/authorize?device_id=<new_id>&public_key=<key>` to Worker
4. Worker stores `authorized_devices` set in the DO
5. DO only accepts WebSocket connections from devices in the authorized set
6. WebSocket connection is authenticated via the device's private key signature

This is exactly the current LAN pairing flow, but mediated through a cloud DO instead of direct QR scanning on the same network.

### 4.6 Minimal Cloudflare Deployment

```
┌──────────────────────────────────────────────────┐
│ theorem.app (Cloudflare zone)                    │
│                                                  │
│  api.theorem.app → Worker                        │
│    POST /authorize-device                        │
│    GET  /sync/:userId (WebSocket upgrade → DO)   │
│    GET  /r2-upload-url                           │
│                                                  │
│  sync.theorem.app → Durable Object               │
│    WebSocket: y-sync protocol                    │
│    DO per user: sync:user:{userId}               │
│                                                  │
│  books.theorem.app → R2 bucket                   │
│    GET /{bookHash}                               │
│    PUT /{bookHash} (pre-signed URL from Worker)  │
│                                                  │
│  *@theorem.app → Email Routing → Worker          │
│    Newsletter delivery (see section 1)           │
└──────────────────────────────────────────────────┘
```

**Entire setup fits within Cloudflare free tier** for hundreds of users. No servers to manage. Yjs handles all sync correctness. The only operational cost is the domain registration.

### 4.7 Implementation Phases

**Phase 1 (now)**: Implement `SyncTransport` and `BlobStore` abstractions. Keep local backends only. This is zero Cloudflare work but architectures the code for future cloud sync.

**Phase 2 (later)**: Add the Cloudflare Worker + DO + R2. The app flips a config flag from `transport: "lan"` to `transport: "cloudflare"`. All existing sync code works unchanged — same Yjs CRDT, same Zustand bridge, same state management.
