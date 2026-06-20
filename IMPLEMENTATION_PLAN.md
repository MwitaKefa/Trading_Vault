# Trading Vault - Multi-Account Management Implementation Plan

**Status:** Pre-implementation Analysis  
**Date:** 2026-06-20  
**Scope:** Add account selection, management, and isolation across the application

---

## 1. CURRENT ARCHITECTURE

### 1.1 Technology Stack
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Backend**: Node.js + Express.js
- **Database**: SQLite3 with raw SQL queries (no ORM)
- **UI**: Tailwind CSS + Lucide Icons + Chart.js
- **Storage Pattern**: Dual-layer (localStorage + HTTP API sync)

### 1.2 Application Flow
```
User Action (Frontend)
  ↓
localStorage (optimistic)
  ↓
HTTP API Call to Backend
  ↓
SQLite Database Update
  ↓
Response to Frontend
  ↓
UI Refresh from State
```

### 1.3 Current Pages/Features
| Page | Purpose | Key Components |
|------|---------|-----------------|
| Dashboard | Overview stats & recent trades | Stats cards, equity chart, win/loss doughnut |
| Journal | Filter & search trades | Search, side/result/tag filters, sort |
| Analytics | Deep analysis | Symbol PnL, tag PnL, daily PnL, duration scatter, streaks |
| Calendar | Monthly view | Grid layout, day trades modal |
| Settings | Configuration | Tag management |

### 1.4 Current Navigation Model
- **Single Global State**: All trades in one namespace
- **All Charts/Stats**: Computed from `getTrades()` (no filtering by account yet)
- **No User Concept**: No authentication, no session management

---

## 2. CURRENT DATABASE SCHEMA

### 2.1 Existing Tables (Before Migration)

```sql
trades (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  side TEXT,
  entryPrice REAL,
  exitPrice REAL,
  quantity REAL,
  fees REAL,
  entryDate TEXT,
  exitDate TEXT,
  tags TEXT (JSON array),
  notes TEXT,
  screenshot TEXT,
  pnl REAL,
  pnlPercent REAL,
  result TEXT
)

tags (
  name TEXT PRIMARY KEY
)
```

### 2.2 Migration 001 - Already Designed (Not Yet Run)

**New Tables:**
```sql
accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_size REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)

balance_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT FK → accounts(id),
  snapshot_balance REAL NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)
-- Index: (account_id, effective_date DESC)
```

**Trades Table Alterations:**
```sql
ALTER TABLE trades ADD COLUMN account_id TEXT FK → accounts(id)
ALTER TABLE trades ADD COLUMN stop_loss_size REAL
ALTER TABLE trades ADD COLUMN risk_percentage REAL
ALTER TABLE trades ADD COLUMN risk_flag TEXT
ALTER TABLE trades ADD COLUMN created_at TEXT
-- Indexes: idx_trades_account_id, idx_trades_account_exit_date
```

### 2.3 Important Design Detail: Running Balance

**Formula** (per account):
```
current_balance = latest_snapshot.snapshot_balance
                + SUM(trades.pnl)
                  WHERE account_id = :id
                  AND exitDate >= latest_snapshot.effective_date
```

This means:
- Balance snapshots act as bookmarks/checkpoints
- Only trades AFTER the snapshot affect the running balance
- When user edits account balance, create NEW snapshot (never update in place)

**Implication for Frontend:**
- Cannot simply show `account.account_size`
- Must query: snapshot + recent trades PnL
- Supports audit trail of balance corrections

---

## 3. EXISTING TRADE WORKFLOW

### 3.1 Trade Creation (Frontend)

**Frontend (`script.js`):**
1. `openTradeModal()` - Display form
2. User fills: symbol, side, entry/exit prices, qty, fees, dates, tags, notes
3. `updatePnlPreview()` - Live calculation: `pnl = (exit - entry) * qty - fees` (or reversed for short)
4. `saveTrade()` - On submit:
   - Generate `id` = `Date.now().toString(36) + Math.random().toString(36).substr(2,5)`
   - Calculate final PnL & PnL%
   - Determine result: 'win' | 'loss' | 'breakeven'
   - Update local `cachedTrades`
   - Save to `localStorage` via `saveTradesToLocal()`
   - **If server available**: POST/PUT to `/api/trades` (create or update)
5. `refreshPage()` - Regenerate all charts/stats

### 3.2 Trade Persistence (Backend)

**Server Routes:**
- `GET /api/trades` - Return all trades (no filtering)
- `POST /api/trades` - Insert new or replace existing (upsert)
- `PUT /api/trades/:id` - Update specific trade
- `DELETE /api/trades/:id` - Delete trade
- `DELETE /api/trades` - Delete all trades (dangerous!)
- `POST /api/trades/bulk` - Batch import

**Key Issue:**
- All routes assume global trade set
- No `account_id` parameter anywhere
- No authorization/access control

### 3.3 Trade Retrieval

**Frontend:**
- `getTrades()` returns `cachedTrades` (loaded from localStorage on init)
- `fetchTradesFromServer()` - GET /api/trades, cache locally
- `syncFromServer()` - Calls fetch trades + fetch tags

**Observation:**
- Frontend maintains its own cache
- Backend = source of truth
- All trades always loaded into memory (no pagination)

---

## 4. EXISTING CHART IMPLEMENTATION

### 4.1 Chart Library & Setup
- **Library**: Chart.js 4.4.0 (via CDN)
- **Container IDs** (in HTML):
  - `equityChart` - Cumulative P&L line chart
  - `winLossChart` - Doughnut (wins/losses/breakeven)
  - `symbolPnlChart` - Horizontal bar (top symbols)
  - `tagPnlChart` - Horizontal bar (tags)
  - `dailyPnlChart` - Bar chart by date
  - `weeklyPnlChart` - Bar chart by week (calls server `/api/stats/weekly`)
  - `durationChart` - Scatter plot (hours vs P&L)

### 4.2 Chart Rendering Functions
All in `script.js`:

| Function | Trigger | Logic |
|----------|---------|-------|
| `renderEquityChart()` | Dashboard load | Cumulative P&L over time (sorted by exitDate) |
| `renderWinLossChart()` | Dashboard load | Count wins/losses/breakeven |
| `renderSymbolPnlChart()` | Analytics page | Group trades by symbol, sum PnL, sort desc |
| `renderTagPnlChart()` | Analytics page | Group trades by tag (multi-tag trades counted multiple times), sort |
| `renderDailyPnlChart()` | Analytics page | Group by exitDate, sum PnL per day |
| `renderWeeklyPnlChart()` | Analytics page | Calls server `/api/stats/weekly` OR local fallback |
| `renderDurationChart()` | Analytics page | Scatter: X=hours between entry/exit, Y=P&L |
| `renderStreakAnalysis()` | Analytics page | Current/best win/worst loss/longest trade streaks |

### 4.3 Chart Destroy Pattern
```javascript
function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}
```
- Prevents memory leaks
- Called before re-rendering

### 4.4 Server-Based Analytics
**Endpoints that compute stats server-side:**
- `GET /api/stats/daily?year=YYYY&month=MM` → Daily PnL + count
- `GET /api/stats/weekly?year=YYYY&month=MM` → Weekly PnL + count
- `GET /api/stats/sessions` → Pre-market/market/post-market winrate

**Important:**
- These compute GLOBAL stats (not account-specific)
- Frontend has fallback local calculation if server unavailable
- Need to add `?accountId` parameter to each

---

## 5. FILES THAT MUST BE MODIFIED

### 5.1 Backend Changes

#### `server.js` (Major refactoring)

**Changes needed:**

1. **Add account management routes:**
   - `GET /api/accounts` - List all accounts
   - `POST /api/accounts` - Create new account
   - `PUT /api/accounts/:id` - Rename/update account
   - `DELETE /api/accounts/:id` - Delete account (cascade trades?)
   - `GET /api/accounts/:id/balance` - Get current balance (snapshot + recent trades)
   - `POST /api/accounts/:id/balance-snapshot` - Create new balance checkpoint

2. **Modify ALL trade routes to filter by account:**
   - `GET /api/trades?accountId=ID` (optional, default to current/first account?)
   - `POST /api/trades` - Require `accountId` in request body
   - `PUT /api/trades/:id` - Verify trade belongs to account before update
   - `DELETE /api/trades/:id` - Same verification
   - `DELETE /api/trades?accountId=ID` - Delete all trades for specific account
   - `POST /api/trades/bulk?accountId=ID` - Batch import to specific account

3. **Modify all stats endpoints:**
   - `GET /api/stats/daily?accountId=ID&year=Y&month=M` - Filter trades by account
   - `GET /api/stats/weekly?accountId=ID&year=Y&month=M` - Same
   - `GET /api/stats/sessions?accountId=ID` - Same

4. **Add account context middleware:**
   - Determine "current" account from query param or session (prepare for auth)
   - Add validation to ensure trades belong to requested account

**Estimated lines to modify:** 150+ lines

**Risk Level:** HIGH - all data routes affected

---

### 5.2 Frontend Changes

#### `script.js` (Major refactoring)

**Changes needed:**

1. **Add account management state:**
   ```javascript
   let currentAccount = null;  // { id, name, account_size, created_at }
   let cachedAccounts = [];
   ```

2. **Add account initialization:**
   - On app load: `fetchAccounts()` 
   - If no accounts exist: `createDefaultAccount()`
   - Set `currentAccount` to first account
   - Only then load trades for that account

3. **Update all data layer functions:**
   - `getTrades()` → `getTradesForAccount(accountId)`
   - `saveTrades()` → Add `accountId` parameter
   - `fetchTradesFromServer()` → Add `?accountId=` query param
   - `syncTradeToServer()` → Include `trade.account_id`
   - All delete operations → Pass `accountId`

4. **Add account switching UI:**
   - Account selector dropdown/button in header
   - `switchAccount(accountId)` - Change current account, refresh all
   - `createAccount()` modal
   - `deleteAccount()` with confirmation

5. **Update all chart functions:**
   - Each chart function must filter trades: `trades.filter(t => t.account_id === currentAccount.id)`
   - Or pass `currentAccount.id` to server and let it filter

6. **Update all analytics/stats calls:**
   - Add `?accountId=` to all `/api/stats/*` calls

7. **Update calendar:**
   - Filter trades by account when grouping by day

8. **Update settings:**
   - Tags might need account-specific handling (design decision pending)
   - Add account management UI

**Estimated lines to modify:** 300+ lines

**Risk Level:** VERY HIGH - touches every data operation

---

#### `index.html` (UI additions)

**Changes needed:**

1. **Add account selector to header:**
   - Dropdown or button showing current account name
   - Click to show account list
   - Add button to create new account

2. **Add account management modal:**
   - Create account form (name, initial balance)
   - Rename account
   - Delete account (with confirmation)
   - View balance history (optional for Step 1)

3. **Optional: Account switcher UI in sidebar**
   - Show current account prominently
   - Quick switch dropdown

**Estimated lines to add:** 50-100 lines

**Risk Level:** MEDIUM - UI-only, no logic impact

---

### 5.3 Migration Runner Updates

#### `migrations/run-001.js` (Already good!)

**What's already there:**
- Creates accounts table
- Creates balance_snapshots table
- Alters trades table with new columns
- Handles orphan trades → creates "Default Account"

**What to verify:**
- Check if default account creation logic works
- Ensure indexes are created
- Test migration idempotency (safe to run twice)

**Estimated changes:** 0-10 lines (minor tweaks only)

---

## 6. FILES THAT MUST BE CREATED

### 6.1 Account Management Module (Frontend)

**Option A: Keep in script.js**
- Pros: Single file, simpler
- Cons: script.js already 1000+ lines, harder to maintain

**Option B: New file `accounts.js`**
- Pros: Separation of concerns
- Cons: Another HTTP request, need to manage load order

**Recommendation: Option A** (Keep in script.js for Phase 1)

### 6.2 Optional: Account Middleware/Utilities (Backend)

Could create `lib/accountHelper.js`:
```javascript
function getAccountIdFromRequest(req) { ... }
function verifyTradeOwnership(tradeId, accountId) { ... }
function attachAccountFilter(req) { ... }
```

**Recommendation: Skip for Phase 1** (inline in server.js is okay for now)

### 6.3 Optional: Database Helper (Backend)

Could create `lib/db.js` for query helpers:
```javascript
function getTradesTotalPnL(accountId) { ... }
function getBalance(accountId) { ... }
```

**Recommendation: Skip for Phase 1**

---

## 7. MIGRATION RISKS

### 7.1 Data Consistency

**Risk:** What if migration runs but trades are not assigned to an account?

**Mitigation (already in run-001.js):**
- Check for orphan trades (no account_id)
- Create "Default Account" if needed
- Link all orphans to it
- Logged output shows what was done

**Status:** ✅ Already handled

### 7.2 Backward Compatibility

**Risk:** Frontend expects old API routes without accountId

**Mitigation:**
- Make accountId optional initially
- If not provided, use current account or first account
- Plan deprecation path
- Document in code

**Action:** Add defensive coding in server.js

### 7.3 UI/UX Confusion

**Risk:** User doesn't know which account they're viewing

**Mitigation:**
- Prominently show current account name in header
- Highlight in sidebar
- Use visual indicator (color, badge)
- Toast notification when switching

**Action:** Design account selector carefully

### 7.4 Existing User Data

**Risk:** User might have trades with no account after migration

**Mitigation:** ✅ Handled by run-001.js default account creation

### 7.5 Performance

**Risk:** Querying all trades from DB could be slow if many accounts

**Current state:** No pagination (all trades loaded)

**Mitigation for Phase 1:**
- Add account filtering immediately (WHERE account_id = ?)
- Will reduce result set size
- Keep pagination out of scope

**Action:** Plan pagination for Phase 2

### 7.6 Balance Snapshot Integrity

**Risk:** User manually edits snapshot, breaks audit trail

**Mitigation:**
- Snapshots are append-only (never DELETE/UPDATE)
- New snapshot creation creates new row
- Display history (optional)

**Action:** Educate user on this model

---

## 8. ROUTE CONFLICTS & Design Decisions

### 8.1 No Route Conflicts Expected

Current routes don't overlap:
- `/api/trades` - List/create (no account specified yet)
- `/api/trades/:id` - Single trade ops (can add accountId check)
- `/api/tags` - Global (shared across accounts? TBD)
- `/api/stats/*` - Global (add accountId param)

**Decision Needed:**

| Feature | Design |
|---------|--------|
| Tags | Global or per-account? |
| Balance snapshots | Only account-specific |
| Trade history | Account-specific |
| Screenshots | Account-specific (stored with trade) |

**Recommendation for Phase 1:**
- **Tags:** Global (shared across accounts)
  - Simpler implementation
  - Logical for trader using same tags across accounts
  - Can be per-account in Phase 2
  
- **Balance:** Account-specific (already designed)

- **Trades:** Account-specific (core requirement)

### 8.2 Query Parameter vs. Request Body

**For filtering by account:**

Option A: Query parameter (recommended)
```
GET /api/trades?accountId=acc_123
POST /api/trades (body has accountId)
```

Option B: Session-based (requires authentication)
```
GET /api/trades (req.user.accountId from session)
```

**Recommendation:** Option A for Phase 1
- No auth needed yet
- Explicit in API
- Can migrate to session later

### 8.3 Default Account Handling

**Question:** When user does `GET /api/trades` without accountId param?

**Option A: Return first account's trades**
```javascript
if (!req.query.accountId) {
  const account = await db.get('SELECT id FROM accounts ORDER BY created_at LIMIT 1');
  req.query.accountId = account.id;
}
```

**Option B: Return error (require accountId)**
```javascript
if (!req.query.accountId) {
  return res.status(400).json({ error: 'accountId required' });
}
```

**Recommendation:** Option A
- Better UX (routes don't break)
- Backward compatible
- Frontend can still work without changes initially

---

## 9. BEST WAY TO IMPLEMENT WITHOUT REWRITING

### 9.1 Phased Approach (Recommended)

**Phase 1: Account Scaffold (This Step)**
- Create accounts table & migration
- Add basic account CRUD routes
- Add account selector to UI (dropdown)
- Switch data layer to filter by current account
- All trades → auto-assign to current account
- ✅ Goal: UI selects account, data is isolated

**Phase 2: Account Features**
- Balance snapshots UI (view history)
- Account statistics (per-account performance)
- Account export/import
- Tags per-account option

**Phase 3: Advanced**
- Multi-account dashboard (compare accounts)
- Account templates/presets
- Account archiving
- Multi-trader support (if needed)

### 9.2 Minimal Rewrite Strategy

**Key Principle:** Use existing patterns, don't rewrite

#### For Backend:
1. **Add accounts middleware** (10 lines) - set req.accountId
2. **Add WHERE clauses** - Add `AND account_id = ?` to existing queries (minimal change)
3. **Add account routes** - 5-6 new endpoint handlers
4. **Keep everything else** - No need to refactor existing logic

#### For Frontend:
1. **Add state** - `currentAccount` variable
2. **Add init function** - Load accounts on app start
3. **Modify data calls** - Add `?accountId=` to existing fetch calls (1-2 line per call)
4. **Add UI** - Account selector dropdown (50 lines new HTML/CSS)
5. **Don't rewrite charts** - They work on `getTrades()`, just update that function

#### For Database:
1. **Run migration** - Already designed
2. **Verify orphan handling** - Check default account was created
3. **No data loss** - Migration handles it all

### 9.3 Implementation Order

**Step 1: Database**
- Run migration: `node migrations/run-001.js`
- Verify: Check `accounts` table created, trades have `account_id`

**Step 2: Backend**
- Add account routes to `server.js`
- Add account filter to trade routes
- Test with curl/Postman

**Step 3: Frontend Data Layer**
- Add `currentAccount` state
- Add `fetchAccounts()` function
- Modify `getTrades()` to use `currentAccount.id`
- Test in browser console

**Step 4: Frontend UI**
- Add account selector to header
- Add create/delete account buttons
- Add account modal
- Test UX flow

**Step 5: Testing**
- Create multiple accounts
- Switch between them
- Verify data isolation
- Test trade operations in each account

---

## 10. SUMMARY OF CHANGES

### Files to Modify:
1. ✏️ `server.js` - Add account routes, filter all trades
2. ✏️ `script.js` - Add account state, modify data layer
3. ✏️ `index.html` - Add account selector UI

### Files to Create:
- None (Phase 1 - keep all in existing files)

### Files to Run:
- `migrations/run-001.js` - Schema update

### Database Changes:
- Migration 001 - Creates `accounts`, `balance_snapshots`, alters `trades`

### Risk Level: **MEDIUM-HIGH**
- Data integrity: LOW (migration handles)
- Route compatibility: MEDIUM (adding accountId everywhere)
- UI/UX: LOW (new feature, doesn't break existing)
- Overall complexity: HIGH (touches many areas)

### Effort Estimate:
- Backend: 2-3 hours
- Frontend: 3-4 hours  
- Testing: 1-2 hours
- Total: 6-9 hours for Phase 1

### Success Criteria:
1. ✅ Users can create multiple accounts
2. ✅ Users can switch between accounts
3. ✅ Trades in Account A don't appear in Account B
4. ✅ Stats/charts update when switching accounts
5. ✅ All existing functionality works per-account
6. ✅ No data loss or corruption

---

## 11. DETAILED IMPLEMENTATION CHECKLIST

### Backend Implementation

- [ ] Add account management routes to `server.js`
  - [ ] `GET /api/accounts` - List all accounts
  - [ ] `POST /api/accounts` - Create account (name, account_size)
  - [ ] `PUT /api/accounts/:id` - Update account
  - [ ] `DELETE /api/accounts/:id` - Delete account
  - [ ] `GET /api/accounts/:id/balance` - Current balance

- [ ] Modify trade routes
  - [ ] `GET /api/trades?accountId=...` - Filter by account
  - [ ] `POST /api/trades` - Accept accountId in body
  - [ ] `PUT /api/trades/:id` - Verify ownership
  - [ ] `DELETE /api/trades/:id` - Verify ownership
  - [ ] `POST /api/trades/bulk` - Filter by accountId

- [ ] Modify stats routes
  - [ ] `GET /api/stats/daily?accountId=...` - Filter
  - [ ] `GET /api/stats/weekly?accountId=...` - Filter
  - [ ] `GET /api/stats/sessions?accountId=...` - Filter

- [ ] Test all routes with curl/Postman

### Frontend Implementation

- [ ] Add account state to `script.js`
  - [ ] `currentAccount` variable
  - [ ] `cachedAccounts` array
  - [ ] `accountInitialized` flag

- [ ] Add account functions
  - [ ] `fetchAccounts()` - GET /api/accounts
  - [ ] `createAccount(name, size)` - POST /api/accounts
  - [ ] `deleteAccount(id)` - DELETE /api/accounts/:id
  - [ ] `switchAccount(id)` - Set current, refresh UI
  - [ ] `initializeAccounts()` - On app load

- [ ] Modify data layer
  - [ ] `getTradesForAccount()` - Filter by currentAccount
  - [ ] Update `saveTrades()` to include accountId
  - [ ] Update `fetchTradesFromServer()` with accountId query
  - [ ] Update all sync functions

- [ ] Update all chart functions
  - [ ] Add account filtering where needed
  - [ ] Update server calls with accountId param

- [ ] Add UI elements to `index.html`
  - [ ] Account selector dropdown in header
  - [ ] Account creation button
  - [ ] Account deletion button
  - [ ] Account management modal

- [ ] Add account modal form
  - [ ] Create account form
  - [ ] Delete confirmation dialog
  - [ ] Rename account (optional)

- [ ] Test UX
  - [ ] Create account works
  - [ ] Switch account works
  - [ ] Data is isolated
  - [ ] Charts update
  - [ ] No data loss

### Migration & Testing

- [ ] Run migration
  - [ ] `node migrations/run-001.js`
  - [ ] Verify tables created
  - [ ] Verify default account created for orphans

- [ ] Browser testing
  - [ ] Load app, see account dropdown
  - [ ] Create new account
  - [ ] Create trade in Account 1
  - [ ] Switch to Account 2 (trade not visible)
  - [ ] Create trade in Account 2
  - [ ] Switch back to Account 1 (original trade visible)
  - [ ] Charts update per account

- [ ] Data validation
  - [ ] Verify trades have account_id in DB
  - [ ] Verify no data loss
  - [ ] Test with existing data

---

**End of Implementation Plan**
