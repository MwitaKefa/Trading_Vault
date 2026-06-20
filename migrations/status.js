/**
 * Migration status tracker - Records which migrations have been applied
 * 
 * Usage:
 *   node migrations/status.js           - Show current migration status
 *   node migrations/status.js --record  - Record a migration as applied
 * 
 * This helps prevent re-running migrations and tracks history
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, '..', 'trades.db');
const statusFile = path.join(__dirname, '.migration-status.json');

// Default status file structure
const defaultStatus = {
  created_at: null,
  last_checked: null,
  migrations: {
    '001_account_management': {
      status: 'pending',
      applied_at: null,
      verified_at: null,
      notes: ''
    }
  }
};

function loadStatus() {
  if (fs.existsSync(statusFile)) {
    try {
      return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch (err) {
      return defaultStatus;
    }
  }
  return defaultStatus;
}

function saveStatus(status) {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf8');
}

async function checkMigrationApplied(migrationName) {
  const db = new sqlite3.Database(dbFile);
  
  return new Promise((resolve, reject) => {
    if (migrationName === '001_account_management') {
      // Check if the accounts table exists
      db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'",
        (err, row) => {
          db.close();
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    } else {
      db.close();
      resolve(false);
    }
  });
}

async function showStatus() {
  console.log('='.repeat(70));
  console.log('Migration Status Report');
  console.log('='.repeat(70));
  console.log(`Database: ${dbFile}\n`);

  const status = loadStatus();
  
  console.log('Status File:', statusFile);
  console.log(`Last checked: ${status.last_checked || 'never'}\n`);

  for (const [name, info] of Object.entries(status.migrations)) {
    const isApplied = await checkMigrationApplied(name);
    const statusSymbol = isApplied ? '✅' : '⏳';
    const statusText = isApplied ? 'APPLIED' : 'PENDING';

    console.log(`${statusSymbol} ${name}`);
    console.log(`   Status: ${statusText}`);
    console.log(`   Applied at: ${info.applied_at || 'not recorded'}`);
    console.log(`   Verified at: ${info.verified_at || 'not verified'}`);
    if (info.notes) {
      console.log(`   Notes: ${info.notes}`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
}

async function recordMigration(migrationName, verified = false) {
  const status = loadStatus();
  
  if (!status.migrations[migrationName]) {
    console.error(`Unknown migration: ${migrationName}`);
    process.exit(1);
  }

  if (!status.created_at) {
    status.created_at = new Date().toISOString();
  }

  status.last_checked = new Date().toISOString();
  status.migrations[migrationName].status = 'applied';
  status.migrations[migrationName].applied_at = new Date().toISOString();

  if (verified) {
    status.migrations[migrationName].verified_at = new Date().toISOString();
  }

  saveStatus(status);

  console.log(`✅ Recorded: ${migrationName} applied at ${status.migrations[migrationName].applied_at}`);
}

// Main
const command = process.argv[2];

if (command === '--record') {
  const migration = process.argv[3] || '001_account_management';
  const verified = process.argv[4] === '--verified';
  recordMigration(migration, verified)
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
} else {
  showStatus()
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
