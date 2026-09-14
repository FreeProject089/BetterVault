import { DatabaseSync } from 'node:sqlite';

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name));
}

function addColumn(db: DatabaseSync, table: string, definition: string): void {
  const name = definition.split(' ')[0];
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      auth_verifier TEXT NOT NULL,
      auth_salt TEXT NOT NULL,
      kdf TEXT NOT NULL,
      salt TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS vaults (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      blob TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Codes envoyés par email (réinitialisation du mot de passe)
    CREATE TABLE IF NOT EXISTS email_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    -- Jeton de courte durée délivré après vérification de la récupération
    CREATE TABLE IF NOT EXISTS recovery_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      with_recovery_key INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Colonnes ajoutées après la première version : les bases existantes sont complétées
  addColumn(db, 'users', 'locale TEXT');
  addColumn(db, 'users', 'totp_secret TEXT');
  addColumn(db, 'users', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'totp_last_step INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'recovery_verifier TEXT');
  addColumn(db, 'users', 'recovery_salt TEXT');
  addColumn(db, 'users', 'recovery_wrapped_key TEXT');
  return db;
}
