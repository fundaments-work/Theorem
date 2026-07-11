# Agent Prompt: Remove Legacy LWW Sync & Consolidate to Universal iroh Sync

## Objective

Remove all three legacy LWW (Last-Writer-Wins) sync paths and consolidate to a single universal iroh-based sync mechanism. The codebase currently has **four** sync paths; the goal is **one**.

### Current Sync Architecture

```
Sync Path 1 (JS timer → iroh-docs CRDT) ─── KEEP
  App.tsx → sync-orchestrator.runDeviceSync() → docs_sync_now()
  This is the CORRECT path — iroh-docs CRDT with iroh-blobs for files.

Sync Path 2 (Rust timer → QUIC LWW) ─── REMOVE
  start_background_sync() → initiate_sync() → sync_with_peer()
  Uses TheoremProtocolHandler (ALPN theorem-sync/v1), encrypt_payload/decrypt_payload.
  This is the legacy QUIC LWW protocol running alongside CRDT.

Sync Path 3 (HTTP sync-daemon sidecar) ─── REMOVE
  crates/sync-daemon/ — standalone HTTP server on port 43935
  Uses axum, runs_sync_round() with HTTP POST /sync/manifest etc.
  Spawned as subprocess on Linux from lib.rs.

Sync Path 4 (Android WorkManager JNI → HTTP) ─── REMOVE
  SyncWorker.kt → JNI → runBackgroundSync() → reqwest::Client HTTP POST
  Spawned by WorkManager every 15 min even if app killed.
  Uses legacy HTTP protocol — DOES NOT USE IROH AT ALL.
```

### Target Architecture

```
Unified Sync (everywhere) ─── ONE PATH
  JS timer → runDeviceSync() → docs_sync_now() [iroh-docs CRDT]
  └── Android: ForegroundService keeps iroh endpoint alive
  └── Android: WorkManager → JNI → init iroh endpoint → docs_sync_now()
  └── Desktop: JS timer → docs_sync_now() (no daemon, no QUIC LWW)
```

---

## Upgrade Plan (Execution Order)

This MUST be followed in order — later steps depend on earlier ones.

### Phase 1: Remove Legacy In-Process LWW (QUIC)

Files: `iroh_sync.rs`, `sync_commands.rs`, `lib.rs` (partial)

#### Step 1.1 — `src-tauri/src/iroh_sync.rs`

- **Remove**: `TheoremProtocolHandler` struct and impl (ALPN `theorem-sync/v1`)
- **Remove**: `dispatch_request()` function
- **Remove**: All `handle_*_req()` functions (manifest, push_batch, pull_batch, complete, file_availability, file_pull, cover_pull)
- **Remove**: `sync_with_peer()` function
- **Remove**: `decrypt_envelope()`, `encrypt_response()` functions
- **Keep**: `subscribe_doc_events()`, `handle_pair_req()`, `send_pair_request()` — these are iroh-docs CRDT / pairing
- **Keep**: `start_accept_loop()` but remove the `TheoremProtocolHandler` entry from the Router builder. Keep the pairing handler registration.
- **Remove**: imports of `sync_crypto::{encrypt_payload, decrypt_payload, encrypt_single_file_chunk, EncryptedPayload}`
- **Remove**: `use theorem_sync_core::sync_protocol::*;`

#### Step 1.2 — `src-tauri/src/sync_commands.rs`

- **Remove**: `initiate_sync()` command
- **Remove**: `sync_now()` command
- **Remove**: `start_background_sync()` command (this started the Rust timer loop)
- **Remove**: `stop_background_sync()` command
- **Remove**: `wake_background_sync()` command
- **Remove**: `set_sync_data()` command
- **Remove**: `get_incoming_sync_data()` command
- **Remove**: `update_peer_address()` command
- **Keep**: All `docs_*`, `blobs_*`, pairing commands, `init_sync`, `iroh_start`, `iroh_stop`, `iroh_pair`, `generate_pairing_qr`, `submit_pairing_code`, `get_device_identity`, `set_device_fingerprint`, `get_paired_devices`, `unpair_device`
- **Remove**: imports of `sync_crypto`, `sync_protocol`

#### Step 1.3 — `src-tauri/src/lib.rs`

- **Remove**: Daemon spawning section (`#[cfg(target_os = "linux")]` block ~lines 1038-1071)
- **Remove**: Legacy command registrations from invoke_handler — remove `initiate_sync`, `sync_now`, `start_background_sync`, `stop_background_sync`, `wake_background_sync`, `set_sync_data`, `get_incoming_sync_data`, `update_peer_address`
- **Remove**: `use theorem_sync_core::sync_crypto` imports that are only for legacy
- **Keep**: The iroh setup, docs/blobs commands, pairing commands, all non-sync commands

### Phase 2: Remove sync-daemon Sidecar

#### Step 2.1 — Delete `crates/sync-daemon/` entirely

- **Delete**: `crates/sync-daemon/src/main.rs` — entire HTTP daemon (axum routes, sync round, health endpoint, control API)
- **Delete**: `crates/sync-daemon/Cargo.toml`
- **Delete**: Any other files in `crates/sync-daemon/`

#### Step 2.2 — Update workspace

- Edit `src-tauri/Cargo.toml` — remove `"crates/sync-daemon"` from `[workspace] members`

### Phase 3: Trim `crates/theorem-sync-core/` & Remove Crypto

#### Step 3.1 — `sync_crypto.rs`

- **Remove**: `encrypt_payload()`, `decrypt_payload()`, `EncryptedPayload`, `EncryptedPayloadData`
- **Remove**: `generate_ephemeral_keypair()`, `derive_symmetric_key()` (ECDH + HKDF — only for legacy handshake)
- **Remove**: `generate_nonce()`, `encrypt_single_file_chunk()`, `decrypt_file_chunk()`
- **Remove**: `read_machine_fingerprint()`, `set_fingerprint_from_frontend()`, `get_frontend_fingerprint()`
- **Keep**: `DeviceIdentity` struct and `load_or_create()` — needed for iroh endpoint identity
- **Keep**: `generate_qr_svg()` — needed for QR pairing codes
- **Keep**: `now_iso8601()` — utility, may still be used elsewhere

#### Step 3.2 — `sync_protocol.rs`

- **Remove**: Entire file — `SyncManifest`, `SyncRound`, `DeviceInfo`, `SyncBatch`, `SyncComplete` all legacy protocol types

#### Step 3.3 — `sync_persistence.rs`

- **Remove**: Entire file — paired devices are now managed through iroh-docs. Check `get_paired_devices` Tauri command — if it uses this file, migrate to read from iroh docs.

#### Step 3.4 — Update `lib.rs` in theorem-sync-core

- Remove `pub mod sync_crypto;`, `pub mod sync_protocol;`, `pub mod sync_persistence;`

#### Step 3.5 — Update `Cargo.toml` in theorem-sync-core

- **Remove**: `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`, `rand`
- **Keep**: `qrcode`, `base64`, `hex`, `serde`, `serde_json`, `rusqlite`, `time`

### Phase 4: Update Android Worker to Use iroh

This is the most complex change. The Android sync worker has two paths that both need migration:

#### Step 4.1 — Understand the current architecture

The Android worker has three components:
1. **`ForegroundService`** (SyncForegroundService.kt) — keeps process alive, persistent notification
2. **`WorkManager`** (SyncWorker.kt) — survives app kill, fires every 15 min
3. **JNI bridge** (`runBackgroundSync` in `lib.rs` lines ~1310-1416) — the actual sync logic invoked by WorkManager

Currently, the WorkManager JNI path (`runBackgroundSync`) does HTTP-based legacy sync:
```rust
// OLD: HTTP POST to each peer
let client = reqwest::Client::new();
for peer in paired_devices {
    let url = format!("http://{}:{}", peer.last_ip, peer.last_port);
    let manifest = SyncManifest { device_id, domains, last_sync_at };
    client.post(format!("{url}/sync/manifest")).json(&manifest).send().await;
}
```

This does NOT use iroh at all.

#### Step 4.2 — Rewrite `runBackgroundSync()` to use iroh-docs CRDT

```rust
// NEW: iroh-docs CRDT sync
pub extern "C" fn Java_..._runBackgroundSync(env, class, data_dir) -> jboolean {
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let identity = sync_crypto::DeviceIdentity::load_or_create(&data_dir)?;
        let db = iroh_docs::store::memory::Store::default();
        let node = iroh::node::Node::builder(db)
            .secret_key(identity.iroh_secret_key())  // NEW: convert StaticSecret → iroh SecretKey
            .spawn()
            .await?;
        let client = node.client();
        // For each paired peer, import their sync doc and sync
        let paired = get_paired_devices_from_iroh(&client).await?;
        for peer in paired {
            let doc = client.docs().import(peer.sync_doc_id).await?;
            doc.start_sync(vec![peer.node_id]).await?;
            // Wait for sync to settle
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
        node.shutdown();
    });
}
```

**Key change**: The JNI path must initialize a temporary iroh endpoint, sync via docs CRDT, then shut down. This is expensive (full DHT join) but only runs every 15 min.

#### Step 4.3 — ForegroundService: keep iroh endpoint alive

The ForegroundService already keeps the Tauri process alive. When the app is in foreground or recently backgrounded, the **JS timer** (`runDeviceSync` → `docs_sync_now`) handles sync. The ForegroundService just prevents the process from being killed so the iroh endpoint stays connected to the DHT/relay.

No Kotlin changes needed — just ensure the iroh endpoint is initialized at app start and kept alive by the ForegroundService.

#### Step 4.4 — Android Worker plugin Rust code

File: `src-tauri/plugins/android-sync-worker/src/lib.rs`

The plugin interface (`start_worker`, `stop_worker`, `schedule_periodic_sync`, etc.) stays the same. No changes needed here.

#### Step 4.5 — Remove HTTP from JNI path's data structures

- Remove `SyncManifest` struct and all HTTP payload types from the JNI path
- Remove `reqwest::Client` construction from `runBackgroundSync()`
- All sync state now lives in iroh-docs CRDT — no more manual manifest/batch/complete round-trips

### Phase 5: Update Frontend

#### Step 5.1 — `src/core/lib/device-sync-daemon.ts`

- **Remove**: Entire file — this was the TS bridge to the HTTP sync-daemon sidecar

#### Step 5.2 — `src/core/lib/device-sync.ts`

- **Remove**: `initiateSync()`, `syncNow()`, `startBackgroundSync()`, `stopBackgroundSync()`, `wakeBackgroundSync()`, `setSyncData()`, `getIncomingSyncData()`, `pullBookFiles()`, `pullBookCovers()`, `updatePeerAddress()`
- **Keep**: `getDeviceIdentity()`, `getPairedDevices()`, `generatePairingQr()`, `submitPairingCode()`, `irohStart()`, `irohStop()`, `unpairDevice()`, `setDeviceFingerprint()`, `docsCreateSyncDoc()`, `docsImportSyncDoc()`, `docsSetEntry()`, `docsGetAllEntries()`, `docsSyncNow()`, `blobsAddBytes()`, `blobsDownloadBytes()`, `blobsAddFile()`, `blobsDownloadFile()`, `initSync()`, `irohPair()`
- **Remove**: Android worker commands `start_android_sync_worker`, `stop_android_sync_worker`, `update_sync_notification`, `schedule_sync_work`, `cancel_sync_work` — the ForegroundService lifecycle is now managed by the JS `runDeviceSync` timer. When auto-sync is enabled → ForegroundService starts. When disabled → stops. The WorkManager periodic sync is scheduled by the app start.

  Actually, update these to be managed by `runDeviceSync` lifecycle:
  - When `autoSyncRound()` starts → `start_android_sync_worker` + `schedule_periodic_sync_work`
  - When auto-sync stops → `stop_android_sync_worker` + `cancel_periodic_sync_work`
  - The notification text reflects `docs_sync_now` progress (already works)

#### Step 5.3 — `src/core/lib/sync-orchestrator.ts`

- **Remove**: All code paths that check `isDaemonReady()` (~lines 1520-1555 and 1618)
- **Remove**: Any calls to `setSyncData()` or `getIncomingSyncData()`
- **Remove**: Import of `./device-sync-daemon`
- **Merge**: The Rust timer background sync is gone. The JS timer `runDeviceSync` is the only sync path. Ensure the auto-sync lifecycle in `startAutoSync()`/`stopAutoSync()` also manages the Android ForegroundService/WorkManager lifecycle.

#### Step 5.4 — `src/App.tsx`

- **Remove**: Line 9 — import of `isDaemonRunning`, `configureDaemon` from `device-sync-daemon`
- **Remove**: Lines 385-386 — dynamic import and call of `startBackgroundSync(300)`
- **Keep**: The call to `startAutoSync()` which starts the JS timer → `runDeviceSync()` → `docs_sync_now()`

#### Step 5.5 — `src/features/settings/DeviceSync.tsx`

- **Remove**: Import of daemon status types and `configureDaemon`
- **Remove**: Daemon status display, daemon configuration controls
- **Remove**: Unpair confirmation dialog — keep only iroh pairing status and controls

#### Step 5.6 — `src/core/lib/env.ts` (check)

- **Remove**: Any `isDaemonRunning` or daemon-related checks

### Phase 6: Cargo.toml Cleanup

#### Step 6.1 — Main `Cargo.toml` (`src-tauri/Cargo.toml`)

- **Remove**: `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`, `bzip2`, `tar` (legacy crypto + archive format support only needed by old protocol)
- **Remove**: `axum`, `tower-http` (were only in sync-daemon, which is now deleted)
- **Keep**: `qrcode`, `base64`, `hex`, `rustls`, `reqwest`, `tokio`, `futures`, all iroh deps, `quick-xml`, `percent-encoding`, `rusqlite`, `r2d2`, `zip`, `walkdir`
- **Update**: `rand = "0.9"` (no longer blocked — `chacha20poly1305` which pulled `rand_core` 0.6 is removed)
- **Remove**: `tauri-plugin-app = "2.0.0-alpha.2"` — check if still registered in lib.rs. If the app plugin is still registered, keep it but the JS dep was already removed.

#### Step 6.2 — theorem-sync-core `Cargo.toml`

- **Remove**: `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`, `rand`
- **Keep**: `qrcode`, `base64`, `hex`, `serde`, `serde_json`, `rusqlite`, `time`, `tokio`

#### Step 6.3 — Remove sync-daemon `Cargo.toml`

- Already deleted in Phase 2.

### Phase 7: Final Cleanup

- Run `cargo update` to prune unused dependencies from lockfile
- Run `cargo check` / `cargo clippy` / `cargo fmt`
- Run `cargo test` in theorem-sync-core
- Check `pnpm typecheck` and `pnpm test`

---

## Post-Migration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Unified Sync (ONE PATH)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── Desktop ──────────────────────────────────────────┐  │
│  │  JS timer (every 5 min)                              │  │
│  │    → runDeviceSync()                                 │  │
│  │      → docs_sync_now() [iroh-docs CRDT]              │  │
│  │      → blobs_download/upload [iroh-blobs file xfer]  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─── Android (foreground) ────────────────────────────┐  │
│  │  ForegroundService keeps iroh endpoint alive         │  │
│  │  Same JS timer as desktop                            │  │
│  │    → runDeviceSync()                                 │  │
│  │    → docs_sync_now()                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─── Android (app killed) ────────────────────────────┐  │
│  │  WorkManager fires every 15 min                     │  │
│  │  → JNI → runBackgroundSync()                       │  │
│  │    → init temp iroh endpoint                        │  │
│  │    → docs.import() + docs.start_sync()               │  │
│  │    → shutdown                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─── Protocol ────────────────────────────────────────┐  │
│  │  iroh-docs CRDT for metadata (books, annotations)   │  │
│  │  iroh-blobs FsStore for files (books, covers)       │  │
│  │  iroh-gossip for live notifications                 │  │
│  │  iroh-relay for NAT traversal                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Deleted Files Summary

| File | Reason |
|------|--------|
| `src-tauri/crates/sync-daemon/src/main.rs` | Legacy HTTP daemon |
| `src-tauri/crates/sync-daemon/Cargo.toml` | Legacy daemon manifest |
| `src-tauri/crates/theorem-sync-core/src/sync_crypto.rs` | Legacy encryption (partial — keep DeviceIdentity) |
| `src-tauri/crates/theorem-sync-core/src/sync_protocol.rs` | Legacy protocol types |
| `src-tauri/crates/theorem-sync-core/src/sync_persistence.rs` | Legacy paired devices (migrate to iroh docs) |
| `src/core/lib/device-sync-daemon.ts` | TS bridge to HTTP daemon |

## Verification

After all phases:

```bash
# Rust
cd src-tauri && cargo check      # Zero errors
cargo clippy                      # Zero warnings
cargo fmt                         # No diff
cargo test                        # All pass

# TypeScript
cd .. && pnpm typecheck           # Zero errors
pnpm lint                         # Zero errors
pnpm test                         # 220/220 pass
pnpm build                        # Production build succeeds
```

## Not In Scope (Separate Tasks)

- Reader.tsx refactoring (2515 lines)
- Zustand store splitting into slices
- TanStack Query integration
- useOptimistic for likes/favorites
- Rust integration tests

Save progress after each phase, run verification after each phase.
