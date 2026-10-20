// Bank statement parsing: CSV (any layout, via a saved column mapping) and OFX/QFX.
import { normalize } from './categorize.js';
import { isoDate, round2 } from './util.js';

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row.map((v) => v.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row.map((v) => v.trim()));
  return rows;
}

export function parseMoney(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/\bDR\b/i.test(t)) neg = true;
  t = t.replace(/\b(CR|DR)\b/gi, '').replace(/[$,\s]/g, '');
  const n = Number(t);
  if (Number.isNaN(n) || t === '') return null;
  return round2(neg ? -Math.abs(n) : n);
}

export function parseDateAny(s) {
  const t = String(s || '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return isoDate(new Date(+m[1], m[2] - 1, +m[3]));
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(t))) {
    let y = +m[3]; if (y < 100) y += 2000;
    return isoDate(new Date(y, m[1] - 1, +m[2]));
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(t))) return isoDate(new Date(+m[1], m[2] - 1, +m[3]));
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : isoDate(new Date(d));
}

// Banks often put account info above the real header row.
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length - 1, 15); i++) {
    const hasDateNow = rows[i].some((c) => parseDateAny(c) && /\d/.test(c));
    const hasDateNext = rows[i + 1].some((c) => parseDateAny(c) && /\d/.test(c));
    if (!hasDateNow && hasDateNext && rows[i].filter(Boolean).length >= 2) return i;
  }
  return 0;
}

export const headerSignature = (headers) => headers.map((h) => h.toLowerCase().trim()).join('|');

export function guessMapping(headers) {
  const find = (re, not) => headers.findIndex((h) => re.test(h) && !(not && not.test(h)));
  let date = find(/post/i);
  if (date < 0) date = find(/date/i);
  const desc = find(/desc|payee|merchant|name|memo|details|narrative/i, /date|amount/i);
  const amount = find(/^\s*(transaction )?amount|^amt/i);
  const debit = find(/debit|withdraw|outflow|money out/i);
  const credit = find(/credit|deposit|inflow|money in/i);
  return {
    date, desc,
    amount: amount >= 0 || debit < 0 ? amount : -1,
    debit: amount >= 0 ? -1 : debit,
    credit: amount >= 0 ? -1 : credit,
    flip: false,
  };
}

export function mappingIsValid(m) {
  return m.date >= 0 && m.desc >= 0 && (m.amount >= 0 || m.debit >= 0 || m.credit >= 0);
}

export function applyMapping(dataRows, m) {
  const out = [];
  for (const r of dataRows) {
    const date = parseDateAny(r[m.date]);
    if (!date) continue;
    let amount;
    if (m.amount >= 0) amount = parseMoney(r[m.amount]);
    else {
      const d = m.debit >= 0 ? parseMoney(r[m.debit]) : null;
      const c = m.credit >= 0 ? parseMoney(r[m.credit]) : null;
      if (d === null && c === null) continue;
      amount = round2(Math.abs(c || 0) - Math.abs(d || 0));
    }
    if (amount === null || amount === 0) continue;
    if (m.flip) amount = -amount;
    out.push({ date, description: r[m.desc] || '(no description)', amount, external_id: '' });
  }
  return out;
}

// True when most rows are positive: typical of credit card exports that list purchases as positive.
export const looksSignFlipped = (txns) => txns.length >= 3 && txns.filter((t) => t.amount > 0).length / txns.length > 0.75;

export function parseOFX(text) {
  const out = [];
  const tag = (block, name) => {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? m[1].trim() : '';
  };
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const b = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseDateAny(tag(b, 'DTPOSTED').slice(0, 8));
    const amount = parseMoney(tag(b, 'TRNAMT'));
    if (!date || amount === null) continue;
    const name = tag(b, 'NAME'), memo = tag(b, 'MEMO');
    out.push({
      date, amount,
      description: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' ') || '(no description)',
      external_id: tag(b, 'FITID'),
    });
  }
  return out;
}

// Closing balance from an OFX file, if it has one.
export function ofxBalance(text) {
  const m = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?<DTASOF>(\d{8})/i.exec(text);
  if (!m) return null;
  const amount = parseMoney(m[1]);
  return amount === null ? null : { balance: amount, date: parseDateAny(m[2]) };
}

export const isOFX = (name, text) => /\.(ofx|qfx)$/i.test(name) || /^\s*(OFXHEADER|<\?xml[^>]*>\s*<\?OFX|<OFX>)/i.test(text);

// Marks rows already in the database. Identical same-day purchases are counted, not collapsed.
export function markDuplicates(incoming, existing, accountId) {
  const key = (t) => `${t.date}|${round2(t.amount).toFixed(2)}|${normalize(t.description)}`;
  const have = new Map(); const fitids = new Set();
  for (const t of existing) {
    if (t.deleted || t.account_id !== accountId) continue;
    have.set(key(t), (have.get(key(t)) || 0) + 1);
    if (t.external_id) fitids.add(t.external_id);
  }
  const seen = new Map();
  for (const t of incoming) {
    const k = key(t);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    t.duplicate = (t.external_id && fitids.has(t.external_id)) || n < (have.get(k) || 0);
  }
  return incoming;
}
