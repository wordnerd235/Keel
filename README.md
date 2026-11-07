# Keel

Household life tools in one app: chores, house upkeep, garden, pantry and recipes, cars, fitness and contacts.
Keel wraps seven single-page tools in one shell with a **Today** screen, one place for the data, sync across
devices and one-file backup. Each tool works exactly as it did on its own.

| Tool | What it does |
|---|---|
| Cleaning Rounds | Chores by room with repeat intervals, "Up next" ranked by how overdue they are |
| House Upkeep Ledger | Home maintenance tasks, installed systems, spending history |
| Garden Planner | Sowing windows from frost dates, bed grids, crop calendar, fruit tree care |
| Pantry & Recipe Book | Pantry stock, recipe matching, allergen flags, shopping list, photo scan |
| Garage Logbook | Odometer, maintenance due board, service history |
| Cut to 150 | Weigh-ins, 7-day trend, workouts, plan |
| Card File | Business card scanner and contact list, vCard and CSV export |

## Using it

- **Phone:** open the site and use *Add to Home Screen*. Keel runs full screen and opens offline.
- **Today** shows what needs attention across every tool. Tap a card to open that tool.
- **Settings** has sync, photo reading, theme, the phone tab bar's three pinned tools, and backup/restore.

## Where the data lives

- **Synced (recommended):** your own free Firebase project. Sign in on each device and see the same data,
  live, with an offline copy on each device. Only accounts on the project's members list can read or write.
  Setup takes about 10 minutes: see [SETUP.md](SETUP.md).
- **This device only:** with no Firebase config, or if you choose it at sign-in, data stays in the browser.

No personal data is stored in this repository. Restore your data from a Keel backup file
(Settings > Backup > Restore from a file).

## Photo reading

- **Card File's "Read card"** works on the device by default: PaddleOCR text recognition (ONNX Runtime Web,
  `assets/ocr.js`) finds the card's edges, straightens it, reads the text, and rules (`assets/card-parse.js`)
  sort it into name, title, company, phones, emails, website and address. Free, offline, nothing leaves the
  device; the first read downloads about 25 MB. Settings can switch Card File to the AI option below instead.
- **Pantry's "Scan"** (and Card File, if chosen) sends the photo to an AI model:
  - **Gemini through Firebase AI Logic** (default when signed in): the free tier of the Gemini Developer API
    through your Firebase project. No key to manage.
  - **Claude with your own Anthropic API key**: paste the key in Settings. It is stored only in that browser.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. A server is needed (ES modules don't load from `file://`).

## How it fits together

```
index.html                 the shell (navigation, Today, Settings, sign-in)
assets/keel.js             shell UI and routing
assets/store.js            one data store for every tool: localStorage/IndexedDB or Firestore
assets/app-bridge.js       runs inside each tool's iframe; provides window.claude.use("db" | "user" | ...)
assets/today.js            the Today summaries, ported from each tool's own due-date rules
assets/ai.js               photo reading (Gemini via Firebase AI Logic, or Claude via the Anthropic SDK)
assets/cloud.js            Firebase sign-in and members check
assets/firebase-config.js  your Firebase web config (null = this device only)
assets/vendor/             bundled Firebase and Anthropic SDKs (built from tools/)
apps/<tool>/index.html     each tool, as published, plus one <script> line (see apps/README.md)
firestore.rules            database rules: members only
sw.js                      offline support
tests/smoke.mjs            loads Keel, restores a sample backup, opens every tool
```

The tools were first built as Claude Artifacts, which call `window.claude.use("db")`, a small Firestore-style
document store. `app-bridge.js` provides the same calls, so the tools run unchanged. Data is stored at
`keel/<tool>/<collection>/<docId>` with the collection and field names from each tool's README.

## Tests

```bash
cd tools && npm install          # once: esbuild, Firebase and Anthropic SDKs for the vendor bundles
node ../tests/smoke.mjs          # needs Playwright and Chromium
```
