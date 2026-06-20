const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname);
const dbFile = path.join(__dirname, 'trades.db');

app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(publicDir));

// Initialize SQLite DB
const db = new sqlite3.Database(dbFile);

// Promise helpers
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Idempotent schema initialization — safe to run on existing databases.
async function initSchema() {
  await runAsync('PRAGMA foreign_keys = ON');

  await runAsync(`CREATE TABLE IF NOT EXISTS trades (
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

  await runAsync(`CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    account_size  REAL NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS balance_snapshots (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL,
    snapshot_balance  REAL NOT NULL,
    effective_date    TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date
    ON balance_snapshots (account_id, effective_date DESC)`);

  // Add prop-firm / account columns to the existing trades table if missing.
  const tradeColumns = (await allAsync('PRAGMA table_info(trades)')).map(r => r.name);
  const tradeAlters = [
    ['account_id', 'TEXT'],
    ['stop_loss_size', 'REAL'],
    ['risk_percentage', 'REAL'],
    ['risk_flag', 'TEXT'],
    ['created_at', "TEXT DEFAULT (datetime('now'))"],
  ];
  for (const [col, type] of tradeAlters) {
    if (!tradeColumns.includes(col)) {
      await runAsync(`ALTER TABLE trades ADD COLUMN ${col} ${type}`);
    }
  }
  await runAsync('CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades (account_id)');
  await runAsync('CREATE INDEX IF NOT EXISTS idx_trades_account_exit_date ON trades (account_id, exitDate)');
}

const schemaReady = initSchema().catch(err => {
  console.error('Schema initialization failed:', err.message);
});

// Utility to parse tags stored as JSON
function parseTags(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Latest balance snapshot for an account (by effective_date, tie-broken by created_at).
function getLatestSnapshot(accountId) {
  return getAsync(
    `SELECT * FROM balance_snapshots WHERE account_id = ?
     ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
    [accountId]
  );
}

// Running balance = latest snapshot balance + SUM(pnl of trades after the snapshot date).
async function getRunningBalance(accountId) {
  const snap = await getLatestSnapshot(accountId);
  if (!snap) {
    const acc = await getAsync('SELECT account_size FROM accounts WHERE id = ?', [accountId]);
    return acc ? acc.account_size : 0;
  }
  const row = await getAsync(
    `SELECT COALESCE(SUM(pnl), 0) AS total FROM trades
     WHERE account_id = ? AND exitDate >= ?`,
    [accountId, snap.effective_date]
  );
  return snap.snapshot_balance + (row ? row.total : 0);
}

// Risk classification from a stop-loss size against the running balance.
function computeRisk(runningBalance, stopLossSize) {
  if (!stopLossSize || !runningBalance || runningBalance <= 0) {
    return { riskPercentage: null, riskFlag: null };
  }
  const riskPercentage = (stopLossSize / runningBalance) * 100;
  let riskFlag = 'ok';
  if (riskPercentage > 1.0) riskFlag = 'violation';
  else if (riskPercentage < 0.2) riskFlag = 'conservative';
  return { riskPercentage: Math.round(riskPercentage * 10000) / 10000, riskFlag };
}

// API: trades
app.get('/api/trades', (req, res) => {
  db.all('SELECT * FROM trades ORDER BY exitDate DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({ ...r, tags: parseTags(r.tags) }));
    res.json(parsed);
  });
});

// Resolve the account id / stop-loss / risk fields for a trade payload.
async function resolveTradeRisk(t) {
  const accountId = t.accountId || t.account_id || null;
  const stopLossSize = (t.stopLossSize != null ? t.stopLossSize : t.stop_loss_size);
  const sls = (stopLossSize === '' || stopLossSize == null) ? null : Number(stopLossSize);
  let riskPercentage = null;
  let riskFlag = null;
  if (accountId && sls != null && !Number.isNaN(sls)) {
    const runningBalance = await getRunningBalance(accountId);
    ({ riskPercentage, riskFlag } = computeRisk(runningBalance, sls));
  }
  return { accountId, stopLossSize: sls, riskPercentage, riskFlag };
}

app.post('/api/trades', async (req, res) => {
  try {
    const t = req.body;
    const { accountId, stopLossSize, riskPercentage, riskFlag } = await resolveTradeRisk(t);
    await runAsync(
      `INSERT OR REPLACE INTO trades
       (id,symbol,side,entryPrice,exitPrice,quantity,fees,entryDate,exitDate,tags,notes,screenshot,pnl,pnlPercent,result,account_id,stop_loss_size,risk_percentage,risk_flag)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0,
       t.entryDate, t.exitDate, JSON.stringify(t.tags || []), t.notes || '', t.screenshot || '',
       t.pnl || 0, t.pnlPercent || 0, t.result || '', accountId, stopLossSize, riskPercentage, riskFlag]
    );
    res.json({ success: true, id: t.id, accountId, stopLossSize, riskPercentage, riskFlag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trades/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const t = req.body;
    const { accountId, stopLossSize, riskPercentage, riskFlag } = await resolveTradeRisk(t);
    await runAsync(
      `UPDATE trades SET symbol=?,side=?,entryPrice=?,exitPrice=?,quantity=?,fees=?,entryDate=?,exitDate=?,tags=?,notes=?,screenshot=?,pnl=?,pnlPercent=?,result=?,account_id=?,stop_loss_size=?,risk_percentage=?,risk_flag=? WHERE id=?`,
      [t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0, t.entryDate, t.exitDate,
       JSON.stringify(t.tags || []), t.notes || '', t.screenshot || '', t.pnl || 0, t.pnlPercent || 0, t.result || '',
       accountId, stopLossSize, riskPercentage, riskFlag, id]
    );
    res.json({ success: true, accountId, stopLossSize, riskPercentage, riskFlag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trades', (req, res) => {
  db.run('DELETE FROM trades', function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

app.delete('/api/trades/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM trades WHERE id = ?', id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Bulk import
app.post('/api/trades/bulk', (req, res) => {
  const trades = req.body;
  if (!Array.isArray(trades)) return res.status(400).json({ error: 'Expected array' });
  const insert = db.prepare(`INSERT OR REPLACE INTO trades (id,symbol,side,entryPrice,exitPrice,quantity,fees,entryDate,exitDate,tags,notes,screenshot,pnl,pnlPercent,result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    trades.forEach(t => insert.run(t.id, t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0, t.entryDate, t.exitDate, JSON.stringify(t.tags || []), t.notes || '', t.screenshot || '', t.pnl || 0, t.pnlPercent || 0, t.result || ''));
    db.run('COMMIT', err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, imported: trades.length });
    });
  });
});

// Tags
app.get('/api/tags', (req, res) => {
  db.all('SELECT name FROM tags ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.name));
  });
});

app.post('/api/tags', (req, res) => {
  const name = req.body.name;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/tags/:name', (req, res) => {
  const name = req.params.name;
  db.run('DELETE FROM tags WHERE name = ?', name, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Stats: daily PnL and trade count for a given month/year
app.get('/api/stats/daily', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = typeof req.query.month !== 'undefined' ? parseInt(req.query.month) : new Date().getMonth();
  // month is 0-based
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 1).toISOString();
  db.all(`SELECT exitDate, pnl FROM trades WHERE exitDate >= ? AND exitDate < ?`, [start, end], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const byDay = {};
    rows.forEach(r => {
      const d = new Date(r.exitDate);
      const key = d.getDate();
      byDay[key] = byDay[key] || { date: key, pnl: 0, count: 0 };
      byDay[key].pnl += r.pnl || 0;
      byDay[key].count += 1;
    });
    const result = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) result.push(byDay[d] || { date: d, pnl: 0, count: 0 });
    res.json(result);
  });
});

// Stats: weekly PnL for a given month/year (weeks starting on Sunday)
app.get('/api/stats/weekly', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = typeof req.query.month !== 'undefined' ? parseInt(req.query.month) : new Date().getMonth();
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 1).toISOString();
  db.all(`SELECT exitDate, pnl FROM trades WHERE exitDate >= ? AND exitDate < ?`, [start, end], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const weeks = {};
    rows.forEach(r => {
      const d = new Date(r.exitDate);
      const week = Math.floor((d.getDate() + new Date(year, month, 1).getDay() - 1) / 7) + 1;
      weeks[week] = weeks[week] || { week, pnl: 0, count: 0 };
      weeks[week].pnl += r.pnl || 0;
      weeks[week].count += 1;
    });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalWeeks = Math.ceil((daysInMonth + new Date(year, month, 1).getDay()) / 7);
    const result = [];
    for (let w = 1; w <= totalWeeks; w++) result.push(weeks[w] || { week: w, pnl: 0, count: 0 });
    res.json(result);
  });
});

// Stats: sessions (pre-market, market, post-market) winrate and counts
app.get('/api/stats/sessions', (req, res) => {
  db.all('SELECT pnl, entryDate, exitDate FROM trades', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const sessions = { premarket: { count: 0, wins: 0 }, market: { count: 0, wins: 0 }, postmarket: { count: 0, wins: 0 } };
    rows.forEach(r => {
      const d = new Date(r.entryDate || r.exitDate);
      const hour = d.getHours();
      let key = 'market';
      // Define sessions (local time): premarket <9:30, market 9:30-16:00, postmarket >16:00
      const minutes = d.getHours() * 60 + d.getMinutes();
      if (minutes < 9 * 60 + 30) key = 'premarket';
      else if (minutes >= 16 * 60) key = 'postmarket';
      sessions[key].count += 1;
      if ((r.pnl || 0) > 0) sessions[key].wins += 1;
    });
    const out = Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, { count: v.count, wins: v.wins, winrate: v.count ? (v.wins / v.count) * 100 : 0 }]));
    res.json(out);
  });
});

// ============ ACCOUNTS ============

// Build the summary view of an account (current running balance, total P&L, trade count).
async function buildAccountSummary(acc) {
  const currentBalance = await getRunningBalance(acc.id);
  const agg = await getAsync(
    'SELECT COALESCE(SUM(pnl),0) AS totalPnL, COUNT(*) AS tradeCount FROM trades WHERE account_id = ?',
    [acc.id]
  );
  return {
    id: acc.id,
    name: acc.name,
    accountSize: acc.account_size,
    currentBalance,
    totalPnL: agg ? agg.totalPnL : 0,
    tradeCount: agg ? agg.tradeCount : 0,
    createdAt: acc.created_at,
  };
}

// Create account + initial balance snapshot.
app.post('/api/accounts', async (req, res) => {
  try {
    const { name, accountSize, currentBalance } = req.body;
    if (!name || accountSize == null) {
      return res.status(400).json({ error: 'name and accountSize are required' });
    }
    const size = Number(accountSize);
    const balance = currentBalance != null ? Number(currentBalance) : size;
    const id = genId('acc');
    const now = new Date().toISOString();
    await runAsync(
      'INSERT INTO accounts (id, name, account_size, created_at) VALUES (?, ?, ?, ?)',
      [id, name, size, now]
    );
    await runAsync(
      'INSERT INTO balance_snapshots (id, account_id, snapshot_balance, effective_date, created_at) VALUES (?, ?, ?, ?, ?)',
      [genId('snap'), id, balance, now, now]
    );
    const acc = await getAsync('SELECT * FROM accounts WHERE id = ?', [id]);
    res.json(await buildAccountSummary(acc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List accounts with running balance, total P&L and trade count.
app.get('/api/accounts', async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM accounts ORDER BY created_at ASC');
    const out = [];
    for (const acc of rows) out.push(await buildAccountSummary(acc));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full account details including snapshot history.
app.get('/api/accounts/:id', async (req, res) => {
  try {
    const acc = await getAsync('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    const summary = await buildAccountSummary(acc);
    const snapshots = await allAsync(
      'SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY effective_date DESC, created_at DESC',
      [acc.id]
    );
    const latest = await getLatestSnapshot(acc.id);
    res.json({ ...summary, snapshots, latestSnapshot: latest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update account name and/or create a NEW balance snapshot (old snapshots are never edited).
app.put('/api/accounts/:id', async (req, res) => {
  try {
    const acc = await getAsync('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    const { name, currentBalance } = req.body;
    if (name != null && name !== '') {
      await runAsync('UPDATE accounts SET name = ? WHERE id = ?', [name, acc.id]);
    }
    if (currentBalance != null && currentBalance !== '') {
      const now = new Date().toISOString();
      await runAsync(
        'INSERT INTO balance_snapshots (id, account_id, snapshot_balance, effective_date, created_at) VALUES (?, ?, ?, ?, ?)',
        [genId('snap'), acc.id, Number(currentBalance), now, now]
      );
    }
    const updated = await getAsync('SELECT * FROM accounts WHERE id = ?', [acc.id]);
    res.json(await buildAccountSummary(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete account and its snapshots; detach its trades (account_id -> NULL).
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await runAsync('DELETE FROM balance_snapshots WHERE account_id = ?', [id]);
    await runAsync('UPDATE trades SET account_id = NULL WHERE account_id = ?', [id]);
    const r = await runAsync('DELETE FROM accounts WHERE id = ?', [id]);
    res.json({ success: true, deleted: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trades belonging to an account.
app.get('/api/accounts/:id/trades', async (req, res) => {
  try {
    const rows = await allAsync(
      'SELECT * FROM trades WHERE account_id = ? ORDER BY exitDate DESC',
      [req.params.id]
    );
    res.json(rows.map(r => ({ ...r, tags: parseTags(r.tags) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Account-scoped analytics: equity curve, daily P&L, and risk trend.
app.get('/api/accounts/:id/analytics', async (req, res) => {
  try {
    const acc = await getAsync('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    const snap = await getLatestSnapshot(acc.id);
    const baseBalance = snap ? snap.snapshot_balance : acc.account_size;
    const effectiveDate = snap ? snap.effective_date : null;

    const trades = await allAsync(
      'SELECT * FROM trades WHERE account_id = ? ORDER BY exitDate ASC, created_at ASC',
      [acc.id]
    );

    // Equity curve = running balance after each trade that follows the latest snapshot.
    const curveTrades = effectiveDate ? trades.filter(t => t.exitDate >= effectiveDate) : trades;
    const equityCurve = [];
    if (effectiveDate) {
      equityCurve.push({ x: effectiveDate, y: baseBalance, label: 'Snapshot' });
    }
    let running = baseBalance;
    curveTrades.forEach(t => {
      running += (t.pnl || 0);
      equityCurve.push({ x: t.exitDate, y: running, symbol: t.symbol });
    });

    // Daily P&L across all account trades.
    const byDay = {};
    trades.forEach(t => {
      const day = (t.exitDate || '').slice(0, 10);
      if (!day) return;
      byDay[day] = (byDay[day] || 0) + (t.pnl || 0);
    });
    const dailyPnL = Object.entries(byDay)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, pnl]) => ({ date, pnl }));

    // Risk trend ordered by trade sequence.
    const riskTrend = trades
      .filter(t => t.risk_percentage != null)
      .map((t, i) => ({ tradeNumber: i + 1, risk: t.risk_percentage, symbol: t.symbol }));

    res.json({
      accountSize: acc.account_size,
      currentBalance: running,
      equityCurve,
      dailyPnL,
      riskTrend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback: serve index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
