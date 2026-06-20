/**
 * Step 1 migration runner — Account Management schema
 *
 * Usage (from project root):
 *   node migrations/run-001.js
 *
 * Safe to run multiple times: uses IF NOT EXISTS and ignores duplicate ALTER errors.
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, '..', 'trades.db');
const db = new sqlite3.Database(dbFile);

function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function columnExists(table, column) {
  const rows = await all(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

async function migrate() {
  console.log('Migrating:', dbFile);

  await run('PRAGMA foreign_keys = ON');

  await run(`CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    account_size  REAL NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS balance_snapshots (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL,
    snapshot_balance  REAL NOT NULL,
    effective_date    TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`);

  await run(`CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date
    ON balance_snapshots (account_id, effective_date DESC)`);

  const tradeAlters = [
    ['account_id', 'TEXT REFERENCES accounts(id) ON DELETE SET NULL'],
    ['stop_loss_size', 'REAL'],
    ['risk_percentage', 'REAL'],
    ['risk_flag', 'TEXT'],
    ['created_at', "TEXT DEFAULT (datetime('now'))"],
  ];

  for (const [col, type] of tradeAlters) {
    if (!(await columnExists('trades', col))) {
      await run(`ALTER TABLE trades ADD COLUMN ${col} ${type}`);
      console.log('  Added trades.' + col);
    } else {
      console.log('  Skipped trades.' + col + ' (already exists)');
    }
  }

  await run('CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades (account_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_trades_account_exit_date ON trades (account_id, exitDate)');

  // Optional: attach orphan trades (no account_id) to a default account
  const orphanCount = await get('SELECT COUNT(*) AS n FROM trades WHERE account_id IS NULL');
  if (orphanCount && orphanCount.n > 0) {
    let defaultAccount = await get("SELECT id FROM accounts WHERE name = 'Default Account' LIMIT 1");
    if (!defaultAccount) {
      const id = 'acc_default_' + Date.now().toString(36);
      await run(
        `INSERT INTO accounts (id, name, account_size, created_at) VALUES (?, ?, ?, datetime('now'))`,
        [id, 'Default Account', 100000]
      );
      await run(
        `INSERT INTO balance_snapshots (id, account_id, snapshot_balance, effective_date, created_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ['snap_' + Date.now().toString(36), id, 100000]
      );
      defaultAccount = { id };
      console.log('  Created Default Account for existing trades:', id);
    }
    await run('UPDATE trades SET account_id = ? WHERE account_id IS NULL', [defaultAccount.id]);
    console.log('  Linked', orphanCount.n, 'existing trade(s) to Default Account');
  }

  console.log('Step 1 migration complete.');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => db.close());
