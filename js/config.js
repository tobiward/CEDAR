// CEDAR ships with no Google keys. Each household creates its own free Google Cloud
// project and enters its keys on the setup screen (see README.md). Keys are saved on
// the device only; they identify the household's own project, not any financial data.
import { prefs } from './util.js';

export const CONFIG = {
  // How often open devices check the sheet for a partner's changes
  SYNC_INTERVAL_MS: 12000,
  // Where the setup guide lives (README section)
  GUIDE_URL: 'https://github.com/tobiward/CEDAR#set-up-your-google-cloud-project',
};

const EMPTY = { clientId: '', apiKey: '', appId: '' };
export const googleKeys = () => ({ ...EMPTY, ...prefs.get('google', {}) });
export const saveGoogleKeys = (k) => prefs.set('google', { clientId: k.clientId.trim(), apiKey: k.apiKey.trim(), appId: String(k.appId).trim() });
export const clearGoogleKeys = () => prefs.remove('google');

export function validateKeys(k) {
  const errors = [];
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(k.clientId.trim())) errors.push('The client ID should end in .apps.googleusercontent.com');
  if (!/^AIza[\w-]{30,}$/.test(k.apiKey.trim())) errors.push('The API key should start with AIza');
  if (!/^\d{6,}$/.test(String(k.appId).trim())) errors.push('The project number should be all digits');
  return errors;
}
