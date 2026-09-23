# Been There

A map of where you have been. Colour in countries, drill into their states and
provinces when you have only seen part of one, and pin the cities.

Open `index.html`. That is the whole install: no build, no server, no account,
no network, no Node. Everything you enter lives in that browser's local storage,
and the menu will hand you a `.json` backup whenever you want one.

**Nothing you enter goes into this repository.** It starts empty, your places
stay in your browser, and `data/travels.js` and `tools/travels.txt` are ignored
by git, so a personal history cannot be committed by accident. A clean checkout
has no `data/travels.js` at all; the app looks for one, does not find it, and
carries on. The 404 in the console is that, and is meant to be there.

## Getting a copy

**On a computer:** **Code → Download ZIP**, unzip anywhere, double-click
`index.html`. Or `git clone` it. Nothing needs installing — the maps, the city
list and the two libraries are all committed, already built.

**On a phone:** a zip is no use; you need a URL. Turn on GitHub Pages
(**Settings → Pages → Deploy from a branch → `main` / `/ (root)`**), open the
`https://<you>.github.io/<repo>/` address it gives you, and use **Add to Home
Screen**. It installs as an app: own icon, no browser chrome, works with no
signal. See *Installing it on a phone* below.

`tools/` is only for rebuilding the committed data files. You never have to
touch it to use the app, and it is the only part that wants Node.

## Why countries *and* regions *and* cities

Country-only maps lie. Land in New York once and the map claims you have seen
the United States. City-only maps can't be coloured — a city is a point, and a
scatter of dots is a different picture than a filled map.

So there are three layers, and each one feeds the one above it:

| Layer | What it is | Count |
|---|---|---|
| Countries | the base fill | 243, including territories |
| Regions | states, provinces, prefectures, counties | 4,596 |
| Cities | pins, with coordinates | 29,385 searchable, plus any you drop yourself |

Mark a city and its region and its country light up on their own. Mark a region
and its country follows. You never tick the same trip twice, and a country you
have half-seen shows as half-seen instead of a flat lie.

## The four states

A place is one of: **lived there**, **visited**, **stopover**, **want to go**,
or nothing. The first three are one blue ramp, darkest for the deepest, so the
map reads as a gradient of how much of your life a place got. Want-to-go is
yellow because it is a different kind of fact, not a lesser grade of visiting.

Stopovers exist because that argument is unavoidable: the layover, the train
change, the cruise stop that let you off for four hours. They get their own
colour and are left out of the headline totals by default — flip that under
**Data → What counts as visited** if you count them.

## Where next?

The dice button spins a destination out of about seven thousand places and drops
it in front of you. Filters narrow it: **coast, islands, mountains, desert,
tropical, far north or south, big cities, small towns, capitals**, plus a
continent, plus *only countries I have not been to* — which is the point of
having the map in the first place. A result can go straight onto the map as
somewhere you want to go.

Every one of those traits is **computed, not curated**:

| Trait | How it is decided |
|---|---|
| Coast | within 30 km of Natural Earth's coastline |
| Islands | on a named island under 200,000 km² — Java counts, Great Britain does not |
| Mountains | in, or within 45 km of, one of 222 named ranges |
| Desert | inside one of 58 named deserts |
| Tropical / far north | latitude |
| Big city / small town | population |

There is deliberately no "charming" or "good food". A boundary file has no
opinion about those, and inventing one would make the filters lie. The desert
layer is the thinnest — Las Vegas is not inside a named desert polygon, so it is
not tagged one.

The pool is places worth suggesting rather than every settlement on Earth: a
capital, somewhere genuinely large, or somewhere small with a character the
geography can vouch for. Anything sitting within 45 km of a place four times its
size is somebody else's suburb and is left out, because "Eimsbüttel, Germany" is
really a suggestion of Hamburg.

## Watching it fill in

The ⟳ button on the map plays your travels back a year at a time, from the first
place you ever marked to the last. Scrub it, pause it, close it. Everything on
screen follows the clock — the header totals and the legend as well as the map —
because a header saying 31 next to a map showing 23 is just wrong.

It reads the same statuses the map always does, only asked as of a year, so the
last frame is identical to the live map by construction rather than by luck.
Places with no year cannot be put on a timeline; the bar says how many are
sitting it out. Editing anything while the clock is wound back closes the replay,
since otherwise you would be editing a year that is no longer on screen.

## One border away

The summary works out which countries you have **not** been to that share a land
border with one you have, ordered by how surrounded they are — being next door to
four of your countries is a better prompt than being next door to one. The
roulette has the same thing as a filter.

Borders are not a separate dataset that can go stale: an edge shared by two
country shapes in the map's own topology *is* a border. That gets the awkward
ones right, including the ones a list would miss — France borders Brazil and
Suriname, through French Guiana, so a Brazilian beach is legitimately one border
from a trip to Paris.

## The summary

The **Summary** button adds the whole thing up: how much of the world's land and
population you have stood on, a running total of countries by year, how many new
countries and cities each year brought, a continent-by-continent breakdown, which
countries you went deepest into, the furthest pin in each direction, your longest
gap between trips, and a table of every country with the years and the region
count. The table is also the colour-free way to read everything the charts say.

## Getting your places in

- **Click the map.** Countries at a glance; zoom into one and its regions appear
  once you have coloured anything inside it. On a phone the map fills the screen
  and the details slide up over it; the handle at the top pushes them back down.
- **The checklist** runs every country on Earth as a grid by continent. Click
  cycles visited → lived → stopover → want to go → blank. This is much faster
  than hunting for Andorra on a world map.
- **Search** (or press `/`) covers countries, regions and cities in one box.
  Picking a city from search pins it.
- **Drop a pin** for anywhere the city list does not have — a village, a
  campsite, a trailhead. Click the map and name it.
- **A text file**, for bulk-loading a history you already have written down.
  Copy `tools/travels.example.txt` to `tools/travels.txt` — one trip per line:

  ```
  2011-08 | France        | Paris, Lyon
  2015-06 | Canada        | Montreal, Toronto     | lived
  2018-02 | Qatar         |                       | stopover
  2027-01 | Chile         |                       | wishlist
  ```

  `cd tools && npm run travels` resolves every name against the city list,
  works out which region each pin falls in, and writes `data/travels.js`. The
  app loads that the first time it runs with nothing saved, and **Data → Load
  the starter travels** merges it back in later. Anything the list cannot find
  is reported by name rather than quietly dropped, so you can add coordinates
  for it in `EXTRA_PLACES` at the top of `tools/build-travels.mjs`.

  Both files are gitignored. Your trips stay on your machine.

## Your data

It is in `localStorage` under `beenthere.v1`, in one browser, on one device.
That is deliberate — nothing to sign into, nothing that can be switched off from
elsewhere — but it means:

- Clearing site data deletes it. **Export a backup** from the menu. The app
  keeps track: a week after your first place goes in, and monthly after each
  backup, the menu button grows a dot and says how long it has been. Exporting
  or importing clears it.
- It does not follow you to your phone. Export on one, import on the other;
  import offers *merge* as well as *replace*.
- A private window and a normal window are different stores. If the browser is
  blocking storage entirely the app says so in the menu.

There is a CSV export too, for when you want the list in a spreadsheet.

## Hosting it

Any static host will do, since there is no backend: GitHub Pages, Netlify,
Cloudflare Pages, or a folder on a USB stick. There is nothing personal in the
repository, so a public one publishes the app and nothing about you.

**GitHub Pages:** **Settings → Pages → Deploy from a branch**, `main`,
`/ (root)`. A minute later the app is at `https://<you>.github.io/<repo>/`. Free
for public repositories; a private one needs a paid plan, and Cloudflare Pages
or Netlify will host a private repository free instead.

Whatever you use, the page is the app only. Your places are in your browser, and
the way to move them to another device is **Data → Export a backup** here and
**Data → Import** there.

### Installing it on a phone

A hosted copy is a progressive web app. Open the URL in the phone's browser and
use **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: menu →
Add to Home screen). It gets its own icon, opens without browser chrome, and
works with no signal — `sw.js` caches the page, the code and the maps on first
visit, so let it finish loading once while you have a connection.

The page and the code are fetched network-first, so a redeploy is never masked
by a stale cache. The two big data files are served from cache until `VERSION`
in `sw.js` changes, which is the line to bump after `npm run data` — it is the
only manual step in the whole build, and forgetting it leaves installed copies on
stale maps. Icons are rebuilt from `icons/*.svg` with `npm run icons`.

None of this applies to opening `index.html` from disk — a service worker only
runs over http(s), and the app already needs no network.

## Checking it still works

```sh
cd tools
npm install
npx playwright install chromium
npm test
```

Forty-two checks against the real page in a real browser: a fresh browser
starts empty and usable, a history loads and adds up, nothing is fetched from
off the page, a corrupt backup is refused rather than
half-applied, a country keeps its colour at world zoom and breaks into regions
when you zoom, the UK lists as four home nations, a city lights up its region and
country, the summary renders, a browser with storage switched off still works and
says so, the backup nudge appears and clears on the right days, the manifest is
installable, the service worker serves the page with the network switched off,
the phone layout gives the map the whole screen and keeps what you selected and
the controls clear of the sheet, the roulette's filters only ever narrow the pool
and every spin honours them, the replay only ever adds countries as it walks
forward and ends on the live map, and nothing overflows sideways. Every one of them is there because
that thing broke at least once.

Set `CHROME_PATH` to use a Chromium already on the machine instead of the one
Playwright downloads. The tests bring their own trips rather than relying on
whatever is in `data/travels.js`, which in a clean checkout is nothing.

## How it is built

Plain HTML, CSS and JavaScript — no framework, no bundler for the app itself.

```
index.html          the page
src/store.js        your places, and the rules for rolling them up
src/atlas.js        geometry, the canvas, hit-testing
src/app.js          panel, checklist, search, import/export
src/styles.css
src/summary.js      the totals and the charts
src/roulette.js     where next, and the filters
vendor/geo.js       d3-geo + topojson-client, bundled (33 KB)
data/*.js           the maps, borders, the city list and your trips, pre-built
sw.js               offline for the hosted copy
manifest.webmanifest, icons/
tools/              how everything in data/, icons/ and vendor/ was generated
```

The data files are **scripts that assign a global**, not JSON. A page opened
from the filesystem cannot `fetch()` a file sitting next to it, but it can
always run a `<script src>`. That one choice is what makes double-clicking
`index.html` work. `data/countries.js` loads with the page; regions and cities
load in the background when they are first wanted.

### Regenerating the data

```sh
cd tools
npm install
npm run data     # downloads Natural Earth, rebuilds the maps, cities and traits
npm run travels  # rebuilds data/travels.js from travels.txt
npm run check    # validates the result
npm run vendor   # rebuilds vendor/geo.js
```

`npm run data` takes a couple of minutes, mostly resolving every city to the
region whose polygon contains it. The build has two traps worth knowing about,
both of which it now handles and asserts on:

- **Never filter rings during simplification.** `toposimplify -f` looks tidy and
  silently deletes 23 countries and 140 regions — every small island state,
  which is precisely the kind of place worth colouring in.
- **Simplification can reverse a ring's winding.** On a plane nobody notices; on
  a sphere a backwards ring means "all of the Earth except this", so one mangled
  county paints over the entire map. The build detects any polygon larger than
  half the globe and flips it back.
- **ISO-2 codes are not unique in Natural Earth.** `AU` belongs to Australia,
  the Indian Ocean Territories *and* Ashmore & Cartier Islands, and taking the
  last one filed Darwin under an uninhabited reef. Country lookups resolve to
  the sovereign state, largest first.

### A note on granularity

Natural Earth's admin-1 layer is finer than how people think about places: the
UK is 232 councils, not four home nations; Italy is 110 provinces, not 20
regions. Where the source also carries the grouping people use, the region list
shows those as collapsible chunks with a **all** button, so "Scotland" is one
row rather than thirty-two.

The map itself keeps a country's own colour at world zoom even when you have
region detail inside it — greying out a country the moment you know *more* about
it is backwards. Regions appear once you zoom past about 3.5×, or immediately
via **Show on map** in the country panel.

## Credits and licence

Boundaries, coastline and physical geography — the mountain ranges, deserts and
islands behind the roulette's filters — from
[Natural Earth](https://www.naturalearthdata.com/) (public domain). City coordinates from [GeoNames](https://www.geonames.org/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via the
`all-the-cities` package. [d3-geo](https://github.com/d3/d3-geo) and
[topojson-client](https://github.com/topojson/topojson-client) are ISC licensed.

Borders on a world map are somebody's politics no matter whose data you use.
Natural Earth's are the least-worst common denominator; disputed areas are drawn
the way it draws them, and the app takes no view.
