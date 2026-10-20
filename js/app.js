import { CONFIG, googleKeys, saveGoogleKeys, clearGoogleKeys, validateKeys } from './config.js';
import { $, $$, esc, uid, nowStamp, prefs, toast } from './util.js';
import { isConfigured, hasValidToken, signIn, signOut, getUser, pickSheet, NeedsSignIn, resetAuth } from './google.js';
import { SheetStore, MemoryStore, TABLES, idField } from './store.js';
import { DEFAULT_CATEGORIES } from './categorize.js';
import { closeModal, modalOpen } from './ui.js';
import { demoTables } from './demo.js';
import { renderHome } from './views/home.js';
import { renderSpending } from './views/spending.js';
import { renderAdd } from './views/add.js';
import { renderAccounts } from './views/accounts.js';
import { renderSettings } from './views/settings.js';
import { renderSetup } from './views/setup.js';
import { renderTransfers } from './views/transfers.js';
import { renderSubscriptions } from './views/subscriptions.js';
import { renderGoals } from './views/goals.js';
import { renderLock } from './views/lock-screen.js';
import { isLockOn, markAway, shouldLockOnReturn } from './lock.js';

const params = new URLSearchParams(location.search);
const emptyTables = () => Object.fromEntries(TABLES.map((t) => [t, []]));

const state = {
  locked: isLockOn(),
  store: null, data: emptyTables(), issues: [], user: null, version: null,
  ready: false, setup: null, demo: params.has('demo'), joinId: params.get('join') || prefs.get('join', null),
  writes: 0, staleUI: false, sessionExpired: false, title: '',
};

// ---------- Context shared with views ----------
const ctx = {
  state,
  render,
  go: (hash) => { if (location.hash === hash) render(); else location.hash = hash; },
  pref: (k, d) => prefs.get(k, d),
  setPref: (k, v) => prefs.set(k, v),
  ui: () => ({ period: 'monthly', lookback: 1, ...prefs.get('ui', {}) }),
  setUI(patch) { prefs.set('ui', { ...ctx.ui(), ...patch }); render(); },
  setTheme(v) { prefs.set('theme', v); applyTheme(); },

  find: (table, id) => state.data[table].find((o) => o[idField(table)] === id),
  accounts: () => state.data.Accounts.filter((a) => !a.deleted),
  categories(kind, includeArchived = false) {
    return state.data.Categories.filter((c) => !c.deleted && (includeArchived || !c.archived) && (!kind || c.kind === kind))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  },
  catName: (id) => (id ? state.data.Categories.find((c) => c.id === id)?.name || 'Unknown category' : 'Uncategorized'),
  multiPerson: () => new Set(state.data.Transactions.map((t) => t.entered_by).filter(Boolean)).size > 1,
  subscriptions: () => state.data.Subscriptions.filter((x) => !x.deleted),
  personName(email) {
    if (!email) return '';
    if (email === state.user?.email) return 'You';
    return email.split('@')[0];
  },
  setting(key, fallback) {
    const s = state.data.Settings.find((r) => r.key === key);
    if (!s) return fallback;
    try { return JSON.parse(s.value); } catch { return s.value; }
  },
  accountMap: () => ctx.setting('account_map', {}),
  latestMonth() {
    let m = null;
    for (const t of state.data.Transactions) if (!t.deleted && (!m || t.date > m)) m = t.date;
    return m?.slice(0, 7);
  },

  // Writes go straight to the sheet, then into the local copy.
  async save(table, obj) {
    const rec = { ...obj, updated_at: nowStamp() };
    if (table !== 'Settings' && rec.deleted === undefined) rec.deleted = false;
    await write(() => (rec._row ? state.store.update(table, rec) : state.store.append(table, [rec])));
    const list = state.data[table];
    const i = list.findIndex((o) => o[idField(table)] === rec[idField(table)]);
    if (i >= 0) list[i] = rec; else list.push(rec);
    render();
    return rec;
  },
  async saveMany(table, objs) {
    const stamp = nowStamp();
    const recs = objs.map((o) => ({ deleted: false, ...o, updated_at: stamp }));
    try { await write(() => state.store.append(table, recs)); }
    catch (err) {
      await reload().catch(() => {});
      render();
      throw new Error(`${err.message}. Some rows may have saved anyway; CEDAR reloaded the sheet so trying again won’t create duplicates.`);
    }
    state.data[table].push(...recs);
    render();
  },
  remove: (table, obj) => ctx.save(table, { ...obj, deleted: true }),
  removeMany: (table, objs) => ctx.updateMany(table, objs.map((o) => ({ ...o, deleted: true }))),
  async updateMany(table, objs) {
    if (!objs.length) return;
    const stamp = nowStamp();
    const recs = objs.map((o) => ({ ...o, updated_at: stamp }));
    await write(() => state.store.updateMany(table, recs));
    const byId = new Map(recs.map((r) => [r[idField(table)], r]));
    state.data[table] = state.data[table].map((o) => byId.get(o[idField(table)]) || o);
    render();
  },
  async setSetting(key, value) {
    const existing = ctx.find('Settings', key);
    await ctx.save('Settings', { ...(existing || {}), key, value: JSON.stringify(value) });
  },
  async learnRule(pattern, category_id, type) {
    if (!pattern) return;
    const existing = state.data.Rules.find((r) => !r.deleted && r.pattern === pattern);
    if (existing && existing.category_id === category_id && existing.type === type) return;
    await ctx.save('Rules', { ...(existing || { id: uid() }), pattern, category_id, type });
  },

  handleError(err) {
    console.error(err);
    if (err instanceof NeedsSignIn) { state.sessionExpired = true; renderChrome(); toast('Your Google session expired. Tap “Reconnect” and try again.', 'error'); }
    else toast(err.message || 'Something went wrong', 'error');
  },
  doSignIn: () => doSignIn(),
  lockNow() { if (isLockOn()) { state.locked = true; render(); } },
  createHousehold: () => createHousehold(),
  joinHousehold: (id) => joinHousehold(id),
  signOut() { signOut(); location.href = location.pathname; },
  disconnect() { prefs.remove('sheet'); clearGoogleKeys(); signOut(); location.href = location.pathname; },
  saveKeys(keys) { saveGoogleKeys(keys); resetAuth(); state.setup = 'signin'; render(); },
  changeKeys() { signOut(); resetAuth(); state.setup = 'unconfigured'; render(); },
  inviteLink() {
    const k = googleKeys();
    const q = new URLSearchParams({ join: state.store.id, cid: k.clientId, key: k.apiKey, app: k.appId });
    return `${location.origin}${location.pathname}?${q}`;
  },
};

async function write(fn) {
  state.writes++; renderChrome();
  try { await fn(); } finally { state.writes--; renderChrome(); }
}

// ---------- Theme ----------
function applyTheme() {
  const t = prefs.get('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------- Routing ----------
function parseHash() {
  const [path, qs] = (location.hash.slice(1) || '/home').split('?');
  const parts = path.split('/').filter(Boolean);
  return { route: parts[0] || 'home', args: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

const NAV = [
  ['home', 'Home', '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['spending', 'Spending', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['add', 'Add', '<path d="M12 5v14M5 12h14"/>'],
  ['goals', 'Goals', '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5z"/>'],
  ['accounts', 'Accounts', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>'],
];

function renderChrome() {
  const app = $('#app');
  const showNav = state.ready && !state.locked;
  app.classList.toggle('no-nav', !showNav);
  const { route } = parseHash();
  $('#nav').innerHTML = showNav ? NAV.map(([id, label, icon]) => `<a href="#/${id}" class="tab ${id === 'add' ? 'tab-add' : ''}" ${route === id ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="24" height="24">${icon}</svg><span>${label}</span></a>`).join('') : '';
  $('#topbar-actions').innerHTML = showNav ? `${isLockOn() ? '<button class="icon-btn" id="lock-btn" aria-label="Lock CEDAR"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>' : ''}
    <span class="sync" role="status">${state.writes ? 'Saving…' : state.demo ? 'Demo' : ''}</span>
    <a href="#/settings" class="icon-btn" aria-label="Settings" ${route === 'settings' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></a>` : '';
  $('#lock-btn')?.addEventListener('click', () => ctx.lockNow());
  const banner = $('#banner');
  banner.innerHTML = state.sessionExpired ? `<div class="banner" role="alert">Your Google session expired. <button class="btn btn-small" id="reconnect">Reconnect</button></div>` : '';
  $('#reconnect')?.addEventListener('click', async () => {
    try { await signIn(); state.sessionExpired = false; await reload(); toast('Reconnected', 'ok'); } catch (e) { toast(e.message, 'error'); }
    renderChrome();
  });
}

function render() {
  renderChrome();
  const root = $('#view');
  // Nothing behind the lock is drawn until it's unlocked.
  if (state.locked && isLockOn()) { closeModal(); renderLock(root, ctx, () => { state.locked = false; markAway(); render(); }); return; }
  state.locked = false;
  if (!state.ready) { renderSetup(root, ctx, state.setup); return; }
  const { route, args, query } = parseHash();
  const view = { home: renderHome, spending: renderSpending, add: renderAdd, accounts: renderAccounts, settings: renderSettings, transfers: renderTransfers, subscriptions: renderSubscriptions, goals: renderGoals }[route] || renderHome;
  view(root, ctx, args, query);
  state.staleUI = false;
}

window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); $('#view h1')?.focus?.(); });

// ---------- Loading and sync ----------
async function reload() {
  const [{ tables, issues }, version] = await Promise.all([state.store.loadAll(), state.store.version()]);
  state.data = tables; state.issues = issues; state.version = version;
}

// Re-render after a partner's change, unless someone is mid-edit; then wait.
function refreshUI() {
  const a = document.activeElement;
  if (modalOpen() || (a && a.closest('#view') && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) { state.staleUI = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (state.staleUI) refreshUI(); }, 200));

async function poll() {
  if (!state.ready || state.demo || state.writes || document.visibilityState !== 'visible' || !hasValidToken()) return;
  try {
    const v = await state.store.version();
    if (v !== state.version) { await reload(); refreshUI(); }
  } catch (e) { if (e instanceof NeedsSignIn) { state.sessionExpired = true; renderChrome(); } }
}
setInterval(poll, CONFIG.SYNC_INTERVAL_MS);
document.addEventListener('visibilitychange', poll);
// Lock again after the chosen time away from the app.
document.addEventListener('visibilitychange', () => {
  if (!isLockOn() || state.locked) return;
  if (document.visibilityState === 'hidden') markAway();
  else if (shouldLockOnReturn()) { state.locked = true; render(); }
});

async function openStore(store) {
  state.store = store;
  await reload();
  await ensureCategories().catch((e) => console.error(e));
  state.title = await store.title().catch(() => '');
  state.ready = true;
  if (state.joinId || params.has('cid')) history.replaceState(null, '', location.pathname + location.hash);
  render();
}

// Categories added in later versions of CEDAR are added to older households once.
async function ensureCategories() {
  const have = new Set(state.data.Categories.filter((c) => !c.deleted).map((c) => c.name.toLowerCase()));
  const missing = ['Cash', 'Debt payments', 'Transfers out'].filter((n) => !have.has(n.toLowerCase()));
  if (!missing.length) return;
  let sort = Math.max(0, ...state.data.Categories.map((c) => c.sort || 0));
  const stamp = nowStamp();
  const recs = missing.map((name) => ({ id: uid(), name, kind: 'expense', monthly_budget: 0, sort: ++sort, archived: false, updated_at: stamp, deleted: false }));
  await state.store.append('Categories', recs);
  state.data.Categories.push(...recs);
}

// ---------- Setup flows ----------
async function doSignIn() {
  try { await signIn(); await afterSignIn(); } catch (e) { toast(e.message || 'Sign-in failed', 'error'); }
}

async function afterSignIn() {
  state.user = await getUser();
  const sheet = prefs.get('sheet', null);
  if (sheet && !state.joinId) {
    try { return await openStore(new SheetStore(sheet)); }
    catch (e) { console.error(e); toast('Couldn’t open your household sheet. You may need to pick it again.', 'error'); prefs.remove('sheet'); }
  }
  state.setup = 'choose'; render();
}

async function createHousehold() {
  try {
    toast('Creating your household sheet…');
    const store = await SheetStore.create(`CEDAR household (${state.user.name})`);
    const stamp = nowStamp();
    await store.append('Categories', DEFAULT_CATEGORIES.map(([name, kind], i) => ({ id: uid(), name, kind, monthly_budget: 0, sort: i, archived: false, updated_at: stamp, deleted: false })));
    await store.append('Settings', [{ key: 'created', value: JSON.stringify(stamp), updated_at: stamp }]);
    prefs.set('sheet', store.id);
    prefs.remove('join'); state.joinId = null;
    await openStore(store);
    location.hash = '#/spending/budget';
    toast('Household created. Start by setting a few monthly budgets.', 'ok');
  } catch (e) { ctx.handleError(e); render(); }
}

async function joinHousehold(presetId) {
  try {
    const id = await pickSheet(presetId);
    if (!id) return;
    const store = new SheetStore(id);
    const { tables } = await store.loadAll();
    if (!tables.Categories.length && !tables.Transactions.length) {
      if (!confirm('That sheet doesn’t look like a CEDAR household yet. Use it anyway?')) return;
    }
    prefs.set('sheet', id);
    prefs.remove('join');
    state.joinId = null;
    await openStore(store);
    toast('Connected to your household', 'ok');
  } catch (e) { ctx.handleError(e); }
}

// ---------- Boot ----------
async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (state.demo) {
    state.user = { name: 'You', email: 'you@example.com' };
    window.cedarDemo = ctx; // handy for poking at demo data from the console
    return openStore(new MemoryStore(demoTables()));
  }
  // An invite link carries the household's Google Cloud keys so the partner doesn't type them.
  // The household to join is remembered too, so installing CEDAR before finishing the join doesn't lose it.
  if (params.get('join')) prefs.set('join', params.get('join'));
  if (params.has('cid')) {
    const keys = { clientId: params.get('cid') || '', apiKey: params.get('key') || '', appId: params.get('app') || '' };
    if (!validateKeys(keys).length && keys.clientId !== googleKeys().clientId) { signOut(); saveGoogleKeys(keys); }
  }
  if (!isConfigured()) { state.setup = 'unconfigured'; return render(); }
  if (!hasValidToken()) { state.setup = 'signin'; return render(); }
  try { await afterSignIn(); }
  catch (e) {
    if (e instanceof NeedsSignIn) { state.setup = 'signin'; render(); } else { ctx.handleError(e); state.setup = 'signin'; render(); }
  }
}

boot();
export { esc, $$ };
