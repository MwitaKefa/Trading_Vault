-- =============================================================================
-- TradeVault — Step 1: Account Management Schema
-- Database file: trades.db (project root, same as server.js)
--
-- Run options:
--   A) node migrations/run-001.js
--   B) sqlite3 trades.db < migrations/001_account_management.sql
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- NEW TABLE: accounts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  account_size  REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- NEW TABLE: balance_snapshots
-- When balance is edited: INSERT a new row (never UPDATE the latest in place).
--
-- Running balance formula (per account):
--   current_balance = latest_snapshot.snapshot_balance
--                   + SUM(trades.pnl)
--                     WHERE trades.account_id = :accountId
--                       AND trades.exitDate >= latest_snapshot.effective_date
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- EXISTING TABLE: trades — add prop-firm / account columns
-- Your current columns (unchanged): id, symbol, side, entryPrice, exitPrice,
-- quantity, fees, entryDate, exitDate, tags, notes, screenshot, pnl, pnlPercent, result
-- -----------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE trades ADD COLUMN stop_loss_size REAL;
ALTER TABLE trades ADD COLUMN risk_percentage REAL;
ALTER TABLE trades ADD COLUMN risk_flag TEXT;   -- 'ok' | 'violation' | 'conservative' (used in Step 2)
ALTER TABLE trades ADD COLUMN created_at TEXT DEFAULT (datetime('now'));

CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades (account_id);
CREATE INDEX IF NOT EXISTS idx_trades_account_exit_date ON trades (account_id, exitDate);
