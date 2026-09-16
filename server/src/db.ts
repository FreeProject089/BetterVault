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

    -- Coffres partagés : contenu chiffré par une clé remise chiffrée à chaque membre
    CREATE TABLE IF NOT EXISTS shared_vaults (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      blob TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shared_roles (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      permissions TEXT NOT NULL,
      builtin TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shared_members (
      vault_id TEXT NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES shared_roles(id),
      wrapped_key TEXT NOT NULL,
      status TEXT NOT NULL,
      invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (vault_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS shared_members_user ON shared_members(user_id);

    -- Pièces jointes chiffrées (le contenu est dans le dossier des fichiers)
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vault_id TEXT REFERENCES shared_vaults(id) ON DELETE CASCADE,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(owner_id);

    -- Fichiers supprimés, à purger des sauvegardes après la durée de conservation
    CREATE TABLE IF NOT EXISTS deleted_files (
      id TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    );

    -- Offres payantes (optionnelles) : état fourni par les webhooks Stripe
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end INTEGER,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      received_at INTEGER NOT NULL
    );

    -- Journal de sécurité : identifiants de compte pseudonymisés, aucune adresse IP ni email
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      detail TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events(at);

    CREATE TABLE IF NOT EXISTS backup_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      bytes INTEGER,
      files INTEGER,
      message TEXT
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
  addColumn(db, 'users', 'public_key TEXT');
  addColumn(db, 'users', 'avatar BLOB');
  addColumn(db, 'users', 'avatar_type TEXT');
  addColumn(db, 'users', 'avatar_url TEXT');
  addColumn(db, 'users', 'avatar_updated_at INTEGER');
  addColumn(db, 'users', 'wrapped_private_key TEXT');
  // Sessions : identifiant public (révocation), appareil, IP tronquée et lieu approximatif, dernière activité
  addColumn(db, 'sessions', 'public_id TEXT');
  addColumn(db, 'sessions', 'device TEXT');
  addColumn(db, 'sessions', 'ip_prefix TEXT');
  addColumn(db, 'sessions', 'country TEXT');
  addColumn(db, 'sessions', 'city TEXT');
  addColumn(db, 'sessions', 'last_seen_at INTEGER');
  db.exec("UPDATE sessions SET public_id = lower(hex(randomblob(8))) WHERE public_id IS NULL");
  return db;
}
