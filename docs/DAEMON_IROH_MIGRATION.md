# Daemon & Worker Migration to iroh-Native Sync

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Desktop App                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Tauri Process (main)                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │  │
│  │  │ iroh Router │  │  TS Frontend │  │ SQLite/Z  │  │  │
│  │  │ docs+blobs  │  │  (React)     │  │ Stores     │  │  │
│  │  │ +gossip     │  │              │  │           │  │  │
│  │  └─────────────┘  └──────────────┘  └───────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Sync Daemon (sidecar process)                     │  │
│  │  HTTP control API (port 43936)                     │  │
│  │  HTTP sync server (port 43935) — LEGACY            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Android Worker (WorkManager)                      │  │
│  │  JNI-based HTTP sync — LEGACY                      │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Current Problems

1. **Duplicated sync mechanisms**: The daemon has its own HTTP-based sync loop (port 43935) that runs independently of the main process's iroh Router. Both can sync simultaneously, causing races.

2. **Daemon lifecycle**: The daemon is spawned as a child process by the main Tauri app. On app exit, the daemon becomes an orphan (persists after the app closes). On restart, two daemon instances can conflict.

3. **Android worker uses HTTP**: The `runBackgroundSync` JNI function connects via HTTP to paired devices, not through iroh. It provisions data, initiates sync, and stores the result — all through the legacy HTTP protocol.

4. **Gossip is unused**: `iroh-gossip` is registered on the Router but carries no traffic. It's only needed by iroh-docs for live notifications, and `doc.subscribe()` is functional.

5. **No background iroh endpoint**: When the app is backgrounded, the iroh endpoint (which maintains relay connections and docs reconciliation) goes with it. Reconnecting on resume adds latency.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop App                                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Tauri Process (main)          ┌──────────────────────┐ │  │
│  │  ┌─────────────┐  ┌───────┐   │  Sync Daemon         │ │  │
│  │  │ iroh Router │  │ TS    │   │  (same binary,        │ │  │
│  │  │ docs+blobs  │  │ UI    │   │  --daemon flag)       │ │  │
│  │  │ +gossip     │  └───────┘   │  ┌──────────────────┐│ │  │
│  │  └─────────────┘              │  │ iroh Router      ││ │  │
│  │  Zustand stores, SQLite       │  │ docs+blobs+gossip││ │  │
│  │  Docs event listener          │  └──────────────────┘│ │  │
│  └──────────────────────────┬────┘  │ HTTP control API  │ │  │
│                             │       │ (port 43936)      │ │  │
│                             │       └────────────────────┘ │  │
│                             │                              │  │
└─────────────────────────────│──────────────────────────────┘  │
                              │ TCP / Unix socket               │
                              ▼                                 │
┌─────────────────────────────────────────────────────────────┐│
│  Android App                                                  ││
│  ┌─────────────────────────────────────────────────────────┐ ││
│  │  Tauri Process                         WorkManager       │ ││
│  │  ┌─────────────┐   ┌──────────────────────────────────┐ │ ││
│  │  │ iroh Router │   │  Keepalive Task (every 15 min)   │ │ ││
│  │  │ docs+blobs  │   │  1. Check autoSyncEnabled flag   │ │ ││
│  │  │ +gossip     │   │  2. If off, return               │ │ ││
│  │  └─────────────┘   │  3. Wake iroh endpoint (JNI)     │ │ ││
│  │  Zustand, SQLite   │  4. iroh-docs auto-reconciles    │ │ ││
│  │  Docs event sub    │  5. Sleep                        │ │ ││
│  │                    │  6. Clean shutdown (JNI)          │ │ ││
│  └────────────────────┘  └──────────────────────────────────┘ ││
└─────────────────────────────────────────────────────────────┘│
```

### Key Changes

| Component | Current | Future |
|-----------|---------|--------|
| **Daemon sync loop** | Custom HTTP (port 43935) | Run iroh Router (docs+blobs+gossip) |
| **Daemon provisioning** | `buildDomainsAndManifest` → `setSyncData` | Read from shared Zustand/Docs state |
| **Daemon lifecycle** | Child process, orphan on exit | Systemd service or `kill_on_drop(true)` |
| **Android worker** | JNI HTTP sync | Keepalive task: wake iroh endpoint |
| **Gossip usage** | Running, no traffic | Carries docs notifications |
| **Background sync** | 3 concurrent mechanisms | Single: iroh docs reconciliation |

---

## Migration Plan

### Phase 1: Daemon Runs iroh Router (Estimated: 3-5 days)

#### 1.1 Add `--daemon` mode to the main binary

```rust
// src-tauri/src/main.rs
#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--daemon") {
        return run_daemon().await;
    }
    // existing app startup...
}

async fn run_daemon() -> Result<()> {
    // 1. Load identity and config from data dir
    // 2. Create iroh Endpoint with N0 preset
    // 3. Set up Docs + Blobs + Gossip on Router
    // 4. Spawn Router
    // 5. Start HTTP control API (port 43936) for status/lifecycle
    // 6. Wait for shutdown signal
}
```

**Changes**:
- `src-tauri/src/main.rs` — add `--daemon` entry point
- `src-tauri/Cargo.toml` — remove `axum` from main crate (already done) but the daemon needs axum for control API; use the sync-daemon crate's axum
- Actually, the cleanest approach: the existing `sync-daemon` crate (crates/sync-daemon/) already has axum + tower-http for its control API. Instead of creating a new daemon entry point, migrate the existing daemon to run iroh Router.

#### 1.2 Modify sync-daemon to run iroh Router

```rust
// crates/sync-daemon/src/main.rs — ADD:
use iroh::{Endpoint, endpoint::presets::N0};
use iroh_blobs::{store::mem::MemStore, BlobsProtocol};
use iroh_docs::protocol::Docs;
use iroh_gossip::net::Gossip;

async fn run_iroh_sync(data_dir: &Path) -> Result<IrohDocs> {
    let endpoint = Endpoint::bind(N0).await?;
    let blobs = MemStore::default();
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let docs = Docs::persistent(data_dir.join("iroh-docs"))
        .spawn(endpoint.clone(), blobs.clone(), gossip.clone())
        .await?;

    let _router = Router::builder(endpoint.clone())
        .accept(iroh_blobs::ALPN, BlobsProtocol::new(&blobs, None))
        .accept(iroh_docs::ALPN, docs.clone())
        .accept(iroh_gossip::ALPN, gossip)
        .spawn();

    Ok(IrohDocs { docs, blobs })
}
```

**Files affected**:
- `crates/sync-daemon/Cargo.toml` — add iroh deps (iroh-docs, iroh-blobs, iroh-gossip)
- `crates/sync-daemon/src/main.rs` — add Router setup, pass iroh state to control API handlers

#### 1.3 Remove legacy HTTP sync server (port 43935)

The old daemon listens on port 43935 for incoming sync connections. With iroh Router, this is replaced by the QUIC-based ALPN dispatch. Port 43935 becomes unnecessary.

**Files affected**:
- `crates/sync-daemon/src/main.rs` — remove HTTP sync handlers, keep control API on port 43936
- `src/core/lib/device-sync-daemon.ts` — update to not use legacy sync endpoints
- `src/core/lib/device-sync.ts` — simplify, remove legacy sync flows

#### 1.4 Update provisioning

The daemon currently receives data snapshots from the frontend via HTTP (`/provision` endpoint). With iroh-docs, the daemon should:
- Periodically read the latest state from docs (via the shared Docs instance)
- Not need explicit provisioning from the frontend
- The frontend writes to docs → docs reconcile → daemon is up to date

### Phase 2: Android Worker Uses iroh (Estimated: 2-3 days)

#### 2.1 Modify `runBackgroundSync` JNI function

Current: JNI function that does HTTP-based sync. New: JNI function that wakes the iroh endpoint.

```rust
// src-tauri/src/lib.rs — MODIFY:
#[no_mangle]
pub extern "C" fn Java_work_fundamentals_theorem_syncworker_SyncWorker_runBackgroundSync(
    env: JNIEnv, _class: JClass, context: JObject
) -> jint {
    // 1. Check auto-sync-disabled flag → return 0
    // 2. Initialize iroh endpoint (load identity from data dir)
    // 3. Start the endpoint + Router (docs+blobs+gossip)
    // 4. Docs automatically reconciles with paired peers
    // 5. Wait for N seconds (configurable, default 30)
    // 6. Clean shutdown
    // 7. Return 0 for success
}
```

#### 2.2 Remove HTTP sync from Android worker

Remove the paired_devices iteration and HTTP manifest exchange. The iroh endpoint handles everything through its QUIC connections.

### Phase 3: Clean Up (Estimated: 1-2 days)

#### 3.1 Remove legacy TS sync infrastructure

After both desktop daemon and Android worker use iroh:
- Remove `device-sync-daemon.ts` HTTP calls (daemon health check, push sync data, configure)
- Remove `device-sync.ts` legacy commands (initiateSync, setSyncData, getIncomingSyncData, pullBookFiles, pullBookCovers) — some already removed
- Remove `buildDomainsAndManifest`, `mergeIncomingData` from sync-orchestrator.ts
- Simplify `sync-orchestrator.ts` to just: Zustand ↔ iroh-docs bridge + live events

#### 3.2 Remove sync_protocol.rs message types

Remove legacy protocol structs no longer used:
- `SyncManifest`, `DomainVersion`, `SyncDirection`, `SyncAction`, `SyncPlan`
- `BatchedDomainPayload`, `BatchedPullRequest`, `BatchedPullResponse`
- `FilePullRequest`, `FilePullResponse`, `FileTransferMeta`, `FileTransferChunk`
- `FileAvailabilityRequest`, `FileAvailabilityResponse`
- `CoverPullRequest`, `CoverPullResponse`
- `SyncCompleteMessage`, `SyncDataSnapshot`

#### 3.3 Remove Rust legacy code

- Remove `handle_peer_connection` (replaced by Router ALPN dispatch)
- Remove `pull_files_via_iroh`, `pull_single_file_iroh`, `pull_covers_via_iroh` (replaced by iroh-blobs)
- Remove `handle_file_pull_req`, `handle_cover_pull_req` (same)
- Remove `send_on_bi`, `recv_from_bi`, `iroh_request`, `iroh_envelope` protocol helpers
- Remove `EncryptedPayload`, all sync_crypto encryption/decryption for protocol messages

---

## Estimated Timeline

| Phase | Description | Days | Dependencies |
|-------|-------------|------|-------------|
| 1a | Add `--daemon` mode to binary | 1 | None |
| 1b | Migrate daemon to iroh Router | 2 | 1a |
| 1c | Remove legacy HTTP sync | 1 | 1b |
| 1d | Update provisioning | 1 | 1b |
| 2a | Migrate Android worker to iroh | 2 | 1b |
| 2b | Remove HTTP worker code | 1 | 2a |
| 3a | Remove TS legacy code | 1 | 1b, 2a |
| 3b | Remove protocol structs | 0.5 | 1b |
| 3c | Remove Rust legacy handlers | 1 | 1b |
| **Total** | | **~10.5 days** | |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Daemon iroh Router conflicts with main process Router | Medium | High | Use separate data directories, separate identity files. Daemon is a different iroh endpoint. |
| Android worker JNI crashes | Low | Critical | Test on emulator first, handle init failures gracefully |
| Legacy protocol removal breaks backward compat | Medium | Medium | Version negotiation in ALPN; keep legacy handler for one release cycle |
| iroh-docs persistent storage corruption | Low | High | Docs uses redb which is crash-safe; back up before migration |

---

## Related Files

### To Modify
- `src-tauri/src/main.rs` — `--daemon` entry point
- `src-tauri/src/lib.rs` — Android worker JNI rewrite
- `crates/sync-daemon/src/main.rs` — iroh Router integration
- `crates/sync-daemon/Cargo.toml` — iroh dependency additions
- `src/core/lib/device-sync-daemon.ts` — simplify
- `src/core/lib/device-sync.ts` — remove legacy commands
- `src/core/lib/sync-orchestrator.ts` — simplify to docs bridge

### To Delete
- Most of `src-tauri/crates/theorem-sync-core/src/sync_protocol.rs` (protocol message types)
- Most of `src-tauri/crates/theorem-sync-core/src/sync_crypto.rs` (encryption for protocol)
- `src-tauri/src/iroh_sync.rs` legacy protocol handlers
- `src/core/lib/device-sync.ts` legacy command exports
