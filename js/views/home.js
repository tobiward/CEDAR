import { esc, fmtMoney, fmtMonth, MONTHS, todayISO, $, $$ } from '../util.js';
import { PERIODS, periodRange, budgetFactor, rangeLabel, elapsedShare } from '../periods.js';
import { inRange, totals, spentByCategory, budgetRows, monthReport, yearReport } from '../reports.js';
import { categoryTile, spendRibbon, txnItem, emptyState, options, badge } from '../ui.js';
import { icon, catBadge } from '../look.js';
import { nextCharge, monthlyCost, daysUntil, FREQUENCIES } from '../subs.js';
import { openTxnForm } from './txn-form.js';
import { openSubForm } from './subscriptions.js';
import { goalsSummary, bindGoalButtons } from './goals.js';

// Which month or year the spending card shows; kept for the session only.
const view = { mode: 'month', ym: null, year: null };

const PERIOD_TITLE = { daily: 'Today', weekly: 'This week', biweekly: 'This pay period', monthly: 'This month', quarterly: 'This quarter', yearly: 'This year' };

// Two growth rings: the outer shows how much of the period has passed, the inner how much of the budget is spent.
function treeRings(spent, budget, elapsed) {
  const pct = budget > 0 ? spent / budget : 0;
  const status = budget <= 0 ? 'none' : pct > 1 ? 'over' : pct > elapsed + 0.1 ? 'near' : 'ok';
  const R = 58, r = 44, C = 2 * Math.PI * R, c = 2 * Math.PI * r;
  return { status, pct, svg: `<svg class="rings" viewBox="0 0 140 140" width="124" height="124" aria-hidden="true">
    <circle cx="70" cy="70" r="${R}" class="rg-track" stroke-width="9"/>
    <circle cx="70" cy="70" r="${R}" class="rg-time" stroke-width="9" stroke-dasharray="${(C * elapsed).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <circle cx="70" cy="70" r="${r}" class="rg-track" stroke-width="13"/>
    <circle cx="70" cy="70" r="${r}" class="rg-spend st-${status}" stroke-width="13" stroke-dasharray="${(c * Math.min(pct, 1)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <circle cx="70" cy="70" r="31" class="rg-core"/>
    <text x="70" y="74" text-anchor="middle">${Math.round(pct * 100)}%</text>
    <text x="70" y="89" text-anchor="middle" class="rg-small">spent</text>
  </svg>` };
}

function shiftYm(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function subsCard(ctx) {
  const subs = ctx.subscriptions().map((s) => ({ ...s, next: nextCharge(s) })).sort((a, b) => a.next.localeCompare(b.next));
  if (!subs.length) {
    return `<section class="card"><div class="card-head"><h2>Subscriptions</h2></div>
      <p class="muted">Add your subscriptions to see what’s about to be charged.</p>
      <button class="btn" id="sub-add">${icon('repeat', 18)} Add a subscription</button></section>`;
  }
  const perMonth = subs.reduce((a, s) => a + monthlyCost(s), 0);
  const rows = subs.slice(0, 6).map((s) => {
    const d = daysUntil(s.next);
    const [, m, day] = s.next.split('-').map(Number);
    const cat = s.category_id ? ctx.find('Categories', s.category_id) : null;
    const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
    return `<tr data-sub="${esc(s.id)}">
      <td><span class="due ${d <= 3 ? 'soon' : ''}"><b>${day}</b><small>${MONTHS[m - 1]}</small></span></td>
      <td><span class="sub-name">${catBadge(cat, 30)}<span>${esc(s.name)}<br><span class="muted" style="font-weight:400;font-size:.85rem">${when} · ${esc(FREQUENCIES.find((f) => f[0] === s.frequency)?.[1] || '')}</span></span></span></td>
      <td class="r"><strong>${fmtMoney(s.amount)}</strong></td></tr>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h2>Upcoming subscriptions</h2><a href="#/subscriptions">Manage</a></div>
    <table class="subs"><caption class="sr-only">Next subscription charges</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Subscription</th><th scope="col" class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="sub-foot"><span>${subs.length} subscription${subs.length === 1 ? '' : 's'} · about <strong>${fmtMoney(perMonth)}</strong> a month</span>${subs.length > 6 ? `<a href="#/subscriptions">See all ${subs.length}</a>` : ''}</div>
  </section>`;
}

export function renderHome(root, ctx) {
  const { data } = ctx.state;
  const ui = ctx.ui();
  const anchor = ctx.setting('biweekly_anchor', '');
  const live = data.Transactions.filter((t) => !t.deleted);
  const quick = `<div class="quick">
    <button id="q-income" style="--c:var(--moss)"><span class="qi">${icon('sprout', 22)}</span>Add income</button>
    <a href="#/add/receipt" style="--c:var(--amber)"><span class="qi">${icon('bill', 22)}</span>Scan receipt</a>
    <a href="#/add/import" style="--c:var(--cedar)"><span class="qi">${icon('out', 22)}</span>Import statement</a>
  </div>`;

  if (!live.length) {
    root.innerHTML = `<div class="page">${emptyState('Welcome to CEDAR', 'Import your first statement to see your spending by category and how it compares to your budget.',
      `<div class="empty-actions"><a class="btn btn-primary" href="#/add/import">Import a statement</a><a class="btn" href="#/spending/budget">Set budgets</a></div>`)}${quick}${subsCard(ctx)}</div>`;
    bind(root, ctx);
    return;
  }

  // Canopy: this period's pace.
  const now = new Date();
  const cur = periodRange(ui.period, now, anchor);
  const curTx = inRange(data.Transactions, cur.start, cur.end);
  const curBudget = budgetRows(data.Categories, spentByCategory(curTx), budgetFactor(ui.period)).reduce((a, r) => a + r.budget, 0);
  const curSpent = totals(curTx).spent;
  const elapsed = elapsedShare(cur, now);
  const rings = treeRings(curSpent, curBudget, elapsed);
  const left = curBudget - curSpent;
  const words = { over: `Over budget by ${fmtMoney(-left)}`, near: 'Spending ahead of pace', ok: 'On track', none: 'Set budgets to track your pace' }[rings.status];

  // Spending vs budget: a month or a year.
  view.ym ||= ctx.latestMonth() || todayISO().slice(0, 7);
  view.year ||= Number(view.ym.slice(0, 4));
  let title, rows, t, budget;
  if (view.mode === 'month') {
    const r = monthReport(data, view.ym);
    title = fmtMonth(view.ym); rows = r.rows; t = r; budget = r.budget;
  } else {
    const r = yearReport(data, view.year);
    title = `${view.year}${r.monthsCounted < 12 ? ` · ${r.monthsCounted} month${r.monthsCounted === 1 ? '' : 's'} so far` : ''}`;
    rows = r.rows.map((x) => ({ id: x.id, name: x.name, spent: x.total, budget: x.ytdBudget, left: x.ytdBudget - x.total, status: x.status }));
    t = { spent: r.ytdSpent, income: r.ytdIncome, net: r.ytdIncome - r.ytdSpent }; budget = r.ytdBudget;
  }
  const shown = rows.filter((r) => r.budget > 0 || r.spent > 0).sort((a, b) => (b.status === 'over') - (a.status === 'over') || b.spent - a.spent);
  const recent = [...live].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const uncategorized = live.filter((x) => x.type !== 'transfer' && !x.category_id).length;
  const catLink = (id) => view.mode === 'month' ? `#/spending/transactions?cat=${encodeURIComponent(id)}&month=${view.ym}` : `#/spending/transactions?cat=${encodeURIComponent(id)}`;

  root.innerHTML = `<div class="page">
    <section class="hero" aria-label="${esc(`${PERIOD_TITLE[ui.period]}: ${fmtMoney(Math.max(left, 0))} left. ${words}`)}">
      <div class="hero-top">
        <h1 style="color:inherit;margin:0;font-size:1.35rem">${PERIOD_TITLE[ui.period]}</h1>
        <label>Budget period <select id="ctl-period">${options(PERIODS.map((p) => [p.id, p.label]), ui.period)}</select></label>
      </div>
      <div class="hero-body">
        <div class="hero-figure">
          <p class="hero-label">${left >= 0 ? 'Money left' : 'Over budget'}</p>
          <p class="hero-amount">${fmtMoney(Math.abs(left))}</p>
          <p class="hero-sub">${fmtMoney(curSpent)} spent of ${fmtMoney(curBudget)} · ${esc(rangeLabel(ui.period, cur, 1))}</p>
          ${badge(rings.status, words)}
        </div>
        ${rings.svg}
      </div>
      <div class="ring-key"><span><i style="background:#A9CF8E"></i>Inner ring: budget spent</span><span><i style="background:var(--amber)"></i>Outer ring: ${Math.round(elapsed * 100)}% of the period gone</span></div>
    </section>
    ${quick}
    ${!ctx.setting('transfers_checked', false) && live.some((x) => x.type === 'transfer') ? '<a class="notice" href="#/transfers">Some transfers may really be spending (cash, loans, payments to people). Re-check them.</a>' : ''}
    ${uncategorized ? `<a class="notice" href="#/spending/transactions?needs=1">${uncategorized} transaction${uncategorized === 1 ? ' needs' : 's need'} a category.</a>` : ''}
    <section class="card">
      <div class="card-head">
        <h2>Spending vs. budget</h2>
        <div class="seg seg-sm" role="group" aria-label="Show a month or a year">
          <button data-mode="month" aria-pressed="${view.mode === 'month'}">Month</button><button data-mode="year" aria-pressed="${view.mode === 'year'}">Year</button>
        </div>
      </div>
      <div class="stepper" style="justify-content:center;margin:.25rem 0 .5rem">
        <button id="prev" aria-label="Previous ${view.mode}">‹</button><strong>${esc(title)}</strong><button id="next" aria-label="Next ${view.mode}" ${(view.mode === 'month' ? view.ym >= todayISO().slice(0, 7) : view.year >= now.getFullYear()) ? 'disabled' : ''}>›</button>
      </div>
      <div class="stats">
        <div class="stat" style="--c:var(--cedar)"><span class="stat-label">Spent</span><span class="stat-val">${fmtMoney(t.spent)}</span></div>
        <div class="stat" style="--c:var(--amber)"><span class="stat-label">Budget</span><span class="stat-val">${fmtMoney(budget)}</span></div>
        <div class="stat" style="--c:var(--moss)"><span class="stat-label">Income</span><span class="stat-val">${fmtMoney(t.income)}</span></div>
        <div class="stat" style="--c:${t.net >= 0 ? 'var(--moss)' : 'var(--bar-over)'}"><span class="stat-label">${t.net >= 0 ? 'Saved' : 'Overspent'}</span><span class="stat-val ${t.net >= 0 ? 'pos' : 'neg'}">${fmtMoney(Math.abs(t.net))}</span></div>
      </div>
      ${spendRibbon(shown, ctx)}
      <div class="tiles">${shown.map((r) => categoryTile(r, ctx, catLink(r.id))).join('') || '<p class="muted">No spending here yet.</p>'}</div>
    </section>
    ${subsCard(ctx)}
    ${goalsSummary(ctx)}
    <section class="card">
      <div class="card-head"><h2>Recent transactions</h2><a href="#/spending/transactions">See all</a></div>
      <div class="txns">${recent.map((x) => txnItem(x, ctx)).join('')}</div>
    </section>
  </div>`;
  bind(root, ctx);
  $('#ctl-period', root)?.addEventListener('change', (e) => ctx.setUI({ period: e.target.value }));
  $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { view.mode = b.dataset.mode; ctx.render(); }));
  $('#prev', root).addEventListener('click', () => { if (view.mode === 'month') view.ym = shiftYm(view.ym, -1); else view.year--; ctx.render(); });
  $('#next', root).addEventListener('click', () => { if (view.mode === 'month') view.ym = shiftYm(view.ym, 1); else view.year++; ctx.render(); });
}

function bind(root, ctx) {
  $('#q-income', root)?.addEventListener('click', () => openTxnForm(ctx, null, { type: 'income' }));
  $('#sub-add', root)?.addEventListener('click', () => openSubForm(ctx));
  $$('[data-sub]', root).forEach((r) => r.addEventListener('click', () => openSubForm(ctx, ctx.find('Subscriptions', r.dataset.sub))));
  $$('[data-txn]', root).forEach((b) => b.addEventListener('click', () => openTxnForm(ctx, ctx.find('Transactions', b.dataset.txn))));
}
