/**
 * Verify that Step 1 migration was applied successfully
 *
 * Usage (from project root):
 *   node migrations/verify-001.js
 *
 * Output: Summary of migration status, tables, columns, and data integrity
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, '..', 'trades.db');
const db = new sqlite3.Database(dbFile);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

async function verify() {
  console.log('='.repeat(70));
  console.log('MIGRATION VERIFICATION - Step 1 Account Management');
  console.log('='.repeat(70));
  console.log(`Database: ${dbFile}\n`);

  let passed = 0;
  let failed = 0;

  // ===== CHECK: accounts table exists =====
  console.log('📋 TABLES AND STRUCTURE');
  console.log('-'.repeat(70));
  
  let tables = await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts', 'balance_snapshots', 'trades')"
  );
  let tableNames = tables.map(t => t.name);

  if (tableNames.includes('accounts')) {
    console.log('✅ accounts table exists');
    passed++;
    let columns = await all("PRAGMA table_info(accounts)");
    console.log('   Columns:', columns.map(c => `${c.name} (${c.type})`).join(', '));
  } else {
    console.log('❌ accounts table NOT FOUND');
    failed++;
  }

  if (tableNames.includes('balance_snapshots')) {
    console.log('✅ balance_snapshots table exists');
    passed++;
    let columns = await all("PRAGMA table_info(balance_snapshots)");
    console.log('   Columns:', columns.map(c => `${c.name} (${c.type})`).join(', '));
  } else {
    console.log('❌ balance_snapshots table NOT FOUND');
    failed++;
  }

  // ===== CHECK: trades table alterations =====
  console.log('\n📊 TRADES TABLE COLUMNS');
  console.log('-'.repeat(70));

  const requiredColumns = [
    'account_id',
    'stop_loss_size',
    'risk_percentage',
    'risk_flag',
    'created_at'
  ];

  let tradesColumns = await all("PRAGMA table_info(trades)");
  let tradesColumnNames = tradesColumns.map(c => c.name);

  requiredColumns.forEach(col => {
    if (tradesColumnNames.includes(col)) {
      const colInfo = tradesColumns.find(c => c.name === col);
      console.log(`✅ trades.${col} (${colInfo.type})`);
      passed++;
    } else {
      console.log(`❌ trades.${col} NOT FOUND`);
      failed++;
    }
  });

  // ===== CHECK: indexes =====
  console.log('\n🔍 INDEXES');
  console.log('-'.repeat(70));

  let indexes = await all(
    "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_trades_account_id', 'idx_trades_account_exit_date', 'idx_balance_snapshots_account_date')"
  );
  let indexNames = indexes.map(i => i.name);

  ['idx_trades_account_id', 'idx_trades_account_exit_date', 'idx_balance_snapshots_account_date'].forEach(idx => {
    if (indexNames.includes(idx)) {
      console.log(`✅ ${idx}`);
      passed++;
    } else {
      console.log(`❌ ${idx} NOT FOUND`);
      failed++;
    }
  });

  // ===== CHECK: data integrity =====
  console.log('\n📈 DATA INTEGRITY');
  console.log('-'.repeat(70));

  let accountCount = await get('SELECT COUNT(*) as count FROM accounts');
  console.log(`Accounts: ${accountCount.count}`);
  if (accountCount.count > 0) {
    passed++;
  }

  let snapshotCount = await get('SELECT COUNT(*) as count FROM balance_snapshots');
  console.log(`Balance snapshots: ${snapshotCount.count}`);
  if (snapshotCount.count > 0) {
    passed++;
  }

  let tradeCount = await get('SELECT COUNT(*) as count FROM trades');
  console.log(`Total trades: ${tradeCount.count}`);

  let tradeWithAccountCount = await get('SELECT COUNT(*) as count FROM trades WHERE account_id IS NOT NULL');
  console.log(`Trades with account_id: ${tradeWithAccountCount.count}`);
  
  let orphanTradeCount = await get('SELECT COUNT(*) as count FROM trades WHERE account_id IS NULL');
  if (orphanTradeCount.count === 0) {
    console.log('✅ No orphan trades (all assigned to accounts)');
    passed++;
  } else {
    console.log(`⚠️  ${orphanTradeCount.count} orphan trades detected`);
  }

  // ===== CHECK: foreign key constraints =====
  console.log('\n🔗 FOREIGN KEY RELATIONSHIPS');
  console.log('-'.repeat(70));

  let fkCheck = await run('PRAGMA foreign_keys = ON');
  let brokenFks = await all('PRAGMA foreign_key_check');
  
  if (brokenFks.length === 0) {
    console.log('✅ All foreign key constraints are valid');
    passed++;
  } else {
    console.log(`❌ ${brokenFks.length} broken foreign key constraint(s) detected:`);
    brokenFks.forEach(fk => {
      console.log(`   Table: ${fk.table}, Rowid: ${fk.rowid}, Issue: ${fk.details}`);
    });
    failed++;
  }

  // ===== SUMMARY =====
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 Migration Step 1 successfully applied!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Migration verification failed. Please review errors above.');
    process.exit(1);
  }
}

verify()
  .catch((err) => {
    console.error('Verification error:', err.message);
    process.exit(1);
  })
  .finally(() => db.close());
