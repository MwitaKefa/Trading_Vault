# Database Migrations - Trading Vault

## Overview

This directory contains database migration scripts for Trading Vault. Migrations handle schema changes in a safe, reversible manner.

**Current Migration:** Step 1 - Account Management Schema

---

## Step 1: Account Management Schema

### What This Migration Does

Introduces multi-account support to Trading Vault by adding:

- ✅ `accounts` table - Stores account information
- ✅ `balance_snapshots` table - Tracks account balance history
- ✅ `trades` table alterations:
  - `account_id` - Links trades to accounts
  - `stop_loss_size` - Position sizing for risk management
  - `risk_percentage` - Risk per trade percentage
  - `risk_flag` - Status flag for risk validation
  - `created_at` - Timestamp for audit trail
- ✅ Indexes for performance optimization

### Data Safety

- ✅ **Preserves existing trades** - All current trades are retained
- ✅ **Handles orphan data** - Automatically assigns existing trades to "Default Account"
- ✅ **Idempotent** - Safe to run multiple times
- ✅ **Foreign key constraints** - Maintains data integrity
- ✅ **Rollback capability** - Can be reversed if needed

---

## Migration Files

| File | Purpose | Safe to Run? |
|------|---------|--------------|
| `001_account_management.sql` | SQL schema definition (reference) | Read-only |
| `run-001.js` | Primary migration runner | ✅ Yes, idempotent |
| `verify-001.js` | Verification script (post-migration) | ✅ Yes, read-only |
| `rollback-001.js` | Rollback script (emergency only) | ⚠️  Destructive |

---

## Step-by-Step: Running the Migration

### Step 1: Backup Your Database

```bash
# From project root
cp trades.db trades.db.backup
```

### Step 2: Run the Migration

```bash
# From project root
node migrations/run-001.js
```

**Expected Output:**
```
Migrating: /path/to/trades.db
  Added trades.account_id
  Added trades.stop_loss_size
  Added trades.risk_percentage
  Added trades.risk_flag
  Added trades.created_at
  Created Default Account for existing trades: acc_default_xyz123
  Linked N existing trade(s) to Default Account
Step 1 migration complete.
```

### Step 3: Verify Migration Success

```bash
# From project root
node migrations/verify-001.js
```

**Expected Output:**
```
✅ accounts table exists
✅ balance_snapshots table exists
✅ trades.account_id
✅ trades.stop_loss_size
✅ trades.risk_percentage
✅ trades.risk_flag
✅ trades.created_at
✅ All indexes created
✅ No orphan trades
✅ All foreign key constraints valid

🎉 Migration Step 1 successfully applied!
```

### Step 4: Restart Your Application

```bash
# Kill the running server (if any)
# Ctrl+C or pkill node

# Restart
npm start
# or
node server.js
```

---

## Database Schema After Migration

### Accounts Table
```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,           -- Unique account identifier
  name          TEXT NOT NULL,              -- Account name (e.g., "Main Account")
  account_size  REAL NOT NULL,              -- Initial account balance
  created_at    TEXT NOT NULL               -- Creation timestamp
);
```

### Balance Snapshots Table
```sql
CREATE TABLE balance_snapshots (
  id                TEXT PRIMARY KEY,       -- Unique snapshot identifier
  account_id        TEXT NOT NULL,          -- FK to accounts
  snapshot_balance  REAL NOT NULL,          -- Balance at snapshot time
  effective_date    TEXT NOT NULL,          -- Date snapshot applies to
  created_at        TEXT NOT NULL,          -- When snapshot was created
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
```

**Index:** `(account_id, effective_date DESC)` - For fast balance history queries

### Trades Table (New Columns)
```sql
ALTER TABLE trades ADD COLUMN account_id TEXT 
  REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE trades ADD COLUMN stop_loss_size REAL;

ALTER TABLE trades ADD COLUMN risk_percentage REAL;

ALTER TABLE trades ADD COLUMN risk_flag TEXT;
  -- Values: 'ok' | 'violation' | 'conservative'

ALTER TABLE trades ADD COLUMN created_at TEXT 
  DEFAULT (datetime('now'));
```

**Indexes:**
- `idx_trades_account_id` on `(account_id)`
- `idx_trades_account_exit_date` on `(account_id, exitDate)`

---

## Rolling Back the Migration (Emergency Only)

If something goes wrong and you need to revert:

```bash
# From project root
node migrations/rollback-001.js --force
```

**⚠️  WARNING: This will:**
- Delete the `accounts` table
- Delete the `balance_snapshots` table
- Remove new columns from `trades` table
- Preserve all trade records

**After rollback:**
1. A backup is automatically created: `trades.db.backup.TIMESTAMP`
2. Manually restore if needed: `cp trades.db.backup.TIMESTAMP trades.db`
3. Restart the application

---

## Verifying Migration Impact

### Check if Migration Ran

```bash
# Connect to database
sqlite3 trades.db

# List tables (should include accounts and balance_snapshots)
.tables

# Check trades table columns
PRAGMA table_info(trades);

# Exit
.quit
```

### Common Checks

**Check account assignment:**
```sql
SELECT COUNT(*) as total_trades,
       COUNT(account_id) as with_account,
       COUNT(*) - COUNT(account_id) as orphan_trades
FROM trades;
```

**Check default account:**
```sql
SELECT id, name, account_size FROM accounts;
```

**Check balance snapshots:**
```sql
SELECT account_id, snapshot_balance, effective_date 
FROM balance_snapshots 
ORDER BY created_at DESC;
```

---

## Troubleshooting

### Problem: "database is locked"

**Cause:** Another process is using the database

**Solution:**
```bash
# Stop your app: Ctrl+C
# Kill any Node processes
pkill -f "node server.js"
# Or on Windows: taskkill /F /IM node.exe

# Wait 2 seconds, then retry migration
node migrations/run-001.js
```

### Problem: "table accounts already exists"

**Cause:** Migration was already run

**Solution:** This is normal! The migration uses `IF NOT EXISTS`, so it's safe to run again. Verify it worked:
```bash
node migrations/verify-001.js
```

### Problem: "migration failed with foreign key error"

**Cause:** Foreign key constraints were violated

**Solution:**
```bash
# Restore from backup
cp trades.db.backup trades.db

# Run rollback
node migrations/rollback-001.js --force

# Investigate your data (optional)
sqlite3 trades.db

# Then run migration again
node migrations/run-001.js
```

### Problem: Existing trades not assigned to default account

**Cause:** Migration failed partway through

**Solution:**
```bash
# Check current state
node migrations/verify-001.js

# If orphan trades exist, run rollback and retry
node migrations/rollback-001.js --force
rm trades.db
cp trades.db.backup trades.db
node migrations/run-001.js
```

---

## Data Integrity Checks

The migration ensures data consistency through:

1. **Foreign Key Constraints** - `ON DELETE CASCADE` for accounts (deleting account also deletes balance snapshots)
2. **NOT NULL Constraints** - Required fields enforced at database level
3. **Unique Identifiers** - All IDs are PRIMARY KEYs
4. **Indexes** - Performance indexes on account_id and dates for fast queries
5. **Orphan Handling** - Automatic default account creation for existing trades
6. **Audit Trail** - `created_at` timestamps on all new entities

---

## Migration Idempotency

All migration operations are idempotent (safe to run multiple times):

- `CREATE TABLE IF NOT EXISTS` - Won't fail if table exists
- `ALTER TABLE ADD COLUMN` - Won't fail if column exists (checked in code)
- `CREATE INDEX IF NOT EXISTS` - Won't fail if index exists
- Orphan handling - Only runs if orphans exist

---

## Next Steps After Migration

1. ✅ Run migration: `node migrations/run-001.js`
2. ✅ Verify success: `node migrations/verify-001.js`
3. ✅ Restart app: `npm start`
4. ⏭️  **Frontend Phase 2** - Add account UI selector and management
5. ⏭️  **Backend Phase 2** - Add account management API routes
6. ⏭️  **Testing** - Multi-account data isolation tests

---

## Database Schema Diagram

```
┌─────────────────┐
│    accounts     │
├─────────────────┤
│ id (PK)         │
│ name            │
│ account_size    │
│ created_at      │
└────────┬────────┘
         │ 1
         │ (FK)
         │ N
┌────────▼──────────────────────┐
│   balance_snapshots           │
├───────────────────────────────┤
│ id (PK)                       │
│ account_id (FK)               │
│ snapshot_balance              │
│ effective_date                │
│ created_at                    │
└─────────────────────────────┬─┘
         ▲                     │
         │ (account_id FK)     │
         │                     │
    ┌────┴──────────────────┐  │
    │                       │  │
┌───┴─────────────────────┐ │  │
│       trades            │◄┘  │
├─────────────────────────┤    │
│ id (PK)                 │    │ References for
│ symbol                  │    │ balance calculation
│ side                    │    │
│ entryPrice              │    │
│ exitPrice               │    │
│ quantity                │    │
│ fees                    │    │
│ entryDate               │    │
│ exitDate                │    │
│ tags                    │    │
│ notes                   │    │
│ screenshot              │    │
│ pnl                     │    │
│ pnlPercent              │    │
│ result                  │    │
│ ─── NEW ───             │    │
│ account_id (FK)◄────────┘    │
│ stop_loss_size          │    │
│ risk_percentage         │    │
│ risk_flag               │    │
│ created_at              │    │
└─────────────────────────┘    │
```

---

## References

- **Migration Documentation:** See IMPLEMENTATION_PLAN.md (Section 2)
- **API Endpoints (Phase 2):** Will be documented separately
- **Frontend Changes (Phase 2):** Will be documented separately

---

**Migration created by:** AI Assistant  
**Date created:** 2026-06-20  
**Status:** ✅ Complete and tested  
**Last updated:** 2026-06-20
