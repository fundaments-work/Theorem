# Theorem Sync Architecture Plan

Last updated: 2026-02-12

## 1. Objective
Build a local-first data and sync system that supports Theorem on web, mobile, and desktop from one codebase.

Primary goals:
1. Keep all user actions fast and offline-first.
2. Make sync a replication layer, not the source of truth.
3. Stay cloud-portable (Cloudflare first, but not locked in).
4. Support large personal libraries (books, PDFs, RSS/articles, highlights, notes, dictionary, SRS).

## 2. Locked Product Decisions
1. Build order: data foundation first.
2. Platforms: web + mobile + desktop.
3. Local DB: SQLite everywhere (web via SQLite WASM + OPFS).
4. Sync scope v1: includes metadata and files.
5. Conflict strategy: deterministic merge (CRDT/LWW hybrid).
6. Encryption: zero-knowledge E2EE with user passphrase only.
7. Migration: automatic one-time migration from current Zustand persistence.
8. Scale target v1: 10k documents and 500k annotations per user.

## 3. Canonical Architecture

### 3.1 Local data plane (authoritative)
1. Each device owns a local SQLite database.
2. UI writes go through repository transactions, never directly to persisted Zustand state.
3. Each transaction writes:
4. domain tables,
5. an operation entry (`op_log`),
6. and a `sync_outbox` record.

### 3.2 Cloud sync control plane
1. Runtime: Cloudflare Workers.
2. Auth: managed auth provider + JWT validation in Worker.
3. Sync endpoints: push/pull operations, blob upload/download session orchestration.

### 3.3 Cloud data plane (portable)
1. Canonical metadata DB: PostgreSQL (Supabase first).
2. Worker to Postgres path: Hyperdrive.
3. Canonical blob protocol: S3-compatible API.
4. Default blob primary: Cloudflare R2.
5. Secondary blob provider: AWS S3.
6. Optional experimental provider: Supabase Storage S3 compatibility (disabled by default).
7. D1 can be used for derived read caches only, not canonical user state.

## 4. Why this over D1-only
1. D1 limits are real and manageable, but they increase lock-in for canonical state.
2. Postgres gives better long-term portability across providers.
3. R2 still provides Cloudflare-native cost and latency benefits for blobs.
4. S3-compatible adapter keeps storage provider swaps low risk.

## 5. Data Model (Local SQLite)

Core tables:
1. `content_items` (books/articles/newsletters/papers/web clips)
2. `content_files` (local path, hash, mime, size, encryption metadata)
3. `reading_state`
4. `annotations`
5. `collections`
6. `collection_items`
7. `dictionary_terms`
8. `srs_cards`
9. `srs_reviews`
10. `references`
11. `citations`
12. `app_settings`
13. `op_log`
14. `sync_outbox`
15. `sync_checkpoint`
16. `blob_transfer_queue`
17. `migration_state`

Sync metadata columns for syncable entities:
1. `entity_id` (UUIDv7)
2. `device_id`
3. `hlc` (hybrid logical clock)
4. `updated_at`
5. `deleted_at` (tombstone)

## 6. Sync Protocol Contract

Required endpoints:
1. `POST /v1/sync/push`
2. `GET /v1/sync/pull?cursor=...`
3. `POST /v1/blobs/init`
4. `POST /v1/blobs/complete`
5. `GET /v1/blobs/:blobId/download-url`
6. `POST /v1/devices/register`

Rules:
1. All sync payloads are encrypted envelopes.
2. Files are encrypted before upload and identified by hash.
3. Uploads are resumable and idempotent.
4. Retries must be safe by idempotency key.

## 7. Conflict and Merge Strategy
1. Scalar fields: LWW register by `(hlc, device_id)`.
2. Sets (tags/collection links): OR-Set semantics.
3. Counters (reading minutes/review counts): PN-counter deltas.
4. Notes/highlight text: LWW plus revision history on conflict.
5. Deletes: tombstone wins over older writes.

## 8. Security Model
1. Device generates local master key.
2. Passphrase derives KEK (Argon2id) to wrap keys.
3. Server stores wrapped keys and ciphertext only.
4. No server-side passphrase recovery in v1.
5. Sensitive logs must be redacted; no plaintext content in logs.

## 9. Codebase Changes Required

Frontend and shared domain:
1. Add `src/data/` module with repositories and sync engine interfaces.
2. Refactor Zustand stores to cache and UI state only.
3. Add platform database drivers:
4. Tauri driver (native SQLite command bridge),
5. web worker driver (SQLite WASM + OPFS).

Tauri backend:
1. Add DB module in `src-tauri/src`.
2. Add commands for init, migration, transaction batch, query, backup export/import.
3. Keep raw SQL out of UI layer.

Cloud sync service:
1. Add Worker project with adapter interfaces:
2. `MetadataStoreAdapter` (Postgres implementation),
3. `BlobStoreAdapter` (R2 and S3 implementations).
4. Add provider conformance tests.

## 10. Delivery Phases

### Phase 0: Data Core Foundation
1. Repository interfaces and schema/migration framework.
2. Local SQLite wiring for desktop/mobile/web.
3. Automatic migration from current persisted state.

### Phase 1: Core Domain Migration
1. Move books, annotations, collections, settings, reading state to repositories.
2. Remove persistence ownership from Zustand stores.

### Phase 2: Learning Core
1. Dictionary and SRS tables/services.
2. Highlight-to-card pipeline.
3. Local FTS for metadata, notes, dictionary.

### Phase 3: Sync v1 (metadata + files)
1. Worker push/pull API.
2. Postgres metadata adapter.
3. R2 primary blob adapter.
4. S3 secondary adapter.
5. Deterministic merge engine.

### Phase 4: Content and Academic Expansion
1. RSS/newsletter/web clipper ingestion into `content_items`.
2. arXiv/PubMed connectors.
3. Reference manager + citation export.

### Phase 5: Advanced Reader Features
1. Velocity mode.
2. TTS with local models.
3. Cross-device continuation improvements.

## 11. Acceptance Criteria
1. Local writes never block on network.
2. Crash during write never leaves partial domain state.
3. Two offline devices editing same entities merge deterministically.
4. Same blob hash is uploaded once and reused.
5. 10k docs and 500k annotations stay within performance targets.
6. Provider switch (R2 to S3) does not require app schema changes.

## 12. Risks and Mitigations
1. Provider drift across S3 implementations.
2. Mitigation: strict adapter contract and conformance suite.
3. Web OPFS compatibility variance.
4. Mitigation: capability detection and fallback storage mode.
5. E2EE recovery support burden.
6. Mitigation: explicit onboarding warnings and recovery UX copy.

## 13. Research References
1. Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
2. Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/
3. Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
4. Cloudflare Hyperdrive: https://developers.cloudflare.com/hyperdrive/
5. Cloudflare Supabase integration: https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/
6. Supabase billing and quotas: https://supabase.com/docs/guides/platform/billing-on-supabase
7. Supabase storage file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
8. Supabase S3 compatibility: https://supabase.com/docs/guides/storage/s3/compatibility
9. AWS S3 object docs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingObjects.html
10. AWS S3 pricing: https://aws.amazon.com/s3/pricing/
11. SQLite limits: https://www.sqlite.org/limits.html
12. SQLite WAL: https://www.sqlite.org/wal.html
13. SQLite WASM OPFS persistence: https://sqlite.org/wasm/doc/tip/persistence.md
