# Ygeia

A free, open-source, offline-first lifestyle tracker. Nutrition, lifting, sport, sleep,
study and body composition in one app — a free alternative to closed-source trackers.

**Your health data never leaves your device.** No account, no server, no analytics, no
tracking. Everything you log is stored in your browser's local database.

Two optional features talk to the internet, both off until you turn them on and both needing
a free Google API key you supply: **study photo help** (a photo of a homework question goes
to Google, never your health data) and the **coach** (which does send a summary of what you
have logged — the one feature that does). Ordinary food search queries Open Food Facts, and
the Nearby map uses OpenStreetMap. Settings lists every one of these in full.

Soft parchment-and-sage theme by default, with a forest-night dark mode.

<!-- Add a screenshot here once deployed: ![Ygeia](docs/screenshot.png) -->

## What it does

**Nutrition**
- 133 bundled whole foods that work with no network at all, plus barcode and name search
  against [Open Food Facts](https://world.openfoodfacts.org) (~3M products, no API key)
- Custom foods with a sanity check that catches macro/calorie typos
- Meal logging with named portions ("1 medium egg", "1 cup") instead of guessing grams
- Calorie and macro targets calculated from your profile (Mifflin-St Jeor BMR → TDEE)
- **A daily food-quality score** that grades the *day*, not individual foods: protein
  adequacy, fiber, whole-food ratio, added sugar, saturated fat, sodium and meal timing
- Late-meal detection with a calorie floor, so water and supplements don't get flagged

**Strength training**
- 114 bundled exercises across every muscle group and equipment type
- Live workout logging: weight, reps, RPE, warm-up / drop / to-failure set types
- Rest timer with an audible cue, using wall-clock deadlines so background throttling
  can't make it drift
- Plate calculator that tells you when a target weight isn't loadable with your plates
- Estimated 1RM (blended Brzycki/Epley), automatic PR detection, progression charts
- Double-progression suggestions: add reps first, then load

**Strength rank**
- A chess-style rating for lifting, scored against published bodyweight-relative strength
  standards for your sex — so the number is absolute, not graded on a curve against others
- Eight guild ranks from Novice to Legend; your best three rated lifts are averaged, with a
  breadth penalty so one huge deadlift alone won't carry you
- Training XP and levels for the sessions in between, because rank moves slowly and
  showing up should still count

**Sport**
- 47 activities with MET values from the Compendium of Physical Activities
- Energy cost and weekly training load in MET-minutes, against the WHO activity guideline
- Explicitly **not** added to your calorie budget — see the note below

**Sleep & study**
- Sleep logging with duration, quality, sleep debt and a **consistency score** (regularity
  predicts outcomes at least as strongly as total hours)
- Bedtime planner built on 90-minute sleep cycles
- Subjects with exam countdowns, focus-block timer, and study-time allocation weighted by
  urgency and how far behind each subject is
- **Spaced repetition** on Leitner boxes (1, 3, 7, 16, 35 days)
- Honest guidance on the study/sleep trade-off: cutting sleep to study costs more recall
  than the extra hour buys

**Weight cutting (combat sports)**
- Water-loading, sodium and carbohydrate manipulation on a day-by-day timeline
- Splits the cut into gradual fat loss and acute loss, filling the acute portion from gut
  content and glycogen water first and dehydration **last**
- **Refuses to generate a schedule for a cut it considers unsafe** (>8% acute) and tells you
  to move up a weight class instead
- Rehydration plan, and a urine-colour hydration check

**Body**
- Weight, body fat, lean mass, resting HR, HRV, blood pressure, sleep, steps, VO₂ max
- BMI — with a caveat that fires when it misclassifies a lean, muscular lifter — plus
  **FFMI**, which actually responds to training
- Trend lines with 30-day projections — and an **r² reliability check**, so a projection
  drawn through noise is labelled untrustworthy instead of shown with false confidence
- Self-correcting calorie targets: if the scale disagrees with the prediction, the scale wins

**Places**
- Nearby restaurants, cafés, libraries, gyms and supermarkets from OpenStreetMap
- A hand-rolled slippy map (no Leaflet), cuisine, opening hours and website links

**Calendar & notes**
- A month grid showing which days have anything in them, coloured by category
- A day view that replays it in order: when you woke, what you ate and when, when you
  trained, when you studied, when you weighed in
- Write notes on any day — "exam tomorrow", "deload week" — and anything coming up in the
  next fortnight surfaces on Today, which is when it is still useful to know

**Accountability**
- Daily habits tracked yes/no — deliberately binary, because partial credit turns a
  commitment into a negotiation

**Meal planning**
- 20 bulk-store meals built around what warehouse stores actually sell: rotisserie chicken,
  frozen veg, rice, eggs, tinned fish, mince
- Filter by prep time, batch cooking, no-cook, vegetarian, cheap
- Suggestions ranked against your *remaining* macros for the day
- Automatic shopping list — quantities summed across planned servings and rounded up to
  something you can actually buy
- Macros are computed from the food library, never typed in, so they stay consistent

**Training programs**
- Six programs: Full Body 3×, Upper/Lower 4×, PPL 6×, Barbell Strength 3×, Bodyweight 4×,
  Fighter Strength 4×
- Sessions rotate rather than being pinned to weekdays, so missing a Tuesday shifts the
  plan along instead of skipping legs
- Starting weights come from your own history via the existing progression logic

**Insights**
- Correlations across everything you log, with a scatter plot and r, n and p shown next to
  every claim
- Only a **curated list** of questions with a plausible mechanism is tested. Testing all 66
  pairs of a dozen variables would manufacture "findings" from pure noise, and this refuses
  to do that
- Nothing is reported below 10 paired days or |r| < 0.45
- A custom explorer for any two variables at same-day, next-day or two-day lag

**Every number shows its working**
- Tap ⓘ on any derived value for the formula, your actual inputs, each arithmetic step, the
  result, and the source it came from
- Each explanation has a "report a problem" button that opens a pre-filled GitHub issue
  containing the full working — so bug reports arrive reproducible

**Study photo help** *(optional, off by default)*
- Photograph a problem you are stuck on and get it worked through step by step
- Save the result as a flashcard
- **This is the only feature that sends anything to a third party.** It needs your own free
  Google Gemini key and sends only the photo and your note — never health data, which is
  enforced in code rather than promised in prose (see `js/ai-vision.js`)

**Coach** *(optional, off by default, needs your own key)*
- Ask about meals, training and studying. It refuses anything medical.
- **This one does send your health data** — a short summary plus your upcoming calendar
  notes. It stays off until you explicitly turn it on, and says exactly what it sends.
- It narrates figures the deterministic engines already computed — it never calculates a
  number you see. "You are 57 g short of 167 g" is arithmetic from `js/domain-gaps.js`,
  computed on your device with no key and no network; the model only puts sentences round it.

**What you're missing** *(no key, no internet, always on)*
- Compares what you logged against published guidelines and shows the shortfall: protein per
  kg, fibre per 1000 kcal, sleep, WHO weekly activity and strength frequency
- Every figure is tappable through to the guideline it came from
- Population guidelines only — it never interprets a symptom or a clinical measurement

**Data**
- Import your Apple Health export (see below)
- One-tap download of everything, plus password-encrypted backups safe for cloud storage
- Backup reminders, because with no server a backup is the only recovery path there is
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
4. In Ygeia: Settings → **Import from Apple Health** → choose `apple_health_export/export.xml`

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
  Bluetooth — it pairs only with the iPhone. Watch data reaches Ygeia via the Health export.
- **No Bluetooth heart-rate straps on iPhone.** Safari has never supported Web Bluetooth
  on any iOS version.
- **No barcode *scanning* on iOS.** Safari lacks the `BarcodeDetector` API, so barcodes are
  typed in rather than scanned. Lookup itself works fine.
- **No restaurant menus.** There is no free API that returns them — Google Places and Yelp
  both require paid keys and neither exposes structured dish data, and OpenStreetMap carries
  a website link at best. Ygeia shows what genuinely exists and lets you log what you ate;
  it does not pretend to know the menu.
- **Exercise calories are not added to your food budget.** Your target already includes your
  activity level, so eating back workout calories double-counts them. That is the single most
  common way calorie tracking silently fails, and this app deliberately won't do it.
- **The strength rank is a motivator, not a verdict.** Strength standards are population
  reference points; leverages, limb lengths and training history all move the real number.
- **Not a medical device.** Nothing here diagnoses, treats or prevents anything. The
  biological formulas are population estimates that can be meaningfully wrong for any given
  individual. Talk to a doctor, not an app.

### On weight cutting

Acute weight cutting has killed athletes — dehydration has caused deaths in MMA and in
collegiate wrestling. The safety limits in `js/domain-cut.js` are therefore part of the
feature, not decoration: the planner refuses to produce a dehydration schedule above 8%
acute loss and tells you to change weight class instead. If you relax a threshold in that
file, you are changing a safety control. It is not medical advice and does not replace a
coach or a doctor.

## Project layout

```
index.html              app shell and script order
tests.html              144 assertions — open it in a browser, no runner needed
css/app.css             design system — every colour is a token
js/util.js              DOM, date and unit helpers
js/store.js             IndexedDB wrapper and repositories
js/domain.js            nutrition, strength, energy balance, trends
js/domain-life.js       BMI, FFMI, sport METs
js/domain-cut.js        weight cutting — including its safety limits
js/domain-study.js      sleep cycles, spaced repetition, study allocation
js/domain-rank.js       strength rating, guild ranks, training XP
js/data-foods.js        bundled offline food library
js/data-exercises.js    bundled exercise library
js/ui.js                reusable UI pieces (sheets, rings, rows, inputs)
js/charts.js            hand-rolled SVG line/bar/sparkline charts
js/map.js               minimal slippy map over OpenStreetMap tiles
js/openfoodfacts.js     food database client
js/places.js            Overpass nearby-places search and UI
js/healthimport.js      streaming Apple Health export parser
js/view-*.js            one file per tab, plus the weight-cut screens
js/app.js               bootstrap, routing, first-run seeding
sw.js                   service worker for offline caching
```

Every `js/domain-*.js` file deliberately contains no DOM or storage access, so each
calculation can be tested in isolation and reused if the UI is ever rewritten. That is what
`tests.html` exercises — reference values are worked out by hand from the published formulas
rather than read back from the implementation.

## Why no framework?

The entire app loads as static files with zero dependencies. That means no build step, no
lockfile rot, and it will still run unchanged in ten years. For an app whose main promise is
that it holds your health data locally and forever, that seemed worth more than developer
convenience.

There is no third-party code in the page at all. `script-src` is `'self'` and nothing else —
every line that executes came from this repository. Ygeia briefly shipped an optional
on-device model that imported WebLLM from a CDN; that code ran in this origin with full
IndexedDB access and could not be version-pinned, because ES module imports cannot carry an
integrity hash. It was removed rather than mitigated. The Content-Security-Policy in
`index.html` then enumerates every host the page may connect to, so even a scripting bug
would have nowhere to send what it read.

## Contributing

Issues and pull requests welcome. The most useful contributions are additions to the
bundled food library (regional staples especially) and the exercise library.

## Licence

[MIT](LICENSE) — do whatever you like with it.

Food data from [Open Food Facts](https://world.openfoodfacts.org), available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
