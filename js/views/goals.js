// Savings goals: money set aside inside savings accounts, with progress and a plan for each goal.
import { esc, fmtMoney, fmtMoney0, fmtDate, uid, toast, round2, todayISO, $, $$ } from '../util.js';
import { openModal, options, busy, emptyState, badge } from '../ui.js';
import { icon } from '../look.js';
import { groupOf, currentBalance, typeLabel } from '../accounts-model.js';
import { accountBadge } from './accounts.js';
import { GOAL_COLORS, goalColor, savedFor, goalStatus, avgMonthlySpending, avgMonthlyIncome, plannedMonthly, savingsRate, todayMonthStart } from '../goals-model.js';

const STATUS_WORD = { ok: 'On track', near: 'Needs more each month', over: 'Past its date', done: 'Reached', none: 'No plan yet' };
const STATUS_CLASS = { ok: 'ok', near: 'near', over: 'over', done: 'ok', none: 'none' };

const savingsAccounts = (ctx) => ctx.accounts().filter((a) => groupOf(a.type) === 'cash' || groupOf(a.type) === 'invest');

export function openGoalForm(ctx, existing = null, preset = {}) {
  const g = existing || { name: '', target: '', target_date: '', account_id: savingsAccounts(ctx).find((a) => /sav|money/.test(a.type))?.id || '', monthly: '', color: ctx.state.data.Goals.length % GOAL_COLORS.length, note: '', ...preset };
  const avg = avgMonthlySpending(ctx.state.data.Transactions);
  const accts = savingsAccounts(ctx);
  const { el, close } = openModal(existing ? 'Edit goal' : 'New savings goal', `<form class="form" id="goal-form">
    ${!existing && avg ? `<div class="rule-box"><p style="margin:.3rem 0">Starting an emergency fund? You spend about <strong>${fmtMoney0(avg)}</strong> a month.</p>
      <div class="form-actions" style="justify-content:flex-start"><button type="button" class="btn btn-small" data-ef="3">3 months: ${fmtMoney0(avg * 3)}</button><button type="button" class="btn btn-small" data-ef="6">6 months: ${fmtMoney0(avg * 6)}</button></div></div>` : ''}
    <label class="field"><span>Name</span><input name="name" required value="${esc(g.name)}" placeholder="e.g. Emergency fund, Vacation, New car"></label>
    <div class="form-row">
      <label class="field"><span>Goal amount</span><input name="target" type="number" min="1" step="1" inputmode="decimal" required value="${g.target}" placeholder="0"></label>
      <label class="field"><span>Target date (optional)</span><input name="target_date" type="date" value="${esc(g.target_date)}"></label>
    </div>
    <label class="field"><span>Kept in</span><select name="account_id"><option value="">Not tied to an account</option>${options(accts.map((a) => [a.id, `${a.name}${a.rate ? ` (${a.rate}% APY)` : ''}`]), g.account_id)}</select></label>
    <fieldset class="field"><legend>Plan to add each month</legend>
      <div class="seg seg-sm" role="radiogroup" aria-label="Plan by">
        <label><input type="radio" name="plan" value="amount" ${g.monthly_pct > 0 ? '' : 'checked'}><span>Dollar amount</span></label>
        <label><input type="radio" name="plan" value="pct" ${g.monthly_pct > 0 ? 'checked' : ''}><span>% of income</span></label>
      </div>
      <input name="monthly" type="number" min="0" step="1" inputmode="decimal" value="${g.monthly || ''}" placeholder="0" aria-label="Dollars per month" style="margin-top:.5rem">
      <input name="monthly_pct" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${g.monthly_pct || ''}" placeholder="e.g. 10" aria-label="Percent of income" style="margin-top:.5rem">
      <span class="muted pct-hint" style="font-weight:400"></span>
    </fieldset>
    ${existing ? '' : '<label class="field"><span>Already saved toward it</span><input name="start" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></label>'}
    <fieldset class="field"><legend>Color</legend><div class="swatches">${GOAL_COLORS.map((c, i) => `<label><input type="radio" name="color" value="${i}" ${Number(g.color) === i ? 'checked' : ''}><span style="--c:${c}" aria-label="Color ${i + 1}"></span></label>`).join('')}</div></fieldset>
    <label class="field"><span>Note (optional)</span><input name="note" value="${esc(g.note || '')}"></label>
    ${existing ? historyHTML(ctx, g) : ''}
    <div class="form-actions">${existing ? `<button type="button" class="btn btn-danger" id="goal-del">Delete</button><button type="button" class="btn" id="goal-done">${g.done ? 'Reopen' : 'Mark finished'}</button>` : ''}<button class="btn btn-primary">${existing ? 'Save' : 'Add goal'}</button></div>
  </form>`);
  const f = $('#goal-form', el);
  const E = f.elements;
  const income = avgMonthlyIncome(ctx.state.data.Transactions);
  const syncPlan = () => {
    const pct = E.plan.value === 'pct';
    E.monthly.hidden = pct; E.monthly_pct.hidden = !pct;
    const p = Number(E.monthly_pct.value) || 0;
    $('.pct-hint', f).textContent = pct ? (income ? `Your income averages ${fmtMoney0(income)} a month${p ? `, so ${p}% is about ${fmtMoney0(income * p / 100)} a month` : ''}. This follows your income as it changes.` : 'Import a statement with your pay so CEDAR knows your income.') : '';
  };
  f.querySelectorAll('input[name=plan]').forEach((r) => r.addEventListener('change', syncPlan));
  E.monthly_pct.addEventListener('input', syncPlan);
  syncPlan();
  $$('[data-ef]', f).forEach((b) => b.addEventListener('click', () => {
    E.name.value ||= 'Emergency fund';
    E.target.value = Math.round(avg * Number(b.dataset.ef));
  }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const rec = { ...g, id: g.id || uid(), name: E.name.value.trim(), target: round2(Number(E.target.value) || 0), target_date: E.target_date.value,
      account_id: E.account_id.value,
      monthly: E.plan.value === 'pct' ? 0 : round2(Number(E.monthly.value) || 0), monthly_pct: E.plan.value === 'pct' ? round2(Number(E.monthly_pct.value) || 0) : 0, color: Number(E.color.value) || 0, note: E.note.value.trim(), done: !!g.done,
      sort: g.sort ?? ctx.state.data.Goals.length };
    const start = existing ? 0 : round2(Number(E.start?.value) || 0);
    busy(e.submitter, async () => {
      try {
        await ctx.save('Goals', rec);
        if (start) await ctx.save('GoalEntries', { id: uid(), goal_id: rec.id, date: todayISO(), amount: start, note: 'Starting amount', entered_by: ctx.state.user.email });
        toast(existing ? 'Saved' : `${rec.name} added`, 'ok'); close();
      } catch (err) { ctx.handleError(err); }
    });
  });
  $('#goal-del', f)?.addEventListener('click', async () => {
    if (!confirm(`Delete ${g.name}? The money stays in the account; it just isn’t set aside for this goal anymore.`)) return;
    try { await ctx.remove('Goals', g); toast('Goal deleted', 'ok'); close(); } catch (err) { ctx.handleError(err); }
  });
  $('#goal-done', f)?.addEventListener('click', async () => {
    try { await ctx.save('Goals', { ...g, done: !g.done }); toast(g.done ? 'Goal reopened' : 'Goal finished', 'ok'); close(); } catch (err) { ctx.handleError(err); }
  });
}

function historyHTML(ctx, g) {
  const list = ctx.state.data.GoalEntries.filter((e) => !e.deleted && e.goal_id === g.id).sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return '';
  return `<details class="history"><summary>History (${list.length})</summary><ul class="simple">${list.slice(0, 30).map((e) =>
    `<li><span>${fmtDate(e.date, true)}${e.note ? ` · ${esc(e.note)}` : ''}</span><strong class="${e.amount < 0 ? 'neg' : 'pos'}">${e.amount < 0 ? '−' : '+'}${fmtMoney(Math.abs(e.amount))}</strong></li>`).join('')}</ul></details>`;
}

export function openEntryForm(ctx, goal, direction = 1) {
  const { el, close } = openModal(direction > 0 ? `Add to ${goal.name}` : `Take out of ${goal.name}`, `<form class="form" id="entry-form">
    <label class="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label>
    <label class="field"><span>Date</span><input name="date" type="date" required value="${todayISO()}"></label>
    <label class="field"><span>Note (optional)</span><input name="note" placeholder="${direction > 0 ? 'e.g. September savings' : 'e.g. car repair'}"></label>
    <p class="muted">This sets money aside inside the account; it doesn’t move money at the bank.</p>
    <div class="form-actions"><button class="btn btn-primary">${direction > 0 ? 'Add money' : 'Take out'}</button></div>
  </form>`);
  const f = $('#entry-form', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const amt = round2(Math.abs(Number(f.elements.amount.value)) * direction);
    busy(e.submitter, async () => {
      try {
        await ctx.save('GoalEntries', { id: uid(), goal_id: goal.id, date: f.elements.date.value, amount: amt, note: f.elements.note.value.trim(), entered_by: ctx.state.user.email });
        toast(direction > 0 ? `Added ${fmtMoney(Math.abs(amt))} to ${goal.name}` : `Took ${fmtMoney(Math.abs(amt))} out of ${goal.name}`, 'ok'); close();
      } catch (err) { ctx.handleError(err); }
    });
  });
}

function goalRing(pct, color, size = 64) {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg class="goal-ring" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="mr-track" style="stroke-width:7"/>
    <circle cx="32" cy="32" r="${r}" class="mr-fill" style="--c:${color};stroke-width:7" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle" class="mr-text" style="font-size:13px">${Math.round(pct * 100)}%</text></svg>`;
}

export function goalCard(ctx, g, apy) {
  const saved = savedFor(g, ctx.state.data.GoalEntries);
  const income = avgMonthlyIncome(ctx.state.data.Transactions);
  const st = goalStatus(g, saved, apy, new Date(), income);
  const planWord = g.monthly_pct > 0 ? `Plan: ${g.monthly_pct}% of income (about ${fmtMoney0(plannedMonthly(g, income))} a month).` : '';
  const color = goalColor(g);
  const thisMonth = ctx.state.data.GoalEntries.filter((e) => !e.deleted && e.goal_id === g.id && e.date >= todayMonthStart()).reduce((s, e) => s + e.amount, 0);
  return `<article class="goal" style="--c:${color}">
    <button class="goal-main" data-goal="${esc(g.id)}" aria-label="Edit ${esc(g.name)}">
      ${goalRing(st.pct, color)}
      <span class="goal-text"><span class="goal-name">${esc(g.name)}</span>
        <span class="goal-amt"><strong>${fmtMoney(saved)}</strong> of ${fmtMoney(g.target)}${g.target_date ? ` · by ${fmtDate(g.target_date, true)}` : ''}</span>
        ${badge(STATUS_CLASS[st.status], STATUS_WORD[st.status])}</span>
    </button>
    <div class="bar goal-bar" aria-hidden="true"><div class="bar-fill" style="width:${(st.pct * 100).toFixed(1)}%;background:${color}"></div></div>
    <p class="goal-line">${planWord ? `${esc(planWord)} ` : ''}${esc(st.line)}${thisMonth ? ` <span class="muted">${thisMonth > 0 ? 'Added' : 'Took out'} ${fmtMoney(Math.abs(thisMonth))} this month.</span>` : ''}</p>
    <div class="goal-actions"><button class="btn btn-small" data-add="${esc(g.id)}">＋ Add money</button><button class="btn btn-small btn-ghost" data-take="${esc(g.id)}">Take out</button></div>
  </article>`;
}

export function renderGoals(root, ctx) {
  const { Goals, GoalEntries, Transactions } = ctx.state.data;
  const goals = Goals.filter((g) => !g.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const active = goals.filter((g) => !g.done);
  const finished = goals.filter((g) => g.done);
  const accts = savingsAccounts(ctx);
  const savingsTypes = accts.filter((a) => /savings|money_market/.test(a.type) || active.some((g) => g.account_id === a.id));
  const bal = (a) => currentBalance(a, Transactions).value;
  const inGoals = active.reduce((s, g) => s + savedFor(g, GoalEntries), 0);
  const savingsTotal = savingsTypes.reduce((s, a) => s + bal(a), 0);
  const interest = savingsTypes.reduce((s, a) => s + bal(a) * (a.rate || 0) / 100, 0);
  const rate = savingsRate(Transactions);

  const accountCard = (a) => {
    const list = active.filter((g) => g.account_id === a.id);
    const total = bal(a);
    const parts = list.map((g) => ({ g, v: Math.max(savedFor(g, GoalEntries), 0) }));
    const assigned = parts.reduce((s, p) => s + p.v, 0);
    const free = round2(total - assigned);
    return `<section class="card">
      <div class="card-head"><div class="acct-title">${accountBadge(a.type, 40)}<div><h2 style="margin:0">${esc(a.name)}</h2><span class="muted">${esc(typeLabel(a.type))}${a.rate ? ` · ${a.rate}% APY · about ${fmtMoney(total * a.rate / 100)} interest a year` : ' · Add its interest rate in Accounts'}</span></div></div><span class="stat-val">${fmtMoney(total)}</span></div>
      ${total > 0 || assigned > 0 ? `<div class="alloc" role="img" aria-label="${esc(parts.map((p) => `${p.g.name} ${fmtMoney0(p.v)}`).concat(free > 0 ? [`Not set aside ${fmtMoney0(free)}`] : []).join(', '))}">
        ${parts.map((p) => `<span style="--c:${goalColor(p.g)};flex:${p.v}"></span>`).join('')}${free > 0 ? `<span style="--c:var(--line);flex:${free}"></span>` : ''}</div>
      <div class="ribbon-key">${parts.map((p) => `<span><i style="--c:${goalColor(p.g)}"></i>${esc(p.g.name)} ${fmtMoney0(p.v)}</span>`).join('')}${free > 0 ? `<span><i style="--c:var(--line)"></i>Not set aside ${fmtMoney0(free)}</span>` : ''}</div>` : ''}
      ${free < -0.5 ? `<p class="notice">Your goals add up to ${fmtMoney(-free)} more than this account holds. Take money out of a goal or update the balance.</p>` : ''}
      <div class="goals">${list.map((g) => goalCard(ctx, g, a.rate || 0)).join('')}</div>
      <button class="btn btn-ghost" data-new="${esc(a.id)}">＋ New goal in ${esc(a.name)}</button>
    </section>`;
  };
  const loose = active.filter((g) => !g.account_id || !accts.some((a) => a.id === g.account_id));

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Goals</h1><button class="btn btn-primary" id="goal-add">＋ Goal</button></div>
    <section class="card">
      <div class="stats">
        <div class="stat" style="--c:var(--moss)"><span class="stat-label">Set aside for goals</span><span class="stat-val">${fmtMoney(inGoals)}</span></div>
        <div class="stat" style="--c:#2F7A72"><span class="stat-label">In savings</span><span class="stat-val">${fmtMoney(savingsTotal)}</span></div>
        <div class="stat" style="--c:var(--amber)"><span class="stat-label">Interest per year</span><span class="stat-val">${fmtMoney(interest)}</span></div>
        <div class="stat" style="--c:var(--cedar)"><span class="stat-label">Savings rate</span><span class="stat-val">${rate === null ? '–' : `${Math.round(rate * 100)}%`}</span></div>
      </div>
      <p class="muted">Savings rate is how much of your income you kept over your last three months of statements.${rate !== null && rate < 0.1 ? ' Many planners suggest aiming for 10–20%.' : ''}</p>
    </section>
    ${savingsTypes.map(accountCard).join('')}
    ${loose.length ? `<section class="card"><h2>Other goals</h2><div class="goals">${loose.map((g) => goalCard(ctx, g, 0)).join('')}</div></section>` : ''}
    ${!goals.length ? `<section class="card">${emptyState('No goals yet', savingsTypes.length ? 'Split your savings into goals like an emergency fund or a trip, and see what it takes to reach each one.' : 'Add a savings account in Accounts first, then split it into goals.', `<button class="btn btn-primary" id="goal-add2">Add a goal</button>`)}</section>` : ''}
    ${finished.length ? `<section class="card"><h2>Finished</h2><ul class="simple">${finished.map((g) => `<li><button class="link" data-goal="${esc(g.id)}">${esc(g.name)}</button><span>${fmtMoney(savedFor(g, GoalEntries))}</span></li>`).join('')}</ul></section>` : ''}
  </div>`;
  $('#goal-add', root).addEventListener('click', () => openGoalForm(ctx));
  $('#goal-add2', root)?.addEventListener('click', () => openGoalForm(ctx));
  $$('[data-new]', root).forEach((b) => b.addEventListener('click', () => openGoalForm(ctx, null, { account_id: b.dataset.new })));
  bindGoalButtons(root, ctx);
}

export function bindGoalButtons(root, ctx) {
  $$('[data-goal]', root).forEach((b) => b.addEventListener('click', () => openGoalForm(ctx, ctx.find('Goals', b.dataset.goal))));
  $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => openEntryForm(ctx, ctx.find('Goals', b.dataset.add), 1)));
  $$('[data-take]', root).forEach((b) => b.addEventListener('click', () => openEntryForm(ctx, ctx.find('Goals', b.dataset.take), -1)));
}

// Small summary for Home.
export function goalsSummary(ctx) {
  const { Goals, GoalEntries } = ctx.state.data;
  const active = Goals.filter((g) => !g.deleted && !g.done).sort((a, b) => (a.sort || 0) - (b.sort || 0)).slice(0, 3);
  if (!active.length) return '';
  return `<section class="card"><div class="card-head"><h2>Savings goals</h2><a href="#/goals">See all</a></div>
    ${active.map((g) => {
      const saved = savedFor(g, GoalEntries);
      const pct = g.target ? Math.min(saved / g.target, 1) : 0;
      return `<a class="goal-mini" href="#/goals" style="--c:${goalColor(g)}"><span class="goal-name">${esc(g.name)}</span><span class="muted num">${fmtMoney0(saved)} of ${fmtMoney0(g.target)}</span>
        <span class="bar" aria-hidden="true"><span class="bar-fill" style="display:block;width:${(pct * 100).toFixed(1)}%;background:${goalColor(g)}"></span></span></a>`;
    }).join('')}</section>`;
}

export { icon };
