import { esc, fmtMoney, fmtMoney0, fmtMonth, fmtDate, uid, toast, MONTHS, todayISO, $, $$ } from '../util.js';
import { monthReport, yearReport, UNCATEGORIZED } from '../reports.js';
import { txnItem, options, catOptions, badge, emptyState, statusText, categoryTile, spendRibbon } from '../ui.js';
import { catColor, catBadge } from '../look.js';
import { openTxnForm } from './txn-form.js';

const TABS = [['budget', 'Budget'], ['transactions', 'Transactions'], ['month', 'Month'], ['year', 'Year']];

export function renderSpending(root, ctx, [sub = 'month', arg] = [], query = {}) {
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Spending</h1></div>
    <nav class="seg seg-nav" aria-label="Spending views">${TABS.map(([id, label]) => `<a href="#/spending/${id}" ${id === sub ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div id="sub"></div></div>`;
  const host = $('#sub', root);
  ({ budget: renderBudget, transactions: renderTransactions, month: renderMonth, year: renderYear }[sub] || renderMonth)(host, ctx, arg, query);
}

// ---- Budget: set monthly amounts per category ----
// Average monthly spending per category over the last three months that have data, as a guide.
function recentAverages(ctx) {
  const months = [...new Set(ctx.state.data.Transactions.filter((t) => !t.deleted).map((t) => t.date.slice(0, 7)))].sort().slice(-3);
  const sums = new Map();
  for (const t of ctx.state.data.Transactions) {
    if (t.deleted || t.type !== 'expense' || !months.includes(t.date.slice(0, 7))) continue;
    sums.set(t.category_id, (sums.get(t.category_id) || 0) - t.amount);
  }
  return { months: months.length, avg: (id) => (months.length ? (sums.get(id) || 0) / months.length : 0) };
}

function renderBudget(host, ctx) {
  const exp = ctx.categories('expense', true);
  const inc = ctx.categories('income', true);
  const active = exp.filter((c) => !c.archived);
  const total = active.reduce((a, c) => a + (c.monthly_budget || 0), 0);
  const avgs = recentAverages(ctx);
  const funded = active.filter((c) => c.monthly_budget > 0).sort((a, b) => b.monthly_budget - a.monthly_budget);
  const row = (c) => {
    const avg = avgs.avg(c.id);
    return `<li class="bud-row ${c.archived ? 'archived' : ''}" style="--c:${catColor(c)}">
      ${catBadge(c, 40)}
      <label class="bud-name" for="b-${esc(c.id)}">${esc(c.name)}${c.archived ? ' <span class="muted">(archived)</span>' : ''}</label>
      ${c.kind === 'expense' ? `<span class="money-input"><span aria-hidden="true">$</span><input id="b-${esc(c.id)}" data-budget="${esc(c.id)}" type="number" inputmode="decimal" min="0" step="1" value="${c.monthly_budget || ''}" placeholder="0" aria-label="${esc(c.name)} monthly budget"></span>` : '<span></span>'}
      ${c.kind === 'expense' ? `<span class="bud-hint">${avgs.months && avg ? `You spend about ${fmtMoney0(avg)} a month` : 'No spending yet'}</span>` : ''}
      <span class="bud-actions"><button class="btn btn-small btn-ghost" data-rename="${esc(c.id)}">Rename</button><button class="btn btn-small btn-ghost" data-archive="${esc(c.id)}">${c.archived ? 'Restore' : 'Archive'}</button></span>
    </li>`;
  };
  host.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Monthly budget</h2><span class="stat-val">${fmtMoney(total)}</span></div>
      ${funded.length ? `<div class="alloc" role="img" aria-label="${esc(funded.map((c) => `${c.name} ${fmtMoney0(c.monthly_budget)}`).join(', '))}">${funded.map((c) => `<span style="--c:${catColor(c)};flex:${c.monthly_budget}" title="${esc(c.name)} ${fmtMoney0(c.monthly_budget)}"></span>`).join('')}</div>
      <div class="ribbon-key">${funded.slice(0, 6).map((c) => `<span><i style="--c:${catColor(c)}"></i>${esc(c.name)} ${fmtMoney0(c.monthly_budget)}</span>`).join('')}</div>` : ''}
      <p class="muted">Set a monthly amount for each category. Weekly, quarterly and yearly views scale it for you.</p>
    </section>
    <section class="card"><h2>Spending categories</h2><ul class="bud-list">${exp.map(row).join('')}</ul></section>
    <section class="card"><h2>Income categories</h2><ul class="bud-list">${inc.map(row).join('')}</ul></section>
    <section class="card"><h2>Add a category</h2>
      <form id="cat-add" class="form form-row">
        <label class="field"><span>Name</span><input name="name" required></label>
        <label class="field"><span>Type</span><select name="kind"><option value="expense">Spending</option><option value="income">Income</option></select></label>
        <button class="btn btn-primary">Add category</button>
      </form>
    </section>`;
  $$('[data-budget]', host).forEach((inp) => inp.addEventListener('change', async () => {
    const c = ctx.find('Categories', inp.dataset.budget);
    try { await ctx.save('Categories', { ...c, monthly_budget: Math.max(0, Number(inp.value) || 0) }); toast(`${c.name} budget saved`, 'ok'); }
    catch (e) { ctx.handleError(e); }
  }));
  $$('[data-rename]', host).forEach((b) => b.addEventListener('click', async () => {
    const c = ctx.find('Categories', b.dataset.rename);
    const name = prompt('New name', c.name)?.trim();
    if (name && name !== c.name) try { await ctx.save('Categories', { ...c, name }); } catch (e) { ctx.handleError(e); }
  }));
  $$('[data-archive]', host).forEach((b) => b.addEventListener('click', async () => {
    const c = ctx.find('Categories', b.dataset.archive);
    try { await ctx.save('Categories', { ...c, archived: !c.archived }); } catch (e) { ctx.handleError(e); }
  }));
  $('#cat-add', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const sort = Math.max(0, ...ctx.state.data.Categories.map((c) => c.sort || 0)) + 1;
    try { await ctx.save('Categories', { id: uid(), name: f.name.value.trim(), kind: f.kind.value, monthly_budget: 0, sort, archived: false }); toast('Category added', 'ok'); }
    catch (err) { ctx.handleError(err); }
  });
}

// ---- Transactions: search and filter ----
function renderTransactions(host, ctx, _arg, q) {
  const people = [...new Set(ctx.state.data.Transactions.map((t) => t.entered_by).filter(Boolean))];
  const allCats = ctx.categories(null, true);
  host.innerHTML = `
    <section class="card">
      <div class="filters">
        <label class="field"><span>Search</span><input id="f-q" type="search" value="${esc(q.q || '')}" placeholder="Merchant, note or amount"></label>
        <label class="field"><span>Category</span><select id="f-cat"><option value="">All categories</option><option value="${UNCATEGORIZED}" ${q.cat === UNCATEGORIZED ? 'selected' : ''}>Uncategorized</option>${options(allCats.map((c) => [c.id, c.name]), q.cat)}</select></label>
        <label class="field"><span>Month</span><input id="f-month" type="month" value="${esc(q.month || '')}"></label>
        <label class="field"><span>Type</span><select id="f-type">${options([['', 'All types'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']], q.type || '')}</select></label>
        <label class="field"><span>Account</span><select id="f-acct"><option value="">All accounts</option>${options(ctx.accounts().map((a) => [a.id, a.name]), q.acct)}</select></label>
        ${people.length > 1 ? `<label class="field"><span>Entered by</span><select id="f-person"><option value="">Everyone</option>${options(people.map((p) => [p, ctx.personName(p)]), q.person)}</select></label>` : ''}
        <label class="check"><input id="f-needs" type="checkbox" ${q.needs ? 'checked' : ''}> Needs a category</label>
      </div>
      <button class="btn btn-primary" id="t-add">＋ Add transaction</button>
    </section>
    <section class="card"><div id="t-sum" class="muted"></div><div class="txns" id="t-list"></div><div id="t-more"></div></section>`;

  let limit = 100;
  const draw = () => {
    const f = {
      q: $('#f-q', host).value.trim().toLowerCase(), cat: $('#f-cat', host).value, month: $('#f-month', host).value,
      type: $('#f-type', host).value, acct: $('#f-acct', host).value, person: $('#f-person', host)?.value || '', needs: $('#f-needs', host).checked,
    };
    const list = ctx.state.data.Transactions.filter((t) => !t.deleted
      && (!f.q || t.description.toLowerCase().includes(f.q) || (t.note || '').toLowerCase().includes(f.q) || Math.abs(t.amount).toFixed(2).includes(f.q))
      && (!f.cat || (f.cat === UNCATEGORIZED ? !t.category_id && t.type === 'expense' : t.category_id === f.cat))
      && (!f.month || t.date.startsWith(f.month))
      && (!f.type || t.type === f.type)
      && (!f.acct || t.account_id === f.acct)
      && (!f.person || t.entered_by === f.person)
      && (!f.needs || (t.type !== 'transfer' && !t.category_id)))
      .sort((a, b) => b.date.localeCompare(a.date));
    const spent = list.filter((t) => t.type === 'expense').reduce((a, t) => a - t.amount, 0);
    $('#t-sum', host).textContent = `${list.length} transaction${list.length === 1 ? '' : 's'} · ${fmtMoney(spent)} spent`;
    const page = list.slice(0, limit);
    const days = new Map();
    for (const t of page) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }
    $('#t-list', host).innerHTML = [...days].map(([d, ts]) => {
      const out = ts.filter((t) => t.type === 'expense').reduce((a, t) => a - t.amount, 0);
      return `<div class="day-head"><span>${esc(fmtDate(d, true))}</span><span>${out ? fmtMoney(out) + ' spent' : ''}</span></div>${ts.map((t) => txnItem(t, ctx)).join('')}`;
    }).join('') || '<p class="muted">Nothing matches these filters.</p>';
    $('#t-more', host).innerHTML = list.length > limit ? '<button class="btn" id="more">Show more</button>' : '';
    $('#more', host)?.addEventListener('click', () => { limit += 200; draw(); });
    $$('[data-txn]', host).forEach((b) => b.addEventListener('click', () => openTxnForm(ctx, ctx.find('Transactions', b.dataset.txn))));
  };
  // Search waits for a pause in typing so long lists don't redraw on every letter.
  let wait;
  $$('.filters input, .filters select', host).forEach((el) => el.addEventListener('input', () => {
    limit = 100; clearTimeout(wait);
    if (el.id === 'f-q') wait = setTimeout(draw, 200); else draw();
  }));
  $('#t-add', host).addEventListener('click', () => openTxnForm(ctx));
  draw();
}

// ---- Month: statement month by category vs budget ----
function change(cur, prev) {
  if (!prev) return '';
  const d = (cur - prev) / prev;
  return `${d >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(d * 100))}%`;
}

function renderMonth(host, ctx, ym) {
  ym ||= ctx.latestMonth() || todayISO().slice(0, 7);
  const r = monthReport(ctx.state.data, ym);
  const shift = (k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const head = `<div class="controls" style="justify-content:space-between">
    <div class="stepper"><button id="m-prev" aria-label="Previous month">‹</button><strong>${esc(fmtMonth(ym))}</strong><button id="m-next" aria-label="Next month" ${ym >= todayISO().slice(0, 7) ? 'disabled' : ''}>›</button></div>
    <a class="btn btn-small" href="#/spending/year/${ym.slice(0, 4)}">See ${ym.slice(0, 4)}</a></div>`;
  if (!r.count) {
    host.innerHTML = head + `<section class="card">${emptyState(`No transactions in ${fmtMonth(ym)}`, 'Import that month’s statement to see spending by category.', '<a class="btn btn-primary" href="#/add/import">Import a statement</a>')}</section>`;
  } else {
    const rows = r.rows.filter((x) => x.budget > 0 || x.spent > 0).sort((a, b) => (b.status === 'over') - (a.status === 'over') || b.spent - a.spent);
    const over = rows.filter((x) => x.status === 'over');
    host.innerHTML = head + `
    <section class="card">
      <div class="stats">
        <div class="stat" style="--c:var(--cedar)"><span class="stat-label">Spent</span><span class="stat-val">${fmtMoney(r.spent)}</span></div>
        <div class="stat" style="--c:var(--amber)"><span class="stat-label">Budget</span><span class="stat-val">${fmtMoney(r.budget)}</span></div>
        <div class="stat" style="--c:var(--moss)"><span class="stat-label">Income</span><span class="stat-val">${fmtMoney(r.income)}</span></div>
        <div class="stat" style="--c:${r.net >= 0 ? 'var(--moss)' : 'var(--bar-over)'}"><span class="stat-label">${r.net >= 0 ? 'Saved' : 'Overspent'}</span><span class="stat-val ${r.net >= 0 ? 'pos' : 'neg'}">${fmtMoney(Math.abs(r.net))}</span></div>
      </div>
      <ul class="facts">
        <li>${r.budget > 0 ? badge(r.spent > r.budget ? 'over' : 'ok', r.spent > r.budget ? `Over budget by ${fmtMoney(r.spent - r.budget)}` : `${fmtMoney(r.budget - r.spent)} under budget`) : badge('unbudgeted', 'No budgets set yet')}</li>
        ${r.prevHasData ? `<li>Spending is ${change(r.spent, r.prevSpent)} vs last month (${fmtMoney(r.prevSpent)}).</li>` : ''}
        ${r.avgSpent ? `<li>Spending is ${change(r.spent, r.avgSpent)} vs your recent monthly average (${fmtMoney(r.avgSpent)}).</li>` : ''}
        ${over.length ? `<li>${over.length} categor${over.length === 1 ? 'y is' : 'ies are'} over budget: ${esc(over.map((x) => x.name).join(', '))}.</li>` : ''}
      </ul>
    </section>
    <section class="card"><h2>By category</h2>
      ${spendRibbon(rows, ctx)}
      <div class="tiles">${rows.map((x) => categoryTile(x, ctx, `#/spending/transactions?cat=${encodeURIComponent(x.id)}&month=${ym}`)).join('')}</div>
    </section>
    <section class="card two-col">
      <div><h2>Top merchants</h2><ol class="simple">${r.topMerchants.map((m) => `<li><span>${esc(titleCase(m.name))}</span><strong class="num">${fmtMoney(m.amount)}</strong></li>`).join('')}</ol></div>
      <div><h2>Largest purchases</h2><div class="txns">${r.largest.map((t) => txnItem(t, ctx)).join('')}</div></div>
    </section>`;
  }
  $('#m-prev', host).addEventListener('click', () => ctx.go(`#/spending/month/${shift(-1)}`));
  $('#m-next', host).addEventListener('click', () => ctx.go(`#/spending/month/${shift(1)}`));
  $$('[data-txn]', host).forEach((b) => b.addEventListener('click', () => openTxnForm(ctx, ctx.find('Transactions', b.dataset.txn))));
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---- Year: months rolled up, year-to-date vs budget ----
function yearChart(rep) {
  const W = 680, H = 220, L = 56, B = 28, T = 12;
  const max = Math.max(rep.monthlyBudget, ...rep.months.map((m) => m.spent), 1);
  const step = (W - L - 8) / 12, bw = step * 0.62;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const bars = rep.months.map((m, i) => {
    const x = L + i * step + (step - bw) / 2;
    const over = rep.monthlyBudget > 0 && m.spent > rep.monthlyBudget;
    const label = m.state === 'data' ? `${MONTHS[i]}: ${fmtMoney(m.spent)} spent${rep.monthlyBudget ? `, budget ${fmtMoney(rep.monthlyBudget)}` : ''}` : `${MONTHS[i]}: ${m.state === 'missing' ? 'no statement yet' : 'not yet'}`;
    const bar = m.state === 'data'
      ? `<rect x="${x}" y="${y(m.spent)}" width="${bw}" height="${y(0) - y(m.spent)}" rx="3" class="${over ? 'bar-over' : 'bar-spent'}"/>`
      : m.state === 'missing' ? `<rect x="${x}" y="${y(0) - 18}" width="${bw}" height="18" rx="3" class="bar-missing"/>` : '';
    return `<a href="#/spending/month/${m.ym}" aria-label="${esc(label)}"><title>${esc(label)}</title>${bar}<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis">${MONTHS[i][0]}</text></a>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Monthly spending in ${rep.year}${rep.monthlyBudget ? ` against a ${fmtMoney(rep.monthlyBudget)} monthly budget` : ''}">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${fmtMoney0(v)}</text>`).join('')}
    ${bars}
    ${rep.monthlyBudget ? `<line x1="${L}" x2="${W - 8}" y1="${y(rep.monthlyBudget)}" y2="${y(rep.monthlyBudget)}" class="budget-line"/><text x="${W - 8}" y="${y(rep.monthlyBudget) < 28 ? y(rep.monthlyBudget) + 16 : y(rep.monthlyBudget) - 6}" text-anchor="end" class="axis-strong">Budget ${fmtMoney0(rep.monthlyBudget)}</text>` : ''}
  </svg>`;
}

const compact = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`);

function heatRow(r, rep, ctx) {
  const cat = r.id === UNCATEGORIZED ? null : ctx.find('Categories', r.id);
  const color = cat ? catColor(cat) : '#8A8F87';
  const max = Math.max(...r.vals, 1);
  const cells = r.vals.map((v, i) => {
    const st = rep.months[i].state;
    if (st === 'future') return '<div class="cell future" role="cell"></div>';
    if (st === 'missing') return '<div class="cell missing" role="cell" title="No statement yet">–</div>';
    const share = r.monthly > 0 ? v / r.monthly : v / max;
    const a = v ? Math.min(0.12 + share * 0.7, 0.88) : 0;
    const over = r.monthly > 0 && v > r.monthly;
    const label = `${r.name}, ${MONTHS[i]}: ${fmtMoney(v)}${r.monthly ? ` of ${fmtMoney(r.monthly)}` : ''}${over ? ', over budget' : ''}`;
    return `<a class="cell ${a > 0.55 ? 'hot' : ''} ${over ? 'over' : ''}" role="cell" style="--c:${color};--a:${a.toFixed(2)}" href="#/spending/transactions?cat=${encodeURIComponent(r.id)}&month=${rep.months[i].ym}" aria-label="${esc(label)}" title="${esc(label)}">${v ? compact(v) : ''}</a>`;
  }).join('');
  return `<div class="hname" role="rowheader" style="--c:${color}">${catBadge(cat, 28)}<span>${esc(r.name)}</span></div>${cells}
    <div class="tot" role="cell"><strong class="${r.status === 'over' ? 'neg' : ''}">${fmtMoney0(r.total)}</strong>${r.ytdBudget ? `<span class="muted">of ${fmtMoney0(r.ytdBudget)}</span>` : ''}</div>`;
}

function renderYear(host, ctx, yearArg) {
  const data = ctx.state.data;
  const years = [...new Set(data.Transactions.filter((t) => !t.deleted).map((t) => Number(t.date.slice(0, 4))))];
  const nowY = new Date().getFullYear();
  if (!years.includes(nowY)) years.push(nowY);
  years.sort((a, b) => b - a);
  const year = Number(yearArg) || years[0];
  const rep = yearReport(data, year);
  const missing = rep.months.filter((m) => m.state === 'missing').map((m) => MONTHS[m.m]);
  const ytdStatus = rep.ytdBudget <= 0 ? 'unbudgeted' : rep.ytdSpent > rep.ytdBudget ? 'over' : rep.ytdSpent > rep.ytdBudget * 0.9 ? 'near' : 'ok';

  host.innerHTML = `<div class="controls"><label class="field-inline"><span>Year</span><select id="y-pick">${options(years.map((y) => [y, y]), year)}</select></label></div>
    <section class="card">
      <h2>${year} so far</h2>
      <div class="stats">
        <div class="stat"><span class="stat-label">Spent</span><span class="stat-val">${fmtMoney(rep.ytdSpent)}</span></div>
        <div class="stat"><span class="stat-label">Budget (${rep.monthsCounted} mo)</span><span class="stat-val">${fmtMoney(rep.ytdBudget)}</span></div>
        <div class="stat"><span class="stat-label">Income</span><span class="stat-val">${fmtMoney(rep.ytdIncome)}</span></div>
      </div>
      <p>${badge(ytdStatus, ytdStatus === 'unbudgeted' ? 'No budgets set yet' : ytdStatus === 'over' ? `Over by ${fmtMoney(rep.ytdSpent - rep.ytdBudget)} year to date` : `${fmtMoney(rep.ytdBudget - rep.ytdSpent)} under budget year to date`)}</p>
      ${missing.length ? `<p class="muted">No statement yet for: ${esc(missing.join(', '))}. Year-to-date budget counts only months with data.</p>` : ''}
      ${yearChart(rep)}
      <p class="legend"><span class="key key-spent"></span> Spent <span class="key key-over"></span> Over budget <span class="key key-missing"></span> No statement yet <span class="key key-budget"></span> Monthly budget</p>
    </section>
    <section class="card"><h2>Categories by month</h2>
      <p class="muted">Darker squares mean more of that month’s budget was spent. A red dot means over budget. Tap a month to open it.</p>
      <div class="heat-wrap" tabindex="0" aria-label="Spending by category and month, scrolls sideways">
        <div class="heat" role="table">
          <div class="hh" role="columnheader"></div>
          ${rep.months.map((m) => `<a class="hh ${m.ym === todayISO().slice(0, 7) ? 'cur' : ''}" role="columnheader" href="#/spending/month/${m.ym}">${MONTHS[m.m]}</a>`).join('')}
          <div class="hh" role="columnheader" style="text-align:right">Year</div>
          ${rep.rows.map((r) => heatRow(r, rep, ctx)).join('')}
          <div class="hname foot" role="rowheader">Total</div>
          ${rep.months.map((m) => `<div class="cell sum" role="cell">${m.state === 'data' ? compact(m.spent) : ''}</div>`).join('')}
          <div class="tot foot" role="cell"><strong>${fmtMoney0(rep.ytdSpent)}</strong><span class="muted">of ${fmtMoney0(rep.ytdBudget)}</span></div>
        </div>
      </div>
    </section>`;
  $('#y-pick', host).addEventListener('change', (e) => ctx.go(`#/spending/year/${e.target.value}`));
}

export { statusText, catOptions };
