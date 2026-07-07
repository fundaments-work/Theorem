//! Theorem LAN Sync — Core Library
//!
//! Shared primitives for the peer-to-peer LAN device sync feature.
//! Used by both the main Tauri application and the standalone sync daemon.

pub mod sync_crypto;
pub mod sync_persistence;
pub mod sync_protocol;
