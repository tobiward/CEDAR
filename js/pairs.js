// A card payment or a move between the household's own accounts shows up twice: leaving one account
// and arriving in another. Pairing the two makes both a transfer, so paying the card isn't counted as
// spending on top of the purchases it paid for.
import { parseISO } from './util.js';
import { movementKind } from './categorize.js';
import { isLoan } from './accounts-model.js';

const DAY = 86400000;
const gap = (out, inn) => (parseISO(inn.date) - parseISO(out.date)) / DAY;
const PAY_WORDS = /\b(PAYMENT|PMT|AUTOPAY|AUTO PAY|THANK YOU)\b/i;

function rules(categories) {
  const moveCats = new Set(categories.filter((c) => !c.deleted && ['debt payments', 'transfers out', 'cash'].includes(c.name.toLowerCase())).map((c) => c.id));
  const moveWords = (t) => ['xfer', 'atm'].includes(movementKind(t.description)) || PAY_WORDS.test(t.description);
  const looksMove = (t) => t.type === 'transfer' || moveCats.has(t.category_id) || moveWords(t);
  const canOut = (t) => t.amount < 0 && (t.type === 'transfer' || (t.type === 'expense' && (!t.category_id || moveCats.has(t.category_id))));
  // Incoming money already given an income category still pairs when its wording is a payment, transfer or ATM deposit.
  const canIn = (t) => t.amount > 0 && (t.type === 'transfer' || (t.type === 'income' && (!t.category_id || moveWords(t))));
  return { looksMove, canOut, canIn };
}

// Payments to and from people (Venmo, Zelle…) are never a move between the household's own accounts.
const usable = (t, accts) => !t.deleted && !t.pair_id && t.account_id && accts.has(t.account_id) && movementKind(t.description) !== 'p2p';

// Same amount, different accounts, arriving from a day before to five days after it left.
function fits(out, inn, r) {
  if (out.account_id === inn.account_id || Math.abs(out.amount + inn.amount) > 0.005) return false;
  const d = gap(out, inn);
  return d >= -1 && d <= 5 && (r.looksMove(out) || r.looksMove(inn));
}

// Every unpaired out/in pair across the household's accounts, closest dates first.
export function findPairs(txns, accounts, categories) {
  const accts = new Set(accounts.filter((a) => !a.deleted && !isLoan(a.type)).map((a) => a.id));
  const r = rules(categories);
  const outs = txns.filter((t) => usable(t, accts) && r.canOut(t));
  const ins = txns.filter((t) => usable(t, accts) && r.canIn(t));
  const options = [];
  for (const o of outs) for (const i of ins) if (fits(o, i, r)) options.push([Math.abs(gap(o, i)), o, i]);
  options.sort((a, b) => a[0] - b[0]);
  const used = new Set();
  const pairs = [];
  for (const [, o, i] of options) {
    if (used.has(o.id) || used.has(i.id)) continue;
    used.add(o.id); used.add(i.id);
    pairs.push({ out: o, in: i });
  }
  return pairs;
}

// The matching other side for one transaction, if there is one.
export function partnerFor(t, txns, accounts, categories) {
  const accts = new Set(accounts.filter((a) => !a.deleted && !isLoan(a.type)).map((a) => a.id));
  const r = rules(categories);
  if (!t.account_id || !accts.has(t.account_id)) return null;
  const others = txns.filter((o) => o.id !== t.id && usable(o, accts));
  const list = t.amount < 0
    ? others.filter((i) => r.canIn(i) && fits(t, i, r)).map((i) => [Math.abs(gap(t, i)), i])
    : others.filter((o) => r.canOut(o) && fits(o, t, r)).map((o) => [Math.abs(gap(o, t)), o]);
  list.sort((a, b) => a[0] - b[0]);
  return list[0]?.[1] || null;
}

// Both sides as transfers, each pointing at the other.
export const linkPair = (a, b) => [
  { ...a, type: 'transfer', category_id: '', transfer_account: b.account_id, pair_id: b.id },
  { ...b, type: 'transfer', category_id: '', transfer_account: a.account_id, pair_id: a.id },
];
