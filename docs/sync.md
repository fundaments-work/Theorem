# P2P Device Sync

## Why iroh

Theorem syncs books, annotations, settings, vocabulary, and RSS data between devices with no server. The iroh stack enables this:

- **iroh-docs** provides CRDT-based document sync — both sides can write concurrently, and the documents converge to the same state. This is essential for a local-first app where both devices may modify the same book's metadata while offline.
- **iroh-blobs** provides content-addressed file transfer with BLAKE3 verification. Book files are identified by their blob hash — if both devices already have the same hash, no transfer is needed.
- **iroh-gossip** propagates presence and sync events between connected peers.
- **iroh-mdns** discovers peers on the same LAN without configuration.

Sync is always compiled (no feature gate). It's a core product feature.

## Pairing Protocol

```
Device A                          Device B
  │                                  │
  │  getDeviceIdentity()             │
  │  (returns deviceId +             │
  │   publicKey + fingerprint)       │
  │                                  │
  │  generate_pairing_qr()           │
  │  (QR encodes device identity     │
  │   + relay URL + pairing ticket)  │
  │                                  │
  │  ┌──── QR code ────────────┐     │
  │  │                         │     │
  │  │ ←─── scan / submit ─────│────►│ submit_pairing_code()
  │  │                         │     │  (decodes QR + calls
  │  └─────────────────────────┘     │   iroh_pair to register)
  │                                  │
  │  docs_import_sync_doc(ticket)    │
  │  (imports the shared CRDT doc    │
  │   created by Device A)           │
  │                                  │
  │◄───── Connected ────────────────►│
```

Once paired, devices are stored in SQLite `kv_store` under keys like `paired_device:{deviceId}`. Re-pairing is needed only if both devices clear their sync databases.

## Sync Lifecycle

### 1. Start (`iroh_start`)

Called from `ensureResponderSyncReady()` in App.tsx. Initializes:
- iroh `Endpoint` (QUIC-based P2P transport)
- iroh-docs `DocsEngine` for CRDT documents
- iroh-blobs `FsStore` for book file storage
- iroh-gossip swarm for event propagation
- mDNS discovery for LAN peers

Stored in a global `SyncTransportState` managed by Tauri.

### 2. Provision

`provisionToIrohDocs()` serializes all store state into the iroh-docs document as individual key-value entries:
- `book:{bookId}` — per-book metadata (stripped of file paths and data: cover URLs)
- `annotations` — full annotations array
- `collections` — full collections array
- `deletion_tombstones` — sync-aware deletion markers
- `vocabulary` — vocabulary terms
- `settings` — full settings + `_settingsUpdatedAt` timestamp
- `reading_stats` — reading statistics
- `rss_feeds` / `rss_articles` — RSS data

### 3. Sync

`docs_sync_now(peerDeviceId)` triggers CRDT reconciliation. The Rust backend:
1. Connects to peer via iroh QUIC transport
2. Exchanges doc content hashes
3. Transfers missing entries
4. Fires `docs-sync-finished` event on completion
5. During sync, `docs-pending-content-ready` fires when new entries arrive

### 4. Merge

`mergeIncomingData()` on the JS side processes all incoming entries:

| Domain | Strategy |
|--------|----------|
| Books | By contentHash/blobHash dedup. Newer `lastReadAt` wins progress. Union of tags, favorites, ratings. |
| Annotations | Newer `updatedAt` wins. Filtered by tombstones. |
| Collections | Union of bookIds. Newer name/description wins. |
| Vocabulary | Merged by normalized term+language. Deduped meanings. |
| Settings | Newer `_settingsUpdatedAt` timestamp wins. Preserves local `deviceSync` config. |
| Reading stats | Max of each stat. Union of daily activity. Streaks recomputed. |
| RSS feeds | By URL. Merged metadata. |
| RSS articles | By ID. Union of read/favorite status. |
| Deletion tombstones | Union of all tombstones with older-than-90-day pruning. |

### 5. Live Listener

After sync completes, `initDocsLiveListener()` subscribes to `docs-entry-changed` Tauri events. Remote changes made after the initial sync are streamed incrementally:
- `book:` keys are batched (200ms debounce, progressive flush)
- `annotation:` / `collection:` keys merge immediately
- Other keys buffer (500ms debounce, max 2000 pending entries)

### 6. Auto Sync

`startAutoSync()` manages recurring sync:

| Trigger | Delay/Interval |
|---------|----------------|
| App startup | 5 seconds |
| Periodic | Every 2 minutes |
| Visibility change | 30s cooldown |
| Peer comes online | 30s cooldown |
| Tray "Sync Now" | Immediate |
| Store mutation | 2 second debounce |

## File Transfer

Books are transferred using iroh-blobs with a custom ALPN (`theorem-file/v1`):

1. When a book is provisioned, its `blobHash` is stored in the book metadata
2. On sync, both sides exchange blob hashes — books marked `syncedWithoutFile` need downloading
3. `downloadBookOnDemand(bookId)` sends a request to each paired peer
4. The peer's `FileTransferHandler` (`file_transfer.rs`) serves the file from the `book-cache/` directory or the blob store
5. The file is written to the local `book-cache/` and the book is marked as having its file

Cover images are transferred the same way using `cover:{bookId}` as the request key.

## Conflict Resolution

Conflicts are detected during merge and surfaced to the user:
- **Book progress**: If both sides read the same book to different positions, the remote wins if its progress was recorded more recently
- **Annotations**: If both sides edit the same annotation, the newer `updatedAt` wins
- **Settings**: Remote wins if its `_settingsUpdatedAt` is newer. Local `deviceSync` configuration is preserved (it's device-specific)

Conflicts are rendered in the sync UI as a list with "local won" / "remote won" labels.
