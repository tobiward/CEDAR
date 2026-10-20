// Per-device app lock: a PIN (stored only as a salted hash) and, where the device supports it,
// Face ID / Touch ID / fingerprint through the browser's built-in passkey support (WebAuthn).
// Five wrong PINs sign this device out of Google, so the lock can't be guessed through.
import { prefs } from './util.js';

const KEY = 'lock';
const ITER = 210000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const lockSettings = () => prefs.get(KEY, null);
export const isLockOn = () => !!lockSettings()?.hash;
export const AWAY_OPTIONS = [[0, 'Every time I leave the app'], [1, 'After 1 minute away'], [5, 'After 5 minutes away'], [15, 'After 15 minutes away'], [60, 'After 1 hour away']];

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256));
}

export async function setPin(pin, awayMinutes = 1) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const old = lockSettings() || {};
  prefs.set(KEY, { ...old, salt: b64(salt), hash: await hashPin(pin, salt), away: awayMinutes, fails: 0 });
}

export function setAway(minutes) { prefs.set(KEY, { ...lockSettings(), away: minutes }); }
export function turnOff() { prefs.remove(KEY); prefs.remove('lockedAt'); }

// Returns 'ok', 'wrong' or 'wiped' (too many wrong tries).
export async function checkPin(pin) {
  const s = lockSettings();
  if (!s) return 'ok';
  const ok = (await hashPin(pin, unb64(s.salt))) === s.hash;
  if (ok) { prefs.set(KEY, { ...s, fails: 0 }); return 'ok'; }
  const fails = (s.fails || 0) + 1;
  prefs.set(KEY, { ...s, fails });
  return fails >= 5 ? 'wiped' : 'wrong';
}
export const triesLeft = () => 5 - (lockSettings()?.fails || 0);

export async function biometricsAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

// Registers this device's Face ID / fingerprint for unlocking CEDAR. Nothing leaves the device.
export async function enableBiometrics(label = 'CEDAR') {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'CEDAR', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000,
  } });
  prefs.set(KEY, { ...lockSettings(), cred: b64(cred.rawId) });
}
export function disableBiometrics() { const s = lockSettings(); delete s.cred; prefs.set(KEY, s); }
export const hasBiometrics = () => !!lockSettings()?.cred;

export async function unlockWithBiometrics() {
  const s = lockSettings();
  await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: unb64(s.cred), transports: ['internal'] }], userVerification: 'required',
  } });
  prefs.set(KEY, { ...s, fails: 0 });
}

// Remembers when the app was last left, so it can lock after the chosen time away.
export const markAway = () => prefs.set('lockedAt', Date.now());
export function shouldLockOnReturn() {
  const s = lockSettings();
  if (!s?.hash) return false;
  const at = prefs.get('lockedAt', 0);
  return !at || Date.now() - at >= (s.away ?? 1) * 60000;
}
