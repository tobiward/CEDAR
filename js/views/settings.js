import { esc, toast, toCSV, downloadFile, todayISO, fmtDate, $ } from '../util.js';
import { shareFile, listPeople } from '../google.js';
import { busy } from '../ui.js';
import { googleKeys } from '../config.js';
import { lockSectionHTML, bindLockSection } from './lock-screen.js';

// One row per statement import, newest first, so a bad or doubled import can be removed in one step.
function importsHTML(ctx) {
  const groups = new Map();
  for (const t of ctx.state.data.Transactions) {
    if (t.deleted || !t.import_id || t.import_id === 'demo') continue;
    if (!groups.has(t.import_id)) groups.set(t.import_id, []);
    groups.get(t.import_id).push(t);
  }
  if (!groups.size) return '<p class="muted">No statement imports yet.</p>';
  const list = [...groups].map(([id, rows]) => {
    const dates = rows.map((r) => r.date).sort();
    const when = rows.map((r) => r.updated_at).filter(Boolean).sort()[0] || '';
    const accts = [...new Set(rows.map((r) => ctx.find('Accounts', r.account_id)?.name || 'No account'))].join(', ');
    // Identical rows inside one import usually mean the save was written twice.
    const keys = rows.map((r) => `${r.account_id}|${r.date}|${r.amount}|${r.description}`);
    const doubled = rows.length >= 4 && rows.length % 2 === 0 && [...new Set(keys)].length === rows.length / 2;
    return { id, rows, dates, when, accts, doubled, sig: `${accts}|${dates[0]}|${dates.at(-1)}|${rows.length}` };
  }).sort((a, b) => b.when.localeCompare(a.when));
  // Two imports covering the same account and dates with mostly identical rows are a repeat.
  const keyset = (g) => new Set(g.rows.map((r) => `${r.account_id}|${r.date}|${r.amount}|${r.description}`));
  for (const g of list) g.keys = keyset(g);
  for (const g of list) {
    g.repeat = list.some((o) => o !== g && o.dates[0] === g.dates[0] && o.dates.at(-1) === g.dates.at(-1)
      && [...g.keys].filter((k) => o.keys.has(k)).length >= 0.9 * Math.min(g.keys.size, o.keys.size));
  }
  return `<ul class="imports">${list.map((g) => `<li>
    <div><strong>${esc(g.accts)}</strong> <span class="muted">· ${g.rows.length} transactions · ${esc(fmtDate(g.dates[0]))} – ${esc(fmtDate(g.dates.at(-1), true))}</span>
      ${g.when ? `<br><span class="muted">Imported ${esc(new Date(g.when).toLocaleString())}</span>` : ''}
      ${g.doubled ? '<br><span class="badge st-over"><span aria-hidden="true">!</span> Every transaction appears twice</span>' : ''}
      ${g.repeat ? '<br><span class="badge st-over"><span aria-hidden="true">!</span> Repeats another import: undo one of them</span>' : ''}</div>
    <div class="imp-actions">${g.doubled ? `<button class="btn btn-small" data-dedupe="${esc(g.id)}">Remove extra copies</button>` : ''}<button class="btn btn-small btn-danger" data-undo="${esc(g.id)}">Undo import</button></div></li>`).join('')}</ul>`;
}

export function renderSettings(root, ctx) {
  const { store, user, issues, demo } = ctx.state;
  const invite = demo ? `${location.origin}${location.pathname}?demo=1` : ctx.inviteLink();
  const keys = googleKeys();
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Settings</h1></div>
    ${demo ? '<p class="notice">You’re in demo mode. Nothing is saved; reload to start over.</p>' : ''}
    <section class="card">
      <h2>Household</h2>
      <p>Signed in as <strong>${esc(user.name)}</strong> <span class="muted">${esc(user.email)}</span></p>
      ${demo ? '' : `<p><a href="${esc(store.url)}" target="_blank" rel="noopener">Open the database sheet ↗</a></p>`}
      <h3>Invite your partner</h3>
      <form id="share" class="form form-row">
        <label class="field"><span>Partner’s Google email</span><input name="email" type="email" required autocomplete="email"></label>
        <button class="btn btn-primary" ${demo ? 'disabled' : ''}>Share</button>
      </form>
      <p class="muted">This gives their Google account access to the sheet. Then send them this link. It connects CEDAR to your household and your Google Cloud project:</p>
      <div class="copy-row"><input id="invite" readonly value="${esc(invite)}" aria-label="Invite link"><button class="btn" id="copy">Copy</button></div>
      <p class="muted">Only share the sheet with people in your household. Anyone with access can see everything in it, including any AI key added later.</p>
      ${demo ? '' : '<p class="muted">Also add your partner as a test user in your Google Cloud project, or Google will block their sign-in.</p>'}
      <h3>People with access</h3>
      <ul id="people" class="simple"><li class="muted">${demo ? 'Demo user' : 'Loading…'}</li></ul>
    </section>
    <section class="card form">
      <h2>Budget</h2>
      <label class="field"><span>Biweekly periods start on (a payday)</span><input type="date" id="anchor" value="${esc(ctx.setting('biweekly_anchor', ''))}"></label>
      <p class="muted">Shared with everyone in the household.</p>
    </section>
    <section class="card form">
      <h2>AI receipt reading (optional)</h2>
      <p class="muted">Receipts are read on your device for free. An Anthropic API key reads faded or crumpled receipts much better; each receipt costs a fraction of a cent on your own account. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      <form id="ai" class="form-row">
        <label class="field"><span>API key</span><input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="${ctx.setting('ai_key', '') ? 'A key is saved' : 'sk-ant-…'}"></label>
        <button class="btn btn-primary" ${demo ? 'disabled' : ''}>Save key</button>
        ${ctx.setting('ai_key', '') ? '<button class="btn btn-danger" type="button" id="ai-remove">Remove</button>' : ''}
      </form>
      <p class="muted">The key is saved in your household sheet so everyone in the household can use it. Receipt photos go straight from this device to Anthropic and aren’t stored.</p>
    </section>
    <section class="card form">
      <h2>Appearance</h2>
      <div class="seg" role="radiogroup" aria-label="Theme">${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${ctx.pref('theme', 'system') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </section>
    <section class="card">
      <h2>Data</h2>
      <div class="form-actions" style="justify-content:flex-start"><button class="btn" id="export">Export transactions (CSV)</button><a class="btn" href="#/transfers">Re-check transfers</a></div>
      <h3>Imports</h3>
      ${importsHTML(ctx)}
      ${issues.length ? `<h3>Rows that need attention in the sheet</h3><ul class="issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">No problems found in the sheet.</p>'}
    </section>
    ${demo ? '' : `<section class="card">
      <h2>Google Cloud project</h2>
      <p>Project number <strong>${esc(keys.appId)}</strong></p>
      <p class="muted">Client ID ${esc(keys.clientId.slice(0, 12))}…</p>
    </section>`}
    ${lockSectionHTML()}
    <section class="card">
      <h2>This device</h2>
      <p class="muted">This device only remembers which sheet to open, your Google Cloud keys, your sign-in and its app lock settings. No financial data is stored here.</p>
      <div class="form-actions"><button class="btn" id="signout">Sign out</button><button class="btn btn-danger" id="disconnect">Disconnect household</button></div>
    </section>
  </div>`;

  if (!demo) {
    listPeople(store.id).then((ps) => {
      $('#people', root).innerHTML = ps.map((p) => `<li><span>${esc(p.displayName || p.emailAddress)}</span><span class="muted">${p.role === 'owner' ? 'Owner' : 'Can edit'}</span></li>`).join('');
    }).catch(() => { $('#people', root).innerHTML = '<li class="muted">Couldn’t load the list.</li>'; });
  }
  $('#share', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.target.elements.email.value.trim();
    busy(e.submitter, async () => {
      try { await shareFile(store.id, email); toast(`Shared with ${email}. Send them the invite link.`, 'ok'); e.target.reset(); ctx.render(); }
      catch (err) { ctx.handleError(err); }
    });
  });
  $('#copy', root).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invite); toast('Link copied', 'ok'); } catch { $('#invite', root).select(); }
  });
  $('#ai', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const key = e.target.elements.key.value.trim();
    if (!key) return;
    busy(e.submitter, async () => {
      try { await ctx.setSetting('ai_key', key); toast('AI key saved', 'ok'); } catch (err) { ctx.handleError(err); }
    });
  });
  $('#ai-remove', root)?.addEventListener('click', async () => {
    if (!confirm('Remove the AI key? Receipts will be read on this device instead.')) return;
    try { await ctx.setSetting('ai_key', ''); toast('AI key removed', 'ok'); } catch (err) { ctx.handleError(err); }
  });
  $('#anchor', root).addEventListener('change', async (e) => {
    try { await ctx.setSetting('biweekly_anchor', e.target.value); toast('Saved', 'ok'); } catch (err) { ctx.handleError(err); }
  });
  root.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => ctx.setTheme(r.value)));
  $('#export', root).addEventListener('click', () => {
    const rows = ctx.state.data.Transactions.filter((t) => !t.deleted).sort((a, b) => a.date.localeCompare(b.date));
    const acct = (id) => ctx.find('Accounts', id)?.name || '';
    downloadFile(`cedar-transactions-${todayISO()}.csv`, toCSV([
      ['Date', 'Description', 'Amount', 'Type', 'Category', 'Account', 'Note', 'Entered by'],
      ...rows.map((t) => [t.date, t.description, t.amount, t.type, t.type === 'transfer' ? '' : ctx.catName(t.category_id), acct(t.account_id), t.note, t.entered_by]),
    ]));
  });
  root.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
    const rows = ctx.state.data.Transactions.filter((t) => !t.deleted && t.import_id === b.dataset.undo);
    if (!confirm(`Remove all ${rows.length} transactions from this import? You can import the statement again afterwards.`)) return;
    busy(b, async () => {
      try { await ctx.removeMany('Transactions', rows); toast(`Removed ${rows.length} transactions`, 'ok'); } catch (err) { ctx.handleError(err); }
    });
  }));
  root.querySelectorAll('[data-dedupe]').forEach((b) => b.addEventListener('click', () => {
    const seen = new Set(); const extra = [];
    for (const t of ctx.state.data.Transactions) {
      if (t.deleted || t.import_id !== b.dataset.dedupe) continue;
      const k = `${t.account_id}|${t.date}|${t.amount}|${t.description}`;
      if (seen.has(k)) extra.push(t); else seen.add(k);
    }
    if (!confirm(`Remove ${extra.length} duplicate transactions and keep one of each?`)) return;
    busy(b, async () => {
      try { await ctx.removeMany('Transactions', extra); toast(`Removed ${extra.length} duplicates`, 'ok'); } catch (err) { ctx.handleError(err); }
    });
  }));
  bindLockSection(root, ctx);
  $('#signout', root).addEventListener('click', () => ctx.signOut());
  $('#disconnect', root).addEventListener('click', () => {
    if (confirm('Disconnect this device? It forgets the household and Google Cloud keys. The sheet and its data stay in Google Drive.')) ctx.disconnect();
  });
}
