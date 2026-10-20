// Subscription schedule math.
import { isoDate, parseISO, addDays, round2 } from './util.js';

export const FREQUENCIES = [
  ['monthly', 'Monthly', 1], ['yearly', 'Yearly', 1 / 12], ['weekly', 'Weekly', 52 / 12],
  ['biweekly', 'Every 2 weeks', 26 / 12], ['quarterly', 'Every 3 months', 1 / 3],
];

function step(d, freq, anchorDay) {
  if (freq === 'weekly') return addDays(d, 7);
  if (freq === 'biweekly') return addDays(d, 14);
  const months = freq === 'yearly' ? 12 : freq === 'quarterly' ? 3 : 1;
  const y = d.getFullYear(), m = d.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(anchorDay, last)); // the 31st becomes the 30th in a short month
}

// The next charge on or after `from`.
export function nextCharge(sub, from = new Date()) {
  let d = parseISO(sub.next_date);
  const day = d.getDate();
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 1000 && d < today; i++) d = step(d, sub.frequency, day);
  return isoDate(d);
}

export const monthlyCost = (sub) => round2(sub.amount * (FREQUENCIES.find((f) => f[0] === sub.frequency)?.[2] ?? 1));
export const daysUntil = (iso, from = new Date()) => Math.round((parseISO(iso) - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 864e5);
