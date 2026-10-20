// Add / edit a single transaction.
import { esc, todayISO, uid, round2, toast, $ } from '../util.js';
import { openModal, catOptions, options, busy } from '../ui.js';
import { merchantKey, movementKind, matchesPattern } from '../categorize.js';

export function openTxnForm(ctx, existing = null, preset = {}) {
  const t = existing || { date: todayISO(), description: '', amount: 0, type: 'expense', category_id: '', account_id: ctx.accounts()[0]?.id || '', note: '', ...preset };
  const out = existing ? t.amount < 0 : true;
  const accounts = ctx.accounts();
  const body = `<form id="txn-form" class="form">
    <div class="seg" role="radiogroup" aria-label="Type">
      ${['expense', 'income', 'transfer'].map((k) => `<label><input type="radio" name="type" value="${k}" ${t.type === k ? 'checked' : ''}><span>${{ expense: 'Expense', income: 'Income', transfer: 'Transfer' }[k]}</span></label>`).join('')}
    </div>
    <label class="field"><span>Amount</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${t.amount ? Math.abs(t.amount) : ''}" placeholder="0.00"></label>
    <fieldset class="field dir" ${t.type === 'transfer' ? '' : 'hidden'}><legend>Direction</legend>
      <label><input type="radio" name="dir" value="out" ${out ? 'checked' : ''}> Money out</label>
      <label><input type="radio" name="dir" value="in" ${out ? '' : 'checked'}> Money in</label>
    </fieldset>
    <label class="field"><span>Description</span><input name="description" required value="${esc(t.description)}" placeholder="e.g. Safeway"></label>
    <label class="field cat-field" ${t.type === 'transfer' ? 'hidden' : ''}><span>Category</span><select name="category_id">${catOptions(ctx, t.type === 'income' ? 'income' : 'expense', t.category_id)}</select></label>
    <div class="rule-box" hidden>
      <label class="check"><input type="checkbox" name="rule" checked> <span>Use this category for every charge that matches</span></label>
      <input name="pattern" aria-label="Merchant words to match" autocomplete="off" spellcheck="false">
      <p class="muted rule-count"></p>
    </div>
    <label class="field"><span>Date</span><input name="date" type="date" required value="${esc(t.date)}"></label>
    <label class="field"><span>Account</span><select name="account_id"><option value="">No account</option>${options(accounts.map((a) => [a.id, a.name]), t.account_id)}</select></label>
    <label class="field"><span>Note (optional)</span><input name="note" value="${esc(t.note)}"></label>
    <div class="form-actions">
      ${existing ? '<button type="button" class="btn btn-danger" id="txn-del">Delete</button>' : ''}
      <button class="btn btn-primary" type="submit">${existing ? 'Save changes' : 'Add transaction'}</button>
    </div>
  </form>`;
  const { el, close } = openModal(existing ? 'Edit transaction' : preset.source === 'receipt' ? 'Check your receipt' : preset.type === 'income' ? 'Add income' : 'Add a transaction', body);
  const f = $('#txn-form', el);
  const origCat = t.category_id;
  let patternEdited = false;

  // Other transactions the rule would recategorize now, not just future imports.
  const others = () => {
    const pat = f.elements.pattern.value.trim();
    const cat = f.elements.category_id.value;
    if (!pat) return [];
    return ctx.state.data.Transactions.filter((o) => !o.deleted && o.id !== t.id && o.type !== 'transfer'
      && matchesPattern(o.description, pat) && (o.category_id !== cat || o.type !== f.elements.type.value));
  };
  const sync = () => {
    const type = f.elements.type.value;
    const desc = f.elements.description.value;
    $('.dir', f).hidden = type !== 'transfer';
    $('.cat-field', f).hidden = type === 'transfer';
    if (!patternEdited) f.elements.pattern.value = merchantKey(desc);
    const show = type !== 'transfer' && !['xfer', 'atm'].includes(movementKind(desc)) && !!f.elements.pattern.value && !!f.elements.category_id.value && f.elements.category_id.value !== origCat;
    $('.rule-box', f).hidden = !show;
    if (show) {
      const n = others().length;
      $('.rule-count', f).textContent = n ? `Also updates ${n} other transaction${n === 1 ? '' : 's'} already in CEDAR, and future imports.` : 'Applies to future imports.';
    }
  };
  f.elements.pattern.addEventListener('input', () => { patternEdited = true; sync(); });
  f.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => {
    f.elements.category_id.innerHTML = catOptions(ctx, f.elements.type.value === 'income' ? 'income' : 'expense', '');
    sync();
  }));
  f.elements.description.addEventListener('input', sync);
  f.elements.category_id.addEventListener('change', sync);
  sync();

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = f.elements.type.value;
    const amt = Math.abs(Number(f.elements.amount.value));
    const isOut = type === 'expense' || (type === 'transfer' && f.elements.dir.value === 'out');
    const rec = {
      ...t,
      id: t.id || uid(),
      date: f.elements.date.value,
      description: f.elements.description.value.trim(),
      amount: round2(isOut ? -amt : amt),
      type,
      category_id: type === 'transfer' ? '' : f.elements.category_id.value,
      account_id: f.elements.account_id.value,
      note: f.elements.note.value.trim(),
      entered_by: t.entered_by || ctx.state.user.email,
      source: t.source || 'manual',
    };
    busy(e.submitter || $('.btn-primary', f), async () => {
      try {
        const ruleOn = !$('.rule-box', f).hidden && f.elements.rule.checked;
        const also = ruleOn ? others() : [];
        await ctx.save('Transactions', rec);
        if (ruleOn) {
          await ctx.learnRule(f.elements.pattern.value.trim().toUpperCase(), rec.category_id, type);
          await ctx.updateMany('Transactions', also.map((o) => ({ ...o, type, category_id: rec.category_id })));
        }
        toast(also.length ? `Saved, and updated ${also.length} matching transactions` : existing ? 'Saved' : 'Transaction added', 'ok');
        close();
      } catch (err) { ctx.handleError(err); }
    });
  });
  $('#txn-del', f)?.addEventListener('click', async (e) => {
    if (!confirm('Delete this transaction?')) return;
    busy(e.target, async () => {
      try { await ctx.remove('Transactions', t); toast('Deleted', 'ok'); close(); } catch (err) { ctx.handleError(err); }
    });
  });
}
