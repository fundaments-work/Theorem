use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

type DbPool = Pool<SqliteConnectionManager>;

static DB_POOL: OnceLock<DbPool> = OnceLock::new();

const DB_FILE_NAME: &str = "theorem.db";
const MATERIALIZED_BOOK_CACHE_DIR: &str = "book-cache";

#[derive(Serialize)]
pub struct SqliteStorageStats {
    pub total_books: u64,
    pub total_size: u64,
    pub covers_size: u64,
    pub binaries_size: u64,
    pub blob_entries: u64,
    pub blob_size: u64,
    pub idb_books: u64,
    pub tauri_books: u64,
}

#[derive(Serialize)]
pub struct SqliteCleanupResult {
    pub removed_books: u64,
    pub removed_covers: u64,
    pub removed_metadata: u64,
}

#[derive(Serialize)]
pub struct SqliteBlobStats {
    pub count: u64,
    pub total_size: u64,
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

pub fn run_schema_migrations(app: &AppHandle) -> Result<(), String> {
    let db_path = database_path(app)?;

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database for migration: {e}"))?;
    conn.execute_batch(DB_SCHEMA_PERSISTENT_PRAGMAS)
        .map_err(|e| format!("Failed to run schema migrations: {e}"))?;
    conn.execute_batch(DB_PER_CONNECTION_PRAGMAS)
        .map_err(|e| format!("Failed to set connection PRAGMAs: {e}"))?;

    let has_data: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('covers') WHERE name = 'data'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_data {
        conn.execute_batch("ALTER TABLE covers ADD COLUMN data BLOB;")
            .ok();
    }
    Ok(())
}

fn init_db_pool(db_path: &Path) -> Result<&DbPool, String> {
    if let Some(pool) = DB_POOL.get() {
        return Ok(pool);
    }

    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder()
        .max_size(1)
        .connection_customizer(Box::new(SqlitePerConnectionPragmas))
        .build(manager)
        .map_err(|error| format!("Failed to create SQLite connection pool: {error}"))?;

    DB_POOL.set(pool).ok();
    DB_POOL
        .get()
        .ok_or_else(|| "Failed to initialize database pool".into())
}

const DB_SCHEMA_PERSISTENT_PRAGMAS: &str = r#"
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
        data BLOB,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS blob_store (
        key TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS materialized_books (
        book_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        materialized_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
        id UNINDEXED,
        title,
        author
    );

    -- Indexes for query performance
    CREATE INDEX IF NOT EXISTS idx_covers_book_id ON covers(book_id);

    CREATE TABLE IF NOT EXISTS book_metadata (
        book_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_annotations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        annotation_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_book_annotations_book_id
        ON book_annotations(book_id);
"#;

const DB_PER_CONNECTION_PRAGMAS: &str = r#"
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -8000;
    PRAGMA mmap_size = 268435456;
    PRAGMA temp_store = MEMORY;
    PRAGMA journal_size_limit = 67108864;
"#;

#[derive(Debug)]
struct SqlitePerConnectionPragmas;

impl r2d2::CustomizeConnection<Connection, rusqlite::Error> for SqlitePerConnectionPragmas {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(DB_PER_CONNECTION_PRAGMAS)
    }
}

pub fn with_connection<T, F>(app: &AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> rusqlite::Result<T>,
{
    let db_path = database_path(app)?;
    let pool = init_db_pool(&db_path)?;
    let connection = pool
        .get()
        .map_err(|error| format!("Failed to acquire SQLite connection from pool: {error}"))?;

    operation(&connection).map_err(|error| format!("SQLite operation failed: {error}"))
}

#[tauri::command]
pub fn sqlite_save_book_data(app: AppHandle, id: String, data: Vec<u8>) -> Result<String, String> {
    let materialized_path = materialized_book_path(&app, &id)?;
    fs::write(&materialized_path, &data).map_err(|error| {
        format!("Failed to write book data file '{materialized_path:?}': {error}")
    })?;

    with_connection(&app, |connection| {
        connection.execute(
            r#"
            INSERT INTO books (id, data, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(id) DO UPDATE SET
                data = ?2,
                updated_at = unixepoch()
            "#,
            params![id, data],
        )?;

        connection.execute(
            r#"
            INSERT INTO materialized_books (book_id, source_updated_at, materialized_at)
            VALUES (?1, (SELECT updated_at FROM books WHERE id = ?1), unixepoch())
            ON CONFLICT(book_id) DO UPDATE SET
                source_updated_at = (SELECT updated_at FROM books WHERE id = ?1),
                materialized_at = unixepoch()
            "#,
            params![id],
        )?;
        Ok(())
    })?;

    Ok(format!("sqlite://{id}"))
}

#[tauri::command]
pub fn sqlite_get_book_data(app: AppHandle, id: String) -> Result<Option<Vec<u8>>, String> {
    if let Ok(Some(path)) = sqlite_get_materialized_book_path(app.clone(), id.clone()) {
        let content = fs::read(&path).map_err(|e| format!("Failed to read book file: {}", e))?;
        return Ok(Some(content));
    }

    with_connection(&app, |connection| {
        connection
            .query_row(
                "SELECT data FROM books WHERE id = ?1 AND data IS NOT NULL",
                params![id],
                |row| row.get::<_, Vec<u8>>(0),
            )
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
    let materialized_path = materialized_book_path(&app, &id)?;

    if materialized_path.exists() {
        return Ok(Some(materialized_path.to_string_lossy().into_owned()));
    }

    let data = with_connection(&app, |connection| {
        connection
            .query_row("SELECT data FROM books WHERE id = ?1", params![id], |row| {
                row.get::<_, Vec<u8>>(0)
            })
            .optional()
    })?;

    if let Some(blob_data) = data {
        if !blob_data.is_empty() {
            fs::write(&materialized_path, &blob_data).map_err(|error| {
                format!("Failed to write migrated book file '{materialized_path:?}': {error}")
            })?;

            let _ = with_connection(&app, |connection| {
                connection.execute("UPDATE books SET data = X'' WHERE id = ?1", params![id])
            });

            return Ok(Some(materialized_path.to_string_lossy().into_owned()));
        }
    }

    Ok(None)
}

pub fn sqlite_save_cover_image_inner(
    connection: &Connection,
    book_id: &str,
    data_url: &str,
) -> rusqlite::Result<()> {
    let cover_data = extract_base64_from_data_url(data_url).and_then(|b64| {
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).ok()
    });

    connection.execute(
        r#"
        INSERT INTO covers (book_id, data_url, data, updated_at)
        VALUES (?1, ?2, ?3, unixepoch())
        ON CONFLICT(book_id) DO UPDATE SET
            data_url = excluded.data_url,
            data = excluded.data,
            updated_at = unixepoch()
        "#,
        params![book_id, data_url, cover_data],
    )?;
    Ok(())
}

fn extract_base64_from_data_url(data_url: &str) -> Option<&str> {
    let comma = data_url.find(',')?;
    Some(&data_url[comma + 1..])
}

#[tauri::command]
pub fn sqlite_save_cover_image(
    app: AppHandle,
    book_id: String,
    data_url: String,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_save_cover_image_inner(connection, &book_id, &data_url)
    })
}

pub fn sqlite_get_cover_image_inner(
    connection: &Connection,
    book_id: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT data_url FROM covers WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()
}

#[tauri::command]
pub fn sqlite_get_cover_image(app: AppHandle, book_id: String) -> Result<Option<String>, String> {
    with_connection(&app, |connection| {
        sqlite_get_cover_image_inner(connection, &book_id)
    })
}

pub fn sqlite_delete_cover_image_inner(
    connection: &Connection,
    book_id: &str,
) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM covers WHERE book_id = ?1", params![book_id])?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_delete_cover_image(app: AppHandle, book_id: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_delete_cover_image_inner(connection, &book_id)
    })
}

#[tauri::command]
pub fn sqlite_get_storage_stats(app: AppHandle) -> Result<SqliteStorageStats, String> {
    let mut binaries_size = 0;

    let cache_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(MATERIALIZED_BOOK_CACHE_DIR));

    if let Some(path) = cache_dir {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    binaries_size += metadata.len();
                }
            }
        }
    }

    with_connection(&app, |connection| {
        let (total_books, legacy_binaries_size): (u64, u64) = connection.query_row(
            "SELECT COUNT(*) AS total_books, COALESCE(SUM(length(data)), 0) AS legacy_binaries_size FROM books",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let covers_size: u64 = connection.query_row(
            "SELECT COALESCE(SUM(length(data_url)), 0) FROM covers",
            [],
            |row| row.get(0),
        )?;

        let (blob_entries, blob_size): (u64, u64) = connection.query_row(
            "SELECT COUNT(*) AS blob_entries, COALESCE(SUM(length(data)), 0) AS blob_size FROM blob_store",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let total_binaries_size = binaries_size + legacy_binaries_size;

        Ok(SqliteStorageStats {
            total_books,
            total_size: total_binaries_size
                .saturating_add(covers_size)
                .saturating_add(blob_size),
            covers_size,
            binaries_size: total_binaries_size,
            blob_entries,
            blob_size,
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

pub fn sqlite_clear_all_storage_inner(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM covers", [])?;
    connection.execute("DELETE FROM materialized_books", [])?;
    connection.execute("DELETE FROM books", [])?;
    connection.execute("DELETE FROM blob_store", [])?;
    connection.execute("DELETE FROM kv_store", [])?;
    Ok(())
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
        sqlite_clear_all_storage_inner(connection)
    })
}

pub fn sqlite_get_kv_inner(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM kv_store WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
}

#[tauri::command]
pub fn sqlite_get_kv(app: AppHandle, key: String) -> Result<Option<String>, String> {
    with_connection(&app, |connection| sqlite_get_kv_inner(connection, &key))
}

pub fn sqlite_batch_get_kv_inner(
    connection: &Connection,
    keys: &[String],
) -> rusqlite::Result<Vec<(String, String)>> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: Vec<String> = keys
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT key, value FROM kv_store WHERE key IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = connection.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(keys.iter()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    rows.collect::<rusqlite::Result<Vec<(String, String)>>>()
}

#[tauri::command]
pub fn sqlite_batch_get_kv(
    app: AppHandle,
    keys: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    with_connection(&app, |connection| {
        sqlite_batch_get_kv_inner(connection, &keys)
    })
}

pub fn sqlite_set_kv_inner(
    connection: &Connection,
    key: &str,
    value: &str,
) -> rusqlite::Result<()> {
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
}

#[tauri::command]
pub fn sqlite_set_kv(app: AppHandle, key: String, value: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_set_kv_inner(connection, &key, &value)
    })
}

pub fn sqlite_delete_kv_inner(connection: &Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM kv_store WHERE key = ?1", params![key])?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_delete_kv(app: AppHandle, key: String) -> Result<(), String> {
    with_connection(&app, |connection| sqlite_delete_kv_inner(connection, &key))
}

pub fn sqlite_count_kv_by_prefix_inner(
    connection: &Connection,
    prefix: &str,
) -> rusqlite::Result<u64> {
    connection.query_row(
        "SELECT COUNT(*) FROM kv_store WHERE key LIKE ?1 || '%'",
        params![prefix],
        |row| row.get(0),
    )
}

#[tauri::command]
pub fn sqlite_count_kv_by_prefix(app: AppHandle, prefix: String) -> Result<u64, String> {
    with_connection(&app, |connection| {
        sqlite_count_kv_by_prefix_inner(connection, &prefix)
    })
}

pub fn sqlite_delete_kv_by_prefix_inner(
    connection: &Connection,
    prefix: &str,
) -> rusqlite::Result<u64> {
    let affected = connection.execute(
        "DELETE FROM kv_store WHERE key LIKE ?1 || '%'",
        params![prefix],
    )?;
    Ok(affected as u64)
}

#[tauri::command]
pub fn sqlite_delete_kv_by_prefix(app: AppHandle, prefix: String) -> Result<u64, String> {
    with_connection(&app, |connection| {
        sqlite_delete_kv_by_prefix_inner(connection, &prefix)
    })
}

pub fn sqlite_set_blob_inner(
    connection: &Connection,
    key: &str,
    data: &[u8],
) -> rusqlite::Result<()> {
    connection.execute(
        r#"
        INSERT INTO blob_store (key, data, updated_at)
        VALUES (?1, ?2, unixepoch())
        ON CONFLICT(key) DO UPDATE SET
            data = excluded.data,
            updated_at = unixepoch()
        "#,
        params![key, data],
    )?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_set_blob(app: AppHandle, key: String, data: Vec<u8>) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_set_blob_inner(connection, &key, &data)
    })
}

pub fn sqlite_get_blob_inner(
    connection: &Connection,
    key: &str,
) -> rusqlite::Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT data FROM blob_store WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
}

#[tauri::command]
pub fn sqlite_get_blob(app: AppHandle, key: String) -> Result<Option<Vec<u8>>, String> {
    with_connection(&app, |connection| sqlite_get_blob_inner(connection, &key))
}

pub fn sqlite_delete_blob_inner(connection: &Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM blob_store WHERE key = ?1", params![key])?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_delete_blob(app: AppHandle, key: String) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_delete_blob_inner(connection, &key)
    })
}

pub fn sqlite_delete_blobs_by_prefix_inner(
    connection: &Connection,
    prefix: &str,
) -> rusqlite::Result<u64> {
    let affected = connection.execute(
        "DELETE FROM blob_store WHERE key LIKE ?1 || '%'",
        params![prefix],
    )?;
    Ok(affected as u64)
}

#[tauri::command]
pub fn sqlite_delete_blobs_by_prefix(app: AppHandle, prefix: String) -> Result<u64, String> {
    with_connection(&app, |connection| {
        sqlite_delete_blobs_by_prefix_inner(connection, &prefix)
    })
}

pub fn sqlite_get_blob_stats_inner(
    connection: &Connection,
    prefix: Option<String>,
) -> rusqlite::Result<SqliteBlobStats> {
    let (count, total_size): (u64, u64) = if let Some(prefix) = prefix {
        connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(data)), 0) FROM blob_store WHERE key LIKE ?1 || '%'",
            params![prefix],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    } else {
        connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(data)), 0) FROM blob_store",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    };

    Ok(SqliteBlobStats { count, total_size })
}

#[tauri::command]
pub fn sqlite_get_blob_stats(
    app: AppHandle,
    prefix: Option<String>,
) -> Result<SqliteBlobStats, String> {
    with_connection(&app, |connection| {
        sqlite_get_blob_stats_inner(connection, prefix)
    })
}

#[derive(Serialize)]
pub struct SqliteBookSearchResult {
    pub book_id: String,
    pub title: String,
}

pub fn sqlite_index_book_fts_inner(
    connection: &Connection,
    book_id: &str,
    title: &str,
    author: &str,
) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM books_fts WHERE id = ?1", params![book_id])?;
    connection.execute(
        "INSERT INTO books_fts(id, title, author) VALUES(?1, ?2, ?3)",
        params![book_id, title, author],
    )?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_index_book_fts(
    app: AppHandle,
    book_id: String,
    title: String,
    author: String,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_index_book_fts_inner(connection, &book_id, &title, &author)
    })
}

pub fn sqlite_index_books_fts_batch_inner(
    connection: &Connection,
    entries: &[(String, String, String)],
) -> rusqlite::Result<()> {
    for (id, title, author) in entries {
        connection.execute("DELETE FROM books_fts WHERE id = ?1", params![id])?;
        connection.execute(
            "INSERT INTO books_fts(id, title, author) VALUES(?1, ?2, ?3)",
            params![id, title, author],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn sqlite_index_books_fts_batch(
    app: AppHandle,
    entries: Vec<(String, String, String)>,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_index_books_fts_batch_inner(connection, &entries)
    })
}

pub fn sqlite_search_books_inner(
    connection: &Connection,
    query: &str,
    limit: u32,
) -> rusqlite::Result<Vec<SqliteBookSearchResult>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = connection.prepare(
        "SELECT id, title FROM books_fts WHERE books_fts MATCH ?1 ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit], |row| {
        Ok(SqliteBookSearchResult {
            book_id: row.get(0)?,
            title: row.get(1)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

#[tauri::command]
pub fn sqlite_search_books(
    app: AppHandle,
    query: String,
    limit: u32,
) -> Result<Vec<SqliteBookSearchResult>, String> {
    with_connection(&app, |connection| {
        sqlite_search_books_inner(connection, &query, limit)
    })
}

pub fn sqlite_save_book_metadata_inner(
    connection: &Connection,
    book_id: &str,
    metadata_json: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO book_metadata(book_id, metadata_json, updated_at) VALUES(?1, ?2, unixepoch())
         ON CONFLICT(book_id) DO UPDATE SET metadata_json = ?2, updated_at = unixepoch()",
        params![book_id, metadata_json],
    )?;
    Ok(())
}

#[tauri::command]
pub fn sqlite_save_book_metadata(
    app: AppHandle,
    book_id: String,
    metadata_json: String,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_save_book_metadata_inner(connection, &book_id, &metadata_json)
    })
}

pub fn sqlite_get_book_metadata_inner(
    connection: &Connection,
    book_id: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT metadata_json FROM book_metadata WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()
}

#[tauri::command]
pub fn sqlite_get_book_metadata(app: AppHandle, book_id: String) -> Result<Option<String>, String> {
    with_connection(&app, |connection| {
        sqlite_get_book_metadata_inner(connection, &book_id)
    })
}

pub fn sqlite_save_book_annotations_inner(
    connection: &Connection,
    book_id: &str,
    annotations_json: &[String],
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM book_annotations WHERE book_id = ?1",
        params![book_id],
    )?;
    for (i, ann_json) in annotations_json.iter().enumerate() {
        let id: String = serde_json::from_str::<serde_json::Value>(ann_json)
            .ok()
            .and_then(|v| {
                v.get("id")
                    .and_then(|id_val| id_val.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| format!("auto:{}:{}", book_id, i));
        connection.execute(
            "INSERT INTO book_annotations(id, book_id, annotation_json, updated_at) VALUES(?1, ?2, ?3, unixepoch())",
            params![id, book_id, ann_json],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn sqlite_save_book_annotations(
    app: AppHandle,
    book_id: String,
    annotations_json: Vec<String>,
) -> Result<(), String> {
    with_connection(&app, |connection| {
        sqlite_save_book_annotations_inner(connection, &book_id, &annotations_json)
    })
}

pub fn sqlite_get_book_annotations_inner(
    connection: &Connection,
    book_id: &str,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = connection.prepare(
        "SELECT annotation_json FROM book_annotations WHERE book_id = ?1 ORDER BY updated_at",
    )?;
    let rows = stmt.query_map(params![book_id], |row| row.get::<_, String>(0))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

#[tauri::command]
pub fn sqlite_get_book_annotations(app: AppHandle, book_id: String) -> Result<Vec<String>, String> {
    with_connection(&app, |connection| {
        sqlite_get_book_annotations_inner(connection, &book_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = MEMORY;
            PRAGMA synchronous = OFF;
            PRAGMA foreign_keys = OFF;

            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS covers (
                book_id TEXT PRIMARY KEY,
                data_url TEXT NOT NULL,
                data BLOB,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS blob_store (
                key TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS materialized_books (
                book_id TEXT PRIMARY KEY,
                source_updated_at INTEGER NOT NULL,
                materialized_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
                id UNINDEXED,
                title,
                author
            );

            CREATE TABLE IF NOT EXISTS book_metadata (
                book_id TEXT PRIMARY KEY,
                metadata_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS book_annotations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                annotation_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_kv_roundtrip() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "key1", "value1").unwrap();
        let result = sqlite_get_kv_inner(&conn, "key1").unwrap();
        assert_eq!(result, Some("value1".to_string()));
    }

    #[test]
    fn test_kv_get_nonexistent() {
        let conn = setup_db();
        let result = sqlite_get_kv_inner(&conn, "nonexistent").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_kv_overwrite() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "key1", "value1").unwrap();
        sqlite_set_kv_inner(&conn, "key1", "value2").unwrap();
        let result = sqlite_get_kv_inner(&conn, "key1").unwrap();
        assert_eq!(result, Some("value2".to_string()));
    }

    #[test]
    fn test_kv_delete() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "key1", "value1").unwrap();
        sqlite_delete_kv_inner(&conn, "key1").unwrap();
        let result = sqlite_get_kv_inner(&conn, "key1").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_batch_get_kv() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "a", "1").unwrap();
        sqlite_set_kv_inner(&conn, "b", "2").unwrap();
        sqlite_set_kv_inner(&conn, "c", "3").unwrap();
        let results =
            sqlite_batch_get_kv_inner(&conn, &["a".to_string(), "c".to_string()]).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.contains(&("a".to_string(), "1".to_string())));
        assert!(results.contains(&("c".to_string(), "3".to_string())));
    }

    #[test]
    fn test_batch_get_kv_empty() {
        let conn = setup_db();
        let results = sqlite_batch_get_kv_inner(&conn, &[]).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_kv_prefix_count() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "prefix:a", "1").unwrap();
        sqlite_set_kv_inner(&conn, "prefix:b", "2").unwrap();
        sqlite_set_kv_inner(&conn, "other:c", "3").unwrap();
        let count = sqlite_count_kv_by_prefix_inner(&conn, "prefix:").unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_kv_prefix_delete() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "prefix:a", "1").unwrap();
        sqlite_set_kv_inner(&conn, "prefix:b", "2").unwrap();
        sqlite_set_kv_inner(&conn, "other:c", "3").unwrap();
        let deleted = sqlite_delete_kv_by_prefix_inner(&conn, "prefix:").unwrap();
        assert_eq!(deleted, 2);
        assert_eq!(sqlite_get_kv_inner(&conn, "prefix:a").unwrap(), None);
        assert_eq!(
            sqlite_get_kv_inner(&conn, "other:c").unwrap(),
            Some("3".to_string())
        );
    }

    #[test]
    fn test_blob_roundtrip() {
        let conn = setup_db();
        let data = vec![1, 2, 3, 4, 5];
        sqlite_set_blob_inner(&conn, "blob1", &data).unwrap();
        let result = sqlite_get_blob_inner(&conn, "blob1").unwrap();
        assert_eq!(result, Some(data));
    }

    #[test]
    fn test_blob_get_nonexistent() {
        let conn = setup_db();
        let result = sqlite_get_blob_inner(&conn, "nonexistent").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_blob_delete() {
        let conn = setup_db();
        sqlite_set_blob_inner(&conn, "blob1", &[1, 2, 3]).unwrap();
        sqlite_delete_blob_inner(&conn, "blob1").unwrap();
        let result = sqlite_get_blob_inner(&conn, "blob1").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_blob_prefix_delete() {
        let conn = setup_db();
        sqlite_set_blob_inner(&conn, "pfx:a", &[1]).unwrap();
        sqlite_set_blob_inner(&conn, "pfx:b", &[2]).unwrap();
        sqlite_set_blob_inner(&conn, "other:c", &[3]).unwrap();
        let deleted = sqlite_delete_blobs_by_prefix_inner(&conn, "pfx:").unwrap();
        assert_eq!(deleted, 2);
        assert_eq!(sqlite_get_blob_inner(&conn, "pfx:a").unwrap(), None);
        assert_eq!(
            sqlite_get_blob_inner(&conn, "other:c").unwrap(),
            Some(vec![3])
        );
    }

    #[test]
    fn test_cover_image_roundtrip() {
        let conn = setup_db();
        sqlite_save_cover_image_inner(&conn, "book1", "data:image/png;base64,abc").unwrap();
        let result = sqlite_get_cover_image_inner(&conn, "book1").unwrap();
        assert_eq!(result, Some("data:image/png;base64,abc".to_string()));
    }

    #[test]
    fn test_cover_image_delete() {
        let conn = setup_db();
        sqlite_save_cover_image_inner(&conn, "book1", "data:image/png;base64,abc").unwrap();
        sqlite_delete_cover_image_inner(&conn, "book1").unwrap();
        let result = sqlite_get_cover_image_inner(&conn, "book1").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_fts_index_and_search() {
        let conn = setup_db();
        sqlite_index_book_fts_inner(&conn, "id1", "The Great Gatsby", "F. Scott Fitzgerald")
            .unwrap();
        sqlite_index_book_fts_inner(&conn, "id2", "Gatsby Returns", "Some Author").unwrap();
        sqlite_index_book_fts_inner(&conn, "id3", "Moby Dick", "Herman Melville").unwrap();
        let results = sqlite_search_books_inner(&conn, "Gatsby", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().any(|r| r.book_id == "id1"));
        assert!(results.iter().any(|r| r.book_id == "id2"));
    }

    #[test]
    fn test_fts_search_empty_query() {
        let conn = setup_db();
        let results = sqlite_search_books_inner(&conn, "", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_book_metadata_roundtrip() {
        let conn = setup_db();
        let meta = r#"{"title":"Test Book","author":"Test Author"}"#;
        sqlite_save_book_metadata_inner(&conn, "book1", meta).unwrap();
        let result = sqlite_get_book_metadata_inner(&conn, "book1").unwrap();
        assert_eq!(result, Some(meta.to_string()));
    }

    #[test]
    fn test_book_metadata_overwrite() {
        let conn = setup_db();
        sqlite_save_book_metadata_inner(&conn, "book1", r#"{"v":1}"#).unwrap();
        sqlite_save_book_metadata_inner(&conn, "book1", r#"{"v":2}"#).unwrap();
        let result = sqlite_get_book_metadata_inner(&conn, "book1").unwrap();
        assert_eq!(result, Some(r#"{"v":2}"#.to_string()));
    }

    #[test]
    fn test_book_metadata_get_nonexistent() {
        let conn = setup_db();
        let result = sqlite_get_book_metadata_inner(&conn, "nonexistent").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_book_annotations_roundtrip() {
        let conn = setup_db();
        let anns = vec![
            r#"{"id":"ann1","type":"highlight","text":"hello"}"#.to_string(),
            r#"{"id":"ann2","type":"note","text":"world"}"#.to_string(),
        ];
        sqlite_save_book_annotations_inner(&conn, "book1", &anns).unwrap();
        let result = sqlite_get_book_annotations_inner(&conn, "book1").unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].contains("ann1") || result[1].contains("ann1"));
    }

    #[test]
    fn test_book_annotations_replace() {
        let conn = setup_db();
        let anns1 = vec![r#"{"id":"ann1","text":"first"}"#.to_string()];
        let anns2 = vec![r#"{"id":"ann2","text":"second"}"#.to_string()];
        sqlite_save_book_annotations_inner(&conn, "book1", &anns1).unwrap();
        sqlite_save_book_annotations_inner(&conn, "book1", &anns2).unwrap();
        let result = sqlite_get_book_annotations_inner(&conn, "book1").unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("ann2"));
    }

    #[test]
    fn test_clear_all_storage() {
        let conn = setup_db();
        sqlite_set_kv_inner(&conn, "k1", "v1").unwrap();
        sqlite_set_blob_inner(&conn, "b1", &[1]).unwrap();
        sqlite_save_cover_image_inner(&conn, "book1", "data:,").unwrap();
        sqlite_clear_all_storage_inner(&conn).unwrap();
        assert_eq!(sqlite_get_kv_inner(&conn, "k1").unwrap(), None);
        assert_eq!(sqlite_get_blob_inner(&conn, "b1").unwrap(), None);
        assert_eq!(sqlite_get_cover_image_inner(&conn, "book1").unwrap(), None);
    }

    #[test]
    fn test_blob_stats() {
        let conn = setup_db();
        let stats = sqlite_get_blob_stats_inner(&conn, None::<String>).unwrap();
        assert_eq!(stats.count, 0);
        assert_eq!(stats.total_size, 0);

        sqlite_set_blob_inner(&conn, "a", &[1, 2, 3]).unwrap();
        sqlite_set_blob_inner(&conn, "b", &[4, 5]).unwrap();
        let stats = sqlite_get_blob_stats_inner(&conn, None::<String>).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_size, 5);
    }

    #[test]
    fn test_blob_stats_with_prefix() {
        let conn = setup_db();
        sqlite_set_blob_inner(&conn, "pfx:a", &[1, 2, 3]).unwrap();
        sqlite_set_blob_inner(&conn, "pfx:b", &[4, 5]).unwrap();
        sqlite_set_blob_inner(&conn, "other:c", &[6]).unwrap();
        let stats = sqlite_get_blob_stats_inner(&conn, Some("pfx:".to_string())).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_size, 5);
    }

    #[test]
    fn test_fts_batch_index() {
        let conn = setup_db();
        let entries = vec![
            (
                "id1".to_string(),
                "Book One".to_string(),
                "Author A".to_string(),
            ),
            (
                "id2".to_string(),
                "Book Two".to_string(),
                "Author B".to_string(),
            ),
        ];
        sqlite_index_books_fts_batch_inner(&conn, &entries).unwrap();
        let results = sqlite_search_books_inner(&conn, "Book", 10).unwrap();
        assert_eq!(results.len(), 2);
    }
}
