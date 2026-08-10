# Vitals

A free, open-source, offline-first health tracker. Nutrition, strength training and body
metrics in one app — a free alternative to closed-source trackers like Bevel.

**Your data never leaves your device.** No account, no server, no analytics, no tracking.
Everything is stored in your browser's local database.

<!-- Add a screenshot here once deployed: ![Vitals](docs/screenshot.png) -->

## What it does

**Nutrition**
- 133 bundled whole foods that work with no network at all, plus barcode and name search
  against [Open Food Facts](https://world.openfoodfacts.org) (~3M products, no API key)
- Custom foods with a sanity check that catches macro/calorie typos
- Meal logging with named portions ("1 medium egg", "1 cup") instead of guessing grams
- Calorie and macro targets calculated from your profile (Mifflin-St Jeor BMR → TDEE)
- **A daily food-quality score** that grades the *day*, not individual foods: protein
  adequacy, fibre, whole-food ratio, added sugar, saturated fat, sodium and meal timing
- Late-meal detection with a calorie floor, so water and supplements don't get flagged

**Strength training**
- 114 bundled exercises across every muscle group and equipment type
- Live workout logging: weight, reps, RPE, warm-up / drop / to-failure set types
- Rest timer with an audible cue, using wall-clock deadlines so background throttling
  can't make it drift
- Plate calculator that tells you when a target weight isn't loadable with your plates
- Estimated 1RM (blended Brzycki/Epley), automatic PR detection, progression charts
- Double-progression suggestions: add reps first, then load

**Body**
- Weight, body fat, lean mass, resting HR, HRV, blood pressure, sleep, steps, VO₂ max
- Trend lines with 30-day projections — and an **r² reliability check**, so a projection
  drawn through noise is labelled untrustworthy instead of shown with false confidence
- Self-correcting calorie targets: if the scale disagrees with the prediction, the scale wins

**Data**
- Import your Apple Health export (see below)
- Full JSON backup and restore
- One-tap erase

## Running it

No build step. No `npm install`. No dependencies. It is plain HTML, CSS and JavaScript.

**Quickest:** open `index.html` in any browser.

**Recommended** (needed for offline caching and iPhone install), serve it over HTTP:

```bash
python -m http.server 8123
```

Then open <http://localhost:8123>.

## Installing on an iPhone

Safari needs an HTTPS URL to install a web app, so deploy it first (GitHub Pages is free —
Settings → Pages → deploy from `main`). Then on your iPhone:

1. Open the URL in **Safari** (not Chrome — iOS only allows Safari to install web apps)
2. Tap the **Share** button
3. Tap **Add to Home Screen**

It then launches fullscreen with no browser chrome and works completely offline.

> Installing to the Home Screen also matters for your data: Safari wipes site data for
> ordinary websites after 7 days of non-use, but **Home Screen web apps are exempt.**
> Export a backup periodically regardless.

## Importing Apple Health data

There is **no browser API for HealthKit** — no web app can read Apple Health directly.
What it *can* read is the export file:

1. Health app → your profile picture → **Export All Health Data**
2. Save the `.zip` to Files (this takes a few minutes and can be 200 MB–1 GB)
3. In Files, tap the zip once to uncompress it
4. In Vitals: Settings → **Import from Apple Health** → choose `apple_health_export/export.xml`

Steps, weight, body fat, lean mass, resting HR, HRV, blood pressure and VO₂ max are
imported. The file is streamed and aggregated to daily values on-device — it is never
uploaded, and the whole document is never held in memory.

Re-importing a newer export updates existing days rather than duplicating them.

## Honest limitations

Worth stating plainly, because other projects tend not to:

- **No live Apple Health sync.** Manual export/import only. Automatic sync requires a
  native iOS app with the HealthKit entitlement, which needs a Mac and a $99/yr Apple
  Developer account.
- **No Apple Watch support.** The Watch does not expose its sensors to third parties over
  Bluetooth — it pairs only with the iPhone. Watch data reaches Vitals via the Health export.
- **No Bluetooth heart-rate straps on iPhone.** Safari has never supported Web Bluetooth
  on any iOS version.
- **No barcode *scanning* on iOS.** Safari lacks the `BarcodeDetector` API, so barcodes are
  typed in rather than scanned. Lookup itself works fine.
- **Not a medical device.** Nothing here diagnoses, treats or prevents anything. The
  biological formulas are population estimates that can be meaningfully wrong for any given
  individual. Talk to a doctor, not an app.

## Project layout

```
index.html              app shell and script order
css/app.css             design system — every colour is a token
js/util.js              DOM, date and unit helpers
js/store.js             IndexedDB wrapper and repositories
js/domain.js            all health maths — pure functions, no DOM, no I/O
js/data-foods.js        bundled offline food library
js/data-exercises.js    bundled exercise library
js/ui.js                reusable UI pieces (sheets, rings, rows, inputs)
js/charts.js            hand-rolled SVG line/bar/sparkline charts
js/openfoodfacts.js     food database client
js/healthimport.js      streaming Apple Health export parser
js/view-*.js            one file per tab
js/app.js               bootstrap, routing, first-run seeding
sw.js                   service worker for offline caching
```

`js/domain.js` deliberately contains no DOM or storage access, so every calculation in the
app can be tested in isolation and reused if the UI is ever rewritten.

## Why no framework?

The entire app loads as static files with zero dependencies. That means no build step, no
supply-chain risk, no lockfile rot, and it will still run unchanged in ten years. For an app
whose main promise is that it holds your health data locally and forever, that seemed worth
more than developer convenience.

## Contributing

Issues and pull requests welcome. The most useful contributions are additions to the
bundled food library (regional staples especially) and the exercise library.

## Licence

[MIT](LICENSE) — do whatever you like with it.

Food data from [Open Food Facts](https://world.openfoodfacts.org), available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
