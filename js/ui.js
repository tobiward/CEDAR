// Shared interface pieces.
import { esc, fmtMoney, fmtDate, $ } from './util.js';
import { PERIODS, LOOKBACKS } from './periods.js';
import { UNCATEGORIZED } from './reports.js';
import { catColor, catBadge, miniRing } from './look.js';

const STATUS = {
  ok: { icon: '✓', word: 'On track' },
  near: { icon: '◷', word: 'Near limit' },
  over: { icon: '!', word: 'Over' },
  unbudgeted: { icon: '•', word: 'No budget' },
  none: { icon: '', word: '' },
};

export function statusText(row) {
  if (row.status === 'over') return `Over by ${fmtMoney(row.spent - row.budget)}`;
  if (row.status === 'near') return `${fmtMoney(row.left)} left`;
  if (row.status === 'ok') return `${fmtMoney(row.left)} left`;
  if (row.status === 'unbudgeted') return 'No budget set';
  return '';
}

export function badge(status, text) {
  const s = STATUS[status] || STATUS.none;
  return `<span class="badge st-${status}"><span aria-hidden="true">${s.icon}</span> ${esc(text || s.word)}</span>`;
}

export function budgetBar(row, href) {
  const pct = row.budget > 0 ? Math.min(row.spent / row.budget, 1) : row.spent > 0 ? 1 : 0;
  const label = `${row.name}: ${fmtMoney(row.spent)} of ${fmtMoney(row.budget)}. ${statusText(row)}`;
  const tag = href ? 'a' : 'div';
  return `<${tag} class="bbar" ${href ? `href="${href}"` : ''} aria-label="${esc(label)}">
    <div class="bbar-top"><span class="bbar-name">${esc(row.name)}</span><span class="bbar-amt">${fmtMoney(row.spent)} <span class="muted">/ ${fmtMoney(row.budget)}</span></span></div>
    <div class="bar" aria-hidden="true"><div class="bar-fill st-${row.status}" style="width:${(pct * 100).toFixed(1)}%"></div></div>
    <div class="bbar-foot">${badge(row.status, statusText(row))}</div>
  </${tag}>`;
}

// A category's budget at a glance: icon, ring, spent of budget, and what's left.
export function categoryTile(row, ctx, href) {
  const cat = row.id === UNCATEGORIZED ? null : ctx.find('Categories', row.id);
  const color = cat ? catColor(cat) : '#8A8F87';
  const tag = href ? 'a' : 'div';
  const pct = row.budget > 0 ? row.spent / row.budget : 0;
  const label = `${row.name}: ${fmtMoney(row.spent)} of ${fmtMoney(row.budget)}. ${statusText(row)}`;
  const icon = { ok: '✓', near: '◷', over: '!', unbudgeted: '•', none: '' }[row.status];
  return `<${tag} class="tile ${row.status === 'over' ? 'over' : ''}" style="--c:${color}" ${href ? `href="${href}"` : ''} aria-label="${esc(label)}">
    ${catBadge(cat, 40)}
    <span class="tile-name">${esc(row.name)}</span>
    ${row.budget > 0 ? miniRing(pct, color) : '<span></span>'}
    <span class="tile-amt"><strong>${fmtMoney(row.spent)}</strong>${row.budget > 0 ? ` of ${fmtMoney(row.budget)}` : ''}</span>
    <span class="tile-status st-${row.status}"><span aria-hidden="true">${icon}</span> ${esc(statusText(row))}</span>
  </${tag}>`;
}

// Where the money went: one colored ribbon segment per category, largest first.
export function spendRibbon(rows, ctx) {
  const list = rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent);
  const total = list.reduce((a, r) => a + r.spent, 0);
  if (!total) return '';
  const col = (r) => (r.id === UNCATEGORIZED ? '#8A8F87' : catColor(ctx.find('Categories', r.id)));
  return `<div class="ribbon" role="img" aria-label="${esc(list.map((r) => `${r.name} ${Math.round((r.spent / total) * 100)}%`).join(', '))}">
    ${list.map((r) => `<span style="--c:${col(r)};flex:${r.spent}" title="${esc(r.name)} ${fmtMoney(r.spent)}"></span>`).join('')}</div>
    <div class="ribbon-key">${list.slice(0, 6).map((r) => `<span><i style="--c:${col(r)}"></i>${esc(r.name)} ${Math.round((r.spent / total) * 100)}%</span>`).join('')}</div>`;
}

export function amountHTML(t) {
  const cls = t.type === 'transfer' ? 'amt-transfer' : t.amount < 0 ? 'amt-out' : 'amt-in';
  const sign = t.amount < 0 ? '−' : '+';
  return `<span class="amt ${cls}">${sign}${fmtMoney(Math.abs(t.amount))}</span>`;
}

export function txnItem(t, ctx) {
  const cat = t.type === 'transfer' ? 'Transfer' : ctx.catName(t.category_id);
  const needs = t.type !== 'transfer' && !t.category_id;
  const catObj = t.category_id ? ctx.find('Categories', t.category_id) : null;
  const src = t.source === 'receipt' ? ' · Receipt' : '';
  return `<button class="txn" data-txn="${esc(t.id)}">
    ${t.type === 'transfer' ? `<span class="cat-badge" style="--c:#7C8A80;width:36px;height:36px">⇄</span>` : catBadge(catObj, 36)}
    <span class="txn-main"><span class="txn-desc">${esc(t.description)}</span>
      <span class="txn-sub">${fmtDate(t.date)} · ${needs ? '<span class="needs">Needs category</span>' : esc(cat)}${src}${t.entered_by && ctx.multiPerson() ? ' · ' + esc(ctx.personName(t.entered_by)) : ''}</span></span>
    ${amountHTML(t)}
  </button>`;
}

export function options(list, selected) {
  return list.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

export function catOptions(ctx, kind, selected, { includeNone = true } = {}) {
  const cats = ctx.categories(kind);
  return (includeNone ? `<option value="">Choose a category…</option>` : '') + options(cats.map((c) => [c.id, c.name]), selected);
}

export function periodControls(ui) {
  return `<div class="controls">
    <label class="field-inline"><span>Budget period</span>
      <select id="ctl-period">${options(PERIODS.map((p) => [p.id, p.label]), ui.period)}</select></label>
    <label class="field-inline"><span>Show</span>
      <select id="ctl-lookback">${options(LOOKBACKS.map((l) => [l.n, l.label]), ui.lookback)}</select></label>
  </div>`;
}

export function bindPeriodControls(root, ctx) {
  $('#ctl-period', root)?.addEventListener('change', (e) => ctx.setUI({ period: e.target.value }));
  $('#ctl-lookback', root)?.addEventListener('change', (e) => ctx.setUI({ lookback: Number(e.target.value) }));
}

export function emptyState(title, body, actionHTML = '') {
  return `<div class="empty"><img src="icons/icon-192.png" alt="" width="72" height="72"><h2>${esc(title)}</h2><p>${esc(body)}</p>${actionHTML}</div>`;
}

// Accessible modal dialog. Returns { el, close }.
let lastFocus = null;
export function openModal(title, bodyHTML, onClose) {
  closeModal();
  lastFocus = document.activeElement;
  const host = document.getElementById('modal-root');
  host.innerHTML = `<div class="modal-backdrop" data-close>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div></div>`;
  const el = host.querySelector('.modal');
  const close = () => { closeModal(); onClose?.(); };
  host.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', (e) => { if (e.target === b) close(); }));
  host.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = [...el.querySelectorAll('button,input,select,textarea,a[href]')].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  setTimeout(() => (el.querySelector('input,select,textarea') || el.querySelector('button'))?.focus(), 30);
  return { el, close };
}
export function closeModal() {
  const host = document.getElementById('modal-root');
  if (host?.innerHTML) { host.innerHTML = ''; lastFocus?.focus?.(); }
}
export const modalOpen = () => !!document.getElementById('modal-root')?.innerHTML;

export async function busy(button, fn) {
  const label = button.textContent;
  button.disabled = true; button.textContent = 'Saving…';
  try { return await fn(); } finally { button.disabled = false; button.textContent = label; }
}

export { UNCATEGORIZED };
