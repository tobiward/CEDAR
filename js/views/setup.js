// First run: sign in, then start a household or join one.
import { esc, toast, $ } from '../util.js';
import { CONFIG, googleKeys, validateKeys } from '../config.js';

const shell = (inner) => `<div class="setup"><div class="setup-card">
  <img src="icons/icon-192.png" alt="" width="96" height="96" class="setup-logo">
  <h1 class="wordmark">CEDAR</h1>
  <p class="tagline">Capital, Expenses, Debt, Assets &amp; Returns</p>
  ${inner}</div></div>`;

export function renderSetup(root, ctx, mode) {
  if (mode === 'unconfigured') {
    const k = googleKeys();
    root.innerHTML = shell(`<p>CEDAR keeps your finances in your own Google account. First, connect your household’s own free Google Cloud project.</p>
      <p class="muted">Follow the <a href="${CONFIG.GUIDE_URL}" target="_blank" rel="noopener">setup guide</a> (about 15 minutes, once per household). When it asks for an authorized JavaScript origin, use:</p>
      <div class="copy-row"><input id="origin" readonly value="${esc(location.origin)}" aria-label="Your authorized JavaScript origin"><button class="btn" id="copy-origin" type="button">Copy</button></div>
      <form id="keys" class="form keys-form">
        <label class="field"><span>OAuth client ID</span><input name="clientId" required autocomplete="off" spellcheck="false" value="${esc(k.clientId)}" placeholder="1234-abc.apps.googleusercontent.com"></label>
        <label class="field"><span>API key</span><input name="apiKey" required autocomplete="off" spellcheck="false" value="${esc(k.apiKey)}" placeholder="AIza…"></label>
        <label class="field"><span>Project number</span><input name="appId" required inputmode="numeric" autocomplete="off" value="${esc(k.appId)}" placeholder="123456789012"></label>
        <p class="form-errors" role="alert"></p>
        <button class="btn btn-primary btn-wide">Save and continue</button>
      </form>
      <p class="muted">Your partner won’t need to do this. Your invite link carries these keys.</p>
      <a class="link" href="?demo=1">Try the demo first</a>`);
    $('#copy-origin', root).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.origin); toast('Copied', 'ok'); } catch { $('#origin', root).select(); }
    });
    $('#keys', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const E = e.target.elements;
      const keys = { clientId: E.clientId.value, apiKey: E.apiKey.value, appId: E.appId.value };
      const errors = validateKeys(keys);
      $('.form-errors', root).textContent = errors.join('. ');
      if (!errors.length) ctx.saveKeys(keys);
    });
    return;
  }
  if (mode === 'signin') {
    root.innerHTML = shell(`<p>Track spending, budgets and more with your household. Your data lives in a Google Sheet you own.</p>
      <button class="btn btn-primary btn-wide" id="signin">Sign in with Google</button>
      <button class="link" id="keys-change">Change Google Cloud keys</button>
      <a class="link" href="?demo=1">Try the demo first</a>`);
    $('#signin', root).addEventListener('click', () => ctx.doSignIn());
    $('#keys-change', root).addEventListener('click', () => ctx.changeKeys());
    return;
  }
  // mode === 'choose'
  const joinId = ctx.state.joinId;
  root.innerHTML = shell(`<p>Hi ${esc(ctx.state.user?.name || '')}. Let’s connect your household.</p>
    ${joinId ? `<button class="btn btn-primary btn-wide" id="join">Join your partner’s household</button>
      <p class="muted">Google will ask you to confirm the CEDAR sheet they shared with you.</p>` : `
    <div class="choices">
      <button class="choice" id="create"><span class="choice-icon" aria-hidden="true">✦</span><span><strong>Start a new household</strong><span class="muted">Creates a CEDAR sheet in your Google Drive.</span></span></button>
      <button class="choice" id="join"><span class="choice-icon" aria-hidden="true">⇄</span><span><strong>Open an existing household</strong><span class="muted">Your own CEDAR sheet on a new device or web address, or one your partner shared with you.</span></span></button>
    </div>`}
    <button class="link" id="switch">Use a different Google account</button>
    <button class="link" id="keys-change">Change Google Cloud keys</button>`);
  $('#create', root)?.addEventListener('click', (e) => { e.currentTarget.disabled = true; ctx.createHousehold(); });
  $('#join', root).addEventListener('click', () => ctx.joinHousehold(joinId));
  $('#switch', root).addEventListener('click', () => ctx.signOut());
  $('#keys-change', root).addEventListener('click', () => ctx.changeKeys());
}
