/**
 * ROLLBACK Step 1 migration - Account Management schema
 *
 * ⚠️  WARNING: This script will DELETE the accounts, balance_snapshots tables
 *     and REMOVE the columns added to trades table.
 *
 * Usage (from project root):
 *   node migrations/rollback-001.js
 *
 * This is a DESTRUCTIVE operation. Use only in emergencies.
 * All account and balance_snapshots data will be LOST.
 * Trades will be preserved but will lose account_id, stop_loss_size, risk_percentage, risk_flag, created_at.
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbFile = path.join(__dirname, '..', 'trades.db');
const backupFile = path.join(__dirname, '..', `trades.db.backup.${Date.now()}`);

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

async function columnExists(table, column) {
  const rows = await get(`PRAGMA table_info(${table})`);
  if (!rows) return false;
  const allRows = await new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  return allRows.some((r) => r.name === column);
}

async function rollback() {
  console.log('='.repeat(70));
  console.log('⚠️  ROLLBACK Step 1 - Account Management Schema');
  console.log('='.repeat(70));
  console.log(`Database: ${dbFile}\n`);

  console.log('📦 Creating backup...');
  try {
    fs.copyFileSync(dbFile, backupFile);
    console.log(`✅ Backup created: ${backupFile}\n`);
  } catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    process.exit(1);
  }

  try {
    console.log('🔄 Beginning rollback...\n');

    // Drop tables
    console.log('Dropping tables...');
    await run('DROP TABLE IF EXISTS balance_snapshots');
    console.log('  ✅ Dropped balance_snapshots');

    await run('DROP TABLE IF EXISTS accounts');
    console.log('  ✅ Dropped accounts');

    // SQLite doesn't support DROP COLUMN, so we need to recreate the trades table
    // without the new columns
    console.log('\nRemoving columns from trades...');

    // Get current trades structure and data
    const currentTrades = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM trades', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    console.log(`  Found ${currentTrades.length} trades to preserve`);

    // Rename old trades table
    await run('ALTER TABLE trades RENAME TO trades_old');
    console.log('  ✅ Renamed trades to trades_old');

    // Create new trades table with original columns only
    await run(`CREATE TABLE trades (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      side TEXT,
      entryPrice REAL,
      exitPrice REAL,
      quantity REAL,
      fees REAL,
      entryDate TEXT,
      exitDate TEXT,
      tags TEXT,
      notes TEXT,
      screenshot TEXT,
      pnl REAL,
      pnlPercent REAL,
      result TEXT
    )`);
    console.log('  ✅ Created new trades table');

    // Copy data back (only original columns)
    const columnsList = [
      'id', 'symbol', 'side', 'entryPrice', 'exitPrice', 'quantity', 'fees',
      'entryDate', 'exitDate', 'tags', 'notes', 'screenshot', 'pnl', 'pnlPercent', 'result'
    ];
    const placeholders = columnsList.map(() => '?').join(',');
    const stmt = db.prepare(
      `INSERT INTO trades (${columnsList.join(',')}) VALUES (${placeholders})`
    );

    for (const trade of currentTrades) {
      const values = columnsList.map(col => trade[col]);
      await new Promise((resolve, reject) => {
        stmt.run(values, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    console.log(`  ✅ Restored ${currentTrades.length} trades`);

    // Drop old table
    await run('DROP TABLE trades_old');
    console.log('  ✅ Dropped trades_old');

    // Drop indexes
    console.log('\nDropping indexes...');
    await run('DROP INDEX IF EXISTS idx_trades_account_id');
    console.log('  ✅ Dropped idx_trades_account_id');

    await run('DROP INDEX IF EXISTS idx_trades_account_exit_date');
    console.log('  ✅ Dropped idx_trades_account_exit_date');

    await run('DROP INDEX IF EXISTS idx_balance_snapshots_account_date');
    console.log('  ✅ Dropped idx_balance_snapshots_account_date');

    console.log('\n' + '='.repeat(70));
    console.log('✅ ROLLBACK COMPLETE');
    console.log('='.repeat(70));
    console.log('\nData preserved:');
    console.log(`  - ${currentTrades.length} trades (account_id and new columns removed)`);
    console.log('\nData DELETED:');
    console.log('  - accounts table and all entries');
    console.log('  - balance_snapshots table and all entries');
    console.log('\nBackup file (keep for safety):');
    console.log(`  ${backupFile}`);
    console.log('\nNext steps:');
    console.log('  1. Restart your application');
    console.log('  2. Run migrations again when ready: node migrations/run-001.js');

  } catch (err) {
    console.error('\n❌ Rollback failed:', err.message);
    console.error('\n⚠️  Backup file available:', backupFile);
    console.error('If database is corrupted, restore from backup:');
    console.error(`  rm ${dbFile} && mv ${backupFile} ${dbFile}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Confirm before rollback
if (process.argv[2] !== '--force') {
  console.log('\n⚠️  DESTRUCTIVE OPERATION');
  console.log('This will delete accounts and balance_snapshots tables.');
  console.log('To proceed, run: node migrations/rollback-001.js --force\n');
  process.exit(0);
} else {
  rollback()
    .catch((err) => {
      console.error('Rollback error:', err.message);
      process.exit(1);
    });
}
