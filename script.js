// ============ DATA LAYER ============
const STORAGE_KEY = 'tradevault_trades';
const TAGS_KEY = 'tradevault_tags';

const DEFAULT_TAGS = ['Scalp', 'Swing', 'Day Trade', 'Breakout', 'Reversal', 'Trend Follow', 'News', 'Earnings'];

let cachedTrades = [];
let cachedTags = [...DEFAULT_TAGS];

function getTradesFromLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveTradesToLocal(trades) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

function getTagsFromLocal() {
  try {
    const tags = JSON.parse(localStorage.getItem(TAGS_KEY));
    return tags || DEFAULT_TAGS;
  } catch { return DEFAULT_TAGS; }
}

function saveTagsToLocal(tags) {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}

function getTrades() {
  return cachedTrades;
}

function saveTrades(trades) {
  cachedTrades = trades;
  saveTradesToLocal(trades);
}

function getTags() {
  return cachedTags;
}

function saveTags(tags) {
  cachedTags = tags;
  saveTagsToLocal(tags);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// --- Server sync helpers ---
let serverAvailable = false;

async function checkServerAvailability() {
  try {
    const res = await fetch('/api/trades', { method: 'GET' });
    serverAvailable = res.ok;
    return serverAvailable;
  } catch (e) {
    serverAvailable = false;
    return false;
  }
}

async function fetchTradesFromServer() {
  const res = await fetch('/api/trades');
  if (!res.ok) throw new Error('Unable to fetch trades');
  const trades = await res.json();
  cachedTrades = trades;
  saveTradesToLocal(trades);
  return trades;
}

async function fetchTagsFromServer() {
  const res = await fetch('/api/tags');
  if (!res.ok) throw new Error('Unable to fetch tags');
  const tags = await res.json();
  cachedTags = tags;
  saveTagsToLocal(tags);
  return tags;
}

async function syncFromServer() {
  try {
    const [trades, tags] = await Promise.all([fetchTradesFromServer(), fetchTagsFromServer()]);
    await fetchAccounts();
    populateAccountSelectors();
    return trades && tags;
  } catch (e) {
    return false;
  }
}

async function syncTradeToServer(trade, isNew = true) {
  if (!serverAvailable) return;
  try {
    const url = isNew ? '/api/trades' : `/api/trades/${encodeURIComponent(trade.id)}`;
    const method = isNew ? 'POST' : 'PUT';
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
  } catch (e) {
    // ignore
  }
}

async function syncDeleteToServer(id) {
  if (!serverAvailable) return;
  try {
    await fetch(`/api/trades/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) { }
}

async function syncBulkToServer(trades) {
  if (!serverAvailable || trades.length === 0) return;
  try {
    await fetch('/api/trades/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trades) });
  } catch (e) { }
}

async function syncTagToServer(tag) {
  if (!serverAvailable) return;
  try {
    await fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tag }) });
  } catch (e) { }
}

function loadLocalData() {
  cachedTrades = getTradesFromLocal();
  cachedTags = getTagsFromLocal();
}

// ============ ACCOUNTS ============
const ACCOUNT_KEY = 'tradevault_account';
let cachedAccounts = [];
let currentAccountId = localStorage.getItem(ACCOUNT_KEY) || '';

async function fetchAccounts() {
  if (!serverAvailable) { cachedAccounts = []; return cachedAccounts; }
  try {
    const res = await fetch('/api/accounts');
    if (!res.ok) throw new Error('Unable to fetch accounts');
    cachedAccounts = await res.json();
  } catch (e) {
    cachedAccounts = [];
  }
  // Reset selection if the selected account no longer exists
  if (currentAccountId && !cachedAccounts.some(a => a.id === currentAccountId)) {
    currentAccountId = '';
    localStorage.setItem(ACCOUNT_KEY, '');
  }
  return cachedAccounts;
}

function getCurrentAccount() {
  return cachedAccounts.find(a => a.id === currentAccountId) || null;
}

function getAccountIdOf(trade) {
  return trade.account_id || trade.accountId || '';
}

// Trades filtered by the currently selected account (all trades when none selected).
function getScopedTrades() {
  const all = getTrades();
  if (!currentAccountId) return all;
  return all.filter(t => getAccountIdOf(t) === currentAccountId);
}

function accountOptionsHTML(includeAll, includeNone) {
  const opts = [];
  if (includeAll) opts.push('<option value="">All Accounts</option>');
  if (includeNone) opts.push('<option value="">No Account</option>');
  cachedAccounts.forEach(a => opts.push(`<option value="${a.id}">${escapeHtml(a.name)}</option>`));
  return opts.join('');
}

function populateAccountSelectors() {
  const sel = document.getElementById('accountSelector');
  if (sel) {
    sel.innerHTML = accountOptionsHTML(true, false);
    sel.value = currentAccountId;
  }
  const tradeSel = document.getElementById('tradeAccount');
  if (tradeSel) {
    const cur = tradeSel.value;
    tradeSel.innerHTML = accountOptionsHTML(false, true);
    tradeSel.value = cur;
  }
}

function onAccountSelectChange(value) {
  currentAccountId = value || '';
  localStorage.setItem(ACCOUNT_KEY, currentAccountId);
  refreshPage();
}

async function refreshAccounts() {
  await fetchAccounts();
  populateAccountSelectors();
  renderAccountsList();
}

function renderAccountsList() {
  const container = document.getElementById('accountsList');
  if (!container) return;
  if (!serverAvailable) {
    container.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">Account management requires the local server. Run <code>npm start</code> and reload.</p>';
    return;
  }
  if (cachedAccounts.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No accounts yet. Create one to get started!</p>';
    return;
  }
  container.innerHTML = cachedAccounts.map(a => {
    const pnlPct = a.accountSize ? (a.totalPnL / a.accountSize) * 100 : 0;
    const diff = a.currentBalance - a.accountSize;
    const diffClass = diff >= 0 ? 'text-profit' : 'text-loss';
    return `
      <div class="bg-surface-900/50 border border-white/5 rounded-2xl p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p class="text-base font-semibold text-white">${escapeHtml(a.name)}</p>
            <p class="text-xs text-slate-500 mt-0.5">Size $${a.accountSize.toLocaleString()} · ${a.tradeCount} trade${a.tradeCount === 1 ? '' : 's'}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="openEditAccount('${a.id}')" class="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-semibold text-white transition">Edit</button>
            <button onclick="deleteAccount('${a.id}')" class="px-3 py-1.5 bg-loss/10 hover:bg-loss/20 text-loss rounded-lg text-xs font-semibold transition">Delete</button>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 mt-4">
          <div>
            <p class="text-[11px] text-slate-500 uppercase tracking-wide">Running Balance</p>
            <p class="text-sm font-bold text-white mt-0.5">$${a.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-500 uppercase tracking-wide">Total P&L</p>
            <p class="text-sm font-bold ${a.totalPnL >= 0 ? 'text-profit' : 'text-loss'} mt-0.5">${formatCurrency(a.totalPnL)}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-500 uppercase tracking-wide">P&L %</p>
            <p class="text-sm font-bold ${diffClass} mt-0.5">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</p>
          </div>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons();
}

async function createAccount(e) {
  e.preventDefault();
  if (!serverAvailable) { showToast('Server required to manage accounts'); return; }
  const name = document.getElementById('accName').value.trim();
  const accountSize = parseFloat(document.getElementById('accSize').value);
  const currentBalance = parseFloat(document.getElementById('accBalance').value);
  if (!name || isNaN(accountSize)) { showToast('Name and account size are required'); return; }
  try {
    const res = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, accountSize, currentBalance: isNaN(currentBalance) ? accountSize : currentBalance })
    });
    if (!res.ok) throw new Error('fail');
    document.getElementById('accountForm').reset();
    showToast('Account created!');
    await refreshAccounts();
  } catch (e) {
    showToast('Failed to create account');
  }
}

function openEditAccount(id) {
  const a = cachedAccounts.find(x => x.id === id);
  if (!a) return;
  document.getElementById('editAccId').value = a.id;
  document.getElementById('editAccName').value = a.name;
  document.getElementById('editAccBalance').value = '';
  document.getElementById('editAccountModal').classList.remove('hidden');
  lucide.createIcons();
}

function closeEditAccount() {
  document.getElementById('editAccountModal').classList.add('hidden');
}

async function saveAccountEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editAccId').value;
  const name = document.getElementById('editAccName').value.trim();
  const balRaw = document.getElementById('editAccBalance').value;
  const body = { name };
  if (balRaw !== '') body.currentBalance = parseFloat(balRaw);
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('fail');
    closeEditAccount();
    showToast('Account updated!');
    await refreshAccounts();
    refreshPage();
  } catch (e) {
    showToast('Failed to update account');
  }
}

async function deleteAccount(id) {
  if (!confirm('Delete this account? Its balance snapshots will be removed and its trades will be detached.')) return;
  try {
    await fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentAccountId === id) {
      currentAccountId = '';
      localStorage.setItem(ACCOUNT_KEY, '');
    }
    showToast('Account deleted');
    await refreshAccounts();
    refreshPage();
  } catch (e) {
    showToast('Failed to delete account');
  }
}

// Dashboard summary card for the selected account.
function renderAccountSummary() {
  const card = document.getElementById('accountSummaryCard');
  if (!card) return;
  const a = getCurrentAccount();
  if (!a) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  document.getElementById('summaryAccountName').textContent = a.name;
  document.getElementById('summaryAccountSize').textContent = '$' + a.accountSize.toLocaleString();
  document.getElementById('summaryRunningBalance').textContent =
    '$' + a.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diff = a.currentBalance - a.accountSize;
  const pct = a.accountSize ? (diff / a.accountSize) * 100 : 0;
  const el = document.getElementById('summaryDrawdown');
  const amount = Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (diff < 0) {
    el.className = 'px-4 py-2 rounded-xl text-sm font-semibold bg-loss/10 text-loss';
    el.textContent = `In Drawdown: -$${amount} (${pct.toFixed(2)}%)`;
  } else {
    el.className = 'px-4 py-2 rounded-xl text-sm font-semibold bg-profit/10 text-profit';
    el.textContent = `In Profit: +$${amount} (+${pct.toFixed(2)}%)`;
  }
}

// ============ NAVIGATION ============
let currentPage = 'dashboard';

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-nav="${page}"]`)?.classList.add('active');

  const titles = {
    dashboard: ['Dashboard', 'Overview of your trading performance'],
    journal: ['Journal', 'All your trades in one place'],
    analytics: ['Analytics', 'Deep dive into your trading patterns'],
    calendar: ['Calendar', 'View trades by date'],
    accounts: ['Accounts', 'Manage your prop firm accounts'],
    settings: ['Settings', 'Manage your data and preferences']
  };
  document.getElementById('pageTitle').textContent = titles[page][0];
  document.getElementById('pageSubtitle').textContent = titles[page][1];

  // Close mobile sidebar
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 1024) {
    sidebar.classList.add('-translate-x-full');
    document.getElementById('sidebarOverlay').classList.add('hidden');
  }

  refreshPage();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('-translate-x-full');
  overlay.classList.toggle('hidden');
}

// ============ TRADE MODAL ============
let selectedModalTags = [];

function openTradeModal(tradeId = null) {
  const modal = document.getElementById('tradeModal');
  modal.classList.remove('hidden');
  document.getElementById('modalTitle').textContent = tradeId ? 'Edit Trade' : 'New Trade';
  selectedModalTags = [];

  // Build tags
  renderModalTags();
  populateAccountSelectors();

  if (tradeId) {
    const trades = getTrades();
    const trade = trades.find(t => t.id === tradeId);
    if (trade) {
      document.getElementById('tradeId').value = trade.id;
      document.getElementById('tradeAccount').value = getAccountIdOf(trade);
      document.getElementById('tradeStopLoss').value = (trade.stop_loss_size != null ? trade.stop_loss_size : '');
      document.getElementById('tradeSymbol').value = trade.symbol;
      document.getElementById('tradeSide').value = trade.side;
      document.getElementById('tradeEntry').value = trade.entryPrice;
      document.getElementById('tradeExit').value = trade.exitPrice;
      document.getElementById('tradeQty').value = trade.quantity;
      document.getElementById('tradeFees').value = trade.fees || 0;
      document.getElementById('tradeEntryDate').value = trade.entryDate;
      document.getElementById('tradeExitDate').value = trade.exitDate;
      document.getElementById('tradeNotes').value = trade.notes || '';
      document.getElementById('tradeScreenshot').value = trade.screenshot || '';
      selectedModalTags = trade.tags ? [...trade.tags] : [];
      renderModalTags();
    }
  } else {
    document.getElementById('tradeForm').reset();
    document.getElementById('tradeId').value = '';
    document.getElementById('tradeFees').value = 0;
    document.getElementById('tradeStopLoss').value = '';
    document.getElementById('tradeAccount').value = currentAccountId || '';
    // Set default dates to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const dateStr = now.toISOString().slice(0, 16);
    document.getElementById('tradeEntryDate').value = dateStr;
    document.getElementById('tradeExitDate').value = dateStr;
  }
  updatePnlPreview();
  updateRiskPreview();
  lucide.createIcons();
}

// Live risk preview against the selected account's running balance.
function updateRiskPreview() {
  const accId = document.getElementById('tradeAccount').value;
  const sls = parseFloat(document.getElementById('tradeStopLoss').value);
  const box = document.getElementById('riskPreview');
  const val = document.getElementById('riskPreviewValue');
  const note = document.getElementById('riskPreviewNote');
  if (!box) return;
  const acc = cachedAccounts.find(a => a.id === accId);
  if (!accId || !acc || !sls || isNaN(sls) || !acc.currentBalance) {
    box.classList.add('hidden');
    return;
  }
  const risk = (sls / acc.currentBalance) * 100;
  box.classList.remove('hidden');
  let color, label;
  if (risk > 1.0) { color = 'text-loss'; label = 'VIOLATION — exceeds 1.0% max risk'; }
  else if (risk < 0.2) { color = 'text-amber-400'; label = 'TOO CONSERVATIVE — below 0.2%'; }
  else { color = 'text-profit'; label = 'OK — within 0.2%–1.0%'; }
  val.className = 'text-sm font-bold ' + color;
  val.textContent = risk.toFixed(2) + '%';
  note.textContent = `${label} · Running balance $${acc.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function closeTradeModal() {
  document.getElementById('tradeModal').classList.add('hidden');
}

function renderModalTags() {
  const container = document.getElementById('modalTagsContainer');
  const tags = getTags();
  container.innerHTML = tags.map(tag => {
    const isSelected = selectedModalTags.includes(tag);
    return `<button type="button" class="tag-pill px-3 py-1 rounded-full text-xs font-medium ${isSelected ? 'bg-accent/20 text-accent-light border border-accent/30 selected' : 'bg-white/5 text-slate-400 border border-white/5'}" onclick="toggleModalTag('${tag}')">${tag}</button>`;
  }).join('');
}

function toggleModalTag(tag) {
  if (selectedModalTags.includes(tag)) {
    selectedModalTags = selectedModalTags.filter(t => t !== tag);
  } else {
    selectedModalTags.push(tag);
  }
  renderModalTags();
}

function updatePnlPreview() {
  const entry = parseFloat(document.getElementById('tradeEntry').value) || 0;
  const exit = parseFloat(document.getElementById('tradeExit').value) || 0;
  const qty = parseFloat(document.getElementById('tradeQty').value) || 0;
  const fees = parseFloat(document.getElementById('tradeFees').value) || 0;
  const side = document.getElementById('tradeSide').value;

  if (entry && exit && qty) {
    let pnl = side === 'long' ? (exit - entry) * qty - fees : (entry - exit) * qty - fees;
    const preview = document.getElementById('pnlPreview');
    const value = document.getElementById('pnlPreviewValue');
    preview.classList.remove('hidden');
    value.textContent = formatCurrency(pnl);
    value.className = `text-2xl font-bold mt-1 ${pnl >= 0 ? 'text-profit' : 'text-loss'}`;
  } else {
    document.getElementById('pnlPreview').classList.add('hidden');
  }
}

// Listen for PnL preview updates
['tradeEntry', 'tradeExit', 'tradeQty', 'tradeFees', 'tradeSide'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updatePnlPreview);
});

// Listen for risk preview updates
['tradeStopLoss', 'tradeAccount'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateRiskPreview);
  document.getElementById(id)?.addEventListener('change', updateRiskPreview);
});

async function saveTrade(e) {
  e.preventDefault();
  const id = document.getElementById('tradeId').value || generateId();
  const side = document.getElementById('tradeSide').value;
  const entry = parseFloat(document.getElementById('tradeEntry').value);
  const exit = parseFloat(document.getElementById('tradeExit').value);
  const qty = parseFloat(document.getElementById('tradeQty').value);
  const fees = parseFloat(document.getElementById('tradeFees').value) || 0;

  let pnl = side === 'long' ? (exit - entry) * qty - fees : (entry - exit) * qty - fees;
  let pnlPercent = side === 'long' ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;

  // Account + risk fields
  const accountId = document.getElementById('tradeAccount').value || null;
  const slsRaw = parseFloat(document.getElementById('tradeStopLoss').value);
  const stopLossSize = isNaN(slsRaw) ? null : slsRaw;
  let riskPercentage = null;
  let riskFlag = null;
  if (accountId && stopLossSize != null) {
    const acc = cachedAccounts.find(a => a.id === accountId);
    if (acc && acc.currentBalance) {
      riskPercentage = Math.round((stopLossSize / acc.currentBalance) * 100 * 10000) / 10000;
      riskFlag = riskPercentage > 1.0 ? 'violation' : riskPercentage < 0.2 ? 'conservative' : 'ok';
    }
  }

  const trade = {
    id,
    symbol: document.getElementById('tradeSymbol').value.toUpperCase(),
    side,
    entryPrice: entry,
    exitPrice: exit,
    quantity: qty,
    fees,
    entryDate: document.getElementById('tradeEntryDate').value,
    exitDate: document.getElementById('tradeExitDate').value,
    tags: [...selectedModalTags],
    notes: document.getElementById('tradeNotes').value,
    screenshot: document.getElementById('tradeScreenshot').value,
    pnl,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
    result: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    account_id: accountId,
    stop_loss_size: stopLossSize,
    risk_percentage: riskPercentage,
    risk_flag: riskFlag
  };

  const trades = getTrades();
  const existingIndex = trades.findIndex(t => t.id === id);
  if (existingIndex >= 0) {
    trades[existingIndex] = trade;
    saveTrades(trades);
    showToast('Trade updated successfully!');
    if (serverAvailable) await syncTradeToServer(trade, false);
  } else {
    trades.unshift(trade);
    saveTrades(trades);
    showToast('Trade saved successfully!');
    if (serverAvailable) await syncTradeToServer(trade, true);
  }

  closeTradeModal();
  refreshPage();
}

// ============ TRADE DETAIL ============
function openTradeDetail(tradeId) {
  const trades = getTrades();
  const trade = trades.find(t => t.id === tradeId);
  if (!trade) return;

  const modal = document.getElementById('tradeDetailModal');
  modal.classList.remove('hidden');

  const entryD = new Date(trade.entryDate);
  const exitD = new Date(trade.exitDate);
  const durationMs = exitD - entryD;
  const durationH = Math.round((durationMs / 3600000) * 10) / 10;

  const content = document.getElementById('tradeDetailContent');
  content.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <span class="text-2xl font-bold text-white">${trade.symbol}</span>
        <span class="px-2.5 py-1 rounded-lg text-xs font-bold uppercase ${trade.side === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">${trade.side}</span>
      </div>
      <span class="text-2xl font-bold ${trade.pnl >= 0 ? 'text-profit' : 'text-loss'}">${formatCurrency(trade.pnl)}</span>
    </div>
    ${trade.screenshot ? `<img src="${trade.screenshot}" alt="Trade screenshot" class="w-full h-48 object-cover rounded-xl mb-4 border border-white/5" onerror="this.style.display='none'">` : ''}
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Entry Price</span>
        <p class="text-sm font-semibold text-white mt-0.5">$${trade.entryPrice.toFixed(2)}</p>
      </div>
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Exit Price</span>
        <p class="text-sm font-semibold text-white mt-0.5">$${trade.exitPrice.toFixed(2)}</p>
      </div>
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Quantity</span>
        <p class="text-sm font-semibold text-white mt-0.5">${trade.quantity}</p>
      </div>
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Fees</span>
        <p class="text-sm font-semibold text-white mt-0.5">$${(trade.fees || 0).toFixed(2)}</p>
      </div>
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">P&L %</span>
        <p class="text-sm font-semibold ${trade.pnlPercent >= 0 ? 'text-profit' : 'text-loss'} mt-0.5">${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent}%</p>
      </div>
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Duration</span>
        <p class="text-sm font-semibold text-white mt-0.5">${durationH}h</p>
      </div>
      ${trade.stop_loss_size != null ? `
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Stop Loss Size</span>
        <p class="text-sm font-semibold text-white mt-0.5">$${Number(trade.stop_loss_size).toFixed(2)}</p>
      </div>` : ''}
      ${trade.risk_percentage != null ? `
      <div class="bg-surface-900/50 rounded-xl p-3">
        <span class="text-xs text-slate-500">Risk</span>
        <p class="text-sm font-semibold mt-0.5 ${riskFlagClass(trade.risk_flag)}">${Number(trade.risk_percentage).toFixed(2)}% · ${riskFlagLabel(trade.risk_flag)}</p>
      </div>` : ''}
    </div>
    <div class="bg-surface-900/50 rounded-xl p-3 mb-4">
      <span class="text-xs text-slate-500">Entry → Exit</span>
      <p class="text-xs text-slate-400 mt-0.5">${entryD.toLocaleString()} → ${exitD.toLocaleString()}</p>
    </div>
    ${trade.tags && trade.tags.length > 0 ? `<div class="flex flex-wrap gap-2 mb-4">${trade.tags.map(t => `<span class="px-2.5 py-1 rounded-full bg-accent/10 text-accent-light text-xs font-medium">${t}</span>`).join('')}</div>` : ''}
    ${trade.notes ? `<div class="bg-surface-900/50 rounded-xl p-3"><span class="text-xs text-slate-500 block mb-1">Notes</span><p class="text-sm text-slate-300 whitespace-pre-wrap">${escapeHtml(trade.notes)}</p></div>` : ''}
    <div class="flex gap-3 mt-6">
      <button onclick="editTrade('${trade.id}')" class="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-dark rounded-xl text-sm font-semibold text-white transition">Edit</button>
      <button onclick="deleteTrade('${trade.id}')" class="px-4 py-2.5 bg-loss/10 hover:bg-loss/20 text-loss rounded-xl text-sm font-semibold transition">Delete</button>
    </div>
  `;
  lucide.createIcons();
}

function closeTradeDetail() {
  document.getElementById('tradeDetailModal').classList.add('hidden');
}

function editTrade(id) {
  closeTradeDetail();
  openTradeModal(id);
}

async function deleteTrade(id) {
  if (!confirm('Delete this trade? This cannot be undone.')) return;
  const trades = getTrades().filter(t => t.id !== id);
  saveTrades(trades);
  closeTradeDetail();
  showToast('Trade deleted');
  if (serverAvailable) await syncDeleteToServer(id);
  refreshPage();
}

// ============ DASHBOARD ============
function refreshDashboard() {
  renderAccountSummary();
  const trades = getScopedTrades();
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgTrade = trades.length > 0 ? totalPnl / trades.length : 0;
  const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  document.getElementById('statTotalTrades').textContent = trades.length;
  document.getElementById('statWinRate').textContent = winRate.toFixed(1) + '%';
  document.getElementById('statTotalPnL').textContent = formatCurrency(totalPnl);
  document.getElementById('statTotalPnL').className = `text-2xl lg:text-3xl font-bold ${totalPnl >= 0 ? 'text-profit' : 'text-loss'}`;
  document.getElementById('statAvgTrade').textContent = formatCurrency(avgTrade);
  document.getElementById('statBestTrade').textContent = formatCurrency(bestTrade);
  document.getElementById('statWorstTrade').textContent = formatCurrency(worstTrade);
  document.getElementById('statProfitFactor').textContent = profitFactor === Infinity ? '∞' : profitFactor.toFixed(2);
  document.getElementById('statAvgWinLoss').textContent = `${formatCurrencyShort(avgWin)} / ${formatCurrencyShort(avgLoss)}`;

  // Recent trades
  const container = document.getElementById('recentTradesContainer');
  const recent = trades.slice(0, 5);
  if (recent.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No trades yet. Click "New Trade" to get started!</p>';
  } else {
    container.innerHTML = recent.map(t => tradeRowHTML(t)).join('');
  }

  // Charts
  renderEquityChart(trades);
  renderWinLossChart(wins.length, losses.length, trades.filter(t => t.pnl === 0).length);
}

function tradeRowHTML(trade) {
  const pnlClass = trade.pnl >= 0 ? 'text-profit' : 'text-loss';
  const sideClass = trade.side === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400';
  return `
    <div class="trade-row flex items-center gap-4 p-3 rounded-xl cursor-pointer" onclick="openTradeDetail('${trade.id}')">
      <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xs font-bold text-white shrink-0">${trade.symbol.slice(0, 3)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-white">${trade.symbol}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${sideClass}">${trade.side}</span>
          ${trade.tags && trade.tags.length > 0 ? trade.tags.slice(0, 2).map(t => `<span class="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent-light">${t}</span>`).join('') : ''}
        </div>
        <p class="text-xs text-slate-500 mt-0.5">${new Date(trade.exitDate).toLocaleDateString()}</p>
      </div>
      <div class="text-right">
        <p class="text-sm font-bold ${pnlClass}">${formatCurrency(trade.pnl)}</p>
        <p class="text-xs ${pnlClass}">${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent}%</p>
      </div>
    </div>`;
}

// ============ JOURNAL ============
function refreshJournal() {
  renderJournal();
  updateFilterTags();
}

function updateFilterTags() {
  const tags = getTags();
  const select = document.getElementById('filterTag');
  const current = select.value;
  select.innerHTML = '<option value="all">All Tags</option>' + tags.map(t => `<option value="${t}">${t}</option>`).join('');
  select.value = current;
}

function renderJournal() {
  let trades = getScopedTrades();
  const search = document.getElementById('searchInput').value.toLowerCase();
  const side = document.getElementById('filterSide').value;
  const result = document.getElementById('filterResult').value;
  const tag = document.getElementById('filterTag').value;
  const sort = document.getElementById('sortBy').value;

  if (search) {
    trades = trades.filter(t => t.symbol.toLowerCase().includes(search) || (t.notes && t.notes.toLowerCase().includes(search)));
  }
  if (side !== 'all') trades = trades.filter(t => t.side === side);
  if (result !== 'all') trades = trades.filter(t => t.result === result);
  if (tag !== 'all') trades = trades.filter(t => t.tags && t.tags.includes(tag));

  // Sort
  switch (sort) {
    case 'date-desc': trades.sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate)); break;
    case 'date-asc': trades.sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate)); break;
    case 'pnl-desc': trades.sort((a, b) => b.pnl - a.pnl); break;
    case 'pnl-asc': trades.sort((a, b) => a.pnl - b.pnl); break;
  }

  const container = document.getElementById('journalList');
  if (trades.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-sm text-center py-12">No trades found matching your filters.</p>';
  } else {
    container.innerHTML = trades.map(t => `
      <div class="trade-row bg-surface-800/50 backdrop-blur border border-white/5 rounded-2xl p-4 cursor-pointer flex items-center gap-4" onclick="openTradeDetail('${t.id}')">
        <div class="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-sm font-bold text-white shrink-0">${t.symbol.slice(0, 4)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-base font-semibold text-white">${t.symbol}</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold uppercase ${t.side === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">${t.side}</span>
            ${t.tags ? t.tags.map(tag => `<span class="px-2 py-0.5 rounded text-[11px] bg-accent/10 text-accent-light">${tag}</span>`).join('') : ''}
          </div>
          <div class="flex items-center gap-3 mt-1.5">
            <span class="text-xs text-slate-500">$${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)}</span>
            <span class="text-xs text-slate-500">×${t.quantity}</span>
            <span class="text-xs text-slate-500">${new Date(t.exitDate).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="text-right shrink-0">
          <p class="text-lg font-bold ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}">${formatCurrency(t.pnl)}</p>
          <p class="text-xs ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}">${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent}%</p>
        </div>
      </div>
    `).join('');
  }
}

// ============ CALENDAR ============
let calendarDate = new Date();

function refreshCalendar() {
  // Account-scoped calendar is computed locally; the global view uses server stats.
  if (serverAvailable && !currentAccountId) {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    fetch(`/api/stats/daily?year=${year}&month=${month}`).then(r => r.json()).then(data => {
      renderCalendarFromStats(year, month, data);
    }).catch(() => renderCalendar());
  } else {
    renderCalendar();
  }
}

function renderCalendarFromStats(year, month, stats) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('calendarMonth').textContent = `${monthNames[month]} ${year}`;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = dayNames.map(d => `<div class="text-center text-xs font-medium text-slate-500 py-2">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell rounded-xl p-2"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayObj = stats[d - 1] || { date: d, pnl: 0, count: 0 };
    const dayPnl = dayObj.pnl;
    const isToday = d === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
    html += `
      <div class="cal-cell rounded-xl p-2 border ${isToday ? 'border-accent/30 bg-accent/5' : 'border-white/5'} cursor-pointer" onclick="showDayTrades(${year}, ${month}, ${d})">
        <div class="text-xs font-medium ${isToday ? 'text-accent' : 'text-slate-400'} mb-1">${d}</div>
        ${dayObj.count > 0 ? `
          <div class="text-[10px] ${dayPnl >= 0 ? 'text-profit' : 'text-loss'} font-semibold">${formatCurrencyShort(dayPnl)}</div>
          <div class="text-[10px] text-slate-600">${dayObj.count} trade${dayObj.count > 1 ? 's' : ''}</div>
        ` : ''}
      </div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function changeMonth(delta) {
  calendarDate.setMonth(calendarDate.getMonth() + delta);
  renderCalendar();
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('calendarMonth').textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const trades = getScopedTrades();

  // Group trades by day
  const tradesByDay = {};
  trades.forEach(t => {
    const d = new Date(t.exitDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!tradesByDay[day]) tradesByDay[day] = [];
      tradesByDay[day].push(t);
    }
  });

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = dayNames.map(d => `<div class="text-center text-xs font-medium text-slate-500 py-2">${d}</div>`).join('');

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell rounded-xl p-2"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayTrades = tradesByDay[day] || [];
    const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
    const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();

    html += `
      <div class="cal-cell rounded-xl p-2 border ${isToday ? 'border-accent/30 bg-accent/5' : 'border-white/5'} cursor-pointer" onclick="showDayTrades(${year}, ${month}, ${day})">
        <div class="text-xs font-medium ${isToday ? 'text-accent' : 'text-slate-400'} mb-1">${day}</div>
        ${dayTrades.length > 0 ? `
          <div class="text-[10px] ${dayPnl >= 0 ? 'text-profit' : 'text-loss'} font-semibold">${formatCurrencyShort(dayPnl)}</div>
          <div class="text-[10px] text-slate-600">${dayTrades.length} trade${dayTrades.length > 1 ? 's' : ''}</div>
        ` : ''}
      </div>`;
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

function showDayTrades(year, month, day) {
  const trades = getScopedTrades().filter(t => {
    const d = new Date(t.exitDate);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  });
  if (trades.length === 0) return;

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const dateLabel = new Date(year, month, day).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const modal = document.getElementById('dayTradesModal');
  document.getElementById('dayTradesTitle').textContent = dateLabel;
  document.getElementById('dayTradesTotal').textContent = formatCurrency(totalPnl);
  document.getElementById('dayTradesTotal').className = `text-xl font-bold ${totalPnl >= 0 ? 'text-profit' : 'text-loss'}`;
  document.getElementById('dayTradesList').innerHTML = trades.map(t => tradeRowHTML(t)).join('');
  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeDayTradesModal() {
  document.getElementById('dayTradesModal').classList.add('hidden');
}

// ============ ANALYTICS ============
function refreshAnalytics() {
  const trades = getScopedTrades();
  renderSymbolPnlChart(trades);
  renderTagPnlChart(trades);
  renderDailyPnlChart(trades);
  renderWeeklyPnlChart(trades);
  renderDurationChart(trades);
  renderStreakAnalysis(trades);
  renderWeeklySessionSummary();
  renderRiskAnalytics();
}

function renderWeeklyPnlChart(trades) {
  destroyChart('weeklyPnl');
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  if (serverAvailable && !currentAccountId) {
    fetch(`/api/stats/weekly?year=${year}&month=${month}`).then(r => r.json()).then(weeks => {
      const labels = weeks.map(w => `W${w.week}`);
      const data = weeks.map(w => w.pnl);
      const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');
      charts.weeklyPnl = new Chart(document.getElementById('weeklyPnlChart'), {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6 }] },
        options: chartDefaults
      });
    }).catch(() => renderWeeklyPnlChartLocal(trades));
  } else {
    renderWeeklyPnlChartLocal(trades);
  }
}

function renderWeeklyPnlChartLocal(trades) {
  destroyChart('weeklyPnl');
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const weeks = {};
  const monthStart = new Date(year, month, 1);
  trades.forEach(t => {
    const d = new Date(t.exitDate);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const week = Math.floor((d.getDate() + monthStart.getDay() - 1) / 7) + 1;
    weeks[week] = weeks[week] || 0;
    weeks[week] += t.pnl;
  });
  const totalWeeks = Math.ceil((new Date(year, month + 1, 0).getDate() + monthStart.getDay()) / 7);
  const labels = [];
  const data = [];
  for (let i = 1; i <= totalWeeks; i++) {
    labels.push(`W${i}`);
    data.push(weeks[i] || 0);
  }
  const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');
  charts.weeklyPnl = new Chart(document.getElementById('weeklyPnlChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6 }] },
    options: chartDefaults
  });
}

function renderWeeklySessionSummary() {
  const el = document.getElementById('sessionStatsContent');
  if (!el) return;
  el.innerHTML = '';
  if (serverAvailable && !currentAccountId) {
    fetch('/api/stats/sessions').then(r => r.json()).then(data => {
      Object.entries(data).forEach(([k, v]) => {
        const div = document.createElement('div');
        div.className = 'bg-surface-900/50 rounded-xl p-4';
        div.innerHTML = `<p class="text-xs text-slate-500 uppercase tracking-wide mb-2">${k}</p><p class="text-2xl font-bold text-white">${v.count}</p><p class="text-xs text-slate-400 mt-1">Win rate ${v.winrate.toFixed(1)}%</p>`;
        el.appendChild(div);
      });
    }).catch(() => renderWeeklySessionSummaryLocal());
  } else {
    renderWeeklySessionSummaryLocal();
  }
}

function renderWeeklySessionSummaryLocal() {
  const el = document.getElementById('sessionStatsContent');
  if (!el) return;
  el.innerHTML = '';
  const trades = getScopedTrades();
  const sessions = { premarket: { count: 0, wins: 0 }, market: { count: 0, wins: 0 }, postmarket: { count: 0, wins: 0 } };
  trades.forEach(r => {
    const d = new Date(r.entryDate || r.exitDate);
    const minutes = d.getHours() * 60 + d.getMinutes();
    let key = 'market';
    if (minutes < 570) key = 'premarket';
    else if (minutes >= 960) key = 'postmarket';
    sessions[key].count += 1;
    if (r.pnl > 0) sessions[key].wins += 1;
  });
  Object.entries(sessions).forEach(([k, v]) => {
    const winrate = v.count ? (v.wins / v.count) * 100 : 0;
    const div = document.createElement('div');
    div.className = 'bg-surface-900/50 rounded-xl p-4';
    div.innerHTML = `<p class="text-xs text-slate-500 uppercase tracking-wide mb-2">${k}</p><p class="text-2xl font-bold text-white">${v.count}</p><p class="text-xs text-slate-400 mt-1">Win rate ${winrate.toFixed(1)}%</p>`;
    el.appendChild(div);
  });
}

// ============ CHARTS ============
let charts = {};

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b', font: { size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b', font: { size: 10 } } }
  }
};

function renderEquityChart(trades) {
  destroyChart('equity');
  const sorted = [...trades].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
  let cumulative = 0;
  const data = sorted.map(t => {
    cumulative += t.pnl;
    return cumulative;
  });
  const labels = sorted.map(t => new Date(t.exitDate).toLocaleDateString());

  charts.equity = new Chart(document.getElementById('equityChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointBackgroundColor: '#6366f1',
        borderWidth: 2,
      }]
    },
    options: {
      ...chartDefaults,
      plugins: {
        ...chartDefaults.plugins,
        tooltip: {
          callbacks: {
            label: ctx => formatCurrency(ctx.parsed.y)
          }
        }
      }
    }
  });
}

function renderWinLossChart(wins, losses, breakeven) {
  destroyChart('winLoss');
  charts.winLoss = new Chart(document.getElementById('winLossChart'), {
    type: 'doughnut',
    data: {
      labels: ['Wins', 'Losses', 'Breakeven'],
      datasets: [{
        data: [wins, losses, breakeven],
        backgroundColor: ['#22c55e', '#ef4444', '#64748b'],
        borderColor: 'transparent',
        borderWidth: 0,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#94a3b8', font: { size: 11 }, padding: 16 }
        }
      }
    }
  });
}

function renderSymbolPnlChart(trades) {
  destroyChart('symbolPnl');
  const bySymbol = {};
  trades.forEach(t => {
    bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.pnl;
  });
  const sorted = Object.entries(bySymbol).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(s => s[0]);
  const data = sorted.map(s => s[1]);
  const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');

  charts.symbolPnl = new Chart(document.getElementById('symbolPnlChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
    }
  });
}

function renderTagPnlChart(trades) {
  destroyChart('tagPnl');
  const byTag = {};
  trades.forEach(t => {
    if (t.tags) {
      t.tags.forEach(tag => {
        byTag[tag] = (byTag[tag] || 0) + t.pnl;
      });
    }
  });
  const sorted = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(s => s[0]);
  const data = sorted.map(s => s[1]);
  const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');

  charts.tagPnl = new Chart(document.getElementById('tagPnlChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
    }
  });
}

function renderDailyPnlChart(trades) {
  destroyChart('dailyPnl');
  const byDate = {};
  trades.forEach(t => {
    const date = new Date(t.exitDate).toLocaleDateString();
    byDate[date] = (byDate[date] || 0) + t.pnl;
  });
  const sorted = Object.entries(byDate).sort((a, b) => new Date(a[0]) - new Date(b[0]));
  const labels = sorted.map(s => s[0]);
  const data = sorted.map(s => s[1]);
  const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');

  charts.dailyPnl = new Chart(document.getElementById('dailyPnlChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderRadius: 6 }]
    },
    options: chartDefaults
  });
}

function renderDurationChart(trades) {
  destroyChart('duration');
  const data = trades.map(t => {
    const hours = (new Date(t.exitDate) - new Date(t.entryDate)) / 3600000;
    return { x: hours, y: t.pnl };
  });
  const colors = data.map(d => d.y >= 0 ? '#22c55e' : '#ef4444');

  charts.duration = new Chart(document.getElementById('durationChart'), {
    type: 'scatter',
    data: {
      datasets: [{
        data,
        backgroundColor: colors,
        pointRadius: 5,
        pointHoverRadius: 8,
      }]
    },
    options: {
      ...chartDefaults,
      scales: {
        x: { ...chartDefaults.scales.x, title: { display: true, text: 'Duration (hours)', color: '#64748b' } },
        y: { ...chartDefaults.scales.y, title: { display: true, text: 'P&L ($)', color: '#64748b' } }
      }
    }
  });
}

function renderStreakAnalysis(trades) {
  const sorted = [...trades].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
  let currentStreak = 0;
  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let tempWinStreak = 0;
  let tempLossStreak = 0;
  let longestDuration = 0;

  sorted.forEach(t => {
    if (t.pnl > 0) {
      tempWinStreak++;
      tempLossStreak = 0;
      bestWinStreak = Math.max(bestWinStreak, tempWinStreak);
    } else if (t.pnl < 0) {
      tempLossStreak++;
      tempWinStreak = 0;
      worstLossStreak = Math.max(worstLossStreak, tempLossStreak);
    }
    const dur = (new Date(t.exitDate) - new Date(t.entryDate)) / 3600000;
    if (dur > longestDuration) longestDuration = dur;
  });

  // Current streak
  if (sorted.length > 0) {
    currentStreak = 0;
    const lastResult = sorted[sorted.length - 1].pnl > 0 ? 'win' : sorted[sorted.length - 1].pnl < 0 ? 'loss' : 'be';
    for (let i = sorted.length - 1; i >= 0; i--) {
      const r = sorted[i].pnl > 0 ? 'win' : sorted[i].pnl < 0 ? 'loss' : 'be';
      if (r === lastResult) currentStreak++;
      else break;
    }
  }

  document.getElementById('streakCurrent').textContent = currentStreak;
  document.getElementById('streakBestWin').textContent = bestWinStreak;
  document.getElementById('streakWorstLoss').textContent = worstLossStreak;
  document.getElementById('streakLongest').textContent = longestDuration.toFixed(1) + 'h';
}

// ============ PROP FIRM RISK ANALYTICS ============
function riskFlagClass(flag) {
  if (flag === 'violation') return 'text-loss';
  if (flag === 'conservative') return 'text-amber-400';
  if (flag === 'ok') return 'text-profit';
  return 'text-slate-400';
}
function riskFlagLabel(flag) {
  if (flag === 'violation') return 'VIOLATION';
  if (flag === 'conservative') return 'TOO CONSERVATIVE';
  if (flag === 'ok') return 'OK';
  return '—';
}

// Constant horizontal reference line as a Chart.js dataset.
function referenceLineDataset(label, value, count, color) {
  return {
    label,
    data: new Array(count).fill(value),
    borderColor: color,
    borderWidth: 1.5,
    borderDash: [6, 4],
    pointRadius: 0,
    fill: false,
    tension: 0,
  };
}

async function renderRiskAnalytics() {
  const hint = document.getElementById('riskAnalyticsHint');
  const content = document.getElementById('riskAnalyticsContent');
  if (!hint || !content) return;
  if (!currentAccountId || !serverAvailable) {
    hint.classList.remove('hidden');
    content.classList.add('hidden');
    destroyChart('acctEquity');
    destroyChart('acctDaily');
    destroyChart('acctRisk');
    return;
  }
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(currentAccountId)}/analytics`);
    if (!res.ok) throw new Error('fail');
    const data = await res.json();
    hint.classList.add('hidden');
    content.classList.remove('hidden');
    renderAcctEquityChart(data);
    renderAcctDailyPnlChart(data);
    renderAcctRiskChart(data);
    renderRiskRecommendation(data);
  } catch (e) {
    hint.classList.remove('hidden');
    content.classList.add('hidden');
  }
}

function renderAcctEquityChart(data) {
  destroyChart('acctEquity');
  const canvas = document.getElementById('acctEquityChart');
  if (!canvas) return;
  const points = data.equityCurve || [];
  const labels = points.map(p => new Date(p.x).toLocaleDateString());
  const balances = points.map(p => p.y);
  const datasets = [{
    label: 'Running Balance',
    data: balances,
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99,102,241,0.1)',
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    borderWidth: 2,
  }];
  if (labels.length > 0 && data.accountSize != null) {
    datasets.push(referenceLineDataset('Account Size', data.accountSize, labels.length, '#94a3b8'));
  }
  charts.acctEquity = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...chartDefaults,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}` } }
      }
    }
  });
}

function renderAcctDailyPnlChart(data) {
  destroyChart('acctDaily');
  const canvas = document.getElementById('acctDailyPnlChart');
  if (!canvas) return;
  const days = data.dailyPnL || [];
  const labels = days.map(d => new Date(d.date).toLocaleDateString());
  const values = days.map(d => d.pnl);
  const colors = values.map(v => v >= 0 ? '#22c55e' : '#ef4444');
  charts.acctDaily = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.parsed.y) } } }
    }
  });
}

function renderAcctRiskChart(data) {
  destroyChart('acctRisk');
  const canvas = document.getElementById('acctRiskChart');
  if (!canvas) return;
  const points = data.riskTrend || [];
  const labels = points.map(p => `#${p.tradeNumber}`);
  const values = points.map(p => p.risk);
  const datasets = [{
    label: 'Risk %',
    data: values,
    borderColor: '#818cf8',
    backgroundColor: 'rgba(129,140,248,0.1)',
    fill: false,
    tension: 0.3,
    pointRadius: 3,
    pointBackgroundColor: values.map(v => v > 1.0 ? '#ef4444' : v < 0.2 ? '#f59e0b' : '#22c55e'),
    borderWidth: 2,
  }];
  if (labels.length > 0) {
    datasets.push(referenceLineDataset('1.0% Max', 1.0, labels.length, '#ef4444'));
    datasets.push(referenceLineDataset('0.2% Min', 0.2, labels.length, '#f59e0b'));
  }
  charts.acctRisk = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...chartDefaults,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%` } }
      }
    }
  });
}

// Size Up / Size Down / Maintain recommendation based on recent balance + risk.
function renderRiskRecommendation(data) {
  const el = document.getElementById('riskRecommendation');
  if (!el) return;
  const balances = (data.equityCurve || []).map(p => p.y);
  const risks = (data.riskTrend || []).map(p => p.risk);
  const account = getCurrentAccount();

  if (balances.length < 2 || risks.length === 0) {
    el.classList.add('hidden');
    return;
  }

  const recentBalances = balances.slice(-11); // up to last 10 trades
  const startBal = recentBalances[0];
  const endBal = recentBalances[recentBalances.length - 1];
  const balanceChangePct = startBal ? ((endBal - startBal) / startBal) * 100 : 0;

  const recentRisks = risks.slice(-10);
  const avgRisk = recentRisks.reduce((s, r) => s + r, 0) / recentRisks.length;

  const inDrawdown = account ? account.currentBalance < account.accountSize : false;

  let text, cls;
  if (inDrawdown && avgRisk >= 0.9) {
    text = '📉 RECOMMENDATION: SIZE DOWN. Reduce risk to 0.5% until recovering from drawdown.';
    cls = 'bg-loss/10 text-loss';
  } else if (balanceChangePct > 5 && avgRisk < 0.6) {
    text = '📈 RECOMMENDATION: SIZE UP. Consider increasing lot size to target 0.8% risk.';
    cls = 'bg-profit/10 text-profit';
  } else if (avgRisk >= 0.5 && avgRisk <= 0.9 && Math.abs(balanceChangePct) <= 5) {
    text = '✅ RECOMMENDATION: MAINTAIN. Risk allocation is optimal.';
    cls = 'bg-accent/10 text-accent-light';
  } else {
    text = `Avg risk ${avgRisk.toFixed(2)}% over last ${recentRisks.length} trade(s), balance ${balanceChangePct >= 0 ? '+' : ''}${balanceChangePct.toFixed(1)}%. No strong signal — keep monitoring discipline.`;
    cls = 'bg-white/5 text-slate-400';
  }
  el.className = 'mt-4 p-4 rounded-xl text-sm font-medium ' + cls;
  el.textContent = text;
  el.classList.remove('hidden');
}

// ============ SETTINGS ============
function refreshSettings() {
  renderTagsList();
}

function renderTagsList() {
  const tags = getTags();
  document.getElementById('tagsList').innerHTML = tags.map(tag =>
    `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-sm text-slate-300">
      ${tag}
      <button onclick="removeTag('${tag}')" class="text-slate-500 hover:text-loss transition"><i data-lucide="x" class="w-3 h-3"></i></button>
    </span>`
  ).join('');
  lucide.createIcons();
}

async function addCustomTag() {
  const input = document.getElementById('newTagInput');
  const tag = input.value.trim();
  if (!tag) return;
  const tags = getTags();
  if (!tags.includes(tag)) {
    tags.push(tag);
    saveTags(tags);
    renderTagsList();
    updateFilterTags();
    if (serverAvailable) await syncTagToServer(tag);
  }
  input.value = '';
}

async function removeTag(tag) {
  const tags = getTags().filter(t => t !== tag);
  saveTags(tags);
  renderTagsList();
  updateFilterTags();
  if (serverAvailable) await syncRemoveTagFromServer(tag);
}

async function syncRemoveTagFromServer(tag) {
  if (!serverAvailable) return;
  try {
    await fetch(`/api/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  } catch (e) { }
}

function exportData() {
  const trades = getTrades();
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tradevault-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported!');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        const existing = getTrades();
        const existingIds = new Set(existing.map(t => t.id));
        const newTrades = imported.filter(t => !existingIds.has(t.id));
        const merged = [...existing, ...newTrades];
        saveTrades(merged);
        if (serverAvailable) await syncBulkToServer(newTrades);
        showToast(`Imported ${newTrades.length} trades!`);
        refreshPage();
      }
    } catch {
      showToast('Invalid file format');
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const trades = getTrades();
  if (trades.length === 0) { showToast('No trades to export'); return; }
  const headers = ['Symbol', 'Side', 'Entry Price', 'Exit Price', 'Quantity', 'Fees', 'P&L', 'P&L %', 'Entry Date', 'Exit Date', 'Tags', 'Notes'];
  const rows = trades.map(t => [
    t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.fees || 0,
    t.pnl, t.pnlPercent, t.entryDate, t.exitDate,
    t.tags ? t.tags.join(';') : '', (t.notes || '').replace(/"/g, '""')
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tradevault-export-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!');
}

async function clearAllData() {
  if (!confirm('Are you sure you want to delete ALL your trades? This cannot be undone!')) return;
  if (!confirm('Really? All data will be permanently lost!')) return;
  localStorage.removeItem(STORAGE_KEY);
  cachedTrades = [];
  if (serverAvailable) {
    try {
      await fetch('/api/trades', { method: 'DELETE' });
    } catch (e) { /* ignore */ }
  }
  showToast('All data cleared');
  refreshPage();
}

// ============ UTILITIES ============
function formatCurrency(val) {
  const sign = val >= 0 ? '+' : '';
  return sign + '$' + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyShort(val) {
  if (Math.abs(val) >= 1000) {
    return (val >= 0 ? '+' : '-') + '$' + Math.abs(val / 1000).toFixed(1) + 'k';
  }
  const sign = val >= 0 ? '+' : '';
  return sign + '$' + Math.abs(val).toFixed(0);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMessage').textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 2500);
}

// ============ REFRESH ============
function renderCurrentPage() {
  switch (currentPage) {
    case 'dashboard': refreshDashboard(); break;
    case 'journal': refreshJournal(); break;
    case 'analytics': refreshAnalytics(); break;
    case 'calendar': refreshCalendar(); break;
    case 'accounts': refreshAccounts(); break;
    case 'settings': refreshSettings(); break;
  }
  lucide.createIcons();
}

function refreshPage() {
  if (serverAvailable) {
    syncFromServer().then(renderCurrentPage).catch(renderCurrentPage);
  } else {
    renderCurrentPage();
  }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadLocalData();
  checkServerAvailability().then(async av => {
    if (av) {
      serverAvailable = true;
      await syncFromServer();
    }
    refreshPage();
  }).catch(() => refreshPage());

  // Keyboard shortcut: N for new trade
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
      openTradeModal();
    }
    if (e.key === 'Escape') {
      closeTradeModal();
      closeTradeDetail();
      closeDayTradesModal();
      closeEditAccount();
    }
  });
});