// The lock screen, and the App lock section of Settings.
import { esc, toast, $ } from '../util.js';
import { openModal, options, busy } from '../ui.js';
import { checkPin, triesLeft, hasBiometrics, unlockWithBiometrics, isLockOn, setPin, turnOff, lockSettings, setAway, AWAY_OPTIONS, biometricsAvailable, enableBiometrics, disableBiometrics } from '../lock.js';

export function renderLock(root, ctx, onUnlock) {
  const bio = hasBiometrics();
  root.innerHTML = `<div class="setup"><div class="setup-card lock-card">
    <img src="icons/icon-192.png" alt="" width="80" height="80" class="setup-logo">
    <h1 class="wordmark">CEDAR</h1>
    <p>CEDAR is locked.</p>
    <form id="unlock" class="form" autocomplete="off">
      <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" required minlength="4" maxlength="8" class="pin-input"></label>
      <p class="form-errors" role="alert"></p>
      <button class="btn btn-primary btn-wide">Unlock</button>
    </form>
    ${bio ? '<button class="btn btn-wide" id="bio">Unlock with Face ID or fingerprint</button>' : ''}
  </div></div>`;
  const f = $('#unlock', root);
  setTimeout(() => f.elements.pin.focus(), 50);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await checkPin(f.elements.pin.value);
    if (r === 'ok') return onUnlock();
    f.elements.pin.value = '';
    if (r === 'wiped') {
      turnOff();
      toast('Too many wrong PINs. This device was signed out.', 'error');
      return ctx.signOut();
    }
    $('.form-errors', root).textContent = `That PIN isn’t right. ${triesLeft()} ${triesLeft() === 1 ? 'try' : 'tries'} left before this device signs out.`;
  });
  $('#bio', root)?.addEventListener('click', async () => {
    try { await unlockWithBiometrics(); onUnlock(); } catch { $('.form-errors', root).textContent = 'Face ID or fingerprint didn’t work. Enter your PIN instead.'; }
  });
}

function pinForm(title, needCurrent, onDone) {
  const { el, close } = openModal(title, `<form class="form" id="pin-form" autocomplete="off">
    ${needCurrent ? '<label class="field"><span>Current PIN</span><input name="cur" type="password" inputmode="numeric" pattern="[0-9]*" required minlength="4" maxlength="8" class="pin-input"></label>' : ''}
    <label class="field"><span>New PIN (4–8 digits)</span><input name="a" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required minlength="4" maxlength="8" class="pin-input"></label>
    <label class="field"><span>Enter it again</span><input name="b" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required minlength="4" maxlength="8" class="pin-input"></label>
    <p class="form-errors" role="alert"></p>
    <p class="muted">The PIN is stored only on this device, as a one-way hash. Each device has its own lock.</p>
    <div class="form-actions"><button class="btn btn-primary">Save PIN</button></div>
  </form>`);
  const f = $('#pin-form', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const E = f.elements;
    const err = (m) => { $('.form-errors', f).textContent = m; };
    if (!/^\d{4,8}$/.test(E.a.value)) return err('Use 4 to 8 digits.');
    if (E.a.value !== E.b.value) return err('The two PINs don’t match.');
    busy(e.submitter, async () => {
      if (needCurrent && (await checkPin(E.cur.value)) !== 'ok') return err('Your current PIN isn’t right.');
      await setPin(E.a.value, lockSettings()?.away ?? 1);
      close(); onDone();
    });
  });
}

export function lockSectionHTML() {
  const on = isLockOn();
  const s = lockSettings() || {};
  return `<section class="card form" id="lock-section">
    <h2>App lock</h2>
    <p class="muted">Ask for a PIN${on && s.cred ? ', Face ID or fingerprint' : ''} before CEDAR opens on this device. Five wrong PINs sign the device out.</p>
    ${on ? `
      <label class="field"><span>Lock</span><select id="lock-away">${options(AWAY_OPTIONS, s.away ?? 1)}</select></label>
      <div id="bio-row"></div>
      <div class="form-actions" style="justify-content:flex-start"><button class="btn" id="lock-now" type="button">Lock now</button><button class="btn" id="lock-change" type="button">Change PIN</button><button class="btn btn-danger" id="lock-off" type="button">Turn off</button></div>`
    : '<button class="btn btn-primary" id="lock-on" type="button">Set a PIN</button>'}
  </section>`;
}

export async function bindLockSection(root, ctx) {
  const rerender = () => ctx.render();
  $('#lock-on', root)?.addEventListener('click', () => pinForm('Set a PIN', false, () => { toast('App lock is on', 'ok'); rerender(); }));
  $('#lock-change', root)?.addEventListener('click', () => pinForm('Change PIN', true, () => { toast('PIN changed', 'ok'); rerender(); }));
  $('#lock-away', root)?.addEventListener('change', (e) => { setAway(Number(e.target.value)); toast('Saved', 'ok'); });
  $('#lock-now', root)?.addEventListener('click', () => ctx.lockNow());
  $('#lock-off', root)?.addEventListener('click', () => {
    const { el, close } = openModal('Turn off app lock', `<form class="form" id="off-form"><label class="field"><span>Current PIN</span><input name="cur" type="password" inputmode="numeric" required class="pin-input"></label><p class="form-errors" role="alert"></p><div class="form-actions"><button class="btn btn-danger">Turn off</button></div></form>`);
    $('#off-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      if ((await checkPin(e.target.elements.cur.value)) !== 'ok') { $('.form-errors', el).textContent = 'That PIN isn’t right.'; return; }
      turnOff(); close(); toast('App lock is off', 'ok'); rerender();
    });
  });
  const row = $('#bio-row', root);
  if (row && await biometricsAvailable()) {
    const on = hasBiometrics();
    row.innerHTML = `<label class="check"><input type="checkbox" id="bio-toggle" ${on ? 'checked' : ''}> Also unlock with Face ID or fingerprint</label>`;
    $('#bio-toggle', row).addEventListener('change', async (e) => {
      try {
        if (e.target.checked) { await enableBiometrics(ctx.state.user?.email || 'CEDAR'); toast('Face ID or fingerprint is on', 'ok'); }
        else { disableBiometrics(); toast('Face ID or fingerprint is off', 'ok'); }
      } catch { e.target.checked = !e.target.checked; toast('This device didn’t allow it. You can keep using your PIN.', 'error'); }
    });
  }
}

export { esc };
