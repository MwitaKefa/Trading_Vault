# PHASE 1 Database Migration - Quick Start Guide

**⏱️ Execution Time:** ~5 minutes  
**Risk Level:** LOW (fully reversible)  
**Data Loss Risk:** NONE (all trades preserved)

---

## ⚡ TL;DR - Execute in 3 Steps

### Step 1: Backup (30 seconds)
```bash
cp trades.db trades.db.backup
```

### Step 2: Migrate (1 minute)
```bash
node migrations/run-001.js
```

Expected output:
```
Migrating: /path/to/trades.db
  Added trades.account_id
  Added trades.stop_loss_size
  Added trades.risk_percentage
  Added trades.risk_flag
  Added trades.created_at
  Created Default Account for existing trades: acc_default_xyz...
  Linked N existing trade(s) to Default Account
Step 1 migration complete.
```

### Step 3: Verify (1 minute)
```bash
node migrations/verify-001.js
```

Expected output ends with:
```
🎉 Migration Step 1 successfully applied!
```

### Step 4: Restart App (1 minute)
```bash
npm start
# or
node server.js
```

---

## ✅ Pre-Flight Checklist

Before running:

- [ ] Backup database: `cp trades.db trades.db.backup`
- [ ] Stop running app: `Ctrl+C` or `pkill node`
- [ ] Located in project root: `cd /path/to/Trading_Vault`
- [ ] Node.js installed: `node --version` (should show v12+)
- [ ] Migration files exist:
  - [ ] `migrations/run-001.js`
  - [ ] `migrations/001_account_management.sql`

---

## 🚀 Execute Migration

### From Project Root:

```bash
# BACKUP (always!)
cp trades.db trades.db.backup

# RUN MIGRATION
node migrations/run-001.js

# VERIFY SUCCESS
node migrations/verify-001.js

# RESTART APP
npm start
```

### Expected Outputs

**Run Migration Output:**
```
Migrating: /Users/yourname/Trading_Vault/trades.db
  Added trades.account_id
  Added trades.stop_loss_size
  Added trades.risk_percentage
  Added trades.risk_flag
  Added trades.created_at
  Created Default Account for existing trades: acc_default_xyz123
  Linked 150 existing trade(s) to Default Account
Step 1 migration complete.
```

**Verify Output:**
```
======================================================================
MIGRATION VERIFICATION - Step 1 Account Management
======================================================================
...
✅ Passed: 15
❌ Failed: 0

🎉 Migration Step 1 successfully applied!
```

**App Restart:**
```
Server running at http://localhost:3000
```

---

## ✅ Post-Flight Checklist

After migration:

- [ ] Migration ran without errors
- [ ] Verification passed
- [ ] App restarted successfully
- [ ] Dashboard loads without errors
- [ ] Existing trades still visible
- [ ] Can view trade details
- [ ] Statistics display correctly
- [ ] Backup file saved: `trades.db.backup`

---

## 🆘 Something Went Wrong?

### App Won't Start

```bash
# 1. Stop app
Ctrl+C

# 2. Check for locked database
lsof | grep trades.db

# 3. Kill any processes using it
kill -9 <PID>

# 4. Retry restart
npm start
```

### Migration Failed

```bash
# 1. Restore from backup
cp trades.db trades.db.broken
cp trades.db.backup trades.db

# 2. Try migration again
node migrations/run-001.js
```

### Verify Reports Errors

```bash
# See detailed error:
node migrations/verify-001.js

# Check database directly:
sqlite3 trades.db

# Then in sqlite3:
.tables              # Should show: accounts, balance_snapshots, trades
PRAGMA table_info(trades);  # Should show new columns
.quit
```

### Need to Rollback?

```bash
# Emergency rollback (deletes accounts table)
node migrations/rollback-001.js --force

# Or manually:
cp trades.db.backup trades.db

# Restart
npm start
```

---

## 📊 What Changed

### New Database Tables
- ✅ `accounts` - Stores trading accounts
- ✅ `balance_snapshots` - Tracks balance history

### Trades Table Updates
- ✅ `account_id` - Links trades to accounts
- ✅ `stop_loss_size` - Risk management field
- ✅ `risk_percentage` - Risk management field  
- ✅ `risk_flag` - Risk status field
- ✅ `created_at` - Timestamp field

### Data Safety
- ✅ All existing trades preserved
- ✅ Zero data loss
- ✅ Automatic "Default Account" created for existing trades
- ✅ All trades automatically assigned to account

---

## 📚 More Information

- **Detailed docs:** See `PHASE_1_DB_CHANGES.md`
- **Migration guide:** See `migrations/README.md`
- **Rollback procedure:** See `migrations/README.md#rolling-back-the-migration`
- **Troubleshooting:** See `migrations/README.md#troubleshooting`

---

## 🎯 After Migration

What's next?

1. ✅ Database schema complete (THIS STEP)
2. ⏭️  Phase 2: Backend API routes (upcoming)
3. ⏭️  Phase 3: Frontend account UI (upcoming)
4. ⏭️  Phase 4: Testing & refinement (upcoming)

Your trades are safe and ready for multi-account support!

---

## 📞 Quick Reference Commands

```bash
# Run migration
node migrations/run-001.js

# Verify migration
node migrations/verify-001.js

# Check migration status
node migrations/status.js

# Rollback (emergency)
node migrations/rollback-001.js --force

# Check database directly
sqlite3 trades.db
# Then: .tables
#      PRAGMA table_info(trades);
#      .quit

# Start app
npm start

# Backup/restore
cp trades.db trades.db.backup              # backup
cp trades.db.backup trades.db              # restore
```

---

**Status:** Ready to execute  
**Last updated:** 2026-06-20  
**Questions?** See full documentation in `PHASE_1_DB_CHANGES.md` or `migrations/README.md`
