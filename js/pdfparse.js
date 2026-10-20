// Bank statement PDFs → transactions. Works from positioned text (what pdf.js extracts),
// so it handles separate Withdrawal/Deposit columns, wrapped descriptions, two date columns,
// running balances and several accounts in one statement.
import { isoDate, round2 } from './util.js';
import { parseMoney } from './importer.js';

const DATE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/;
const MONEY = /^\(?-?\$?(\d{1,3}(,\d{3})+|\d+)\.\d{2}\)?-?$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SKIP_DESC = /^(beginning|opening|previous|ending|closing|new)\s+balance|^balance\s+(forward|brought)|^total\b/i;

// Split pdf.js items into word tokens with estimated positions.
function tokenize(items) {
  const out = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const per = s.length ? (it.w || 0) / s.length : 0;
    const re = /\S+/g; let m;
    while ((m = re.exec(s))) out.push({ s: m[0], x0: it.x + m.index * per, x1: it.x + (m.index + m[0].length) * per, y: it.y });
  }
  return out;
}

function toLines(tokens) {
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines = [];
  for (const t of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - t.y) <= 2.5) last.t.push(t);
    else lines.push({ y: t.y, t: [t] });
  }
  for (const l of lines) l.t = l.t.filter((t) => t.s !== '$').sort((a, b) => a.x0 - b.x0);
  return lines.filter((l) => l.t.length);
}

const center = (t) => (t.x0 + t.x1) / 2;
const text = (toks) => toks.map((t) => t.s).join(' ');

// Statement period from dates that carry a year: "09-01-2026", "September 30, 2026".
export function statementPeriod(fullText, today = new Date()) {
  const dates = [];
  for (const m of fullText.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/g)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[1] >= 1 && +m[1] <= 12) dates.push(new Date(y, m[1] - 1, +m[2]));
  }
  for (const m of fullText.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi)) {
    dates.push(new Date(+m[3], MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2]));
  }
  const valid = dates.filter((d) => !Number.isNaN(+d) && d.getFullYear() > 1990);
  if (!valid.length) return { start: null, end: today };
  return { start: new Date(Math.min(...valid)), end: new Date(Math.max(...valid)) };
}

function resolveDate(tok, period) {
  const m = DATE.exec(tok);
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[3]) { let y = +m[3]; if (y < 100) y += 2000; return isoDate(new Date(y, mo - 1, d)); }
  const end = period.end;
  let dt = new Date(end.getFullYear(), mo - 1, d);
  if (dt - end > 31 * 864e5) dt = new Date(end.getFullYear() - 1, mo - 1, d); // Dec dates on a January statement
  return isoDate(dt);
}

function headerCols(toks) {
  const cols = {};
  for (const t of toks) {
    const w = t.s.toLowerCase().replace(/[^a-z]/g, '');
    if (/^(withdrawals?|debits?|charges|paymentsdebits)$/.test(w)) cols.debit = center(t);
    else if (/^(deposits?|credits?|paymentscredits)$/.test(w)) cols.credit = center(t);
    else if (/^balance$/.test(w)) cols.balance = center(t);
    else if (/^amount$/.test(w)) cols.amount = center(t);
  }
  const s = text(toks).toLowerCase();
  const looksHeader = /date/.test(s) && /(description|transaction|details|payee)/.test(s);
  return looksHeader && (cols.debit || cols.credit || cols.amount) ? cols : null;
}

const SECTION = /(.*?)\b(?:account|acct)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*[*xX•·.\s]*(\d{3,})\b/i;

export function parseStatementPages(pages, today = new Date()) {
  const allText = pages.map((items) => items.map((i) => i.str).join(' ')).join('\n');
  const period = statementPeriod(allText, today);
  const sections = [];
  let sec = null;
  const newSection = (name, last4) => {
    sec = { name: name || (last4 ? `Account ··${last4}` : 'Statement'), last4: last4 || '', txns: [], endBalance: null };
    sections.push(sec);
  };
  let cols = null; let prevBal = null; let lastTxn = null;

  for (const items of pages) {
    const lines = toLines(tokenize(items));
    lastTxn = null;
    for (const line of lines) {
      const toks = line.t;
      const lineText = text(toks);

      const sm = SECTION.exec(lineText);
      if (sm && !DATE.test(toks[0].s)) {
        const name = sm[1].replace(/[^\w &'-]/g, ' ').replace(/\s+/g, ' ').trim();
        const last4 = sm[2].slice(-4);
        if (!sec || sec.last4 !== last4) { newSection(name && name.length <= 40 ? titleCase(name) : '', last4); cols = null; prevBal = null; }
        lastTxn = null; continue;
      }
      const hc = headerCols(toks);
      if (hc) { cols = hc; lastTxn = null; continue; }

      // Leading dates (one or two columns), trailing money (amount, balance).
      let i = 0; const dates = [];
      while (i < toks.length && i < 2 && DATE.test(toks[i].s)) dates.push(toks[i++]);
      // Money may sit before the description (Date | Credit | Debit | Balance | Description) or after it.
      let k = i;
      if (dates.length) while (k < toks.length && MONEY.test(toks[k].s)) k++;
      let j = toks.length;
      while (j > k && MONEY.test(toks[j - 1].s)) j--;
      const money = [...toks.slice(i, k), ...toks.slice(j)];
      const desc = toks.slice(k, j);

      if (dates.length && money.length) {
        const description = text(desc).replace(/\s+/g, ' ').trim();
        let amount = null; let balance = null;
        if (cols) {
          for (const mt of money) {
            const c = center(mt);
            const best = Object.entries(cols).sort((a, b) => Math.abs(a[1] - c) - Math.abs(b[1] - c))[0][0];
            const v = parseMoney(mt.s);
            if (best === 'balance') balance = v;
            else if (best === 'debit') amount = -Math.abs(v);
            else if (best === 'credit') amount = Math.abs(v);
            else amount = v;
          }
        } else if (money.length >= 2) {
          amount = parseMoney(money.at(-2).s); balance = parseMoney(money.at(-1).s);
        } else amount = parseMoney(money[0].s);

        if (SKIP_DESC.test(description)) {
          if (balance !== null || amount !== null) prevBal = balance ?? amount;
          if (sec && prevBal !== null) sec.endBalance = prevBal;
          lastTxn = null; continue;
        }
        // A running balance settles the sign whenever the change matches the amount.
        if (balance !== null && prevBal !== null && amount !== null) {
          const diff = round2(balance - prevBal);
          if (Math.abs(Math.abs(diff) - Math.abs(amount)) < 0.005) amount = diff;
        }
        if (balance !== null) { prevBal = balance; if (sec) sec.endBalance = balance; }
        if (amount === null || amount === 0) { lastTxn = null; continue; }
        const date = resolveDate(dates[0].s, period);
        if (!date) continue;
        if (!sec) newSection('', '');
        lastTxn = { date, description: description || '(no description)', amount: round2(amount), external_id: '', _x: desc[0]?.x0 ?? toks[0].x0, _y: line.y };
        sec.txns.push(lastTxn);
        continue;
      }

      // A wrapped description continues on the next line, starting under the description column.
      if (lastTxn && !dates.length && !money.length && lastTxn._y - line.y < 14 && toks[0].x0 >= lastTxn._x - 3) {
        lastTxn.description = `${lastTxn.description} ${lineText}`.trim();
        lastTxn._y = line.y;
        continue;
      }
      lastTxn = null;
    }
  }
  for (const s of sections) s.txns.forEach((t) => { delete t._x; delete t._y; });
  return { period, sections: sections.filter((s) => s.txns.length) };
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Loads pdf.js on demand (only when someone imports a PDF) from CEDAR's own lib folder,
// never from a CDN. tools/fetch_libs.py puts it there.
const PDFJS_BASE = new URL('../lib/pdfjs/', import.meta.url).href;
let pdfjsPromise = null;
async function loadPdfjs() {
  pdfjsPromise ||= (async () => {
    try {
      const lib = await import(`${PDFJS_BASE}pdf.min.mjs`);
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
      return lib;
    } catch (e) {
      pdfjsPromise = null;
      throw new Error('This copy of CEDAR is missing its PDF reader. Run tools/fetch_libs.py (see the README), or import a CSV or OFX file instead.', { cause: e });
    }
  })();
  return pdfjsPromise;
}

export async function extractPdfPages(file) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.filter((i) => i.str !== undefined).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
  }
  return pages;
}
