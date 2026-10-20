// Reads screenshots of an account from a mobile banking app: account name, balance and recent activity.
import { isoDate, round2, addDays, MONTHS } from './util.js';
import { parseDateAny } from './importer.js';
import { ocrText, askClaudeJSON } from './receipt.js';

const MONEY = /([+\-−–]?)\s?\(?\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\)?|([+\-−–]?)(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g;
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_INLINE = new RegExp(`\\b(${MONTH_RE}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)\\b`, 'i');
const IN_WORDS = /\b(deposit|payroll|direct dep|refund|credit|transfer from|xfer from|interest paid|interest earned|received|from\s+\w+|cashback|cash ?out|reversal)\b/i;

function moneyIn(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const sign = m[1] || m[4] || '';
    const v = Number(`${(m[2] || m[5]).replace(/,/g, '')}.${m[3] || m[6]}`);
    const neg = /[-−–]/.test(sign) || /^\(.*\)$/.test(m[0].trim());
    out.push({ v, signed: neg ? -v : sign === '+' ? v : null, text: m[0] });
  }
  return out;
}

// A date from a line like "Today", "Yesterday", "Oct 18", "Mon, Oct 18, 2026" or "10/18".
function dateFrom(text, today) {
  if (/\btoday\b/i.test(text)) return isoDate(today);
  if (/\byesterday\b/i.test(text)) return isoDate(addDays(today, -1));
  const m = DATE_INLINE.exec(text);
  if (!m) return null;
  let s = m[1];
  if (!/\d{4}/.test(s)) s = /\//.test(s) ? `${s}/${today.getFullYear()}` : `${s}, ${today.getFullYear()}`;
  let d = parseDateAny(s.replace(/sept/i, 'Sep'));
  // A date in the future without a year belongs to last year.
  if (d && new Date(d) > addDays(today, 1)) d = parseDateAny(s.replace(String(today.getFullYear()), String(today.getFullYear() - 1)));
  return d;
}

export function parseScreenshotText(text, today = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let accountName = '', last4 = '', balance = null, balanceKind = '';
  const txns = [];
  let curDate = null, pendingBlock = false, carry = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const money = moneyIn(l);
    if (!accountName) {
      const m = /([A-Za-z][A-Za-z '&+-]*(?:checking|savings|share|card|credit|loan|account|visa|mastercard)[A-Za-z '&+-]*)\s*(?:\(|-|\.{2,}|[x•·*…]+\s*)?\s*(\d{4})?/i.exec(l);
      if (m && !money.length && !/balance/i.test(l)) { accountName = m[1].replace(/[\sx•·*.…-]+$/i, '').trim(); last4 = m[2] || (/(\d{4})\D*$/.exec(l) || [])[1] || ''; continue; }
    }
    if (/balance/i.test(l)) {
      const kind = /available/i.test(l) ? 'available' : 'current';
      const val = money[0]?.v ?? moneyIn(lines[i + 1] || '')[0]?.v ?? null;
      // Prefer the current (posted) balance; take available only if nothing else is shown.
      if (val !== null && (balance === null || (balanceKind === 'available' && kind === 'current'))) { balance = val; balanceKind = kind; }
      if (!money.length && moneyIn(lines[i + 1] || '').length) i++;
      carry = [];
      continue;
    }
    if (/^pending\b/i.test(l) && !money.length) { pendingBlock = true; carry = []; continue; }
    const d = dateFrom(l, today);
    const rest = l.replace(DATE_INLINE, '').replace(/\b(today|yesterday)\b/ig, '').replace(MONEY, '').replace(/\bpending\b/ig, '').replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b,?/ig, '').replace(/[•·|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!money.length) {
      if (d && rest.length < 4) { curDate = d; pendingBlock = false; continue; } // a date heading
      if (rest) carry.push(rest);
      if (carry.length > 2) carry.shift();
      continue;
    }
    // A transaction line: the first amount is the transaction; a second one is usually a running balance.
    const amt = money[0];
    const description = (rest.length >= 3 ? rest : carry.join(' ')).trim() || 'Bank activity';
    const signed = amt.signed ?? (IN_WORDS.test(description) ? amt.v : -amt.v);
    txns.push({
      date: d || curDate || isoDate(today), description, amount: round2(signed),
      pending: pendingBlock || /pending/i.test(l) || /pending/i.test(lines[i + 1] || ''), external_id: '',
    });
    carry = [];
  }
  return { accountName, last4, balance, txns };
}

const PROMPT = `This is a screenshot from a mobile banking app. Reply with only JSON:
{"account_name": string or null, "last4": last 4 digits of the account number or null, "balance": current balance as a number or null,
 "transactions": [{"date": "YYYY-MM-DD", "description": merchant or description, "amount": number, negative for money out and positive for money in, "pending": true or false}]}.
Today is ${isoDate(new Date())}. Use this year for dates without a year. Don't include balances as transactions.`;

export async function readScreenshot(file, { aiKey, onProgress } = {}) {
  if (aiKey) {
    try {
      const j = await askClaudeJSON(file, aiKey, PROMPT, { maxSide: 2400, maxTokens: 2500 });
      return {
        accountName: String(j.account_name || ''), last4: String(j.last4 || '').slice(-4), balance: j.balance == null ? null : round2(Number(j.balance)),
        txns: (j.transactions || []).map((t) => ({ date: parseDateAny(t.date) || isoDate(new Date()), description: String(t.description || 'Bank activity'), amount: round2(Number(t.amount) || 0), pending: !!t.pending, external_id: '' })).filter((t) => t.amount),
        via: 'ai',
      };
    } catch (e) { console.warn('AI screenshot reading failed, using on-device reading', e); }
  }
  return { ...parseScreenshotText(await ocrText(file, onProgress, 2400)), via: 'device' };
}

export { MONTHS };
