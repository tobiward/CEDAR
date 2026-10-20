// The database: one Google Sheet, one tab per table, a header row naming the columns.
// Rows are never removed (deletes set `deleted`), so row numbers stay stable for every partner.
import { api, fileVersion } from './google.js';

export const SCHEMA = {
  // source: 'statement', 'receipt' or 'manual' (blank on older rows: statement if import_id is set).
  Transactions: ['id', 'date', 'description', 'amount', 'type', 'category_id', 'account_id', 'note', 'entered_by', 'import_id', 'external_id', 'updated_at', 'deleted', 'source', 'transfer_account', 'pair_id'],
  Categories: ['id', 'name', 'kind', 'monthly_budget', 'sort', 'archived', 'updated_at', 'deleted'],
  // balance is as of balance_date (a statement's closing date, or when entered by hand).
  // rate: APR for debts, APY for savings (percent). payment: monthly payment on a debt.
  // available_mode: 'full', 'payment' (debts only) or 'none' — how the account counts toward "available".
  Accounts: ['id', 'name', 'type', 'balance', 'updated_at', 'deleted', 'balance_date', 'rate', 'payment', 'available_mode'],
  // A savings goal; its saved amount is the sum of its GoalEntries. account_id is the account holding the money.
  // monthly_pct: plan to save this percent of average monthly income instead of a fixed monthly amount.
  Goals: ['id', 'name', 'target', 'target_date', 'account_id', 'monthly', 'color', 'sort', 'done', 'note', 'updated_at', 'deleted', 'monthly_pct'],
  GoalEntries: ['id', 'goal_id', 'date', 'amount', 'note', 'entered_by', 'updated_at', 'deleted'],
  // next_date is any past or future charge date; the next one is worked out from the frequency.
  Subscriptions: ['id', 'name', 'amount', 'frequency', 'next_date', 'category_id', 'account_id', 'note', 'updated_at', 'deleted'],
  Rules: ['id', 'pattern', 'category_id', 'type', 'updated_at', 'deleted'],
  Settings: ['key', 'value', 'updated_at'],
};
export const TABLES = Object.keys(SCHEMA);
export const idField = (table) => (table === 'Settings' ? 'key' : 'id');

const NUMBER = new Set(['amount', 'monthly_budget', 'balance', 'sort', 'rate', 'payment', 'target', 'monthly', 'monthly_pct']);
const BOOL = new Set(['deleted', 'archived', 'done']);
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

const colLetter = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// Turn sheet cells into typed objects, flagging anything hand-edited into a bad state.
function readRow(table, headers, cells, rowNum, issues) {
  const o = { _row: rowNum };
  headers.forEach((h, i) => {
    if (!h) return;
    let v = cells[i] ?? '';
    if (NUMBER.has(h)) {
      if (v === '') v = 0;
      else if (typeof v !== 'number') {
        const n = Number(String(v).replace(/[$,\s]/g, ''));
        if (Number.isNaN(n)) { issues.push(`${table} row ${rowNum}: "${v}" in ${h} isn't a number`); v = 0; } else v = n;
      }
    } else if (BOOL.has(h)) v = v === true || String(v).toUpperCase() === 'TRUE';
    else v = String(v);
    o[h] = v;
  });
  if (table === 'Transactions' && o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
    issues.push(`Transactions row ${rowNum}: date "${o.date}" should look like 2026-10-19`);
    return null;
  }
  if (!o[idField(table)]) {
    if (cells.some((c) => c !== '' && c != null)) issues.push(`${table} row ${rowNum} has no ${idField(table)} and was skipped`);
    return null;
  }
  return o;
}

export class SheetStore {
  constructor(id) { this.id = id; this.headers = {}; }

  get url() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }

  static async create(title) {
    const sheet = await api(SHEETS, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title },
        sheets: TABLES.map((t) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })),
      }),
    });
    const store = new SheetStore(sheet.spreadsheetId);
    await store.writeHeaders(TABLES);
    return store;
  }

  async writeHeaders(tables) {
    await api(`${SHEETS}/${this.id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: tables.map((t) => ({ range: `${t}!A1`, values: [SCHEMA[t]] })) }),
    });
    tables.forEach((t) => { this.headers[t] = [...SCHEMA[t]]; });
  }

  version() { return fileVersion(this.id); }

  async title() {
    const r = await api(`${SHEETS}/${this.id}?fields=properties.title`);
    return r.properties.title;
  }

  // Adds tabs or columns a newer CEDAR version expects to an older sheet.
  async migrate(existingTabs) {
    const missing = TABLES.filter((t) => !existingTabs.includes(t));
    if (missing.length) {
      await api(`${SHEETS}/${this.id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: missing.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) }),
      });
      await this.writeHeaders(missing);
    }
    for (const t of TABLES) {
      const have = this.headers[t] || [];
      const add = SCHEMA[t].filter((c) => !have.includes(c));
      if (add.length) {
        const start = have.length;
        await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${t}!${colLetter(start)}1`)}?valueInputOption=RAW`, {
          method: 'PUT', body: JSON.stringify({ values: [add] }),
        });
        this.headers[t] = [...have, ...add];
      }
    }
  }

  async loadAll() {
    const meta = await api(`${SHEETS}/${this.id}?fields=sheets.properties.title`);
    const tabs = meta.sheets.map((s) => s.properties.title);
    const present = TABLES.filter((t) => tabs.includes(t));
    const ranges = present.map((t) => `ranges=${encodeURIComponent(`${t}!A1:Z`)}`).join('&');
    const res = present.length
      ? await api(`${SHEETS}/${this.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`)
      : { valueRanges: [] };
    const issues = [];
    const tables = Object.fromEntries(TABLES.map((t) => [t, []]));
    present.forEach((t, i) => {
      const values = res.valueRanges[i].values || [];
      this.headers[t] = (values[0] || []).map((h) => String(h).trim());
      for (let r = 1; r < values.length; r++) {
        const o = readRow(t, this.headers[t], values[r], r + 1, issues);
        if (o) tables[t].push(o);
      }
    });
    if (present.length < TABLES.length || TABLES.some((t) => SCHEMA[t].some((c) => !(this.headers[t] || []).includes(c)))) {
      await this.migrate(tabs);
    }
    return { tables, issues };
  }

  rowValues(table, obj) {
    return this.headers[table].map((h) => (obj[h] === undefined ? '' : obj[h]));
  }

  async append(table, objs) {
    if (!objs.length) return;
    const res = await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${table}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: objs.map((o) => this.rowValues(table, o)) }),
    });
    const m = /![A-Z]+(\d+)/.exec(res.updates?.updatedRange || '');
    if (m) objs.forEach((o, i) => { o._row = Number(m[1]) + i; });
  }

  // Overwrites many rows in one request, finding each row by id first.
  async updateMany(table, objs) {
    if (!objs.length) return;
    const letter = colLetter(this.headers[table].indexOf(idField(table)));
    const col = await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${table}!${letter}:${letter}`)}`);
    const rowOf = new Map((col.values || []).map((v, i) => [v[0], i + 1]));
    const last = colLetter(this.headers[table].length - 1);
    const data = [];
    for (const o of objs) {
      const r = rowOf.get(o[idField(table)]);
      if (!r) continue;
      o._row = r;
      data.push({ range: `${table}!A${r}:${last}${r}`, values: [this.rowValues(table, o)] });
    }
    for (let i = 0; i < data.length; i += 500) {
      await api(`${SHEETS}/${this.id}/values:batchUpdate`, {
        method: 'POST', idempotent: true, body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 500) }),
      });
    }
  }

  async update(table, obj) {
    const idCol = this.headers[table].indexOf(idField(table));
    const letter = colLetter(idCol);
    let row = obj._row;
    // Confirm the row still holds this record (someone may have sorted the sheet by hand).
    const check = await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${table}!${letter}${row}`)}`);
    if (check.values?.[0]?.[0] !== obj[idField(table)]) {
      const col = await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${table}!${letter}:${letter}`)}`);
      const idx = (col.values || []).findIndex((v) => v[0] === obj[idField(table)]);
      if (idx < 0) return this.append(table, [obj]);
      row = idx + 1; obj._row = row;
    }
    const last = colLetter(this.headers[table].length - 1);
    await api(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${table}!A${row}:${last}${row}`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [this.rowValues(table, obj)] }),
    });
  }
}

// In-memory store with the same interface, used by demo mode (?demo=1) and tests.
export class MemoryStore {
  constructor(tables = {}) {
    this.id = 'demo';
    this.url = '#';
    this.v = 1;
    this.tables = Object.fromEntries(TABLES.map((t) => [t, (tables[t] || []).map((o) => ({ ...o }))]));
  }
  async title() { return 'CEDAR demo household'; }
  async version() { return String(this.v); }
  async loadAll() {
    const tables = Object.fromEntries(TABLES.map((t) => [t, this.tables[t].map((o, i) => ({ ...o, _row: i + 2 }))]));
    return { tables, issues: [] };
  }
  async append(table, objs) {
    objs.forEach((o) => { o._row = this.tables[table].length + 2; this.tables[table].push({ ...o }); });
    this.v++;
  }
  async updateMany(table, objs) { for (const o of objs) await this.update(table, o); }
  async update(table, obj) {
    const i = this.tables[table].findIndex((o) => o[idField(table)] === obj[idField(table)]);
    if (i < 0) this.tables[table].push({ ...obj }); else this.tables[table][i] = { ...obj };
    this.v++;
  }
}
