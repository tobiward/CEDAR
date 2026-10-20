export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const fmtMoney = (n) => money.format(Number(n) || 0);
export const fmtMoney0 = (n) => money0.format(Math.round(Number(n) || 0));
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const todayISO = () => isoDate(new Date());
export const nowStamp = () => new Date().toISOString();
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(iso, withYear = false) {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? ', ' + d.getFullYear() : ''}`;
}
export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// Local, non-financial device preferences only.
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem('cedar.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('cedar.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  remove(key) {
    try { localStorage.removeItem('cedar.' + key); } catch { /* storage unavailable */ }
  },
};

export function downloadFile(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    let s = String(v ?? '');
    // Spreadsheet apps run cells that start with = + - @ as formulas; a bank description could be one.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d[\d,.]*$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
