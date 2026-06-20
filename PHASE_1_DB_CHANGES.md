# Phase 1: Database Schema Changes - Implementation Summary

**Date Implemented:** 2026-06-20  
**Status:** Complete - Ready to Execute  
**Scope:** Database schema initialization for multi-account support  

---

## 1. AFFECTED FILES

### Files Modified

| File | Purpose | Changes |
|------|---------|---------|
| `migrations/001_account_management.sql` | Schema reference | ✅ Already exists (no changes) |
| `migrations/run-001.js` | Migration runner | ✅ Already exists (no changes) |

### Files Created

| File | Purpose | Type |
|------|---------|------|
| `migrations/verify-001.js` | Post-migration verification | New utility |
| `migrations/rollback-001.js` | Emergency rollback script | New utility |
| `migrations/status.js` | Migration tracking | New utility |
| `migrations/README.md` | Migration documentation | New reference |
| `PHASE_1_DB_CHANGES.md` | This file | New reference |

### No Changes To

- ✅ `server.js` - Routes unchanged (Phase 2)
- ✅ `script.js` - Frontend unchanged (Phase 2)
- ✅ `index.html` - UI unchanged (Phase 2)
- ✅ `style.css` - Styling unchanged (Phase 2)
- ✅ `package.json` - Dependencies unchanged

---

## 2. DATABASE SCHEMA CHANGES

### 2.1 New Tables

#### Table: `accounts`

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  account_size  REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Purpose:** Stores trading account metadata  
**Primary Key:** `id` (auto-generated text)  
**Constraints:** NOT NULL on name and account_size  
**Default Entries:** None (user creates)  
**Orphan Handling:** If existing trades exist, creates "Default Account"

---

#### Table: `balance_snapshots`

```sql
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  snapshot_balance  REAL NOT NULL,
  effective_date    TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date
  ON balance_snapshots (account_id, effective_date DESC);
```

**Purpose:** Audit trail for account balance changes  
**Primary Key:** `id` (auto-generated text)  
**Foreign Key:** `account_id` → `accounts(id)` (CASCADE delete)  
**Index:** `(account_id, effective_date DESC)` for fast queries  
**Design Pattern:** Append-only (never UPDATE), only INSERT new snapshots  
**Running Balance Formula:**
```
current_balance = latest_snapshot.snapshot_balance
                + SUM(trades.pnl)
                  WHERE account_id = :id
                  AND exitDate >= latest_snapshot.effective_date
```

---

### 2.2 Trades Table Alterations

**Existing Columns (Unchanged):**
```
id, symbol, side, entryPrice, exitPrice, quantity, fees,
entryDate, exitDate, tags, notes, screenshot, pnl, pnlPercent, result
```

**New Columns Added:**

| Column | Type | Purpose | Default | Nullable |
|--------|------|---------|---------|----------|
| `account_id` | TEXT FK | Links trade to account | NULL | Yes |
| `stop_loss_size` | REAL | SL price for risk calculation | NULL | Yes |
| `risk_percentage` | REAL | % of account risked | NULL | Yes |
| `risk_flag` | TEXT | Risk status: 'ok'\|'violation'\|'conservative' | NULL | Yes |
| `created_at` | TEXT | Trade creation timestamp | `datetime('now')` | Yes |

**Migration SQL:**
```sql
ALTER TABLE trades ADD COLUMN account_id TEXT 
  REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE trades ADD COLUMN stop_loss_size REAL;

ALTER TABLE trades ADD COLUMN risk_percentage REAL;

ALTER TABLE trades ADD COLUMN risk_flag TEXT;

ALTER TABLE trades ADD COLUMN created_at TEXT 
  DEFAULT (datetime('now'));
```

---

### 2.3 New Indexes

**Index 1:** `idx_trades_account_id`
```sql
CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades (account_id);
```
**Purpose:** Fast filtering of trades by account_id  
**Expected Query:** `SELECT * FROM trades WHERE account_id = ?`

**Index 2:** `idx_trades_account_exit_date`
```sql
CREATE INDEX IF NOT EXISTS idx_trades_account_exit_date 
  ON trades (account_id, exitDate);
```
**Purpose:** Fast filtering by account and date range (analytics)  
**Expected Query:** `SELECT * FROM trades WHERE account_id = ? AND exitDate BETWEEN ? AND ?`

**Index 3:** `idx_balance_snapshots_account_date`
```sql
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date
  ON balance_snapshots (account_id, effective_date DESC);
```
**Purpose:** Fast retrieval of latest balance snapshot  
**Expected Query:** `SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY effective_date DESC LIMIT 1`

---

## 3. COMPLETE MIGRATION STEPS

### Pre-Migration Checklist

- [ ] **Backup database:** `cp trades.db trades.db.backup`
- [ ] **Stop application:** `Ctrl+C` or `pkill node`
- [ ] **Verify Node.js installed:** `node --version` (should be v12+)
- [ ] **Verify sqlite3 module:** Already in `package.json` dependencies
- [ ] **Check disk space:** Ensure ~1MB free (for backup + migration)
- [ ] **Read migration README:** `cat migrations/README.md`

### Execution Steps

#### Step 1: Create Backup

```bash
# From project root
cp trades.db trades.db.backup
echo "Backup created: trades.db.backup"
```

**Why:** Allows rollback if migration fails

---

#### Step 2: Run Migration

```bash
# From project root
node migrations/run-001.js
```

**Expected Output:**
```
Migrating: /full/path/to/trades.db
  Added trades.account_id
  Added trades.stop_loss_size
  Added trades.risk_percentage
  Added trades.risk_flag
  Added trades.created_at
  Created Default Account for existing trades: acc_default_xyz123abc
  Linked N existing trade(s) to Default Account
Step 1 migration complete.
```

**What Happens:**
1. Creates `accounts` table
2. Creates `balance_snapshots` table
3. Adds 5 new columns to `trades` table
4. Creates 3 new indexes
5. Detects orphan trades (trades with no account_id)
6. Creates "Default Account" if orphans exist
7. Assigns all orphan trades to "Default Account"
8. Creates initial balance snapshot for default account

**Time:** ~100-500ms depending on trade count

---

#### Step 3: Verify Migration

```bash
# From project root
node migrations/verify-001.js
```

**Expected Output:**
```
======================================================================
MIGRATION VERIFICATION - Step 1 Account Management
======================================================================
Database: /full/path/to/trades.db

📋 TABLES AND STRUCTURE
----------------------------------------------------------------------
✅ accounts table exists
   Columns: id (TEXT), name (TEXT), account_size (REAL), created_at (TEXT)
✅ balance_snapshots table exists
   Columns: id (TEXT), account_id (TEXT), snapshot_balance (REAL), 
            effective_date (TEXT), created_at (TEXT)

📊 TRADES TABLE COLUMNS
----------------------------------------------------------------------
✅ trades.account_id (TEXT)
✅ trades.stop_loss_size (REAL)
✅ trades.risk_percentage (REAL)
✅ trades.risk_flag (TEXT)
✅ trades.created_at (TEXT)

🔍 INDEXES
----------------------------------------------------------------------
✅ idx_trades_account_id
✅ idx_trades_account_exit_date
✅ idx_balance_snapshots_account_date

📈 DATA INTEGRITY
----------------------------------------------------------------------
Accounts: 1
Balance snapshots: 1
Total trades: N
Trades with account_id: N
✅ No orphan trades (all assigned to accounts)

🔗 FOREIGN KEY RELATIONSHIPS
----------------------------------------------------------------------
✅ All foreign key constraints are valid

======================================================================
SUMMARY
======================================================================
✅ Passed: 15
❌ Failed: 0

🎉 Migration Step 1 successfully applied!
```

**If verification FAILS:**
- Check error messages carefully
- See troubleshooting section
- Consider rollback if critical errors

---

#### Step 4: Record Migration Status (Optional)

```bash
# From project root
node migrations/status.js --record 001_account_management --verified
```

**Output:**
```
✅ Recorded: 001_account_management applied at 2026-06-20T14:32:15.123Z
```

**Why:** Helps track which migrations have been applied (useful for multiple environments)

---

#### Step 5: Restart Application

```bash
# From project root
npm start
# or
node server.js
```

**Verify:**
- Application starts without errors
- Can load dashboard
- Can view existing trades
- Navigation works

---

## 4. DATA PRESERVATION DETAILS

### Existing Trades: What Happens

**Before Migration:**
```
trades: 150 records
  - All have: id, symbol, side, entryPrice, exitPrice, quantity, fees,
              entryDate, exitDate, tags, notes, screenshot, pnl, pnlPercent, result
  - None have: account_id, stop_loss_size, risk_percentage, risk_flag, created_at
```

**During Migration:**
```
1. New columns added to trades table
2. account_id column initialized to NULL
3. Migration script detects trades with account_id = NULL (orphans)
4. Creates "Default Account" entry
5. Updates all orphan trades: SET account_id = 'acc_default_...'
```

**After Migration:**
```
trades: 150 records (unchanged count)
  - All have: original columns + new columns
  - All trades assigned: account_id = 'acc_default_...'
  - New columns for existing trades:
    - account_id: 'acc_default_...' (assigned)
    - stop_loss_size: NULL (can be set later)
    - risk_percentage: NULL (can be set later)
    - risk_flag: NULL (can be set later)
    - created_at: datetime('now') during ALTER (all same timestamp)
```

**Impact:** ✅ Zero data loss, all trades preserved and assigned

---

### Default Account: What Gets Created

**Table: accounts**
```
id: 'acc_default_' + timestamp  (e.g., 'acc_default_xyz123abc')
name: 'Default Account'
account_size: 100000
created_at: datetime('now')
```

**Table: balance_snapshots**
```
id: 'snap_' + timestamp  (e.g., 'snap_xyz123abc')
account_id: 'acc_default_...'
snapshot_balance: 100000
effective_date: datetime('now')
created_at: datetime('now')
```

**Why $100k default:** Placeholder value; user can edit in Phase 2

---

## 5. ROLLBACK PROCEDURE

### When to Rollback

- ❌ Migration failed with errors
- ❌ Application won't start after migration
- ❌ Data appears corrupted
- ❌ Critical foreign key errors detected
- ✅ Otherwise: keep the migration (it's safe)

### How to Rollback

#### Option A: Automatic Rollback (Recommended)

```bash
# From project root
node migrations/rollback-001.js --force
```

**What Happens:**
1. Creates automatic backup: `trades.db.backup.TIMESTAMP`
2. Drops `accounts` table completely
3. Drops `balance_snapshots` table completely
4. Recreates `trades` table with original columns only
5. Restores all trade data from trades_old
6. Cleans up temporary tables

**Output:**
```
======================================================================
⚠️  ROLLBACK Step 1 - Account Management Schema
======================================================================
Database: /full/path/to/trades.db

📦 Creating backup...
✅ Backup created: /full/path/to/trades.db.backup.1687261535123

🔄 Beginning rollback...

Dropping tables...
  ✅ Dropped balance_snapshots
  ✅ Dropped accounts

Removing columns from trades...
  Found 150 trades to preserve
  ✅ Renamed trades to trades_old
  ✅ Created new trades table
  ✅ Restored 150 trades
  ✅ Dropped trades_old

Dropping indexes...
  ✅ Dropped idx_trades_account_id
  ✅ Dropped idx_trades_account_exit_date
  ✅ Dropped idx_balance_snapshots_account_date

======================================================================
✅ ROLLBACK COMPLETE
======================================================================

Data preserved:
  - 150 trades (account_id and new columns removed)

Data DELETED:
  - accounts table and all entries
  - balance_snapshots table and all entries

Backup file (keep for safety):
  /full/path/to/trades.db.backup.1687261535123

Next steps:
  1. Restart your application
  2. Run migrations again when ready: node migrations/run-001.js
```

**Time:** ~200-500ms

---

#### Option B: Manual Rollback

If automatic rollback fails:

```bash
# 1. Stop the application
pkill node

# 2. Restore from backup
cp trades.db trades.db.broken
cp trades.db.backup trades.db

# 3. Restart application
npm start

# 4. Application is back to pre-migration state
```

---

### After Rollback

- ✅ Application works as before
- ✅ All trades preserved
- ✅ Safe to retry migration later
- ✅ Backup files kept (for audit trail)

---

## 6. MIGRATION SAFETY FEATURES

### Idempotency

✅ **Safe to Run Multiple Times**

The migration uses:
- `CREATE TABLE IF NOT EXISTS` - Won't fail if table exists
- `ALTER TABLE ADD COLUMN` - Checked before running (code handles duplicates)
- `CREATE INDEX IF NOT EXISTS` - Won't fail if index exists
- Column existence checks - Prevents duplicate ADD COLUMN errors

**Example:**
```bash
node migrations/run-001.js  # First run - creates schema
node migrations/run-001.js  # Second run - skips existing items
# Both succeed with same result
```

### Foreign Key Integrity

✅ **Enforced Constraints**

```sql
PRAGMA foreign_keys = ON;  -- Enabled in migration

-- balance_snapshots → accounts (CASCADE delete)
FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE

-- trades → accounts (NULL on delete)
ALTER TABLE trades ADD COLUMN account_id TEXT 
  REFERENCES accounts(id) ON DELETE SET NULL;
```

**Protection:**
- Cannot insert trades with non-existent account_id
- Deleting an account cascades to its balance_snapshots
- Deleting an account sets trade.account_id to NULL (preserves trades)

### Backup Strategy

✅ **Automatic Backups**

```bash
# Before migration (manual)
cp trades.db trades.db.backup

# Before rollback (automatic)
# Creates: trades.db.backup.TIMESTAMP
```

### Verification Script

✅ **Comprehensive Checks**

`verify-001.js` checks:
- All tables exist
- All columns exist with correct types
- All indexes exist
- No orphan trades
- Foreign key constraints valid
- Data integrity maintained

---

## 7. TESTING PROCEDURE

### Pre-Migration Testing

```bash
# 1. Stop server
pkill node

# 2. Make backup
cp trades.db trades.db.before_test

# 3. Run migration
node migrations/run-001.js

# 4. Verify
node migrations/verify-001.js

# 5. If failed, restore and try again
cp trades.db.before_test trades.db
```

### Post-Migration Testing

**Unit Tests** (SQL-level):
```bash
# Check accounts created
sqlite3 trades.db "SELECT COUNT(*) FROM accounts;"
# Expected: 1 (Default Account)

# Check trades assigned
sqlite3 trades.db "SELECT COUNT(DISTINCT account_id) FROM trades;"
# Expected: 1 (all in Default Account)

# Check no orphans
sqlite3 trades.db "SELECT COUNT(*) FROM trades WHERE account_id IS NULL;"
# Expected: 0

# Check indexes
sqlite3 trades.db ".indices"
# Expected: See 3 new indexes listed
```

**Integration Tests** (Application-level):
```bash
# 1. Start application
npm start

# 2. Verify app loads
curl http://localhost:3000
# Expected: 200 OK, HTML content

# 3. Verify API works
curl http://localhost:3000/api/trades
# Expected: 200 OK, JSON array of trades

# 4. Verify trades can be retrieved
# Each trade should have account_id field

# 5. Stop server
Ctrl+C
```

---

## 8. TROUBLESHOOTING

### Error: "database is locked"

```
Error: database is locked
```

**Cause:** Another process is using the database

**Solution:**
```bash
# Kill all Node processes
pkill node
# Wait 2 seconds
sleep 2
# Retry migration
node migrations/run-001.js
```

---

### Error: "table accounts already exists"

```
Error: table accounts already exists
```

**Cause:** Migration already ran successfully

**Solution:**
```bash
# This is normal! Run verification to confirm
node migrations/verify-001.js

# If verification passes, migration is complete
```

---

### Error: "column account_id already exists"

```
Error: ALTER TABLE trades: column account_id already exists
```

**Cause:** Migration partially completed before

**Solution:**
```bash
# Verify if migration actually succeeded
node migrations/verify-001.js

# If verification passes, no action needed (already applied)
# If verification fails, check error details
```

---

### Error: "FOREIGN KEY constraint failed"

```
Error: FOREIGN KEY constraint failed
```

**Cause:** Orphan data or constraint violation

**Solution:**
```bash
# 1. Check for constraint violations
sqlite3 trades.db "PRAGMA foreign_key_check;"

# 2. If found, rollback and investigate
node migrations/rollback-001.js --force

# 3. Clean any problematic data

# 4. Retry migration
node migrations/run-001.js
```

---

### Verification Fails: "orphan trades detected"

```
⚠️  5 orphan trades detected
```

**Cause:** Some trades weren't assigned to account during migration

**Solution:**
```bash
# 1. This should not happen with current migration code
# 2. But if it does, manually assign them:

sqlite3 trades.db <<EOF
UPDATE trades 
SET account_id = (SELECT id FROM accounts LIMIT 1)
WHERE account_id IS NULL;
.quit
EOF

# 3. Verify again
node migrations/verify-001.js
```

---

## 9. POST-MIGRATION CHECKLIST

- [ ] Database backed up before migration
- [ ] Migration ran without errors: `node migrations/run-001.js`
- [ ] Verification passed: `node migrations/verify-001.js`
- [ ] Application restarted: `npm start`
- [ ] Dashboard loads without errors
- [ ] Existing trades still visible
- [ ] All stats/charts display correctly
- [ ] No console errors in browser DevTools
- [ ] No errors in server logs
- [ ] Can create new trades
- [ ] Backup file kept safely: `trades.db.backup`

---

## 10. PERFORMANCE IMPACT

### Database Size Change

**Before Migration:**
```
trades.db: ~50KB (example with 150 trades)
```

**After Migration:**
```
trades.db: ~65KB (example with 150 trades)
- New tables: ~10KB
- New columns: ~3KB
- New indexes: ~2KB
```

**Impact:** ✅ Minimal (~30% increase for small databases)

### Query Performance Change

**Trade Retrieval:**
- **Before:** `SELECT * FROM trades` - scans all rows
- **After with filter:** `SELECT * FROM trades WHERE account_id = ?` - uses index (faster)

**Expected:** ✅ Faster after filtering is implemented (Phase 2)

### Index Usage

New indexes significantly improve queries by account:
- `idx_trades_account_id` - O(log n) instead of O(n)
- `idx_trades_account_exit_date` - O(log n) for date range queries
- `idx_balance_snapshots_account_date` - O(log n) for balance history

---

## 11. ROLLBACK CONSIDERATIONS

### Can We Rollback Later?

✅ **Yes, at any time** before Phase 2 starts

Once Phase 2 (API routes) is implemented:
- Frontend will expect `account_id` in trades
- Routes will require `account_id` parameter
- Rollback becomes more complex

**Recommendation:** Rollback within 1 hour of migration if issues found

### What Happens on Rollback?

- ✅ `accounts` table deleted (no data loss - empty table)
- ✅ `balance_snapshots` table deleted (no data loss - only initial snapshot)
- ✅ All trades preserved (same 150 records)
- ✅ New columns removed (reverts to original schema)

---

## 12. NEXT PHASES

### Phase 2 (Backend API Routes)
- Modify `/api/trades` to accept `accountId` parameter
- Add account management routes
- Add stats routes with account filtering

### Phase 3 (Frontend UI)
- Add account selector to header
- Add account creation/deletion UI
- Modify all data fetches to use `accountId`

### Phase 4 (Testing)
- Test multi-account data isolation
- Test account switching
- Test chart updates per account

---

## Summary

✅ **Migration 001 is production-ready**
✅ **All existing data preserved**
✅ **Rollback available if needed**
✅ **Verification script included**
✅ **Zero impact on Phase 1 (database only)**

**Status:** Ready to execute

---

**Prepared by:** AI Assistant  
**Date:** 2026-06-20  
**Version:** 1.0  
