function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function addColumn(db, table, column, spec) {
  if (!tableColumns(db, table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}

export function migrate(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL,
      song_json TEXT NOT NULL,
      requester TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qq_accounts (
      id INTEGER PRIMARY KEY CHECK (id=1),
      uin TEXT NOT NULL DEFAULT '',
      cookie_ciphertext TEXT NOT NULL,
      remember_login INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL,
      song_json TEXT NOT NULL,
      requester TEXT NOT NULL DEFAULT '',
      played_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bili_accounts (
      id INTEGER PRIMARY KEY CHECK (id=1),
      uid TEXT NOT NULL DEFAULT '',
      cookie_ciphertext TEXT NOT NULL,
      remember_login INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cloud_accounts (
      id INTEGER PRIMARY KEY CHECK (id=1),
      uid TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      cookie_ciphertext TEXT NOT NULL,
      remember_login INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS migu_accounts (
      id INTEGER PRIMARY KEY CHECK (id=1),
      uid TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      cookie_ciphertext TEXT NOT NULL,
      remember_login INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      last_connected_at INTEGER,
      auto_connect INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playback_state (
      id INTEGER PRIMARY KEY CHECK (id=1),
      current_queue_id INTEGER,
      mode TEXT NOT NULL DEFAULT 'loop',
      playing INTEGER NOT NULL DEFAULT 0,
      position_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS command_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      permission_json TEXT NOT NULL DEFAULT '{}',
      cooldown_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS gift_credits (
      uid TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      credits INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gift_skip_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      credits INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gift_skip_uid ON gift_skip_lots(uid, expires_at)');

  addColumn(db, 'queue_items', 'requested_by_uid', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'queue_items', 'failure_code', 'TEXT');
  addColumn(db, 'queue_items', 'updated_at', 'INTEGER');
  addColumn(db, 'play_history', 'result', "TEXT NOT NULL DEFAULT 'played'");
  addColumn(db, 'play_history', 'failure_code', 'TEXT');
  addColumn(db, 'play_history', 'started_at', 'INTEGER');
  addColumn(db, 'play_history', 'ended_at', 'INTEGER');
  addColumn(db, 'app_settings', 'revision', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`DELETE FROM play_history WHERE id NOT IN (SELECT MAX(id) FROM play_history GROUP BY song_id)`);

  db.exec('PRAGMA user_version = 1');
  return 1;
}
