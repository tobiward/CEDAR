// Subscriptions: what's charged, how much, and when.
import { esc, fmtMoney, fmtDate, uid, round2, toast, todayISO, $, $$ } from '../util.js';
import { openModal, options, catOptions, busy, emptyState } from '../ui.js';
import { catBadge } from '../look.js';
import { FREQUENCIES, nextCharge, monthlyCost, daysUntil } from '../subs.js';

export function openSubForm(ctx, existing = null) {
  const subsCat = ctx.categories('expense').find((c) => c.name.toLowerCase() === 'subscriptions');
  const s = existing || { name: '', amount: '', frequency: 'monthly', next_date: todayISO(), category_id: subsCat?.id || '', account_id: ctx.accounts()[0]?.id || '', note: '' };
  const { el, close } = openModal(existing ? 'Edit subscription' : 'Add a subscription', `<form class="form" id="sub-form">
    <label class="field"><span>Name</span><input name="name" required value="${esc(s.name)}" placeholder="e.g. Netflix"></label>
    <div class="form-row">
      <label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${s.amount}" placeholder="0.00"></label>
      <label class="field"><span>How often</span><select name="frequency">${options(FREQUENCIES.map((f) => [f[0], f[1]]), s.frequency)}</select></label>
    </div>
    <label class="field"><span>A charge date (the last one or the next one)</span><input name="next_date" type="date" required value="${esc(existing ? nextCharge(s) : s.next_date)}"></label>
    <label class="field"><span>Category</span><select name="category_id">${catOptions(ctx, 'expense', s.category_id)}</select></label>
    <label class="field"><span>Charged to</span><select name="account_id"><option value="">Not set</option>${options(ctx.accounts().map((a) => [a.id, a.name]), s.account_id)}</select></label>
    <label class="field"><span>Note (optional)</span><input name="note" value="${esc(s.note || '')}" placeholder="e.g. family plan, cancel after trial"></label>
    <div class="form-actions">${existing ? '<button type="button" class="btn btn-danger" id="sub-del">Remove</button>' : ''}<button class="btn btn-primary">${existing ? 'Save' : 'Add subscription'}</button></div>
  </form>`);
  const f = $('#sub-form', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const E = f.elements;
    const rec = { ...s, id: s.id || uid(), name: E.name.value.trim(), amount: round2(Math.abs(Number(E.amount.value))), frequency: E.frequency.value,
      next_date: E.next_date.value, category_id: E.category_id.value, account_id: E.account_id.value, note: E.note.value.trim() };
    busy(e.submitter, async () => {
      try { await ctx.save('Subscriptions', rec); toast(existing ? 'Saved' : `${rec.name} added`, 'ok'); close(); } catch (err) { ctx.handleError(err); }
    });
  });
  $('#sub-del', f)?.addEventListener('click', async () => {
    if (!confirm(`Remove ${s.name}?`)) return;
    try { await ctx.remove('Subscriptions', s); toast('Removed', 'ok'); close(); } catch (err) { ctx.handleError(err); }
  });
}

export function renderSubscriptions(root, ctx) {
  const subs = ctx.subscriptions().map((s) => ({ ...s, next: nextCharge(s) })).sort((a, b) => a.next.localeCompare(b.next));
  const perMonth = subs.reduce((a, s) => a + monthlyCost(s), 0);
  root.innerHTML = `<div class="page">
    <div class="page-head"><a class="back" href="#/home" aria-label="Back to Home">←</a><h1>Subscriptions</h1><button class="btn btn-primary" id="add">＋ Add</button></div>
    ${subs.length ? `<section class="card">
      <div class="stats">
        <div class="stat" style="--c:var(--cedar)"><span class="stat-label">Per month</span><span class="stat-val">${fmtMoney(perMonth)}</span></div>
        <div class="stat" style="--c:var(--amber)"><span class="stat-label">Per year</span><span class="stat-val">${fmtMoney(perMonth * 12)}</span></div>
        <div class="stat" style="--c:var(--moss)"><span class="stat-label">Next 30 days</span><span class="stat-val">${fmtMoney(subs.filter((s) => daysUntil(s.next) <= 30).reduce((a, s) => a + s.amount, 0))}</span></div>
      </div>
      <table class="subs">
        <thead><tr><th scope="col">Subscription</th><th scope="col">Next charge</th><th scope="col" class="r">Amount</th></tr></thead>
        <tbody>${subs.map((s) => {
          const cat = s.category_id ? ctx.find('Categories', s.category_id) : null;
          const d = daysUntil(s.next);
          return `<tr data-sub="${esc(s.id)}" tabindex="0" role="button" aria-label="Edit ${esc(s.name)}">
            <td><span class="sub-name">${catBadge(cat, 32)}<span>${esc(s.name)}<br><span class="muted" style="font-weight:400;font-size:.85rem">${esc(FREQUENCIES.find((f) => f[0] === s.frequency)?.[1] || '')}${s.note ? ' · ' + esc(s.note) : ''}</span></span></span></td>
            <td>${fmtDate(s.next, true)}<br><span class="muted" style="font-size:.85rem">${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`}</span></td>
            <td class="r"><strong>${fmtMoney(s.amount)}</strong>${s.frequency !== 'monthly' ? `<br><span class="muted" style="font-size:.85rem">${fmtMoney(monthlyCost(s))}/mo</span>` : ''}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </section>` : emptyState('No subscriptions yet', 'Add each subscription with its amount and charge date, and Home will remind you before it’s charged.', '<button class="btn btn-primary" id="add2">Add a subscription</button>')}
  </div>`;
  $('#add', root).addEventListener('click', () => openSubForm(ctx));
  $('#add2', root)?.addEventListener('click', () => openSubForm(ctx));
  $$('[data-sub]', root).forEach((r) => {
    const open = () => openSubForm(ctx, ctx.find('Subscriptions', r.dataset.sub));
    r.addEventListener('click', open);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}
