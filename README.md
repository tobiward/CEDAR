# CEDAR

**Capital, Expenses, Debt, Assets & Returns** — a free, open-source household finance app by Tobi Ward.

Import a monthly bank statement and CEDAR sorts it into spending categories, rolls each month into the year, and compares both against your budget. Each household connects its own free Google Cloud project, and partners sign in on their own devices to share one database: a Google Sheet that you own.

- Installable on iPhone, Android and desktop (it's a PWA; no app store)
- No financial data is stored on the device or on any CEDAR server
- Changes from a partner appear within about 15 seconds

**Try it without signing in:** open the app with `?demo=1` at the end of the address.

## Features

- Google sign-in and a household Google Sheet, shared with your partner from inside the app
- Monthly budgets per category, tracked daily through yearly; Home shows spending vs. budget for any month or year
- Statement import from PDF statements (including statements covering several accounts) or CSV, OFX and QFX downloads, with automatic categorization, duplicate detection and a review screen
- Receipt scanning: read on the device for free, or by AI with your own Anthropic key
- Banking app screenshots update an account's balance and add activity CEDAR doesn't have yet
- Savings goals inside your savings accounts, planned by a monthly amount or a percent of income
- Statements confirm what you already logged: receipts and hand-entered income or purchases are matched, not duplicated
- Account balances update from each statement's closing balance, plus anything logged since
- Subscriptions with upcoming charges on Home
- Categorization that learns: fix a merchant once and its other transactions and future imports follow
- Only transfers between your own accounts count as transfers; cash, payments to people, and outside loan or card payments count as spending
- Month report, year heat map, CSV export, light and dark themes
- App lock with a PIN or Face ID / fingerprint
- No code from CDNs: third-party libraries ship in the repo

## Bring your own Google Cloud

CEDAR ships with no keys and no shared accounts. Every household connects its own free Google Cloud project, so your sign-ins, your API usage and your data all belong to you. Nobody else's project, including the developer's, ever touches your finances.

It takes about 15 minutes, once per household. Your partner doesn't repeat it: your invite link carries your keys.

## Set up your Google Cloud project

Keep your CEDAR project selected in the project picker at the top left of the console for every step. The links below go straight to each page.

1. **Create a project.** At [console.cloud.google.com](https://console.cloud.google.com), open the project picker, choose **New project**, and name it `CEDAR`. No billing account is needed; don't add one.
2. **Turn on three APIs.** Open each page and tap **Enable**:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
3. **Set up sign-in** in Google Auth Platform:
   - Open [Branding](https://console.cloud.google.com/auth/branding). If it says Google Auth Platform isn't configured, tap **Get started**: app name `CEDAR`, your email as support email, Audience **External**, your email as contact, then agree and **Create**.
   - Open [Audience](https://console.cloud.google.com/auth/audience). Leave the app in **Testing**. Under **Test users**, tap **Add users** and add your Google account and your partner's.
   - Open [Data Access](https://console.cloud.google.com/auth/scopes), tap **Add or Remove Scopes**, add `https://www.googleapis.com/auth/drive.file` (paste it into the manual entry box), and **Save**. CEDAR can then see only files it created or that you pick, nothing else in your Drive.

   Choose **External** even for a private household app. **Internal** only works inside a Google Workspace organization. External plus Testing means only your test users can sign in; everyone else sees "Access blocked." Don't tap **Publish app**.
4. **Create the sign-in client.** Open [Clients](https://console.cloud.google.com/auth/clients), tap **Create client**, choose **Web application**, and name it `CEDAR web`. Under **Authorized JavaScript origins**, tap **Add URI** for each address you'll use CEDAR from, exactly as CEDAR's setup screen shows it: just the scheme, domain and port, with no path and no trailing slash.
   - Published site: `https://tobiward.github.io`
   - Testing on your computer: `http://localhost:8000` (`http`, not `https`; `localhost` and `127.0.0.1` count as different addresses)

   Leave redirect URIs empty, tap **Create**, and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). CEDAR doesn't use the client secret. You can find the ID again anytime by opening the client. Origin changes can take a few minutes to apply.
5. **Create an API key** for the file picker. Open [Credentials](https://console.cloud.google.com/apis/credentials), tap **Create credentials → API key**, then edit the key:
   - Application restrictions: **Websites**, adding each address followed by `/*` (for example `https://tobiward.github.io/*` and `http://localhost:8000/*`)
   - API restrictions: **Restrict key** to **Google Picker API**

   Copy the key (it starts with `AIza`).
6. **Find the project number** (all digits, not the text project ID) on [IAM & Admin → Settings](https://console.cloud.google.com/iam-admin/settings).
7. **Open CEDAR** and paste the client ID, API key and project number into the setup screen. Then sign in and choose **Start a new household**.

While the project stays in Testing, Google may ask you to re-approve CEDAR about once a week. It's one tap.

If you see **Error 400: origin_mismatch**, the address in your browser isn't in step 4's list exactly as typed. Add it and wait a few minutes.

The client ID, API key and project number identify your project; they're designed to be used in browser apps and are restricted to your addresses. They're stored on your device, never in the sheet or on any server.

## Publishing on GitHub Pages

1. **Get the libraries** (once, and again when CEDAR updates them). From the CEDAR folder run `python tools/fetch_libs.py`. It downloads the PDF reader, receipt reader and fonts into `lib/` from the npm registry, checking each against the registry's published checksum, so CEDAR never loads code from a CDN.
2. **Create the repository** on GitHub, for example `tobiward/CEDAR`, and upload everything in the CEDAR folder, including `lib/`.
3. **Turn on Pages.** In the repo, open **Settings → Pages**, set the source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and save. After a minute the site is at `https://tobiward.github.io/CEDAR/`.
4. **Allow the address** in Google Cloud: add `https://tobiward.github.io` to the client's JavaScript origins (step 4) and `https://tobiward.github.io/*` to the API key's websites (step 5).
5. **Open the published site.** It's a new address, so the browser starts fresh: paste your three keys again, sign in, and choose **Open an existing household** to pick the CEDAR sheet you already have. Your data is all still there.
6. **Install it.** On iPhone, open the site in Safari and tap **Share → Add to Home Screen**. On Android or desktop Chrome, use **Install app** from the menu.

## Using CEDAR with a partner

1. In Google Cloud, add your partner's Google account as a test user ([Audience](https://console.cloud.google.com/auth/audience)).
2. In CEDAR's **Settings**, enter their Google email and tap **Share**, then send them the invite link. The link carries your Google Cloud keys, so they don't type anything.
3. They open the link on their phone, sign in, tap **Join your partner's household**, and confirm the sheet.

Only share the sheet with people in your household: anyone with access can see everything in it, including an AI key if you add one.

## App lock

Under **Settings → App lock**, each device can require a PIN, and optionally Face ID or a fingerprint, before CEDAR opens. Choose whether it locks every time you leave the app or after a few minutes away. The PIN is stored only on that device as a one-way hash. Five wrong PINs sign the device out of Google, so the lock can't be guessed through.

## Hosting your own copy of the code (optional)

Anyone can use a published CEDAR site with their own Google Cloud project. If you'd rather host the code yourself, fork the repo, run `tools/fetch_libs.py` if `lib/` is missing, publish with GitHub Pages, and use your own site's address in steps 4 and 5.

## Running locally

```sh
python tools/fetch_libs.py     # first time only
python -m http.server 8000
```

Then open <http://localhost:8000> (or <http://localhost:8000/?demo=1>). Keep using the same port: the browser remembers your keys and sign-in per address. Any static server works; there is no build step.

## How the data is stored

The household sheet has one tab per table (Transactions, Categories, Accounts, Rules, Settings, Subscriptions, Goals, GoalEntries) with a header row. Every row has an `id`, `updated_at` and a `deleted` flag; deletes are soft so row positions never shift under a partner's edit. You can read the sheet, but edit it through CEDAR: hand-edited rows that don't make sense are listed under *Settings → Data*.

Amounts are negative for money out and positive for money in. Transfers (moving money between your own accounts, credit card payments) never count as spending.

## Project layout

```
index.html, manifest.webmanifest, sw.js   app shell, install info, offline cache (code only)
css/styles.css                            red cedar forest theme, light and dark
js/app.js                                 state, saving, sync, routing, setup flows
js/config.js                              your Google Cloud keys (saved on the device) and app settings
js/google.js                              Google sign-in, Drive and Picker helpers
js/store.js                               the Google Sheet database (plus an in-memory store for demo)
js/importer.js                            CSV and OFX parsing, column mapping, duplicates
js/pdfparse.js                            PDF statement reading
js/receipt.js, js/screenshot.js           receipt and banking app screenshot reading
js/lock.js                                app lock (PIN and Face ID / fingerprint)
lib/                                      pdf.js, Tesseract and fonts, filled by tools/fetch_libs.py
tools/fetch_libs.py                       downloads and checksum-checks the libraries
js/categorize.js                          default categories and categorization rules
js/periods.js, js/reports.js              budget periods and spending math
js/views/                                 one file per screen
```

## AI reading costs (optional)

Receipts and screenshots are read on the device for free. If you add an Anthropic API key under **Settings**, CEDAR uses Claude Haiku 5.5 instead, which is more accurate. You pay Anthropic directly from prepaid credits; at current prices that's roughly:

| What | About |
|---|---|
| One receipt | $0.0003 (about 3,000 receipts per dollar) |
| One banking app screenshot | $0.001 or less |

Statement imports, categorization and everything else never use AI. Set a monthly spend limit in the [Anthropic Console](https://console.anthropic.com) so a lost or shared key can't run up a bill.

## Security and privacy

- **Your data stays in your Google Drive.** CEDAR has no server, no analytics and no tracking. The app talks only to Google and, if you add a key, Anthropic.
- **Limited Drive access.** CEDAR asks only for `drive.file`, so it can open the files it created or that you picked, and nothing else in your Drive.
- **Sign-in on the device.** Google's sign-in token lasts about an hour and is kept on the device so CEDAR opens without asking again. Signing out revokes it.
- **The app lock is a privacy screen, not encryption.** It keeps someone who picks up your unlocked phone out of CEDAR. It doesn't stop a technical person who has your unlocked computer. Use your device's own passcode as well.
- **The AI key lives in the household sheet.** Anyone the sheet is shared with can see it. Share only with your household, and set a spend limit.
- **CSV exports** put an apostrophe in front of text that a spreadsheet app would otherwise run as a formula.

Found a security problem? Please open a private security advisory on GitHub rather than a public issue.

## Disclaimer

CEDAR is a personal budgeting tool, not financial, tax or legal advice. Imported and AI-read numbers can be wrong, so check anything important against your bank. CEDAR isn't affiliated with Google, Anthropic or any bank. You're responsible for your own Google Cloud project, API keys and any charges on them. The software is provided as is, without warranty; see the license.

## License

MIT — see [LICENSE](LICENSE).
