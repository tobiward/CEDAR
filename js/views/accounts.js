import { esc, fmtMoney, fmtDate, uid, toast, round2, todayISO, $, $$ } from '../util.js';
import { options, openModal, emptyState, busy } from '../ui.js';
import { icon } from '../look.js';
import { ACCOUNT_TYPES, GROUPS, MODE_LABELS, groupOf, isDebt, isLoan, typeLabel, modeOf, defaultMode, currentBalance, accountTotals } from '../accounts-model.js';

export { ACCOUNT_TYPES, currentBalance };

const STYLE = {
  checking: ['#2F7A72', 'card'], savings: ['#5E8A45', 'sprout'], money_market: ['#4E9A8B', 'sprout'], cash: ['#D9973A', 'bill'],
  investment: ['#3F6E9E', 'leaf'], retirement: ['#6B5BA3', 'leaf'],
  credit: ['#9A3B26', 'card'], line_of_credit: ['#B5472E', 'card'], car_loan: ['#A0623E', 'car'], mortgage: ['#7D3C5C', 'home'],
  student_loan: ['#3F6E9E', 'sparkle'], personal_loan: ['#8A7A2E', 'percent'], medical: ['#C46A7A', 'heart'], other_debt: ['#5D6B7A', 'percent'],
};
export const accountBadge = (type, size = 40) => {
  const [c, i] = STYLE[type] || ['#5D6B7A', 'card'];
  return `<span class="cat-badge" style="--c:${c};width:${size}px;height:${size}px">${icon(i, Math.round(size * 0.55))}</span>`;
};

const typeOptions = (selected) => GROUPS.map(([g, label]) => `<optgroup label="${esc(label)}">${options(ACCOUNT_TYPES.filter((t) => t[2] === g).map((t) => [t[0], t[1]]), selected)}</optgroup>`).join('');

export function openAccountForm(ctx, existing = null, onSaved) {
  const a = existing || { name: '', type: 'checking', balance: 0, rate: '', payment: '', available_mode: '' };
  const shownBalance = existing ? currentBalance(a, ctx.state.data.Transactions).value : '';
  const { el, close } = openModal(existing ? 'Edit account' : 'New account', `<form class="form" id="acct-form">
    <label class="field"><span>Name</span><input name="name" required value="${esc(a.name)}" placeholder="e.g. Joint checking ··2814"></label>
    <label class="field"><span>Type</span><select name="type">${typeOptions(a.type)}</select></label>
    <label class="field"><span class="bal-label">Current balance</span><input name="balance" type="number" step="0.01" inputmode="decimal" value="${shownBalance}" placeholder="0.00"></label>
    <div class="form-row">
      <label class="field"><span class="rate-label">Interest rate (%)</span><input name="rate" type="number" step="0.01" min="0" inputmode="decimal" value="${a.rate || ''}" placeholder="0.00"></label>
      <label class="field pay-field"><span>Monthly payment</span><input name="payment" type="number" step="0.01" min="0" inputmode="decimal" value="${a.payment || ''}" placeholder="0.00"></label>
    </div>
    <label class="field"><span>Counts against “available”?</span><select name="available_mode"></select></label>
    <p class="muted form-help"></p>
    <div class="form-actions">${existing ? '<button type="button" class="btn btn-danger" id="acct-del">Remove</button>' : ''}<button class="btn btn-primary">${existing ? 'Save' : 'Add account'}</button></div>
  </form>`);
  const f = $('#acct-form', el);
  const E = f.elements;
  const sync = (typeChanged) => {
    const type = E.type.value, g = groupOf(type);
    $('.bal-label', f).textContent = g === 'debt' ? 'Amount owed' : 'Current balance';
    $('.rate-label', f).textContent = g === 'debt' ? 'Interest rate (APR %)' : 'Interest rate (APY %)';
    $('.pay-field', f).hidden = g !== 'debt';
    const keep = typeChanged ? defaultMode(type) : modeOf({ ...a, type });
    E.available_mode.innerHTML = options(MODE_LABELS[g], MODE_LABELS[g].some((m) => m[0] === keep) ? keep : MODE_LABELS[g][0][0]);
    $('.form-help', f).textContent = g === 'debt'
      ? (isLoan(type) ? 'Put the last digits of the loan number in the name (like ··4821) and the balance goes down as your payments to it show up on statements.' : 'Purchases on statements you import raise what you owe; payments lower it.')
      : 'Balances update when you import a statement, and between statements from receipts and income you log.';
  };
  E.type.addEventListener('change', () => sync(true));
  sync(false);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = Number(E.balance.value) || 0;
    const balance = round2(isDebt(E.type.value) ? Math.abs(typed) : typed);
    const rec = {
      ...a, id: a.id || uid(), name: E.name.value.trim(), type: E.type.value, balance,
      // Typing a new balance makes it the balance as of today.
      balance_date: !existing || balance !== shownBalance ? todayISO() : a.balance_date,
      rate: round2(Number(E.rate.value) || 0), payment: isDebt(E.type.value) ? round2(Number(E.payment.value) || 0) : 0,
      available_mode: E.available_mode.value,
    };
    busy(e.submitter, async () => {
      try { await ctx.save('Accounts', rec); close(); onSaved?.(rec); } catch (err) { ctx.handleError(err); }
    });
  });
  $('#acct-del', f)?.addEventListener('click', async () => {
    if (!confirm(`Remove ${a.name}? Its transactions stay in your history.`)) return;
    try { await ctx.remove('Accounts', a); close(); } catch (err) { ctx.handleError(err); }
  });
}

function accountRow(a, ctx) {
  const b = currentBalance(a, ctx.state.data.Transactions);
  const debt = isDebt(a.type);
  const mode = modeOf(a);
  const bits = [typeLabel(a.type)];
  if (a.rate) bits.push(`${a.rate}% ${debt ? 'APR' : 'APY'}`);
  if (debt && a.payment) bits.push(`${fmtMoney(a.payment)}/mo`);
  const when = a.balance_date ? `As of ${fmtDate(a.balance_date, true)}${b.since ? ` · ${b.since > 0 ? '+' : '−'}${fmtMoney(Math.abs(b.since))} since` : ''}` : 'Entered by hand';
  const availWord = mode === 'none' ? 'Not in available' : debt && mode === 'payment' ? 'Payment subtracted' : debt ? 'Balance subtracted' : '';
  return `<button class="txn" data-acct="${esc(a.id)}">
    ${accountBadge(a.type)}
    <span class="txn-main"><span class="txn-desc">${esc(a.name)}</span><span class="txn-sub">${esc(bits.join(' · '))}</span>
      <span class="txn-sub">${esc(when)}${availWord ? ` · ${esc(availWord)}` : ''}</span></span>
    <span class="amt ${debt ? 'neg' : ''}">${debt ? '−' : ''}${fmtMoney(b.value)}</span></button>`;
}

export function renderAccounts(root, ctx) {
  const accts = ctx.accounts();
  const tx = ctx.state.data.Transactions;
  const tot = accountTotals(accts, tx);
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Accounts</h1><button class="btn btn-primary" id="acct-add">＋ Account</button></div>
    ${accts.length ? `<section class="card">
      <div class="stats">
        <div class="stat" style="--c:var(--amber)"><span class="stat-label">Available</span><span class="stat-val ${tot.available >= 0 ? 'pos' : 'neg'}">${fmtMoney(tot.available)}</span></div>
        <div class="stat" style="--c:var(--moss)"><span class="stat-label">Cash & savings</span><span class="stat-val">${fmtMoney(tot.cash)}</span></div>
        <div class="stat" style="--c:var(--cedar)"><span class="stat-label">Owed</span><span class="stat-val">${fmtMoney(tot.owed)}</span></div>
        <div class="stat" style="--c:#3F6E9E"><span class="stat-label">Net worth</span><span class="stat-val ${tot.net >= 0 ? '' : 'neg'}">${fmtMoney(tot.net)}</span></div>
      </div>
      <p class="muted">Available is what you could spend now: the accounts set to count, minus the debts you’ve chosen to subtract, in full or just this month’s payment. Tap an account to change it.</p>
    </section>
    ${GROUPS.map(([g, label]) => {
      const list = accts.filter((a) => groupOf(a.type) === g);
      if (!list.length) return '';
      const sum = list.reduce((s, a) => s + currentBalance(a, tx).value, 0);
      return `<section class="card"><div class="card-head"><h2>${esc(label)}</h2><strong class="num ${g === 'debt' ? 'neg' : ''}">${g === 'debt' ? '−' : ''}${fmtMoney(sum)}</strong></div>
        <div class="txns">${list.map((a) => accountRow(a, ctx)).join('')}</div></section>`;
    }).join('')}`
    : `<section class="card">${emptyState('No accounts yet', 'Add your bank accounts, cards and loans. Statements you import fill in the balances.')}</section>`}
  </div>`;
  $('#acct-add', root).addEventListener('click', () => openAccountForm(ctx, null, () => toast('Account added', 'ok')));
  $$('[data-acct]', root).forEach((b) => b.addEventListener('click', () => openAccountForm(ctx, ctx.find('Accounts', b.dataset.acct))));
}
