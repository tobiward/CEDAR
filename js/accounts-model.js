// Account types and the math for balances and "available".
import { round2 } from './util.js';
import { counterpartDigits } from './categorize.js';

// [id, label, group, default "counts against available" mode]
export const ACCOUNT_TYPES = [
  ['checking', 'Checking', 'cash', 'full'],
  ['savings', 'Savings', 'cash', 'full'],
  ['money_market', 'Money market', 'cash', 'full'],
  ['cash', 'Cash', 'cash', 'full'],
  ['investment', 'Investment / brokerage', 'invest', 'none'],
  ['retirement', 'Retirement (401k, IRA)', 'invest', 'none'],
  ['credit', 'Credit card', 'debt', 'full'],
  ['line_of_credit', 'Line of credit / HELOC', 'debt', 'full'],
  ['car_loan', 'Car loan', 'debt', 'payment'],
  ['mortgage', 'Mortgage', 'debt', 'payment'],
  ['student_loan', 'Student loan', 'debt', 'payment'],
  ['personal_loan', 'Personal loan', 'debt', 'payment'],
  ['medical', 'Medical debt', 'debt', 'payment'],
  ['other_debt', 'Other debt', 'debt', 'payment'],
];
export const GROUPS = [['cash', 'Cash & savings'], ['invest', 'Investments'], ['debt', 'Debts']];

const T = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t[0], t]));
export const typeLabel = (type) => T[type]?.[1] || type;
export const groupOf = (type) => T[type]?.[2] || 'cash';
export const isDebt = (type) => groupOf(type) === 'debt';
// Loans are paid off from another account and their purchases aren't imported, so payments to them
// stay spending (Debt payments). Cards and credit lines are imported, so payments to them are transfers.
export const isLoan = (type) => isDebt(type) && type !== 'credit' && type !== 'line_of_credit';
export const defaultMode = (type) => T[type]?.[3] || 'full';
export const modeOf = (a) => a.available_mode || defaultMode(a.type);

export const MODE_LABELS = {
  cash: [['full', 'Yes, count this balance as available'], ['none', 'No, keep it out of available (e.g. emergency fund)']],
  invest: [['none', 'No, keep it out of available'], ['full', 'Yes, count it as available']],
  debt: [['full', 'Full balance owed'], ['payment', 'Just this month’s payment'], ['none', 'Don’t subtract it']],
};

const digitsOf = (name) => (String(name).match(/(\d{3,})\D*$/) || [])[1]?.slice(-4) || '';

// Balance now: the last known balance (from a statement or typed in) plus what's happened since.
// Cash accounts add every transaction dated after it; cards subtract them (purchases raise what's owed);
// loans go down by each payment made to them, matched by account number.
export function currentBalance(a, txns) {
  const base = a.balance || 0;
  if (!a.balance_date) return { value: base, since: 0 };
  let since = 0;
  if (isLoan(a.type)) {
    const d = digitsOf(a.name);
    if (d) {
      for (const t of txns) {
        if (t.deleted || t.amount >= 0 || t.date <= a.balance_date) continue;
        const cd = counterpartDigits(t.description);
        if (cd && (cd === d || d.endsWith(cd) || cd.endsWith(d))) since += -t.amount;
      }
    }
    return { value: round2(Math.max(base - since, 0)), since: round2(-since) };
  }
  for (const t of txns) if (!t.deleted && t.account_id === a.id && t.date > a.balance_date) since += t.amount;
  since = round2(since);
  return { value: round2(isDebt(a.type) ? base - since : base + since), since };
}

// Totals for the accounts screen: what you have, what you owe, what's available to spend, and net worth.
export function accountTotals(accounts, txns) {
  let cash = 0, invest = 0, owed = 0, available = 0;
  for (const a of accounts) {
    const v = currentBalance(a, txns).value;
    const g = groupOf(a.type);
    const mode = modeOf(a);
    if (g === 'debt') {
      owed += v;
      if (mode === 'full') available -= v;
      else if (mode === 'payment') available -= Math.min(a.payment || 0, v);
    } else {
      if (g === 'cash') cash += v; else invest += v;
      if (mode === 'full') available += v;
    }
  }
  return { cash: round2(cash), invest: round2(invest), owed: round2(owed), available: round2(available), net: round2(cash + invest - owed) };
}
