use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DB_FILE_NAME: &str = "theorem.db";
const MATERIALIZED_BOOK_CACHE_DIR: &str = "book-cache";

#[derive(Serialize)]
pub struct SqliteStorageStats {
    pub total_books: u64,
    pub total_size: u64,
    pub covers_size: u64,
    pub binaries_size: u64,
    pub idb_books: u64,
    pub tauri_books: u64,
}

#[derive(Serialize)]
pub struct SqliteCleanupResult {
    pub removed_books: u64,
    pub removed_covers: u64,
    pub removed_metadata: u64,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir).map_err(|error| {
        format!("Failed to create app data directory '{app_data_dir:?}': {error}")
    })?;

    Ok(app_data_dir.join(DB_FILE_NAME))
}

fn materialized_book_path(app: &AppHandle, book_id: &str) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let cache_dir = app_data_dir.join(MATERIALIZED_BOOK_CACHE_DIR);
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!("Failed to create materialized cache directory '{cache_dir:?}': {error}")
    })?;

    Ok(cache_dir.join(format!("{book_id}.book")))
}

fn remove_materialized_cache_file(app: &AppHandle, book_id: &str) {
    if let Ok(path) = materialized_book_path(app, book_id) {
        let _ = fs::remove_file(path);
    }
}

fn with_connection<T, F>(app: &AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> rusqlite::Result<T>,
{
    let db_path = database_path(app)?;
    let connection = Connection::open(&db_path)
        .map_err(|error| format!("Failed to open SQLite database '{db_path:?}': {error}"))?;

    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS covers (
                book_id TEXT PRIMARY KEY,
                data_url TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS materialized_books (
                book_id TEXT PRIMARY KEY,
                source_updated_at INTEGER NOT NULL,
                materialized_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );
            "#,
        )
        .map_err(|error| format!("Failed to initialize SQLite schema: {error}"))?;

    operation(&connection).map_err(|error| format!("SQLite operation failed: {error}"))
}

#[tauri::command]
pub fn sqlite_save_book_data(app: AppHandle, id: String, data: Vec<u8>) -> Result<String, String> {
    with_connection(&app, |connection| {
        connection.execute(
            r#"
            INSERT INTO books (id, data, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                updated_at = unixepoch()
            "#,
            params![id, data],
        )?;
        Ok(())
    })?;

    Ok(format!("sqlite://{id}"))
}

#[tauri::command]
pub fn sqlite_get_book_data(app: AppHandle, id: String) -> Result<Option<Vec<u8>>, String> {
    with_connection(&app, |connection| {
        connection
            .query_row("SELECT data FROM books WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .optional()
    })
}

#[tauri::command]
pub fn sqlite_delete_book_data(app: AppHandle, id: String) -> Result<(), String> {
    remove_materialized_cache_file(&app, &id);

    with_connection(&app, |connection| {
        connection.execute(
            "DELETE FROM materialized_books WHERE book_id = ?1",
            params![id],
        )?;
        connection.execute("DELETE FROM books WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn sqlite_get_materialized_book_path(
    app: AppHandle,
    id: String,
) -> Result<Option<String>, String> {
    let source_updated_at = with_connection(&app, |connection| {
        connection
            .query_row(
                "SELECT updated_at FROM books WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
    })?;

    let source_updated_at = match source_updated_at {
        Some(value) => value,
        None => return Ok(None),
    };

    let materialized_path = materialized_book_path(&app, &id)?;

    let can_reuse_materialized = with_connection(&app, |connection| {
        connection
            .query_row(
                "SELECT source_updated_at FROM materialized_books WHERE book_id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map(|cached| cached == Some(source_updated_at) && materialized_path.exists())
    })?;

    if can_reuse_materialized {
        return Ok(Some(materialized_path.to_string_lossy().into_owned()));
    }

    let data = with_connection(&app, |connection| {
        connection.query_row("SELECT data FROM books WHERE id = ?1", params![id], |row| {
            row.get::<_, Vec<u8>>(0)
        })
    })?;

    fs::write(&materialized_path, data).map_err(|error| {
        format!("Failed to write materialized cache file '{materialized_path:?}': {error}")
    })?;

    with_connection(&app, |connection| {
        connection.execute(
            r#"
            INSERT INTO materialized_books (book_id, source_updated_at, materialized_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(book_id) DO UPDATE SET
                source_updated_at = excluded.source_updated_at,
                materialized_at = unixepoch()
            "#,
            params![id, source_updated_at],
        )?;
        Ok(())
    })?;

    Ok(Some(materialized_path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn sqlite_save_cover_image(
    app: AppHandle,
    book_id: String,
    data_url: String,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        connection.execute(
            r#"
            INSERT INTO covers (book_id, data_url, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(book_id) DO UPDATE SET
                data_url = excluded.data_url,
                updated_at = unixepoch()
            "#,
            params![book_id, data_url],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn sqlite_get_cover_image(app: AppHandle, book_id: String) -> Result<Option<String>, String> {
    with_connection(&app, |connection| {
        connection
            .query_row(
                "SELECT data_url FROM covers WHERE book_id = ?1",
                params![book_id],
                |row| row.get(0),
            )
            .optional()
    })
}

#[tauri::command]
pub fn sqlite_delete_cover_image(app: AppHandle, book_id: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        connection.execute("DELETE FROM covers WHERE book_id = ?1", params![book_id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn sqlite_get_storage_stats(app: AppHandle) -> Result<SqliteStorageStats, String> {
    with_connection(&app, |connection| {
        let (total_books, binaries_size): (u64, u64) = connection.query_row(
            "SELECT COUNT(*) AS total_books, COALESCE(SUM(length(data)), 0) AS binaries_size FROM books",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let covers_size: u64 = connection.query_row(
            "SELECT COALESCE(SUM(length(data_url)), 0) FROM covers",
            [],
            |row| row.get(0),
        )?;

        Ok(SqliteStorageStats {
            total_books,
            total_size: binaries_size.saturating_add(covers_size),
            covers_size,
            binaries_size,
            idb_books: 0,
            tauri_books: total_books,
        })
    })
}

#[tauri::command]
pub fn sqlite_cleanup_orphaned_storage(
    app: AppHandle,
    existing_book_ids: Vec<String>,
) -> Result<SqliteCleanupResult, String> {
    with_connection(&app, |connection| {
        let existing_ids: HashSet<String> = existing_book_ids.into_iter().collect();

        let mut removed_books = 0_u64;
        let mut removed_covers = 0_u64;

        let existing_rows: Vec<String> = {
            let mut statement = connection.prepare("SELECT id FROM books")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };

        for id in existing_rows {
            if !existing_ids.contains(&id) {
                remove_materialized_cache_file(&app, &id);
                let affected =
                    connection.execute("DELETE FROM books WHERE id = ?1", params![id])?;
                removed_books = removed_books.saturating_add(affected as u64);
            }
        }

        let existing_cover_rows: Vec<String> = {
            let mut statement = connection.prepare("SELECT book_id FROM covers")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };

        for id in existing_cover_rows {
            if !existing_ids.contains(&id) {
                let affected =
                    connection.execute("DELETE FROM covers WHERE book_id = ?1", params![id])?;
                removed_covers = removed_covers.saturating_add(affected as u64);
            }
        }

        Ok(SqliteCleanupResult {
            removed_books,
            removed_covers,
            removed_metadata: 0,
        })
    })
}

#[tauri::command]
pub fn sqlite_clear_all_storage(app: AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(MATERIALIZED_BOOK_CACHE_DIR));

    if let Some(path) = cache_dir {
        let _ = fs::remove_dir_all(path);
    }

    with_connection(&app, |connection| {
        connection.execute("DELETE FROM covers", [])?;
        connection.execute("DELETE FROM materialized_books", [])?;
        connection.execute("DELETE FROM books", [])?;
        connection.execute("DELETE FROM kv_store", [])?;
        Ok(())
    })
}

#[tauri::command]
pub fn sqlite_get_kv(app: AppHandle, key: String) -> Result<Option<String>, String> {
    with_connection(&app, |connection| {
        connection
            .query_row(
                "SELECT value FROM kv_store WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
    })
}

#[tauri::command]
pub fn sqlite_set_kv(app: AppHandle, key: String, value: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        connection.execute(
            r#"
            INSERT INTO kv_store (key, value, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = unixepoch()
            "#,
            params![key, value],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn sqlite_delete_kv(app: AppHandle, key: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        connection.execute("DELETE FROM kv_store WHERE key = ?1", params![key])?;
        Ok(())
    })
}
