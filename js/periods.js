// Budget periods. Budgets are stored as monthly amounts and scaled to the chosen period.
import { addDays, isoDate, parseISO, fmtDate, MONTHS, MONTHS_LONG } from './util.js';

export const PERIODS = [
  { id: 'daily', label: 'Daily', perYear: 365 },
  { id: 'weekly', label: 'Weekly', perYear: 52 },
  { id: 'biweekly', label: 'Biweekly', perYear: 26 },
  { id: 'monthly', label: 'Monthly', perYear: 12 },
  { id: 'quarterly', label: 'Quarterly', perYear: 4 },
  { id: 'yearly', label: 'Yearly', perYear: 1 },
];
export const LOOKBACKS = [
  { n: 1, label: 'This period' },
  { n: 3, label: 'Last 3 periods' },
  { n: 6, label: 'Last 6 periods' },
  { n: 12, label: 'Last 12 periods' },
  { n: 0, label: 'All time' },
];

export const budgetFactor = (type) => 12 / PERIODS.find((p) => p.id === type).perYear;

// { start, end } as Dates; end is exclusive.
export function periodRange(type, ref, anchorISO) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  switch (type) {
    case 'daily': return { start: d, end: addDays(d, 1) };
    case 'weekly': { const s = addDays(d, -d.getDay()); return { start: s, end: addDays(s, 7) }; }
    case 'biweekly': {
      const a = parseISO(anchorISO || `${d.getFullYear()}-01-01`);
      const k = Math.floor(Math.round((d - a) / 864e5) / 14);
      const s = addDays(a, k * 14);
      return { start: s, end: addDays(s, 14) };
    }
    case 'monthly': return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
    case 'quarterly': { const q = Math.floor(d.getMonth() / 3) * 3; return { start: new Date(d.getFullYear(), q, 1), end: new Date(d.getFullYear(), q + 3, 1) }; }
    default: return { start: new Date(d.getFullYear(), 0, 1), end: new Date(d.getFullYear() + 1, 0, 1) };
  }
}

// The current period plus the n-1 before it; n = 0 reaches back to the earliest data.
export function lookbackRange(type, n, ref, anchorISO, earliestISO) {
  const current = periodRange(type, ref, anchorISO);
  let start = current.start; let count = 1;
  const stop = n === 0 ? (earliestISO ? parseISO(earliestISO) : current.start) : null;
  while (n === 0 ? start > stop : count < n) {
    start = periodRange(type, addDays(start, -1), anchorISO).start;
    count++;
    if (count > 5000) break;
  }
  return { start, end: current.end, count };
}

export function periodLabel(type, { start, end }) {
  const last = addDays(end, -1);
  switch (type) {
    case 'daily': return fmtDate(isoDate(start), true);
    case 'monthly': return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
    case 'quarterly': return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
    case 'yearly': return String(start.getFullYear());
    default: return `${fmtDate(isoDate(start))} – ${fmtDate(isoDate(last), start.getFullYear() !== last.getFullYear())}`;
  }
}

export function rangeLabel(type, range, count) {
  if (count === 1) return periodLabel(type, range);
  const last = addDays(range.end, -1);
  return `${MONTHS[range.start.getMonth()]} ${range.start.getDate()}, ${range.start.getFullYear()} – ${MONTHS[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
}

// Share of the period elapsed (0–1) as of today.
export function elapsedShare({ start, end }, now = new Date()) {
  const t = Math.min(Math.max(now - start, 0), end - start);
  return t / (end - start);
}
