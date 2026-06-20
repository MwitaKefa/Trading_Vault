# ✅ PHASE 1 EXECUTION CHECKLIST

**Print this page and check off boxes as you go**

---

## 📋 PRE-FLIGHT CHECKS (Do Before Starting)

### Environment Setup
```
☐ Terminal open
☐ Located in project root: /path/to/Trading_Vault
☐ Node.js installed: node --version (should be v12+)
☐ npm installed: npm --version
☐ Can see migrations/ folder: ls migrations/
☐ Can see trades.db: ls trades.db
```

### Preparation
```
☐ Read MIGRATION_QUICKSTART.md
☐ Understand: Phase 1 = Database only (no code changes)
☐ Understand: Can rollback if needed
☐ Have backup strategy (cp command ready)
☐ Application currently running (optional, will stop it)
```

### File Verification
```
☐ migrations/001_account_management.sql exists
☐ migrations/run-001.js exists
☐ migrations/verify-001.js exists (newly created)
☐ migrations/rollback-001.js exists (newly created)
☐ migrations/status.js exists (newly created)
☐ trades.db exists (current database)
```

---

## 🚀 EXECUTION (Follow In Order)

### STEP 1: Stop Application (1 minute)

```
☐ If app is running, stop it:
  ☐ Ctrl+C in terminal, or
  ☐ pkill node
  ☐ Wait 2 seconds
  ☐ Verify stopped: ps aux | grep node (should show nothing)
```

### STEP 2: Create Backup (30 seconds)

```
☐ From project root, run:
  cp trades.db trades.db.backup

☐ Verify backup created:
  ls -lh trades.db*

☐ Output should show:
  -rw-r--r--  trades.db
  -rw-r--r--  trades.db.backup (same size)

☐ Note backup location: 
  /path/to/Trading_Vault/trades.db.backup
```

### STEP 3: Run Migration (1 minute)

```
☐ From project root, run:
  node migrations/run-001.js

☐ Watch output - should show:
  ☐ "Migrating: /path/to/trades.db"
  ☐ "Added trades.account_id"
  ☐ "Added trades.stop_loss_size"
  ☐ "Added trades.risk_percentage"
  ☐ "Added trades.risk_flag"
  ☐ "Added trades.created_at"
  ☐ "Created Default Account for existing trades: acc_default_..."
  ☐ "Linked N existing trade(s) to Default Account"
  ☐ "Step 1 migration complete."

☐ Exit code is 0 (success):
  echo $?  (should output: 0)
```

**⚠️ If Migration Failed:**
```
☐ See error message
☐ Check PHASE_1_DB_CHANGES.md §8 Troubleshooting
☐ If serious: cp trades.db.backup trades.db
☐ Try again or contact support
```

### STEP 4: Verify Migration (1 minute)

```
☐ From project root, run:
  node migrations/verify-001.js

☐ Watch output - should show:
  ☐ "✅ accounts table exists"
  ☐ "✅ balance_snapshots table exists"
  ☐ "✅ trades.account_id"
  ☐ "✅ trades.stop_loss_size"
  ☐ "✅ trades.risk_percentage"
  ☐ "✅ trades.risk_flag"
  ☐ "✅ trades.created_at"
  ☐ "✅ idx_trades_account_id"
  ☐ "✅ idx_trades_account_exit_date"
  ☐ "✅ idx_balance_snapshots_account_date"
  ☐ "✅ Accounts: 1"
  ☐ "✅ No orphan trades"
  ☐ "✅ All foreign key constraints are valid"
  ☐ "🎉 Migration Step 1 successfully applied!"

☐ Exit code is 0:
  echo $?  (should output: 0)
```

**⚠️ If Verification Failed:**
```
☐ Check error messages carefully
☐ See PHASE_1_DB_CHANGES.md §8 for specific errors
☐ Option A: Rollback and retry
  node migrations/rollback-001.js --force
  cp trades.db.backup trades.db
  node migrations/run-001.js
☐ Option B: Contact support with error message
```

### STEP 5: Restart Application (1 minute)

```
☐ From project root, run:
  npm start
  (or: node server.js)

☐ Watch for output:
  ☐ "Server running at http://localhost:3000"
  ☐ No error messages
  ☐ Database initialization messages (if any)

☐ Wait 3 seconds for full startup

☐ Verify app is running:
  curl http://localhost:3000

☐ Should see HTML response (index.html content)
```

**⚠️ If App Won't Start:**
```
☐ Check error messages in terminal
☐ See PHASE_1_DB_CHANGES.md §8 for solutions
☐ Most common: "database is locked"
  ☐ Kill Node processes: pkill node
  ☐ Wait 2 seconds
  ☐ Try npm start again
☐ If still failing: Rollback (see STEP 6)
```

---

## ✅ VERIFICATION TESTS (Do After Restart)

### Browser Test (1 minute)

```
☐ Open browser: http://localhost:3000

☐ Dashboard should load:
  ☐ Page displays without errors
  ☐ See stats cards (Total Trades, Win Rate, etc.)
  ☐ See charts (equity chart, win/loss pie)
  ☐ See recent trades list

☐ Navigation works:
  ☐ Click Dashboard - loads
  ☐ Click Journal - loads
  ☐ Click Analytics - loads
  ☐ Click Calendar - loads
  ☐ Click Settings - loads
  ☐ No error messages in browser console

☐ Trades visible:
  ☐ If you had trades before, they're still there
  ☐ Trade count matches before migration
  ☐ Trade details unchanged
```

### API Test (Optional, 1 minute)

```
☐ Open new terminal, from project root:

☐ Test GET /api/trades:
  curl http://localhost:3000/api/trades
  ☐ Returns JSON array
  ☐ All trades present (same count as before)
  ☐ Each trade has account_id field (should be 'acc_default_...')

☐ Test GET /api/accounts:
  curl http://localhost:3000/api/accounts
  ☐ Returns error (Phase 2 feature, not yet implemented)
  ☐ This is EXPECTED - don't worry

☐ All tests passed ✅
```

### Database Test (Optional, 1 minute)

```
☐ Open terminal, from project root:

☐ Connect to database:
  sqlite3 trades.db

☐ In sqlite3 shell, run:

  ☐ .tables
    Should show: accounts balance_snapshots tags trades

  ☐ SELECT COUNT(*) FROM accounts;
    Should return: 1

  ☐ SELECT COUNT(*) FROM balance_snapshots;
    Should return: 1

  ☐ SELECT COUNT(*) FROM trades;
    Should return: N (same as before)

  ☐ SELECT COUNT(*) FROM trades WHERE account_id IS NULL;
    Should return: 0 (no orphans)

  ☐ PRAGMA table_info(trades);
    Should show: account_id, stop_loss_size, risk_percentage, risk_flag, created_at in columns

  ☐ .quit
    Exit sqlite3

☐ All tests passed ✅
```

---

## 📊 POST-FLIGHT CHECKLIST (Do After Verification)

### Documentation
```
☐ Save backup location: /path/to/Trading_Vault/trades.db.backup
☐ Backup is safe - keep indefinitely
☐ Document: Phase 1 completed on [DATE] at [TIME]
```

### Cleanup
```
☐ No orphaned .db files remaining
☐ Terminal sessions closed
☐ App still running and functional
```

### Next Steps
```
☐ Phase 1 (Database) ✅ COMPLETE
☐ Next: Phase 2 (Backend API routes) - await approval
☐ Then: Phase 3 (Frontend account UI)
☐ Finally: Phase 4 (Testing & refinement)
```

---

## 🆘 ROLLBACK PROCEDURE (If Needed)

**Use this ONLY if something goes wrong**

### Quick Rollback

```
☐ Stop app: Ctrl+C

☐ Option A - Automatic Rollback:
  node migrations/rollback-001.js --force

☐ Option B - Manual Rollback:
  cp trades.db trades.db.failed
  cp trades.db.backup trades.db

☐ Restart app:
  npm start

☐ Verify:
  ☐ App starts
  ☐ Trades still visible
  ☐ Everything works like before

☐ Status: Database back to pre-migration state ✅
```

### After Rollback

```
☐ You can safely restart migration
☐ Check PHASE_1_DB_CHANGES.md §8 for specific errors
☐ Address root cause
☐ Try migration again
☐ Or contact support
```

---

## 📝 DOCUMENTATION REFERENCE

Keep these links handy:

| Need | Go To |
|------|-------|
| Quick help | `MIGRATION_QUICKSTART.md` |
| Full details | `PHASE_1_DB_CHANGES.md` |
| Errors | `PHASE_1_DB_CHANGES.md` §8 |
| Migration guide | `migrations/README.md` |
| This checklist | `PHASE_1_EXECUTION_CHECKLIST.md` |

---

## 💾 IMPORTANT LOCATIONS

```
Database file:
  /path/to/Trading_Vault/trades.db

Backup file:
  /path/to/Trading_Vault/trades.db.backup

Migration scripts:
  /path/to/Trading_Vault/migrations/
    ├── run-001.js
    ├── verify-001.js
    ├── rollback-001.js
    └── status.js

Documentation:
  /path/to/Trading_Vault/
    ├── MIGRATION_QUICKSTART.md
    ├── PHASE_1_DB_CHANGES.md
    ├── PHASE_1_COMPLETION_SUMMARY.md
    ├── PHASE_1_FILE_REFERENCE.md
    └── PHASE_1_EXECUTION_CHECKLIST.md (this file)
```

---

## ✨ SUCCESS CRITERIA

You have successfully completed Phase 1 when:

```
✅ Migration ran without errors: "Step 1 migration complete"
✅ Verification passed: "Migration Step 1 successfully applied"
✅ Application restarted successfully
✅ Dashboard loads in browser
✅ All trades visible
✅ Charts and stats display
✅ No error messages
✅ Backup file saved
```

---

## 🎉 YOU'RE DONE!

When all checkboxes above are ✅, you have successfully implemented Phase 1.

**Status:** Phase 1 Database Schema Changes ✅ COMPLETE

**Next Phase:** Awaiting approval to proceed with Phase 2 (Backend API Routes)

---

## 📞 EMERGENCY CONTACTS

If you get stuck:

1. Check the error message
2. Search `PHASE_1_DB_CHANGES.md` §8 Troubleshooting
3. See `MIGRATION_QUICKSTART.md` 🆘 Section
4. Consult `migrations/README.md` #Troubleshooting

---

**Print Date:** ________________  
**Migration Date:** ________________  
**Completed By:** ________________  
**Notes:** ________________________________________________  

---

**Good luck! 🚀**
