// Receipt reading. Free by default: text recognition runs on the device (Tesseract.js, loaded only when
// a receipt is scanned). With the household's own AI key in Settings, the photo is read by Claude instead,
// which handles faded or crumpled receipts much better.
import { isoDate, round2 } from './util.js';
import { parseDateAny } from './importer.js';

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})*|\d+)[.,](\d{2})\b/g;
const amountsIn = (line) => [...line.matchAll(MONEY)].map((m) => Number(`${m[1].replace(/,/g, '')}.${m[2]}`));

// Pulls merchant, date and total out of recognized receipt text.
export function parseReceiptText(text, today = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const skip = /receipt|welcome|thank|store\s*#|tel|phone|www\.|http|\.com|customer|cashier|^\W*$|^\d/i;
  const merchantLine = lines.slice(0, 8).find((l) => !skip.test(l) && (l.match(/[A-Za-z]/g) || []).length >= 3);
  const merchant = merchantLine ? merchantLine.replace(/[^A-Za-z0-9&'.\- ]+/g, ' ').replace(/\s+/g, ' ').trim() : '';

  let date = null;
  const lo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const hi = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  for (const l of lines) {
    for (const m of l.matchAll(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi)) {
      const d = parseDateAny(m[1]);
      if (d && new Date(d) >= lo && new Date(d) <= hi) { date = d; break; }
    }
    if (date) break;
  }

  // The total is on a line that says total (not subtotal, tax or savings); take the largest such amount,
  // since a tip line raises the final total.
  const notTotal = /sub\s*-?\s*total|\btax\b|saving|you saved|discount|change\b|cash back|items?\b|tip suggest|points/i;
  const totals = [];
  for (const l of lines) {
    if (/\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\b/i.test(l) && !notTotal.test(l)) totals.push(...amountsIn(l));
  }
  let total = totals.length ? Math.max(...totals) : null;
  if (total === null) {
    const all = lines.filter((l) => !notTotal.test(l)).flatMap(amountsIn);
    total = all.length ? Math.max(...all) : null;
  }
  return { merchant, date: date || isoDate(today), total: total === null ? null : round2(total) };
}

// Shrinks a photo so it reads quickly (and costs less with an AI key).
async function toJpeg(file, max = 1600) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// Tesseract and its language data load from CEDAR's own lib folder, never from a CDN.
const TESS_BASE = new URL('../lib/tesseract/', import.meta.url).href;
let tesseract = null;
function loadTesseract() {
  tesseract ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESS_BASE + 'tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseract = null; reject(new Error('This copy of CEDAR is missing its text reader. Run tools/fetch_libs.py (see the README), or add an AI key in Settings.')); };
    document.head.appendChild(s);
  });
  return tesseract;
}

// Text recognized on this device.
export async function ocrText(file, onProgress, maxSide = 1600) {
  const T = await loadTesseract();
  const blob = await toJpeg(file, maxSide);
  const worker = await T.createWorker('eng', 1, {
    workerPath: TESS_BASE + 'worker.min.js', corePath: TESS_BASE + 'core', langPath: TESS_BASE + 'lang',
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  try { return (await worker.recognize(blob)).data.text; } finally { await worker.terminate(); }
}

// Asks Claude to read an image and reply with JSON, using the household's own key.
export async function askClaudeJSON(file, key, prompt, { maxSide = 1600, maxTokens = 300 } = {}) {
  const blob = await toJpeg(file, maxSide);
  const b64 = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: prompt },
      ] }],
    }),
  });
  if (!res.ok) {
    let msg = `The AI service returned an error (${res.status})`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const out = (await res.json()).content?.find((c) => c.type === 'text')?.text || '';
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

const RECEIPT_PROMPT = 'This is a purchase receipt. Reply with only JSON: {"merchant": store name, "date": "YYYY-MM-DD" or null, "total": final amount paid including tax and tip as a number}.';

// Reads a receipt photo. Falls back to on-device reading if the AI request fails.
export async function readReceipt(file, { aiKey, onProgress } = {}) {
  if (aiKey) {
    try {
      const j = await askClaudeJSON(file, aiKey, RECEIPT_PROMPT, { maxTokens: 200 });
      return { merchant: String(j.merchant || ''), date: parseDateAny(j.date) || isoDate(new Date()), total: j.total == null ? null : round2(Number(j.total)), via: 'ai' };
    } catch (e) { console.warn('AI receipt reading failed, using on-device reading', e); }
  }
  return { ...parseReceiptText(await ocrText(file, onProgress)), via: 'device' };
}
