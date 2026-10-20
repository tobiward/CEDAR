// Google sign-in (Identity Services token model), Drive and Sheets API helpers.
import { googleKeys } from './config.js';
import { prefs } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export class NeedsSignIn extends Error { constructor() { super('Sign-in needed'); this.name = 'NeedsSignIn'; } }

let tokenClient = null;
let token = prefs.get('token', null); // { access_token, expires_at }

export const isConfigured = () => !!googleKeys().clientId;
// Call after the keys change so the next sign-in uses the new client ID.
export const resetAuth = () => { tokenClient = null; };
export const hasValidToken = () => !!token && token.expires_at > Date.now() + 60_000;

const scripts = {};
function loadScript(src) {
  scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve;
    s.onerror = () => {
      delete scripts[src]; s.remove(); // let the next tap try again
      reject(new Error('Couldn’t reach Google sign-in. An ad or tracker blocker, strict tracking prevention, or a network filter is probably blocking accounts.google.com. Allow it for this site and try again.'));
    };
    document.head.appendChild(s);
  });
  return scripts[src];
}

async function initAuth() {
  if (tokenClient) return;
  await loadScript('https://accounts.google.com/gsi/client');
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: googleKeys().clientId, scope: SCOPE, callback: () => {} });
}

// Must be called from a user gesture (button tap); Google opens a popup.
export async function signIn() {
  await initAuth();
  await new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = { access_token: resp.access_token, expires_at: Date.now() + resp.expires_in * 1000 };
      prefs.set('token', token);
      resolve();
    };
    tokenClient.error_callback = (err) => reject(new Error(err?.message || 'Sign-in was cancelled'));
    tokenClient.requestAccessToken({ prompt: '', login_hint: prefs.get('email', '') || undefined });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  prefs.remove('token');
}

export async function api(url, opts = {}, attempt = 0) {
  if (!hasValidToken()) throw new NeedsSignIn();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { token = null; prefs.remove('token'); throw new NeedsSignIn(); }
  // 429 means Google didn't run the request, so it's always safe to retry. A 5xx on an append
  // may still have written rows, so only idempotent requests (reads, overwrites) retry on 5xx.
  const idempotent = opts.idempotent ?? (!opts.method || opts.method === 'GET' || opts.method === 'PUT');
  if ((res.status === 429 || (res.status >= 500 && idempotent)) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    return api(url, opts, attempt + 1);
  }
  if (!res.ok) {
    let msg = `Google request failed (${res.status})`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* not json */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}

const DRIVE = 'https://www.googleapis.com/drive/v3';

export async function getUser() {
  const r = await api(`${DRIVE}/about?fields=user(displayName,emailAddress)`);
  prefs.set('email', r.user.emailAddress);
  return { name: r.user.displayName || r.user.emailAddress, email: r.user.emailAddress };
}

export const fileVersion = (fileId) => api(`${DRIVE}/files/${fileId}?fields=version`).then((r) => r.version);

export const shareFile = (fileId, email) => api(`${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=true`, {
  method: 'POST', body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
});

export const listPeople = (fileId) => api(`${DRIVE}/files/${fileId}/permissions?fields=permissions(displayName,emailAddress,role)`)
  .then((r) => r.permissions || []);

// Google's file picker: grants CEDAR access to a sheet someone shared with this user.
export async function pickSheet(presetId) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((r) => gapi.load('picker', r));
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST);
    // Shows the household's sheet whether this person created it (a new device or web address)
    // or a partner shared it.
    if (presetId) view.setFileIds(presetId);
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token.access_token)
      .setDeveloperKey(googleKeys().apiKey)
      .setAppId(googleKeys().appId)
      .setTitle('Choose your CEDAR household sheet')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs[0].id);
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
