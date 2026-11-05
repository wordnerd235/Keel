# Keel: notes for Claude Code

Keel combines Caleb's seven "Life Tools" pages (first built as Claude Artifacts) into one installable web app,
hosted on GitHub Pages. Read `README.md` for the layout and `apps/README.md` for each tool's data schema.
The calorie tracker **Intake** is a separate app and repo (wordnerd235/intake); keep it out of Keel.

## This repository is public

- Never commit personal data: no backups, no `data/db.json` exports, no household facts (address, health
  numbers, family details, vehicles, contacts). Backups (`keel-backup*.json`) are git-ignored.
- Never commit API keys. The Anthropic key lives only in the user's browser (localStorage `keel:ai`).
- `assets/firebase-config.js` holds the Firebase web config. It is not secret; access is controlled by
  `firestore.rules` (members only) and sign-in.
- Household facts that tools rely on (allergies, frost dates, odometers, plan targets) belong in the user's
  data, not in code. Ask Caleb when a task needs them.

## Rules for changing things

- **Keep each tool working as it does.** Change a tool's page only when asked, keep changes small, and list
  them in `apps/README.md`. Keep collection and field names so backups import.
- The tools call `window.claude.use("db" | "user" | "downloads" | "assets" | "sample")`. `assets/app-bridge.js`
  implements those over `assets/store.js`. Preserve the claude.ai error codes the pages check
  (`invalid_argument` for no permission, `quota_exceeded`, `not_found`; for photo reading `cancelled`,
  `rate_limited`, `image_rejected`, `invalid_json`, `refused`, `not_granted`, `sampling_disabled`).
- **Today summaries** (`assets/today.js`) are line-for-line ports of each tool's due-date rules. If a tool's
  rules change, change the matching summary and check the numbers match the tool's own header.
- No build step for the app itself. `assets/vendor/*.js` are bundled from npm by `tools/` (esbuild); rebuild
  with `cd tools && npm install && npm run build` when updating Firebase or the Anthropic SDK, with exact,
  pinned versions.
- Photo reading with Claude uses the official Anthropic SDK (`assets/vendor/anthropic.js`) in the browser with
  the user's own key (`dangerouslyAllowBrowser: true`), model `claude-opus-5-5`, server-side fallbacks on.
  Gemini goes through Firebase AI Logic (`firebase/ai`, Gemini Developer API backend).
- Bump `CACHE` in `sw.js` when adding files the app needs offline.

## Testing

- `node tests/smoke.mjs` serves the repo, restores `tests/fixture-backup.json` (made-up data), opens every
  tool inside Keel and fails on any page error.
- Firestore sync can be tested against the Firebase emulators: run `firebase emulators:start --only
  auth,firestore --project demo-keel` with `firestore.rules`, and open Keel with `?emulator=1` and a demo
  `firebase-config.js` (`projectId: "demo-keel"`).
- Check both themes and a phone width (390 px) for any UI change.

## Caleb's preferences (apply to every tool)

- Plain, friendly UI copy; phone-first layouts that also work on a laptop; light and dark themes.
- Accuracy over speed: verify facts (allergens, nutrition, schedules) or say plainly you're not sure.
- Only recommend maintenance that clearly prevents a real failure or safety issue, at the longest sensible
  interval. Skip debated items (driveway sealcoating, routine duct cleaning, septic additives, yearly pro HVAC
  tune-ups, generic timers for wipers or batteries). Wear items are inspect-when-serviced, not timers.
- Dates use the device's local calendar day (Caleb is in US Eastern time).
