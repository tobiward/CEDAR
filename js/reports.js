// Spending math. Amounts: negative = money out. Spending counts only type "expense"; transfers never count.
import { isoDate, round2 } from './util.js';
import { normalize, merchantKey } from './categorize.js';

const live = (rows) => rows.filter((r) => !r.deleted);
export const UNCATEGORIZED = '__uncategorized';

export function inRange(txns, start, end) {
  const s = typeof start === 'string' ? start : isoDate(start);
  const e = typeof end === 'string' ? end : isoDate(end);
  return live(txns).filter((t) => t.date >= s && t.date < e);
}

export function totals(txns) {
  let spent = 0, income = 0;
  for (const t of txns) {
    if (t.type === 'expense') spent -= t.amount;
    else if (t.type === 'income') income += t.amount;
  }
  return { spent: round2(spent), income: round2(income), net: round2(income - spent) };
}

export function spentByCategory(txns) {
  const m = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    const k = t.category_id || UNCATEGORIZED;
    m.set(k, round2((m.get(k) || 0) - t.amount));
  }
  return m;
}

export function statusOf(spent, budget) {
  if (budget <= 0) return spent > 0 ? 'unbudgeted' : 'none';
  if (spent > budget) return 'over';
  if (spent >= budget * 0.9) return 'near';
  return 'ok';
}

// One row per expense category: budget for the range vs. what was spent.
export function budgetRows(categories, spentMap, factor) {
  const rows = live(categories)
    .filter((c) => c.kind === 'expense' && (!c.archived || spentMap.get(c.id)))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((c) => {
      const budget = round2((c.monthly_budget || 0) * factor);
      const spent = spentMap.get(c.id) || 0;
      return { id: c.id, name: c.name, budget, spent, left: round2(budget - spent), pct: budget > 0 ? spent / budget : 0, status: statusOf(spent, budget) };
    });
  const unc = spentMap.get(UNCATEGORIZED);
  if (unc) rows.push({ id: UNCATEGORIZED, name: 'Uncategorized', budget: 0, spent: unc, left: -unc, pct: 0, status: 'unbudgeted' });
  return rows;
}

export const monthKey = (iso) => iso.slice(0, 7);
const monthBounds = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, isoDate(new Date(y, m, 1))];
};
const shiftMonth = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  return isoDate(new Date(y, m - 1 + k, 1)).slice(0, 7);
};

export function monthReport(data, ym) {
  const [s, e] = monthBounds(ym);
  const txns = inRange(data.Transactions, s, e);
  const t = totals(txns);
  const rows = budgetRows(data.Categories, spentByCategory(txns), 1);
  const budget = round2(rows.reduce((a, r) => a + r.budget, 0));

  const prevYm = shiftMonth(ym, -1);
  const prev = totals(inRange(data.Transactions, ...monthBounds(prevYm)));
  // Average of up to 6 earlier months that have data.
  const earlier = [];
  for (let k = 1; k <= 6; k++) {
    const mk = shiftMonth(ym, -k);
    const tx = inRange(data.Transactions, ...monthBounds(mk));
    if (tx.length) earlier.push(totals(tx).spent);
  }
  const avg = earlier.length ? round2(earlier.reduce((a, b) => a + b, 0) / earlier.length) : null;

  const merchants = new Map();
  for (const x of txns) {
    if (x.type !== 'expense') continue;
    const k = merchantKey(x.description) || normalize(x.description);
    merchants.set(k, round2((merchants.get(k) || 0) - x.amount));
  }
  const topMerchants = [...merchants].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, amount]) => ({ name, amount }));
  const largest = txns.filter((x) => x.type === 'expense').sort((a, b) => a.amount - b.amount).slice(0, 5);

  return { ym, ...t, budget, rows, count: txns.length, prevSpent: prev.spent, prevHasData: inRange(data.Transactions, ...monthBounds(prevYm)).length > 0, avgSpent: avg, topMerchants, largest };
}

export function yearReport(data, year, today = new Date()) {
  const cats = live(data.Categories).filter((c) => c.kind === 'expense').sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const curYm = isoDate(today).slice(0, 7);
  const months = [];
  const grid = new Map(cats.map((c) => [c.id, Array(12).fill(0)]));
  grid.set(UNCATEGORIZED, Array(12).fill(0));
  const monthlyBudget = round2(cats.filter((c) => !c.archived).reduce((a, c) => a + (c.monthly_budget || 0), 0));

  for (let m = 0; m < 12; m++) {
    const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
    const txns = inRange(data.Transactions, ...monthBounds(ym));
    const t = totals(txns);
    const state = ym > curYm ? 'future' : txns.length ? 'data' : 'missing';
    months.push({ ym, m, state, ...t });
    for (const [k, v] of spentByCategory(txns)) {
      if (!grid.has(k)) grid.set(k, Array(12).fill(0));
      grid.get(k)[m] = v;
    }
  }
  const counted = months.filter((x) => x.state === 'data');
  const ytdSpent = round2(counted.reduce((a, x) => a + x.spent, 0));
  const ytdIncome = round2(counted.reduce((a, x) => a + x.income, 0));
  const ytdBudget = round2(monthlyBudget * counted.length);
  const rows = [...cats.map((c) => ({ id: c.id, name: c.name, archived: c.archived, monthly: c.monthly_budget || 0 })), { id: UNCATEGORIZED, name: 'Uncategorized', monthly: 0 }]
    .map((r) => {
      const vals = grid.get(r.id);
      const total = round2(vals.reduce((a, b) => a + b, 0));
      const ytdB = round2(r.monthly * counted.length);
      return { ...r, vals, total, ytdBudget: ytdB, status: statusOf(total, ytdB) };
    })
    .filter((r) => r.total > 0 || (r.monthly > 0 && !r.archived));
  return { year, months, rows, monthlyBudget, ytdSpent, ytdIncome, ytdBudget, monthsCounted: counted.length };
}

export function earliestDate(txns) {
  let e = null;
  for (const t of live(txns)) if (!e || t.date < e) e = t.date;
  return e;
}
