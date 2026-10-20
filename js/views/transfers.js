// One-time re-check of transactions marked as transfers. Only money moving between the household's
// own CEDAR accounts stays a transfer; cash, payments to people, and payments to outside loans,
// cards or accounts become spending so "Saved" matches what's really left.
import { esc, fmtMoney, fmtDate, toast, $, $$ } from '../util.js';
import { categorize, counterpartDigits, isOwnAccount, movementKind } from '../categorize.js';
import { options, busy } from '../ui.js';
import { findPairs, linkPair } from '../pairs.js';

let draft = null; // { accountMap, dropRules: Set }

const CHOICES = [['other', 'Someone else, or an account I don’t track'], ['debt', 'My loan or credit card'], ['own', 'My account, and I import it into CEDAR']];

export function renderTransfers(root, ctx) {
  const { Transactions, Rules, Categories } = ctx.state.data;
  const transfers = Transactions.filter((t) => !t.deleted && t.type === 'transfer');
  const accounts = ctx.accounts();
  const saved = ctx.accountMap();

  // Account numbers that transfers went to or came from, other than accounts already in CEDAR.
  const numbers = new Map();
  for (const t of transfers) {
    const d = counterpartDigits(t.description);
    if (!d || isOwnAccount(d, accounts, {})) continue;
    if (!numbers.has(d)) numbers.set(d, { out: 0, in: 0, count: 0, sample: t.description, debtWords: false });
    const n = numbers.get(d);
    n.count++; if (t.amount < 0) n.out -= t.amount; else n.in += t.amount;
    if (/LOAN|CREDIT CARD|CARD PAYMENT|MORTGAGE/i.test(t.description)) n.debtWords = true;
  }
  const transferRules = Rules.filter((r) => !r.deleted && r.type === 'transfer');
  if (!draft) {
    draft = { accountMap: { ...saved }, dropRules: new Set(transferRules.map((r) => r.id)) };
    // Money going both ways usually means the household's own savings and checking.
    for (const [d, n] of numbers) draft.accountMap[d] ||= n.debtWords ? 'debt' : n.out && n.in ? 'own' : 'other';
  }

  // Card payments and moves between accounts that show up on both statements: both sides become a transfer.
  const pairs = findPairs(Transactions, accounts, Categories);
  const paired = new Set(pairs.flatMap((p) => [p.out.id, p.in.id]));
  const pairTotal = pairs.reduce((a, p) => a + p.in.amount, 0);

  const rules = Rules.filter((r) => !draft.dropRules.has(r.id));
  const changes = [];
  for (const t of transfers) {
    if (paired.has(t.id) || t.pair_id) continue;
    const c = categorize(t.description, t.amount, { rules, categories: Categories, accounts, accountMap: draft.accountMap });
    if (c.type !== 'transfer') changes.push({ t, c });
  }
  const groups = new Map();
  for (const { t, c } of changes) {
    const label = c.type === 'income' ? 'Income (needs a category)' : c.category_id ? ctx.catName(c.category_id) : 'Spending (needs a category)';
    const g = groups.get(label) || { count: 0, total: 0 };
    g.count++; g.total += Math.abs(t.amount); groups.set(label, g);
  }
  const stay = transfers.length - changes.length;
  const total = changes.length + pairs.length * 2;
  const acctName = (id) => accounts.find((a) => a.id === id)?.name || 'Account';

  root.innerHTML = `<div class="page">
    <div class="page-head"><a class="back" href="#/settings" aria-label="Back to Settings">←</a><h1>Re-check transfers</h1></div>
    <section class="card">
      <p>Only money moving between your own CEDAR accounts should be a transfer. Cash withdrawals, payments to people, and payments to loans or cards you don’t import are spending, or “Saved” comes out too high.</p>
    </section>
    ${pairs.length ? `<section class="card">
      <h2>Payments between your accounts</h2>
      <p class="muted">The same amount left one of your accounts and arrived in another, like paying your credit card from checking. The purchases on the card already count as spending, so each pair becomes a transfer instead of counting a second time.</p>
      <ul class="simple">${pairs.slice(0, 12).map((p) => `<li><span>${esc(acctName(p.out.account_id))} → ${esc(acctName(p.in.account_id))} <span class="muted">· ${esc(fmtDate(p.out.date))}</span></span><span>${fmtMoney(p.in.amount)}</span></li>`).join('')}</ul>
      ${pairs.length > 12 ? `<p class="muted">and ${pairs.length - 12} more</p>` : ''}
      <p class="muted">${pairs.length} pair${pairs.length === 1 ? '' : 's'} · ${fmtMoney(pairTotal)} no longer counted twice</p>
    </section>` : ''}
    ${numbers.size ? `<section class="card form">
      <h2>Which accounts are these?</h2>
      <p class="muted">Your transfers went to or came from these account numbers, which aren’t in CEDAR.</p>
      ${[...numbers].map(([d, n]) => `<label class="field"><span>··${esc(d)} <span class="muted">· ${n.count} transfer${n.count === 1 ? '' : 's'}${n.out ? `, ${fmtMoney(n.out)} sent` : ''}${n.in ? `, ${fmtMoney(n.in)} received` : ''} · e.g. “${esc(n.sample.slice(0, 48))}”</span></span>
        <select data-num="${esc(d)}">${options(CHOICES, draft.accountMap[d])}</select></label>`).join('')}
    </section>` : ''}
    ${transferRules.length ? `<section class="card">
      <h2>Your transfer rules</h2>
      <p class="muted">These rules mark matching transactions as transfers. Untick any you want to keep.</p>
      ${transferRules.map((r) => `<label class="check"><input type="checkbox" data-rule="${esc(r.id)}" ${draft.dropRules.has(r.id) ? 'checked' : ''}> Stop treating “${esc(r.pattern)}” as a transfer</label>`).join('')}
    </section>` : ''}
    <section class="card">
      <h2>What will change</h2>
      ${changes.length || pairs.length ? `<ul class="simple">${pairs.length ? `<li><span>Transfers between your accounts <span class="muted">· ${pairs.length * 2}</span></span><span>${fmtMoney(pairTotal)}</span></li>` : ''}${[...groups].sort((a, b) => b[1].total - a[1].total).map(([label, g]) => `<li><span>${esc(label)} <span class="muted">· ${g.count}</span></span><span>${fmtMoney(g.total)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing to change.</p>'}
      <p class="muted">${stay} transaction${stay === 1 ? '' : 's'} stay transfers between your own accounts.</p>
      <div class="form-actions"><a class="btn" href="#/settings">Cancel</a><button class="btn btn-primary" id="apply" ${total || numbers.size ? '' : 'disabled'}>Apply ${total} change${total === 1 ? '' : 's'}</button></div>
    </section>
  </div>`;

  $$('[data-num]', root).forEach((s) => s.addEventListener('change', () => { draft.accountMap[s.dataset.num] = s.value; renderTransfers(root, ctx); }));
  $$('[data-rule]', root).forEach((c) => c.addEventListener('change', () => {
    if (c.checked) draft.dropRules.add(c.dataset.rule); else draft.dropRules.delete(c.dataset.rule);
    renderTransfers(root, ctx);
  }));
  $('#apply', root).addEventListener('click', (e) => busy(e.target, async () => {
    try {
      await ctx.setSetting('account_map', draft.accountMap);
      await ctx.removeMany('Rules', transferRules.filter((r) => draft.dropRules.has(r.id)));
      await ctx.updateMany('Transactions', [...changes.map(({ t, c }) => ({ ...t, type: c.type, category_id: c.category_id })), ...pairs.flatMap((p) => linkPair(p.out, p.in))]);
      await ctx.setSetting('transfers_checked', true);
      const needs = changes.filter(({ c }) => !c.category_id).length;
      toast(`Updated ${total} transactions${needs ? `; ${needs} need a category` : ''}`, 'ok');
      draft = null;
      ctx.go(needs ? '#/spending/transactions?needs=1' : '#/home');
    } catch (err) { ctx.handleError(err); }
  }));
}

export const isMovement = movementKind;
