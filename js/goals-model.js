// Savings goal math: what's saved, what's needed, and when it will be done (with the account's interest).
import { isoDate, parseISO, round2, MONTHS } from './util.js';

export const GOAL_COLORS = ['#5E8A45', '#2F7A72', '#D9973A', '#3F6E9E', '#7D3C5C', '#B5472E', '#4E9A8B', '#6B5BA3'];
export const goalColor = (g) => GOAL_COLORS[(Number(g.color) || 0) % GOAL_COLORS.length];

export const savedFor = (goal, entries) => round2(entries.filter((e) => !e.deleted && e.goal_id === goal.id).reduce((s, e) => s + e.amount, 0));

const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const monthLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Months until saved reaches target, adding `monthly` each month with interest at `apy` percent.
export function monthsToReach(saved, target, monthly, apy = 0) {
  if (saved >= target) return 0;
  const r = apy / 100 / 12;
  if (monthly <= 0 && (r === 0 || saved <= 0)) return null;
  let b = saved;
  for (let m = 1; m <= 1200; m++) { b = b * (1 + r) + monthly; if (b >= target) return m; }
  return null;
}

// Monthly amount needed to go from saved to target in n months at `apy` percent.
export function monthlyNeeded(saved, target, n, apy = 0) {
  if (saved >= target) return 0;
  if (n <= 0) return round2(target - saved);
  const r = apy / 100 / 12;
  if (r === 0) return round2((target - saved) / n);
  const g = (1 + r) ** n;
  return round2(Math.max((target - saved * g) * r / (g - 1), 0));
}

// Everything the goal card needs to tell the household how it's going.
export function goalStatus(goal, saved, apy = 0, today = new Date(), income = 0) {
  const target = goal.target || 0;
  const pct = target > 0 ? Math.min(saved / target, 1) : 0;
  const monthly = plannedMonthly(goal, income);
  const left = round2(Math.max(target - saved, 0));
  if (target > 0 && saved >= target) return { pct: 1, left: 0, status: 'done', line: 'Goal reached. Nice work.' };

  const finishIn = monthsToReach(saved, target, monthly, apy);
  const finish = finishIn === null ? null : addMonths(today, finishIn);
  if (goal.target_date) {
    const due = parseISO(goal.target_date);
    const n = monthsBetween(today, due);
    if (n < 0) return { pct, left, status: 'over', line: `The target date has passed with ${fmt(left)} to go. Pick a new date to see a plan.` };
    const need = monthlyNeeded(saved, target, Math.max(n, 1), apy);
    if (monthly >= need - 0.5) {
      return { pct, left, need, finish, status: 'ok', line: `On track for ${monthLabel(due)}${finish && monthLabel(finish) !== monthLabel(due) && finish < due ? `, maybe as early as ${monthLabel(finish)}` : ''}. Keep adding ${fmt(monthly)} a month.` };
    }
    const late = finish ? ` At ${fmt(monthly)} a month you’d finish in ${monthLabel(finish)}.` : '';
    return { pct, left, need, finish, status: 'near', line: `Save ${fmt(need)} a month to reach it by ${monthLabel(due)}.${monthly ? late : ''}` };
  }
  if (finish) return { pct, left, finish, status: 'ok', line: `At ${fmt(monthly)} a month you’ll reach it in ${monthLabel(finish)}.` };
  return { pct, left, status: 'none', line: 'Set a monthly amount or a target date to see a plan.' };
}

const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// Average monthly spending over the last three months with data, for sizing an emergency fund.
export function avgMonthlySpending(txns) {
  const months = [...new Set(txns.filter((t) => !t.deleted).map((t) => t.date.slice(0, 7)))].sort().slice(-3);
  if (!months.length) return 0;
  const spent = txns.filter((t) => !t.deleted && t.type === 'expense' && months.includes(t.date.slice(0, 7))).reduce((s, t) => s - t.amount, 0);
  return round2(spent / months.length);
}

// Average monthly income over the last three months with data.
export function avgMonthlyIncome(txns) {
  const months = [...new Set(txns.filter((t) => !t.deleted).map((t) => t.date.slice(0, 7)))].sort().slice(-3);
  if (!months.length) return 0;
  const inc = txns.filter((t) => !t.deleted && t.type === 'income' && months.includes(t.date.slice(0, 7))).reduce((s, t) => s + t.amount, 0);
  return round2(inc / months.length);
}

// The monthly amount a goal plans to add: a fixed amount, or a percent of average income.
export const plannedMonthly = (goal, income) => (goal.monthly_pct > 0 ? round2(income * goal.monthly_pct / 100) : goal.monthly || 0);

// Share of income kept over the last three months with data.
export function savingsRate(txns) {
  const months = [...new Set(txns.filter((t) => !t.deleted).map((t) => t.date.slice(0, 7)))].sort().slice(-3);
  let inc = 0, sp = 0;
  for (const t of txns) {
    if (t.deleted || !months.includes(t.date.slice(0, 7))) continue;
    if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') sp -= t.amount;
  }
  return inc > 0 ? (inc - sp) / inc : null;
}

export const todayMonthStart = () => { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); };
