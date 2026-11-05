# The tools

Each folder holds one tool's `index.html`, a self-contained page (inline CSS and JS, no build step, Google
Fonts only). They were built as Claude Artifacts and are kept as published, with these changes only:

1. **All seven:** one added line after `<meta charset=utf8>` that loads `../../assets/app-bridge.js`
   with `data-app="<folder>"`. It provides `window.claude.use(...)` backed by Keel's shared store.
2. **Card File:** `blobUrl` asks the bridge for photo URLs (`window.claude.assetUrl(id)`) instead of claude.ai's
   `/_blob/<id>`.
3. **Cut to 150:** the intro sentence under the title used to be typed into the page with personal numbers.
   It is now built from the saved plan (`plan/current`), and `plan.intro`, if present, overrides it. The fallback
   plan (`DEF`, used only until a plan is saved) and the placeholder numbers in the page are generic.
4. **Card File:** the "Where we met" example is generic.

Opening a tool's page directly redirects to Keel with that tool selected.

## Data schemas

Data is stored per tool as `{ collection: { docId: document } }`. In Firestore the path is
`keel/<tool>/<collection>/<docId>`; locally it is localStorage `keel:<tool>`. Keep these names when changing a
tool so backups keep importing.

### cleaning-rounds (Cleaning Rounds)
- `rooms/{id}`: name, order.
- `chores/{id}`: name, room, everyDays, minutes, lastDone (YYYY-MM-DD or null), history[] (dates, newest first,
  max 24), startDue (first due date until logged), created.
- Next due = lastDone + everyDays, or startDue if never logged.

### house-upkeep-ledger (House Upkeep Ledger)
- `tasks/{id}`: title, everyMonths, month (1-12, first due month until logged), systemId, lastDone (YYYY-MM-DD or ""),
  pro (bool), notes, createdAt.
- `systems/{id}`: name, category (Heating & cooling | Plumbing | Electrical | Appliance | Roof & exterior | Safety |
  Yard | Interior | Other), location, brand, model, installedYear, notes, createdAt.
- `log/{id}`: date, title, taskId, systemId, cost, by, notes, createdAt.
- Next due = lastDone + everyMonths; if never logged, the end of the task's first month. Marking a task done writes
  a log entry and moves lastDone forward.

### garden-planner (Garden Planner)
- `settings/garden`: zone, lastFrost ("MM-DD"), firstFrost ("MM-DD"), location, isDefault.
- `beds/{id}`: name, width, length (ft), sun (full | part | shade), notes, order, example.
- `plantings/{id}`: crop (id from the CROPS table), variety, bedId, cells[] (square indexes), plantedOn,
  method (seed | transplant | indoor), status (planned | growing | harvesting | done), notes.
- `trees/{id}`: kind (apple | pear | cherry | peach | fig), label, variety, planted, notes, log[{date, text}].
- Crop windows are weeks relative to the frost dates (CROPS table in the page). Keel's Today screen reads the
  CROPS and FRUIT tables from this page, between `const CROPS = [` and `const TK = {`; keep those markers.

### pantry-recipe-book (Pantry & Recipe Book)
- `pantry/{id}`: name (plain ingredient name), qty, location (Fridge | Freezer | Pantry | Spice rack),
  expires (YYYY-MM-DD or ""), low (bool), store, updated (epoch ms).
- `recipes/{id}`: title, time (minutes, string), servings, tags[], ingredients[] ("(optional)" or a leading "~"
  marks optional), steps[], notes, updated.
- `shop/{id}`: name, from (recipe title or "Running low"), store, done (bool), added (epoch ms).
- `settings/household`: allergens[], stores[].
- Ingredient matching is token based (singularized words). Allergen matching expands common names and has
  exceptions (see `ALLERGEN_WORDS` in the page).

### garage-logbook (Garage Logbook)
- `vehicles/{id}`: name, year, make, model, plate, miles, milesAt (date of reading), readings[{date, miles}],
  schedule[{id, label, miles, months, nextMiles}], created. `nextMiles` is an absolute due mileage.
- `services/{id}`: vehicleId, date, miles, items[] (schedule labels or free text), cost, shop, notes, created.
- Due status matches a schedule label to service `items`; a never-logged item counts from the earliest record.
  Driving rate comes from readings at least 14 days apart.

### cut-to-150 (Cut to 150)
- `weighins/{YYYY-MM-DD}`: date, weight (lb), bodyFat?, muscle?, waist? (in), water?, note?, createdAt.
- `workouts/{YYYY-MM-DD}-{lift|walk}`: date, kind, createdAt.
- `plan/current`: startWeight, startDate, goalWeight, goalDate, calories, protein, steps, intro? (Keel).
- Trend = average of entries in the trailing 7 days; pace compares the latest trend to the trend 10+ days earlier.

### card-file (Card File)
- `cards/{id}`: name, title, company, website, phones[{label, number}], emails[], street, city, region, postal,
  country, met, other, notes, frontId, backId (photo ids), frontAspect, backAspect, createdAt, updatedAt.
- Photos: `_assets/{id}` in Firestore (`{ mime, data (base64), bytes, createdAt }`, re-encoded under 700 KB), or
  IndexedDB locally. Backups carry them under `assets["card-file"]`.
