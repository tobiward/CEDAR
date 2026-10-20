// Rule-based categorization. Order: household rules, then built-in starter rules, then uncategorized.

export const DEFAULT_CATEGORIES = [
  ['Housing', 'expense'], ['Groceries', 'expense'], ['Dining', 'expense'], ['Transport', 'expense'],
  ['Utilities', 'expense'], ['Subscriptions', 'expense'], ['Shopping', 'expense'], ['Health', 'expense'],
  ['Entertainment', 'expense'], ['Travel', 'expense'], ['Personal care', 'expense'], ['Gifts & giving', 'expense'],
  ['Fees & interest', 'expense'], ['Cash', 'expense'], ['Debt payments', 'expense'], ['Transfers out', 'expense'], ['Other', 'expense'],
  ['Paycheck', 'income'], ['Other income', 'income'],
];

// [pattern, category name]. Patterns match whole words in the cleaned-up description.
const STARTER = {
  Groceries: ['SAFEWAY', 'KROGER', 'WHOLE FOODS', 'WHOLEFDS', 'TRADER JOE', 'ALDI', 'PUBLIX', 'HEB', 'SMITHS', 'KING SOOPERS', 'ALBERTSONS', 'SPROUTS', 'WINCO', 'COSTCO', 'MEIJER', 'WEGMANS', 'FOOD LION', 'HY VEE', 'INSTACART', 'SAMS CLUB', 'FRED MEYER'],
  Dining: ['MCDONALD', 'MCDONALDS', 'STARBUCKS', 'CHIPOTLE', 'TACO BELL', 'WENDYS', 'SUBWAY', 'DOORDASH', 'UBER EATS', 'GRUBHUB', 'CHICK FIL A', 'DOMINOS', 'PIZZA HUT', 'PANERA', 'DUNKIN', 'SONIC', 'IN N OUT', 'DUTCH BROS', 'BARISTAS', 'TACO TIME', 'CAFE', 'RESTAURANT', 'COFFEE', 'GRILL'],
  Transport: ['SHELL', 'CHEVRON', 'EXXON', 'EXXONMOBIL', 'MOBIL', 'MAVERIK', 'CONOCO', 'SINCLAIR', 'BP', 'ARCO', 'VALERO', 'CIRCLE K', 'PILOT', 'COSTCO GAS', 'UBER', 'LYFT', 'PARKING', 'TOLL', 'JIFFY LUBE', 'AUTOZONE'],
  Subscriptions: ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY PLUS', 'DISNEYPLUS', 'APPLE COM BILL', 'YOUTUBE PREMIUM', 'GOOGLE STORAGE', 'AMAZON PRIME', 'PRIME VIDEO', 'HBO MAX', 'MAX COM', 'PARAMOUNT', 'PEACOCK', 'AUDIBLE', 'ADOBE', 'MICROSOFT 365', 'PATREON', 'CRUNCHYROLL', 'ANTHROPIC', 'PROTON', 'PORKBUN'],
  Shopping: ['AMAZON', 'AMZN', 'TARGET', 'WALMART', 'WAL MART', 'BEST BUY', 'HOME DEPOT', 'LOWES', 'ETSY', 'EBAY', 'IKEA', 'NORDSTROM', 'WM SUPERCENTER', 'KOHLS', 'TJ MAXX', 'ROSS', 'MARSHALLS', 'BARNES NOBLE'],
  Utilities: ['COMCAST', 'XFINITY', 'VERIZON', 'AT T', 'T MOBILE', 'SPECTRUM', 'ROCKY MOUNTAIN POWER', 'XCEL ENERGY', 'DUKE ENERGY', 'DOMINION', 'ENBRIDGE', 'WATER', 'ELECTRIC', 'GAS CO'],
  Housing: ['RENT', 'MORTGAGE', 'HOA', 'APARTMENTS'],
  Health: ['CVS', 'WALGREENS', 'PHARMACY', 'DENTAL', 'CLINIC', 'HOSPITAL', 'OPTOMETRY', 'GYM', 'PLANET FITNESS'],
  Entertainment: ['STEAM', 'STEAMGAMES', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'AMC', 'CINEMARK', 'TICKETMASTER', 'FANDANGO', 'JUMP TIME'],
  Travel: ['AIRLINES', 'AIRLINE', 'DELTA', 'UNITED', 'SOUTHWEST', 'FRONTIER', 'MARRIOTT', 'HILTON', 'HYATT', 'AIRBNB', 'EXPEDIA', 'HOTEL', 'SUITES', 'INN'],
  'Personal care': ['SALON', 'BARBER', 'GREAT CLIPS', 'SEPHORA', 'ULTA'],
  'Gifts & giving': ['DONATION', 'CHARITY', 'TITHE'],
  'Fees & interest': ['FEE', 'INTEREST CHARGE', 'OVERDRAFT', 'LATE CHARGE'],
};

const TRANSFER = ['TRANSFER', 'XFER', 'PAYMENT THANK YOU', 'THANK YOU PAYMENT', 'AUTOPAY', 'AUTOMATIC PAYMENT', 'ONLINE PAYMENT', 'CREDIT CARD PAYMENT', 'CARD PAYMENT', 'EPAYMENT'];
const PAYCHECK = ['PAYROLL', 'DIRECT DEP', 'DIR DEP', 'DIRECT DEPOSIT', 'SALARY', 'PAYCHECK', 'FED SAL'];

// Strip bank noise so "POS PURCHASE SHELL OIL 57444 #233 SALT LAKE" becomes "SHELL OIL SALT LAKE".
const NOISE = /\b(POS CARD PURCHASE|CARD PURCHASE|HOME BANKING|SEC PPD|POINT OF SALE (WITHDRAWAL|DEPOSIT|PURCHASE)|ACH (WITHDRAWAL|DEPOSIT|DEBIT|CREDIT)|ATM (WITHDRAWAL|DEPOSIT)|REAL TIME PAYMENT( DEPOSIT)?|RTP CREDIT( FROM)?|DEBIT CARD( PURCHASE)?|POS|PURCHASE|AUTHORIZED ON|CHECKCARD|CHECK CARD|RECURRING|ACH|SQ|TST|PP|PAYPAL|WITHDRAWAL|DEPOSIT|WEB PMTS|IDUS|CAUS|ORUS|WAUS|NYUS|CTXUS|DCUS|ARUS)\b/g;
export function normalize(desc) {
  return String(desc || '').toUpperCase()
    .replace(/[^A-Z0-9& ]+/g, ' ')
    .replace(/&/g, ' ')
    .replace(/\b\d{2}\s\d{2}\b/g, ' ')
    .replace(/\b[A-Z]*\d[A-Z\d]*\b/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A short, stable merchant name used for household rules ("SHELL OIL").
// Person-to-person payments keep the person's name ("VENMO LITZY TEJADA"), so each person can have their own rule.
// Words too common to identify a merchant on their own ("GOLDEN CORRAL" needs both words).
const GENERIC = new Set(['MARKET', 'STORE', 'STORES', 'SHOP', 'COFFEE', 'CAFE', 'RESTAURANT', 'SERVICE', 'SERVICES', 'AMERICAN', 'IDAHO',
  'CAPITAL', 'GOLDEN', 'BURGER', 'PIZZA', 'DOLLAR', 'CHICK', 'FAMILY', 'CREDIT', 'PAYMENT', 'ONLINE', 'NATIONAL', 'GENERAL', 'CENTRAL',
  'PREMIUM', 'SUPERCENTER', 'INTERNATIONAL', 'COUNTY', 'CITY', 'PUBLIC', 'MEDICAL', 'DENTAL', 'GRILL', 'KITCHEN', 'EXPRESS', 'TRANSFER', 'COSTCO', 'TARGET', 'AMAZON']);

// The merchant's words: bank prefixes removed, leading reference numbers skipped, and cut at the
// store number or address that usually follows the name ("WENDY'S 11495 4108 GARRITY BLVD" → WENDY).
function merchantWords(desc) {
  const u = String(desc || '').toUpperCase().replace(/'/g, '').replace(/[^A-Z0-9#& ]+/g, ' ').replace(/&/g, ' ').replace(NOISE, ' ');
  const toks = u.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && /[\d#]/.test(toks[i])) i++;
  const out = [];
  for (; i < toks.length; i++) {
    if (/[\d#]/.test(toks[i])) break;
    if (toks[i].length > 1) out.push(toks[i]);
  }
  return out.length ? out : normalize(desc).split(' ').filter((w) => w.length > 1);
}

export function merchantKey(desc) {
  const all = normalize(desc).split(' ').filter((w) => w.length > 1);
  const p2p = all.findIndex((w) => P2P_WORDS.includes(w));
  if (p2p >= 0) return all.slice(p2p, p2p + 3).join(' ');
  const words = merchantWords(desc);
  // A long, distinctive first word is the merchant ("MCDONALD", "WALMART"); the next word is often a city.
  if (words[0] && words[0].length >= 6 && !GENERIC.has(words[0])) return words[0];
  return words.slice(0, 2).join(' ') || normalize(desc);
}

// Count transactions a rule pattern would match, for showing "also applies to N others".
export function matchesPattern(description, pattern) {
  return matches(normalize(description), pattern);
}

// ---- Money moving between accounts, cash and people ----
const P2P_WORDS = ['ZELLE', 'VENMO', 'CASHAPP', 'CASH', 'APPLE'];
const P2P = /\b(ZELLE|VENMO|CASH ?APP|SQUARE CASH|APPLE CASH|PAYPAL)\b/;
const ATM_OUT = /\bATM\b.*\b(WITHDRAWAL|WDL|DEBIT)\b|\b(WITHDRAWAL|WDL)\b.*\bATM\b|\bCASH WITHDRAWAL\b/;
const DEBT = /\b(LOAN|MORTGAGE|CREDIT CARD|CARD PAYMENT|CARD PMT|AUTOPAY|AUTO PAY|CAPITAL ONE|DISCOVER|AMEX|CHASE CARD|CITI CARD|SYNCHRONY)\b/;
const LOAN_TYPES = new Set(['car_loan', 'mortgage', 'student_loan', 'personal_loan', 'medical', 'other_debt']);
const XFER = /\b(TRANSFER|XFER|TRNSFR)\b/;
const CARD_PAYMENT_IN = /^\s*(PAYMENT|PMT|AUTOPAY|AUTO PAY)\b|\bPAYMENT\s*-?\s*THANK YOU\b/;

// The other account in a transfer, by its last digits: "Xfer To *****4821", "Transfer to Loan 0377".
export function counterpartDigits(desc) {
  const u = String(desc || '').toUpperCase();
  const m = /\*{2,}\s*(\d{3,})/.exec(u) || /\b(?:TO|FROM)\s+(?:LOAN|ACCT|ACCOUNT|SAVINGS|CHECKING|SHARE)?\s*#?\s*X*(\d{3,})\b/.exec(u);
  return m ? m[1].slice(-4) : '';
}

// What kind of money movement a description is, judged from the raw text: 'atm', 'p2p', 'xfer' or ''.
export function movementKind(desc) {
  const u = String(desc || '').toUpperCase();
  if (ATM_OUT.test(u) || /\bATM\b/.test(u)) return 'atm';
  if (P2P.test(u)) return 'p2p';
  if (XFER.test(u) || TRANSFER.some((p) => matches(normalize(u), p))) return 'xfer';
  return '';
}

// Is this account number one of the household's own accounts in CEDAR?
// accountMap holds the household's answers for numbers it has been asked about: 'own', 'debt' or 'other'.
export function isOwnAccount(digits, accounts = [], accountMap = {}) {
  if (!digits) return false;
  if (accountMap[digits]) return accountMap[digits] === 'own';
  // Loans aren't imported, so a payment to one is spending (Debt payments), not a transfer.
  return accounts.some((a) => !a.deleted && !LOAN_TYPES.has(a.type) && a.name.replace(/\D+/g, ' ').split(' ').some((n) => n && n.endsWith(digits)));
}

// Whole-word match that ignores a trailing S, so MCDONALDS, MCDONALD'S and MCDONALD all match.
const stem = (w) => (w.length > 3 && w.endsWith('S') ? w.slice(0, -1) : w);
const stems = (text) => text.split(' ').filter(Boolean).map(stem).join(' ');
const matches = (norm, pattern) => {
  const p = stems(normalize(pattern));
  return !!p && (` ${stems(norm)} `).includes(` ${p} `);
};

let starterCache = null;
function starterRules() {
  if (!starterCache) {
    starterCache = Object.entries(STARTER).flatMap(([cat, pats]) => pats.map((p) => [p, cat]))
      .sort((a, b) => normalize(b[0]).length - normalize(a[0]).length);
  }
  return starterCache;
}

// Returns { type, category_id, source } where source is 'rule', 'starter' or 'none'.
//
// Only money moving between the household's own CEDAR accounts is a transfer. Cash withdrawals,
// payments to people, and payments to loans or cards that aren't in CEDAR are spending, because
// that's the only record CEDAR has of that money leaving.
export function categorize(description, amount, { rules = [], categories = [], accounts = [], accountMap = {} }) {
  const norm = normalize(description);
  const raw = String(description || '').toUpperCase();
  const byName = (name) => categories.find((c) => !c.deleted && !c.archived && c.name.toLowerCase() === name.toLowerCase());
  const kind = movementKind(description);
  const digits = counterpartDigits(description);

  if (kind === 'xfer' && isOwnAccount(digits, accounts, accountMap)) return { type: 'transfer', category_id: '', source: 'starter' };

  const live = rules.filter((r) => !r.deleted && r.pattern).sort((a, b) => b.pattern.length - a.pattern.length);
  for (const r of live) {
    if (!matches(norm, r.pattern)) continue;
    // A rule learned from a refund or deposit (income) mustn't turn purchases at that store into income.
    if (r.type === 'income' && amount < 0) continue;
    return { type: r.type || 'expense', category_id: r.category_id || '', source: 'rule' };
  }

  if (kind === 'atm') {
    if (amount < 0) return { type: 'expense', category_id: byName('Cash')?.id || '', source: 'starter' };
    return { type: 'income', category_id: '', source: 'none' };
  }
  if (kind === 'p2p') return { type: amount < 0 ? 'expense' : 'income', category_id: '', source: 'none' };
  if (kind === 'xfer' || DEBT.test(raw)) {
    const mapped = accountMap[digits];
    const toLoan = !!digits && accounts.some((a) => !a.deleted && LOAN_TYPES.has(a.type) && a.name.replace(/\D+/g, ' ').split(' ').some((n) => n && n.endsWith(digits)));
    const debt = toLoan || mapped === 'debt' || (!mapped && DEBT.test(raw));
    if (amount < 0 && (debt || digits)) {
      return { type: 'expense', category_id: byName(debt ? 'Debt payments' : 'Transfers out')?.id || '', source: 'starter' };
    }
    if (amount > 0 && digits) return { type: 'income', category_id: '', source: 'none' };
    // No account number to go on (e.g. "PAYMENT THANK YOU" on a card statement): the other side is usually in CEDAR.
    return { type: 'transfer', category_id: '', source: 'starter' };
  }
  // A card statement's "PAYMENT - THANK YOU" or "PAYMENT - IN BRANCH" is the household paying its own card.
  if (amount > 0 && CARD_PAYMENT_IN.test(raw)) return { type: 'transfer', category_id: '', source: 'starter' };
  if (amount > 0) {
    if (PAYCHECK.some((p) => matches(norm, p))) {
      const c = byName('Paycheck');
      return { type: 'income', category_id: c?.id || '', source: 'starter' };
    }
    return { type: 'income', category_id: '', source: 'none' };
  }
  for (const [p, name] of starterRules()) {
    if (matches(norm, p)) {
      const c = byName(name);
      if (c) return { type: 'expense', category_id: c.id, source: 'starter' };
    }
  }
  return { type: 'expense', category_id: '', source: 'none' };
}
