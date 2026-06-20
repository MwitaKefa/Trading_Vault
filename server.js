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
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS trades (
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

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY
  )`);
});

// Utility to parse tags stored as JSON
function parseTags(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// API: trades
app.get('/api/trades', (req, res) => {
  db.all('SELECT * FROM trades ORDER BY exitDate DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({ ...r, tags: parseTags(r.tags) }));
    res.json(parsed);
  });
});

app.post('/api/trades', (req, res) => {
  const t = req.body;
  const stmt = db.prepare(`INSERT OR REPLACE INTO trades (id,symbol,side,entryPrice,exitPrice,quantity,fees,entryDate,exitDate,tags,notes,screenshot,pnl,pnlPercent,result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  stmt.run(
    t.id, t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0,
    t.entryDate, t.exitDate, JSON.stringify(t.tags || []), t.notes || '', t.screenshot || '', t.pnl || 0, t.pnlPercent || 0, t.result || '',
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: t.id });
    }
  );
});

app.put('/api/trades/:id', (req, res) => {
  const id = req.params.id;
  const t = req.body;
  const stmt = db.prepare(`UPDATE trades SET symbol=?,side=?,entryPrice=?,exitPrice=?,quantity=?,fees=?,entryDate=?,exitDate=?,tags=?,notes=?,screenshot=?,pnl=?,pnlPercent=?,result=? WHERE id=?`);
  stmt.run(t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0, t.entryDate, t.exitDate, JSON.stringify(t.tags || []), t.notes || '', t.screenshot || '', t.pnl || 0, t.pnlPercent || 0, t.result || '', id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
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

// Fallback: serve index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
