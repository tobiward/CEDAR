// Add tab: manual entry, receipt scanning, and statement import (upload → map columns → review → save).
import { esc, fmtMoney, fmtDate, uid, toast, isoDate, parseISO, round2, $, $$ } from '../util.js';
import { icon } from '../look.js';
import { readReceipt } from '../receipt.js';
import { readScreenshot } from '../screenshot.js';
import { normalize } from '../categorize.js';
import { options, catOptions, amountHTML, busy } from '../ui.js';
import { openTxnForm } from './txn-form.js';
import { openAccountForm } from './accounts.js';
import { isDebt } from '../accounts-model.js';
import { parseCSV, findHeaderRow, guessMapping, mappingIsValid, applyMapping, looksSignFlipped, parseOFX, ofxBalance, isOFX, headerSignature, markDuplicates } from '../importer.js';
import { categorize, merchantKey, movementKind, matchesPattern } from '../categorize.js';
import { parseStatementPages, extractPdfPages } from '../pdfparse.js';
import { findPairs, linkPair } from '../pairs.js';

let imp = null; // import in progress (kept in memory only)

export function renderAdd(root, ctx, [sub] = []) {
  if (sub === 'import') return renderImport(root, ctx);
  if (sub === 'receipt') return renderReceipt(root, ctx);
  if (sub === 'screenshot') return renderScreenshot(root, ctx);
  const badge = (name, color) => `<span class="cat-badge" style="--c:${color}">${icon(name, 26)}</span>`;
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Add</h1></div>
    <div class="choices">
      <a class="choice" href="#/add/receipt">${badge('bill', '#D9973A')}<span><strong>Scan a receipt</strong><span class="muted">Take a photo and CEDAR fills in the store, date and total. Your statement confirms it later.</span></span></a>
      <button class="choice" id="add-income">${badge('sprout', '#5E8A45')}<span><strong>Add income</strong><span class="muted">Log a paycheck or other money coming in before your statement arrives.</span></span></button>
      <a class="choice" href="#/add/screenshot">${badge('card', '#3F6E9E')}<span><strong>Update from a screenshot</strong><span class="muted">Screenshots of an account in your banking app update its balance and add any activity CEDAR doesn’t have yet.</span></span></a>
      <a class="choice" href="#/add/import">${badge('out', '#9A3B26')}<span><strong>Import a statement</strong><span class="muted">PDF statement or CSV/OFX download. Fills in anything you haven’t logged and checks what you have.</span></span></a>
      <button class="choice" id="add-manual">${badge('leaf', '#2F7A72')}<span><strong>Enter a transaction</strong><span class="muted">Add one expense, income or transfer by hand.</span></span></button>
    </div></div>`;
  $('#add-manual', root).addEventListener('click', () => openTxnForm(ctx));
  $('#add-income', root).addEventListener('click', () => openTxnForm(ctx, null, { type: 'income' }));
}

// ---- Banking app screenshots ----
function renderScreenshot(root, ctx) {
  const ai = !!ctx.setting('ai_key', '');
  root.innerHTML = `<div class="page"><div class="page-head"><a class="back" href="#/add" aria-label="Back to Add">←</a><h1>Update from a screenshot</h1></div><div id="shot"></div></div>`;
  const host = $('#shot', root);
  if (imp?.source === 'screenshot' && imp.step === 'shot') return stepShotAccount(host, ctx);
  if (imp?.source === 'screenshot' && imp.step === 'review') return stepReview(host, ctx);
  host.innerHTML = `<ol class="steps"><li aria-current="step">Screenshots</li><li>Account</li><li>Review</li></ol>
    <section class="card form">
      <label class="drop" id="sh-drop">
        <input type="file" id="sh-file" accept="image/*" multiple>
        <span class="cat-badge" style="--c:#3F6E9E;width:56px;height:56px">${icon('card', 30)}</span>
        <strong>Choose screenshots of one account</strong>
        <span class="muted">Include the balance and the activity list. Add several screenshots to cover more history.</span>
      </label>
      <div id="sh-status" hidden><p id="sh-msg">Reading your screenshots…</p><div class="progress"><span id="sh-bar"></span></div></div>
      <p class="muted">${ai ? 'Screenshots are read by AI using your household’s key.' : 'Screenshots are read on this device. An AI key in Settings reads them more reliably.'} Nothing already in CEDAR is added twice, and screenshots themselves aren’t saved.</p>
    </section>`;
  const input = $('#sh-file', host);
  input.addEventListener('change', async () => {
    const files = [...input.files];
    if (!files.length) return;
    $('#sh-drop', host).hidden = true; $('#sh-status', host).hidden = false;
    try {
      const reads = [];
      for (let i = 0; i < files.length; i++) {
        $('#sh-msg', host).textContent = `Reading screenshot ${i + 1} of ${files.length}…`;
        reads.push(await readScreenshot(files[i], { aiKey: ctx.setting('ai_key', ''), onProgress: (p) => { $('#sh-bar', host).style.width = `${Math.round(((i + p) / files.length) * 100)}%`; } }));
      }
      // Overlapping screenshots show the same rows; keep each once.
      const seen = new Set(); const txns = [];
      for (const r of reads) for (const t of r.txns) {
        const k = `${t.date}|${t.amount}|${normalize(t.description)}`;
        if (!seen.has(k)) { seen.add(k); txns.push(t); }
      }
      const first = reads.find((r) => r.accountName || r.last4) || {};
      const balance = reads.find((r) => r.balance !== null && r.balance !== undefined)?.balance ?? null;
      if (!txns.length && balance === null) throw new Error('Couldn’t find a balance or any activity in those screenshots.');
      imp = { source: 'screenshot', step: 'shot', fileName: `${files.length} screenshot${files.length === 1 ? '' : 's'}`, shot: { accountName: first.accountName || '', last4: first.last4 || '', balance }, txns };
      rerender(ctx);
    } catch (err) {
      $('#sh-status', host).hidden = true; $('#sh-drop', host).hidden = false;
      toast(err.message || 'Couldn’t read those screenshots.', 'error');
    }
  });
}

function stepShotAccount(host, ctx) {
  const { accountName, last4, balance } = imp.shot;
  const label = `${accountName || 'Account'}${last4 && !accountName.includes(last4) ? ` ··${last4}` : ''}`;
  const target = imp.shot.target ?? matchAccount(ctx, { name: accountName, last4 }, prefsLastAccount(ctx) || 'new');
  host.innerHTML = `<ol class="steps"><li>Screenshots</li><li aria-current="step">Account</li><li>Review</li></ol>
    <section class="card form">
      <h2>${esc(label)}</h2>
      <p class="muted">${imp.txns.length} transaction${imp.txns.length === 1 ? '' : 's'} found${balance !== null ? `, balance ${fmtMoney(balance)}` : ''}.</p>
      <label class="field"><span>Which account is this?</span><select id="sh-acct">${options(ctx.accounts().map((a) => [a.id, a.name]), target)}<option value="new" ${target === 'new' ? 'selected' : ''}>＋ New account “${esc(label)}”</option></select></label>
      <label class="field"><span>Balance shown in the app (as of today)</span><input id="sh-bal" type="number" step="0.01" inputmode="decimal" value="${balance ?? ''}" placeholder="Leave blank to keep the current balance"></label>
      <div class="form-actions"><button class="btn" id="sh-back">Start over</button><button class="btn btn-primary" id="sh-next">Continue</button></div>
    </section>`;
  $('#sh-acct', host).addEventListener('change', (e) => { imp.shot.target = e.target.value; });
  $('#sh-back', host).addEventListener('click', () => { imp = null; rerender(ctx); });
  $('#sh-next', host).addEventListener('click', (e) => busy(e.target, async () => {
    let acctId = $('#sh-acct', host).value;
    try {
      if (acctId === 'new') {
        const type = /sav|share|money/i.test(label) ? 'savings' : /credit|card|visa|master/i.test(label) ? 'credit' : 'checking';
        acctId = (await ctx.save('Accounts', { id: uid(), name: label, type, balance: 0 })).id;
      }
    } catch (err) { return ctx.handleError(err); }
    ctx.setPref('lastAccount', acctId);
    imp.accountId = acctId;
    const b = $('#sh-bal', host).value.trim();
    imp.balances = b !== '' ? { [acctId]: { balance: Number(b), date: isoDate(new Date()) } } : {};
    toReview(ctx, imp.txns.map((t) => ({ ...t, account_id: acctId })));
  }));
}

// Screenshots word things differently from statements ("Dutch Bros" vs "POS DUTCH BROS ID0703"),
// so a row counts as already in CEDAR when the same account has the same amount within three days.
function markLooseDuplicates(list, existing, acct) {
  const pool = existing.filter((t) => !t.deleted && t.account_id === acct);
  const used = new Set();
  const days = (a, b) => Math.abs(Math.round((parseISO(a) - parseISO(b)) / 864e5));
  for (const t of list) {
    const hit = pool.filter((e) => !used.has(e.id) && Math.abs(e.amount - t.amount) < 0.005 && days(e.date, t.date) <= 3)
      .sort((a, b) => days(a.date, t.date) - days(b.date, t.date))[0];
    t.duplicate = !!hit;
    if (hit) used.add(hit.id);
  }
  return list;
}

// ---- Receipt scanning ----
function renderReceipt(root, ctx) {
  const ai = !!ctx.setting('ai_key', '');
  root.innerHTML = `<div class="page"><div class="page-head"><a class="back" href="#/add" aria-label="Back to Add">←</a><h1>Scan a receipt</h1></div>
    <section class="card form">
      <img id="rc-img" class="receipt-preview" alt="Your receipt" hidden>
      <label class="drop" id="rc-drop">
        <input type="file" id="rc-file" accept="image/*" capture="environment">
        <span class="cat-badge" style="--c:#D9973A;width:56px;height:56px">${icon('bill', 30)}</span>
        <strong>Take a photo or choose one</strong>
        <span class="muted">Lay the receipt flat in good light with the total visible.</span>
      </label>
      <div id="rc-status" hidden><p id="rc-msg">Reading your receipt…</p><div class="progress"><span id="rc-bar"></span></div></div>
      <p class="muted">${ai ? 'Receipts are read by AI using your household’s key.' : 'Receipts are read on this device. For faded or crumpled receipts, add an AI key in Settings.'} The photo itself isn’t saved.</p>
    </section></div>`;
  const input = $('#rc-file', root);
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    const img = $('#rc-img', root);
    img.src = URL.createObjectURL(f); img.hidden = false;
    $('#rc-drop', root).hidden = true; $('#rc-status', root).hidden = false;
    try {
      const r = await readReceipt(f, { aiKey: ctx.setting('ai_key', ''), onProgress: (p) => { $('#rc-bar', root).style.width = `${Math.round(p * 100)}%`; } });
      const { Rules, Categories } = ctx.state.data;
      const c = categorize(r.merchant, -(r.total || 1), { rules: Rules, categories: Categories, accounts: ctx.accounts(), accountMap: ctx.accountMap() });
      $('#rc-msg', root).textContent = r.total ? 'Check the details and save.' : 'Couldn’t find the total. Enter it below.';
      $('#rc-bar', root).style.width = '100%';
      openTxnForm(ctx, null, {
        type: 'expense', description: r.merchant, date: r.date, amount: r.total ? -r.total : 0, category_id: c.type === 'expense' ? c.category_id : '',
        account_id: prefsLastAccount(ctx) || ctx.accounts()[0]?.id || '', source: 'receipt',
      });
    } catch (err) {
      $('#rc-status', root).hidden = true; $('#rc-drop', root).hidden = false;
      toast(err.message || 'Couldn’t read that photo. Try again or enter it by hand.', 'error');
    }
  });
}

function renderImport(root, ctx) {
  root.innerHTML = `<div class="page"><div class="page-head"><a class="back" href="#/add" aria-label="Back to Add">←</a><h1>Import a statement</h1></div><div id="imp"></div></div>`;
  const host = $('#imp', root);
  if (!imp || imp.step === 'choose') stepChoose(host, ctx);
  else if (imp.step === 'map') stepMap(host, ctx);
  else if (imp.step === 'accounts') stepAccounts(host, ctx);
  else stepReview(host, ctx);
}

const rerender = (ctx) => ctx.render();

// ---- Step 1: account + file ----
function stepChoose(host, ctx) {
  const accounts = ctx.accounts();
  const sel = imp?.accountId || prefsLastAccount(ctx) || accounts[0]?.id || '';
  host.innerHTML = `<ol class="steps" aria-label="Import steps"><li aria-current="step">Upload</li><li>Check columns</li><li>Review</li></ol>
  <section class="card form">
    <label class="field"><span>Which account is this statement from?</span>
      <select id="imp-acct">${accounts.length ? options(accounts.map((a) => [a.id, a.name]), sel) : '<option value="">No accounts yet</option>'}</select></label>
    <p class="muted">For PDF statements, CEDAR finds the accounts in the file and lets you match each one next.</p>
    <button class="btn btn-ghost btn-small" id="imp-new-acct" type="button">＋ New account</button>
    <label class="drop" id="drop">
      <input type="file" id="imp-file" accept=".pdf,.csv,.ofx,.qfx,application/pdf,text/csv">
      <span class="drop-icon" aria-hidden="true">⇪</span>
      <strong>Choose a statement file</strong>
      <span class="muted">PDF statement, or a CSV, OFX or QFX download from your bank.</span>
    </label>
  </section>`;
  $('#imp-new-acct', host).addEventListener('click', () => openAccountForm(ctx, null, (a) => { imp = { step: 'choose', accountId: a.id }; rerender(ctx); }));
  const file = $('#imp-file', host);
  const drop = $('#drop', host);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => file.files[0] && load(file.files[0]));

  async function load(f) {
    const accountId = $('#imp-acct', host).value;
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return loadPdf(f, accountId);
    if (!accountId) return toast('Add an account first, or import a PDF statement', 'error');
    const text = await f.text();
    ctx.setPref('lastAccount', accountId);
    if (isOFX(f.name, text)) {
      const txns = parseOFX(text);
      if (!txns.length) return toast('No transactions found in that file.', 'error');
      const bal = ofxBalance(text);
      imp = { step: 'review', accountId, fileName: f.name, balances: bal ? { [accountId]: bal } : {} };
      return toReview(ctx, txns);
    }
    const rows = parseCSV(text);
    if (rows.length < 2) return toast('That file looks empty.', 'error');
    const h = findHeaderRow(rows);
    const headers = rows[h];
    const sig = headerSignature(headers);
    const saved = ctx.setting(`csvmap:${sig}`, null);
    imp = { step: 'map', accountId, fileName: f.name, headers, data: rows.slice(h + 1), sig, mapping: saved || guessMapping(headers), saved: !!saved };
    if (saved && mappingIsValid(saved)) return toReview(ctx, applyMapping(imp.data, saved));
    rerender(ctx);
  }

  async function loadPdf(f, accountId) {
    toast('Reading the PDF…');
    let result;
    try { result = parseStatementPages(await extractPdfPages(f)); }
    catch (err) { console.error(err); return toast(/^(Couldn’t|This copy)/.test(err.message || '') ? err.message : 'Couldn’t read that PDF. Is it password-protected?', 'error'); }
    const { sections } = result;
    if (!sections.length) return toast('No transactions found. If this is a scanned image, download a CSV from your bank instead.', 'error');
    if (accountId) ctx.setPref('lastAccount', accountId);
    imp = { step: 'accounts', accountId, fileName: f.name, period: result.period, sections: sections.map((sec) => ({ ...sec, target: matchAccount(ctx, sec, '') })) };
    rerender(ctx);
  }
}

// Best guess for which CEDAR account a statement section belongs to.
function matchAccount(ctx, sec, fallback) {
  const accts = ctx.accounts();
  const hit = accts.find((a) => (sec.last4 && a.name.includes(sec.last4)) || a.name.toLowerCase() === sec.name.toLowerCase());
  return hit?.id || fallback || 'new';
}

// ---- Step 2 (PDF): match each account in the statement ----
function stepAccounts(host, ctx) {
  const accounts = ctx.accounts();
  const label = (sec) => `${sec.name}${sec.last4 && !sec.name.includes(sec.last4) ? ` ··${sec.last4}` : ''}`;
  host.innerHTML = `<ol class="steps"><li>Upload</li><li aria-current="step">Match accounts</li><li>Review</li></ol>
  <section class="card form">
    <h2>This statement covers ${imp.sections.length} account${imp.sections.length === 1 ? '' : 's'}</h2>
    <p class="muted">Choose where each one goes. New accounts start with a $0 balance you can update later.</p>
    ${imp.sections.map((sec, i) => {
      const dates = sec.txns.map((t) => t.date).sort();
      return `<label class="field"><span>${esc(label(sec))} <span class="muted">· ${sec.txns.length} transactions, ${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}</span></span>
        <select data-sec="${i}">${options(accounts.map((a) => [a.id, a.name]), sec.target)}
          <option value="new" ${sec.target === 'new' ? 'selected' : ''}>＋ New account “${esc(label(sec))}”</option>
          <option value="skip" ${sec.target === 'skip' ? 'selected' : ''}>Don’t import</option></select></label>`;
    }).join('')}
    <div class="form-actions"><button class="btn" id="acc-back">Back</button><button class="btn btn-primary" id="acc-next">Continue</button></div>
  </section>`;
  $$('[data-sec]', host).forEach((sel) => sel.addEventListener('change', () => { imp.sections[Number(sel.dataset.sec)].target = sel.value; }));
  $('#acc-back', host).addEventListener('click', () => { imp.step = 'choose'; rerender(ctx); });
  $('#acc-next', host).addEventListener('click', (e) => busy(e.target, async () => {
    const chosen = imp.sections.filter((sec) => sec.target !== 'skip');
    if (!chosen.length) return toast('Choose at least one account to import', 'error');
    try {
      for (const sec of chosen) {
        if (sec.target !== 'new') continue;
        const type = /sav|share/i.test(sec.name) ? 'savings' : /credit|card|visa|master/i.test(sec.name) ? 'credit' : 'checking';
        const a = await ctx.save('Accounts', { id: uid(), name: label(sec), type, balance: 0 });
        sec.target = a.id;
      }
    } catch (err) { return ctx.handleError(err); }
    imp.multi = chosen.length > 1;
    // Each account's closing balance on the statement becomes its balance as of the statement date.
    imp.balances = {};
    const asOf = isoDate(imp.period?.end || new Date());
    for (const sec of chosen) if (sec.endBalance !== null && sec.endBalance !== undefined) imp.balances[sec.target] = { balance: sec.endBalance, date: asOf };
    toReview(ctx, chosen.flatMap((sec) => sec.txns.map((t) => ({ ...t, account_id: sec.target }))));
  }));
}

const prefsLastAccount = (ctx) => {
  const id = ctx.pref('lastAccount', '');
  return ctx.accounts().some((a) => a.id === id) ? id : '';
};

// ---- Step 2: column mapping (first time a bank's layout is seen) ----
function stepMap(host, ctx) {
  const { headers, data, mapping: m } = imp;
  const cols = [[-1, '— none —'], ...headers.map((h, i) => [i, h || `Column ${i + 1}`])];
  const preview = applyMapping(data, m);
  const flipHint = !m.flip && m.amount >= 0 && looksSignFlipped(preview);
  host.innerHTML = `<ol class="steps"><li>Upload</li><li aria-current="step">Check columns</li><li>Review</li></ol>
  <section class="card form">
    <h2>Which column is which?</h2>
    <p class="muted">CEDAR remembers this for future statements from the same bank.</p>
    <div class="form-row">
      <label class="field"><span>Date</span><select data-map="date">${options(cols, m.date)}</select></label>
      <label class="field"><span>Description</span><select data-map="desc">${options(cols, m.desc)}</select></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Amount (one column)</span><select data-map="amount">${options(cols, m.amount)}</select></label>
      <span class="or">or</span>
      <label class="field"><span>Money out</span><select data-map="debit">${options(cols, m.debit)}</select></label>
      <label class="field"><span>Money in</span><select data-map="credit">${options(cols, m.credit)}</select></label>
    </div>
    <label class="check"><input type="checkbox" id="map-flip" ${m.flip ? 'checked' : ''}> Purchases show as positive numbers in this file</label>
    ${flipHint ? '<p class="notice">Most amounts in this file are positive. If it’s a credit card statement, tick the box above so purchases count as spending.</p>' : ''}
  </section>
  <section class="card"><h2>Preview</h2>
    ${mappingIsValid(m) ? `<p class="muted">${preview.length} transactions found.</p><div class="txns">${preview.slice(0, 5).map((t) => `<div class="txn static"><span class="txn-main"><span class="txn-desc">${esc(t.description)}</span><span class="txn-sub">${fmtDate(t.date, true)}</span></span>${amountHTML({ ...t, type: t.amount < 0 ? 'expense' : 'income' })}</div>`).join('')}</div>` : '<p class="muted">Pick the date, description and amount columns to see a preview.</p>'}
    <div class="form-actions"><button class="btn" id="map-back">Back</button><button class="btn btn-primary" id="map-next" ${mappingIsValid(m) && preview.length ? '' : 'disabled'}>Continue</button></div>
  </section>`;
  $$('[data-map]', host).forEach((s) => s.addEventListener('change', () => {
    const k = s.dataset.map; m[k] = Number(s.value);
    if (k === 'amount' && m.amount >= 0) { m.debit = -1; m.credit = -1; }
    if ((k === 'debit' || k === 'credit') && m[k] >= 0) m.amount = -1;
    rerender(ctx);
  }));
  $('#map-flip', host).addEventListener('change', (e) => { m.flip = e.target.checked; rerender(ctx); });
  $('#map-back', host).addEventListener('click', () => { imp.step = 'choose'; rerender(ctx); });
  $('#map-next', host).addEventListener('click', async (e) => {
    await busy(e.target, async () => {
      try { await ctx.setSetting(`csvmap:${imp.sig}`, m); } catch (err) { ctx.handleError(err); }
    });
    toReview(ctx, preview);
  });
}

// ---- Step 3: review categories and duplicates ----
function toReview(ctx, txns) {
  const { Rules, Categories, Transactions } = ctx.state.data;
  const byAcct = new Map();
  for (const t of txns) { t.account_id ||= imp.accountId; if (!byAcct.has(t.account_id)) byAcct.set(t.account_id, []); byAcct.get(t.account_id).push(t); }
  for (const [acct, list] of byAcct) (imp.source === 'screenshot' ? markLooseDuplicates(list, Transactions, acct) : markDuplicates(list, Transactions.filter((t) => !unconfirmed(t)), acct));
  imp.items = txns.map((t, i) => {
    const c = categorize(t.description, t.amount, { rules: Rules, categories: Categories, accounts: ctx.accounts(), accountMap: ctx.accountMap() });
    return { ...t, i, key: merchantKey(t.description), type: c.type, category_id: c.category_id, source: c.source, include: !t.duplicate, touched: false };
  });
  matchLoggedEntries(imp.items, Transactions);
  imp.step = 'review';
  imp.remember = true;
  imp.show = 'all';
  rerender(ctx);
}

// Receipts and hand-entered transactions not yet confirmed by a statement.
const unconfirmed = (t) => !t.deleted && !t.import_id && ['receipt', 'manual', 'screenshot'].includes(t.source);

// Pairs statement rows with receipts or hand entries for the same purchase, so it isn't counted twice.
// Same amount within a few days is a match; the same merchant with a slightly higher bank amount
// (a tip added after the receipt printed) is a likely match. Each entry is used once.
function matchLoggedEntries(items, existing) {
  const pool = existing.filter(unconfirmed);
  const used = new Set();
  const days = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
  const candidates = [];
  for (const it of items) {
    if (it.duplicate) continue;
    for (const e of pool) {
      if (e.account_id && e.account_id !== it.account_id) continue;
      if (Math.sign(e.amount) !== Math.sign(it.amount)) continue;
      const d = days(it.date, e.date); // banks post on or after the purchase
      if (d < -2 || d > 6) continue;
      const exact = Math.abs(Math.abs(e.amount) - Math.abs(it.amount)) < 0.005;
      const sameMerchant = matchesPattern(it.description, merchantKey(e.description)) || matchesPattern(e.description, it.key);
      const ratio = Math.abs(it.amount) / Math.abs(e.amount);
      if (exact || (sameMerchant && ratio >= 1 && ratio <= 1.3)) {
        candidates.push({ it, e, kind: exact ? 'strong' : 'likely', score: (exact ? 0 : 10) + Math.abs(d) - (sameMerchant ? 0.5 : 0) });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates) {
    if (c.it.match || used.has(c.e.id)) continue;
    used.add(c.e.id);
    c.it.match = { id: c.e.id, kind: c.kind, description: c.e.description, date: c.e.date, amount: c.e.amount, source: c.e.source };
    c.it.merge = true;
  }
}

function saveLabel(items) {
  const n = items.filter((t) => t.include).length;
  if (!n && imp.source === 'screenshot') return 'Update balance';
  return `Save ${n} transaction${n === 1 ? '' : 's'}`;
}

function stepReview(host, ctx) {
  const items = imp.items;
  const fresh = items.filter((t) => !t.duplicate);
  const dups = items.length - fresh.length;
  const matched = items.filter((t) => t.match).length;
  const needs = () => items.filter((t) => t.include && t.type !== 'transfer' && !t.category_id).length;
  const shown = items.filter((t) => (imp.show === 'needs' ? t.type !== 'transfer' && !t.category_id && t.include : true));
  const byType = { expense: catOptions(ctx, 'expense', ''), income: catOptions(ctx, 'income', '') };

  host.innerHTML = `<ol class="steps">${imp.source === 'screenshot' ? '<li>Screenshots</li><li>Account</li>' : '<li>Upload</li><li>Check columns</li>'}<li aria-current="step">Review</li></ol>
  <section class="card">
    <h2>${esc(imp.fileName)}</h2>
    <div class="chips"><span class="chip">${fresh.length} new</span>${dups ? `<span class="chip">${dups} already imported</span>` : ''}${matched ? `<span class="chip chip-ok">${matched} match${matched === 1 ? 'es' : ''} what you already logged</span>` : ''}<span class="chip chip-warn" id="needs-chip">${needs()} need a category</span></div>
    <div class="controls">
      <div class="seg" role="radiogroup" aria-label="Show">
        <label><input type="radio" name="show" value="all" ${imp.show === 'all' ? 'checked' : ''}><span>All</span></label>
        <label><input type="radio" name="show" value="needs" ${imp.show === 'needs' ? 'checked' : ''}><span>Needs category</span></label>
      </div>
      <label class="check"><input type="checkbox" id="remember" ${imp.remember ? 'checked' : ''}> Remember my category changes for future imports</label>
    </div>
  </section>
  <section class="card review" aria-label="Transactions to import">
    ${shown.map((t) => `<div class="rv ${t.duplicate ? 'dup' : ''}" data-i="${t.i}">
      <label class="rv-inc"><input type="checkbox" data-inc ${t.include ? 'checked' : ''} aria-label="Include ${esc(t.description)}"></label>
      <div class="rv-main"><span class="txn-desc">${esc(t.description)}</span><span class="txn-sub">${fmtDate(t.date, true)}${imp.multi ? ' · ' + esc(ctx.find('Accounts', t.account_id)?.name || '') : ''}${t.pending ? ' · Pending' : ''}${t.duplicate ? ' · Already in CEDAR' : ''}</span></div>
      ${amountHTML(t)}
      ${t.match ? `<div class="rv-match">${icon('bill', 16)}<span>${t.match.kind === 'strong' ? 'Matches' : 'Looks like'} your ${t.match.source === 'receipt' ? 'receipt' : t.match.source === 'screenshot' ? 'screenshot' : 'entry'}: ${esc(t.match.description)}, ${fmtDate(t.match.date)}, ${fmtMoney(Math.abs(t.match.amount))}</span>
        <select data-merge aria-label="What to do with this match">${options([['merge', 'Confirm it (no duplicate)'], ['both', 'Keep both']], t.merge ? 'merge' : 'both')}</select></div>` : ''}
      <div class="rv-cat" ${t.match && t.merge ? 'hidden' : ''}>
        <select data-type aria-label="Type for ${esc(t.description)}">${options([['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']], t.type)}</select>
        <select data-cat data-key="${esc(t.key)}" aria-label="Category for ${esc(t.description)}" ${t.type === 'transfer' ? 'hidden' : ''} class="${!t.category_id && t.type !== 'transfer' ? 'needs' : ''}">${t.type === 'transfer' ? '' : byType[t.type].replace(`value="${t.category_id}"`, `value="${t.category_id}" selected`)}</select>
      </div>
    </div>`).join('') || '<p class="muted">Everything has a category.</p>'}
  </section>
  <div class="sticky-actions">${imp.saving ? '<button class="btn btn-primary" disabled>Saving…</button>' : `<button class="btn" id="rv-cancel">Cancel</button><button class="btn btn-primary" id="rv-save">${saveLabel(items)}</button>`}</div>`;

  const refreshCounts = () => {
    $('#needs-chip', host).textContent = `${needs()} need a category`;
    if ($('#rv-save', host)) $('#rv-save', host).textContent = saveLabel(items);
  };
  $$('input[name=show]', host).forEach((r) => r.addEventListener('change', () => { imp.show = r.value; rerender(ctx); }));
  $('#remember', host).addEventListener('change', (e) => { imp.remember = e.target.checked; });
  $$('.rv', host).forEach((row) => {
    const t = items[Number(row.dataset.i)];
    $('[data-inc]', row).addEventListener('change', (e) => { t.include = e.target.checked; refreshCounts(); });
    $('[data-merge]', row)?.addEventListener('change', (e) => { t.merge = e.target.value === 'merge'; rerender(ctx); });
    $('[data-type]', row).addEventListener('change', (e) => { t.type = e.target.value; t.category_id = ''; t.touched = true; rerender(ctx); });
    $('[data-cat]', row).addEventListener('change', (e) => {
      t.category_id = e.target.value; t.touched = true; t.learn = true;
      e.target.classList.toggle('needs', !t.category_id);
      // Same merchant elsewhere in this file follows, unless already changed by hand.
      for (const o of items) {
        if (o !== t && !o.touched && o.type === t.type && (o.key === t.key || matchesPattern(o.description, t.key))) {
          o.category_id = t.category_id;
          const s = host.querySelector(`.rv[data-i="${o.i}"] [data-cat]`);
          if (s) { s.value = t.category_id; s.classList.toggle('needs', !t.category_id); }
        }
      }
      refreshCounts();
    });
  });
  $('#rv-cancel', host)?.addEventListener('click', () => { if (confirm('Discard this import?')) { imp = null; ctx.go('#/add'); } });
  $('#rv-save', host)?.addEventListener('click', () => save(ctx));
}

async function save(ctx) {
  if (!imp || imp.saving) return;
  // Check again against the sheet as it is now, so nothing already saved can be saved twice.
  // Statement rows that confirm a receipt or hand entry update that entry instead of adding a new row.
  const merges = imp.items.filter((x) => x.include && x.match && x.merge);
  const byAcct = new Map();
  for (const t of imp.items.filter((x) => x.include && !(x.match && x.merge))) {
    if (!byAcct.has(t.account_id)) byAcct.set(t.account_id, []);
    byAcct.get(t.account_id).push({ ...t });
  }
  const chosen = [];
  for (const [acct, list] of byAcct) chosen.push(...(imp.source === 'screenshot' ? markLooseDuplicates(list, ctx.state.data.Transactions, acct) : markDuplicates(list, ctx.state.data.Transactions.filter((t) => !unconfirmed(t)), acct)).filter((t) => !t.duplicate));
  const balancesOnly = !chosen.length && !merges.length && Object.keys(imp.balances || {}).length && imp.source === 'screenshot';
  if (!chosen.length && !merges.length && !balancesOnly) { toast('These transactions are already saved', 'error'); imp = null; return ctx.go('#/spending/month'); }
  imp.saving = true;
  ctx.render();
  const importId = uid();
  const shot = imp.source === 'screenshot';
  // Screenshot rows wait for the statement to confirm them, like receipts, so they carry no import id.
  const rows = chosen.map((t) => ({
    id: uid(), date: t.date, description: t.description, amount: t.amount, type: t.type,
    category_id: t.type === 'transfer' ? '' : t.category_id, account_id: t.account_id || imp.accountId, note: '',
    entered_by: ctx.state.user.email, import_id: shot ? '' : importId, external_id: t.external_id || '', source: shot ? 'screenshot' : 'statement',
    ...(shot && t.pending ? { note: 'Pending' } : {}),
  }));
  const confirmed = merges.map((t) => {
    const e = ctx.find('Transactions', t.match.id);
    // Keep the household's category and note; take the bank's date, amount and wording (what re-imports match on).
    // A screenshot only confirms a pending entry; it doesn't overwrite the household's wording.
    if (e && shot) return { ...e, account_id: e.account_id || t.account_id, note: e.note === 'Pending' && !t.pending ? '' : e.note };
    return e && { ...e, date: t.date, amount: t.amount, description: t.description, account_id: t.account_id,
      note: (e.note && e.note !== 'Pending' ? e.note : '') || (e.description !== t.description ? e.description : ''), import_id: shot ? '' : importId, external_id: t.external_id || '', source: e.source };
  }).filter(Boolean);
  // Card payments and moves between accounts: pair the side leaving one account with the side arriving in another.
  const pairs = findPairs([...ctx.state.data.Transactions, ...rows], ctx.accounts(), ctx.state.data.Categories)
    .filter((p) => rows.includes(p.out) || rows.includes(p.in));
  const pairedOld = [];
  for (const p of pairs) {
    for (const t of linkPair(p.out, p.in)) {
      const i = rows.findIndex((r) => r.id === t.id);
      if (i >= 0) rows[i] = t; else pairedOld.push(t);
    }
  }
  try {
    if (rows.length) await ctx.saveMany('Transactions', rows);
    if (pairedOld.length) await ctx.updateMany('Transactions', pairedOld);
    if (confirmed.length) await ctx.updateMany('Transactions', confirmed);
    for (const [acctId, b] of Object.entries(imp.balances || {})) {
      const a = ctx.find('Accounts', acctId);
      if (!a || (a.balance_date && a.balance_date > b.date)) continue;
      await ctx.save('Accounts', { ...a, balance: round2(isDebt(a.type) ? Math.abs(b.balance) : b.balance), balance_date: b.date });
    }
    if (imp.remember) {
      const learned = new Map();
      for (const t of imp.items) if (t.learn && t.key && (t.category_id || t.type === 'transfer') && !['xfer', 'atm'].includes(movementKind(t.description))) learned.set(t.key, t);
      for (const [key, t] of learned) await ctx.learnRule(key, t.category_id, t.type);
    }
  } catch (err) { imp.saving = false; ctx.render(); return ctx.handleError(err); }
  if (shot) {
    toast(rows.length || confirmed.length ? `Added ${rows.length} new transaction${rows.length === 1 ? '' : 's'}${confirmed.length ? `, matched ${confirmed.length} you already had` : ''}` : 'Balance updated', 'ok');
    imp = null;
    return ctx.go('#/accounts');
  }
  const months = new Map();
  [...rows, ...confirmed].forEach((r) => months.set(r.date.slice(0, 7), (months.get(r.date.slice(0, 7)) || 0) + 1));
  const ym = [...months].sort((a, b) => b[1] - a[1])[0][0];
  toast(`Imported ${rows.length} transactions${confirmed.length ? `, confirmed ${confirmed.length} you’d already logged` : ''}${pairs.length ? `, matched ${pairs.length} card payment${pairs.length === 1 ? '' : 's'} or transfer${pairs.length === 1 ? '' : 's'} between your accounts` : ''}`, 'ok');
  imp = null;
  ctx.go(`#/spending/month/${ym}`);
}

export const resetImport = () => { imp = null; };
export { fmtMoney };
