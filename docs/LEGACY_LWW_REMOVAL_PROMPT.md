# Agent Prompt: Remove Legacy LWW Sync Protocol

## Objective

Remove the legacy LWW (Last-Writer-Wins) sync protocol entirely, keeping only the new iroh-docs CRDT + iroh-blobs sync path. The legacy protocol exists in three forms:

1. **In-process QUIC LWW** — `TheoremProtocolHandler` with ALPN `theorem-sync/v1` in `iroh_sync.rs`
2. **HTTP sync-daemon sidecar** — `crates/sync-daemon/` with axum HTTP server
3. **Legacy crypto** — `sync_crypto.rs` (ChaCha20Poly1305, X25519, HKDF) used for encrypting LWW payloads

## Changes Required

### 1. Rust: `src-tauri/src/iroh_sync.rs`

- **Remove**: `TheoremProtocolHandler` struct and impl (ALPN `theorem-sync/v1`)
- **Remove**: `dispatch_request()` function
- **Remove**: All `handle_*_req()` functions (manifest, push_batch, pull_batch, complete, file_availability, file_pull, cover_pull)
- **Remove**: `sync_with_peer()` function
- **Remove**: `decrypt_envelope()`, `encrypt_response()` functions
- **Keep**: `subscribe_doc_events()`, `handle_pair_req()`, `send_pair_request()` — these are iroh-docs CRDT / pairing, not legacy
- **Keep**: `start_accept_loop()` but remove the `TheoremProtocolHandler` entry from the Router builder. Keep `handle_pair_req` registration.
- **Remove**: imports of `sync_crypto::{encrypt_payload, decrypt_payload, encrypt_single_file_chunk, EncryptedPayload}` — these are only used by legacy handlers
- **Remove**: `use theorem_sync_core::sync_protocol::*;`

### 2. Rust: `src-tauri/src/sync_commands.rs`

- **Remove**: `initiate_sync()` command
- **Remove**: `sync_now()` command
- **Remove**: `start_background_sync()` command
- **Remove**: `stop_background_sync()` command
- **Remove**: `wake_background_sync()` command
- **Remove**: `set_sync_data()` command (used only by legacy sync-orchestrator path)
- **Remove**: `get_incoming_sync_data()` command (used only by legacy sync-orchestrator path)
- **Remove**: `update_peer_address()` command if only used for legacy sync paths
- **Keep**: All `docs_*`, `blobs_*`, pairing commands, `init_sync`, `iroh_start`, `iroh_stop`, `iroh_pair`, `generate_pairing_qr`, `submit_pairing_code`, `get_device_identity`, `set_device_fingerprint`, `get_paired_devices`, `unpair_device`
- **Remove**: imports of `sync_crypto`, `sync_protocol`

### 3. Rust: `src-tauri/src/lib.rs`

- **Remove**: Daemon spawning section (around lines 1038-1071, `#[cfg(target_os = "linux")]` block that spawns sync-daemon subprocess)
- **Remove**: Legacy command registrations from the invoke_handler — remove `sync_commands::initiate_sync`, `sync_now`, `start_background_sync`, `stop_background_sync`, `wake_background_sync`, `set_sync_data`, `get_incoming_sync_data`, `update_peer_address`
- **Remove**: `setup_init_sync()` or any call to legacy sync init
- **Remove**: `use theorem_sync_core::sync_crypto` imports that are only for legacy
- **Keep**: The iroh setup, docs/blobs commands, pairing commands, all non-sync commands

### 4. Rust: Remove `crates/sync-daemon/` entirely

- **Delete**: `crates/sync-daemon/src/main.rs` (entire file — the HTTP daemon with axum, sync round, etc.)
- **Delete**: `crates/sync-daemon/Cargo.toml`
- **Remove from workspace**: Edit `src-tauri/Cargo.toml` — remove `"crates/sync-daemon"` from `[workspace] members`

### 5. Rust: Trim `crates/theorem-sync-core/`

- **Remove**: `sync_crypto.rs` — delete entire file. The encryption/decryption, `EncryptedPayload`, `generate_ephemeral_keypair`, `derive_symmetric_key`, `generate_nonce`, `encrypt_single_file_chunk`, `decrypt_file_chunk`, `read_machine_fingerprint`, `set_fingerprint_from_frontend`, `get_frontend_fingerprint`, `generate_qr_svg` are all only needed by the legacy LWW path.
  - **EXCEPTION**: `DeviceIdentity` struct and `load_or_create()` — needed for pairing identity even with iroh. Keep `DeviceIdentity` and trim everything else.
  - **EXCEPTION**: `generate_qr_svg()` — needed for pairing QR codes. Keep this.
- **Remove**: `sync_protocol.rs` — entire file (SyncManifest, SyncRound, etc. — all legacy protocol types)
- **Remove**: `sync_persistence.rs` — entire file (load/save paired devices to JSON) — IF paired devices are now managed through iroh-docs. If they're still loaded from JSON for the UI, keep this. Check if `get_paired_devices` Tauri command uses it.
- **Update**: `lib.rs` in theorem-sync-core — remove `pub mod sync_crypto;`, `pub mod sync_protocol;`, `pub mod sync_persistence;` as appropriate
- **Update**: `Cargo.toml` in theorem-sync-core — remove `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`. Remove `rand` (or keep if DeviceIdentity needs it — if StaticSecret::random_from_rng still exists). Keep `qrcode`, `base64`, `hex`.

### 6. Rust: Remove crypto deps from main `Cargo.toml`

- **Remove**: `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`, `bzip2`, `tar`
- **Keep**: `rand` (may still be needed by theorem-sync-core), `qrcode`, `base64`, `hex`, `rustls`
- After removing `chacha20poly1305` (which pulls in `rand_core` 0.6), upgrade `rand = "0.9"` (was blocked by version conflict)

### 7. Rust: `src-tauri/src/database.rs`

- **Check**: If `sqlite_get_book_data` or other functions used legacy sync path. Unlikely — these are for book metadata.

### 8. TypeScript: `src/core/lib/device-sync-daemon.ts`

- **Remove**: Entire file — this was the TS bridge to the HTTP sync-daemon sidecar

### 9. TypeScript: `src/core/lib/device-sync.ts`

- **Remove**: `initiateSync()`, `syncNow()`, `startBackgroundSync()`, `stopBackgroundSync()`, `wakeBackgroundSync()`, `setSyncData()`, `getIncomingSyncData()`, `pullBookFiles()`, `pullBookCovers()`, `updatePeerAddress()`
- **Keep**: `getDeviceIdentity()`, `getPairedDevices()`, `generatePairingQr()`, `submitPairingCode()`, `irohStart()`, `irohStop()`, `unpairDevice()`, `setDeviceFingerprint()`, `docsCreateSyncDoc()`, `docsImportSyncDoc()`, `docsSetEntry()`, `docsGetAllEntries()`, `docsSyncNow()`, `blobsAddBytes()`, `blobsDownloadBytes()`, `blobsAddFile()`, `blobsDownloadFile()`, `initSync()`, `irohPair()`

### 10. TypeScript: `src/core/lib/sync-orchestrator.ts`

- **Remove**: All code paths that check `isDaemonReady()` (lines around 1520-1555 and 1618). The daemon no longer exists.
- **Remove**: Any calls to `setSyncData()` or `getIncomingSyncData()` if they exist (these were legacy daemon data exchange)
- **Remove**: Import of `./device-sync-daemon`
- **Keep**: The full `runDeviceSync()` / `autoSyncRound()` / `docs_sync_now()` flow — this is the iroh-docs CRDT path

### 11. TypeScript: `src/App.tsx`

- **Remove**: Line 9 — import of `isDaemonRunning`, `configureDaemon` from `device-sync-daemon`
- **Remove**: Lines 385-386 — dynamic import and call of `startBackgroundSync(300)`
- **Remove**: Any references to daemon config on startup

### 12. TypeScript: `src/features/settings/DeviceSync.tsx`

- **Remove**: Import of daemon status types and `configureDaemon`
- **Simplify**: Remove daemon status display, daemon configuration controls. Only show iroh pairing status.

### 13. TypeScript: `src/core/lib/env.ts` (check)

- **Remove**: Any `isDaemonRunning` or daemon-related checks

## Tests

- **Update**: `tests/release-1.0.7-audit-verification.test.ts` — update test at line 198-202 that checks `isDaemonReady` function. This function is being removed, so the test should be updated or removed.
- **Run**: `pnpm test` — ensure existing tests still pass after changes

## Verification

After all changes:
1. `cd src-tauri && cargo check` — must compile with zero errors
2. `cd src-tauri && cargo clippy` — zero warnings
3. `cd src-tauri && cargo fmt` — clean formatting
4. `pnpm typecheck` — zero errors
5. `pnpm lint` — zero errors
6. `pnpm test` — all tests pass
7. `pnpm build` — production build succeeds

## Not In Scope

- Reader.tsx refactoring (2515 lines)
- Zustand store splitting into slices
- TanStack Query integration
- useOptimistic usage
- Rust integration tests

Save the agent prompt as a doc, and optionally commit the doc.
