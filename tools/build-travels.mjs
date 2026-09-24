// Turns tools/travels.txt into data/travels.js, which the app offers to load
// the first time it runs with nothing saved.
//
//   cd tools && npm run travels

import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {feature} from 'topojson-client';
import {geoContains, geoBounds, geoCentroid, geoDistance} from 'd3-geo';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '..', 'data');
globalThis.window = {};

async function loadData(name) {
  // eslint-disable-next-line no-eval
  eval(await readFile(path.join(data, `${name}.js`), 'utf8'));
}

// Names people use that Natural Earth spells differently, or that are a part of
// a country rather than a country.
const COUNTRY_ALIASES = {
  'czech': 'CZE', 'czech republic': 'CZE',
  'korea': 'KOR', 'south korea': 'KOR',
  'england': 'GBR', 'scotland': 'GBR', 'wales': 'GBR',
  'n. ireland': 'GBR', 'northern ireland': 'GBR', 'uk': 'GBR', 'britain': 'GBR',
  'vatican city': 'VAT', 'holy see': 'VAT',
  'macau': 'MAC', 'macao': 'MAC',
  'hong kong': 'HKG',
  'russia': 'RUS', 'usa': 'USA', 'united states': 'USA',
  'uae': 'ARE', 'ivory coast': 'CIV', 'burma': 'MMR',
};

// Places the bundled city list does not carry - a village below the size cut,
// or a region or a landmark rather than a town. Add your own here, keyed by the
// name exactly as you write it in travels.txt, and the build will place them.
const EXTRA_PLACES = {};

// Spellings the city list uses instead of the one you would type. Add your own
// in places.txt rather than here, so they stay out of the repository.
const CITY_ALIASES = {
  'st petersburg': 'saint petersburg',
  'gothenburg': 'goteborg',
  'cologne': 'koln',
};

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

await loadData('countries');
await loadData('admin1');
await loadData('cities');
const w = globalThis.window;

const countries = feature(w.TM_COUNTRIES, w.TM_COUNTRIES.objects.countries).features
  .map((f) => f.properties);
const regionShapes = feature(w.TM_ADMIN1, w.TM_ADMIN1.objects.admin1).features;
const regions = regionShapes.map((f) => f.properties);

/* A hand-placed pin gets the same treatment the bundled cities got at build
   time: find the region whose outline actually contains it, so a village lights
   up its province rather than floating unattached. */
function regionAt(lon, lat, countryId) {
  const mine = regionShapes.filter((f) => f.properties.adm0 === countryId);
  const boxed = [];

  for (const f of mine) {
    const [[w0, s0], [e0, n0]] = geoBounds(f);
    const inLat = lat >= s0 - 0.1 && lat <= n0 + 0.1;
    const inLon = w0 <= e0 ? lon >= w0 - 0.1 && lon <= e0 + 0.1 : lon >= w0 - 0.1 || lon <= e0 + 0.1;
    if (!inLat || !inLon) continue;
    if (geoContains(f, [lon, lat])) return f.properties.id;
    boxed.push({id: f.properties.id, size: Math.abs((e0 - w0) * (n0 - s0))});
  }

  // Small islands and thin coastal strips sit a kilometre or two outside the
  // simplified outline. Take the tightest bounding box that still holds them,
  // and failing that the nearest region centre within ~75 km.
  if (boxed.length) return boxed.sort((a, b) => a.size - b.size)[0].id;

  let best = null;
  let bestD = 0.012; // radians
  for (const f of mine) {
    const d = geoDistance(geoCentroid(f), [lon, lat]);
    if (d < bestD) { bestD = d; best = f.properties.id; }
  }
  return best;
}

const byName = {};
for (const c of countries) {
  byName[fold(c.name)] = c.id;
  if (c.longName) byName[fold(c.longName)] = c.id;
}
// AU is claimed by Australia, the Indian Ocean Territories and Ashmore &
// Cartier Islands; the sovereign country wins, largest first.
const iso2ToId = {};
for (const c of countries) {
  if (!c.iso2) continue;
  const held = iso2ToId[c.iso2] && countries.find((x) => x.id === iso2ToId[c.iso2]);
  if (!held ||
      (c.kind === 'country') > (held.kind === 'country') ||
      (c.kind === 'country') === (held.kind === 'country') && (c.area || 0) > (held.area || 0)) {
    iso2ToId[c.iso2] = c.id;
  }
}

const col = Object.fromEntries(w.TM_CITIES.columns.map((c, i) => [c, i]));
const cityRows = w.TM_CITIES.rows.map((r) => ({
  id: String(r[col.id]), name: r[col.name], cc: r[col.cc], pop: r[col.pop],
  lon: r[col.lon], lat: r[col.lat], country: r[col.country], region: r[col.region],
}));
const cityIndex = new Map();
for (const c of cityRows) {
  const key = c.cc + '|' + fold(c.name);
  const seen = cityIndex.get(key);
  if (!seen || c.pop > seen.pop) cityIndex.set(key, c);
}

/* Places the bundled city list does not carry, and spellings it uses instead,
   kept in a gitignored file beside travels.txt so a personal itinerary never
   reaches the repository through the back door. See places.example.txt. */
async function loadPlaces() {
  let raw = '';
  try {
    raw = await readFile(path.join(here, 'places.txt'), 'utf8');
  } catch { return; }
  let extras = 0;
  let aliases = 0;
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    if (text.includes('->')) {
      const [from, to] = text.split('->').map((x) => x.trim());
      if (from && to) { CITY_ALIASES[fold(from)] = fold(to); aliases++; }
      continue;
    }
    const bits = text.split('|').map((x) => x.trim());
    if (bits.length < 4) continue;
    const lon = Number(bits[2]);
    const lat = Number(bits[3]);
    if (!bits[0] || !bits[1] || !isFinite(lon) || !isFinite(lat)) continue;
    EXTRA_PLACES[fold(bits[0])] = {cc: bits[1].toUpperCase(), lon, lat};
    extras++;
  }
  console.log(`places     ${extras} hand-placed, ${aliases} aliases from places.txt`);
}

await loadPlaces();

const text = await readFile(path.join(here, 'travels.txt'), 'utf8');
const problems = [];
const loose = [];
/* A blank line ends a trip, and @home / @base say where you set off from.
   Trips are the unit that matters for distance: one loop out and back, rather
   than a line drawn between everywhere you happened to reach in a year. */
function parseDirective(line, homes, problems, lineNo) {
  var m = line.match(/^@(home|base)\s+(.+)$/i);
  if (!m) return false;
  var rest = m[2].trim().split(/\s+/);
  var span = [];
  while (rest.length > 1 && /^\d{4}(-\d{2})?$/.test(rest[rest.length - 1])) span.unshift(rest.pop());
  var name = rest.join(' ');
  if (!name) { problems.push(`line ${lineNo}: @${m[1]} needs a place`); return true; }
  homes.push({raw: name, from: span[0] || null, to: span[1] || null, kind: m[1].toLowerCase()});
  return true;
}

const ym = (text) => {
  if (!text) return null;
  const bits = String(text).split('-');
  const y = Number(bits[0]);
  const mo = bits[1] ? Number(bits[1]) : null;
  if (!y) return null;
  return y * 100 + (mo || 1);
};

const RANK = {wishlist: 1, stopover: 2, visited: 3, lived: 4};
const strongest = (a, b) => ((RANK[b] || 0) > (RANK[a] || 0) ? b : a);

const countryTrips = new Map();   // id -> {years:Set, status}
const cityTrips = new Map();      // key -> {city, years:Set, note, status, trip}
const homeLines = [];
const trips = {};                 // tripId -> {ym}

let lineNo = 0;
let tripNo = 0;
let inTrip = false;
for (const raw of text.split('\n')) {
  lineNo++;
  const line = raw.trim();
  if (!line) { inTrip = false; continue; }
  if (line.startsWith('#')) continue;
  if (parseDirective(line, homeLines, problems, lineNo)) continue;
  if (!inTrip) { tripNo++; inTrip = true; }
  const tripId = 't' + tripNo;
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 2) { problems.push(`line ${lineNo}: cannot read "${line}"`); continue; }

  const year = Number(parts[0].slice(0, 4));
  if (!year) { problems.push(`line ${lineNo}: no year in "${parts[0]}"`); continue; }
  const stamp = ym(parts[0]);
  // A trip takes the date of its first line.
  if (!trips[tripId]) trips[tripId] = {ym: stamp};

  const countryName = fold(parts[1]);
  const id = COUNTRY_ALIASES[countryName] || byName[countryName];
  if (!id) { problems.push(`line ${lineNo}: unknown country "${parts[1]}"`); continue; }

  const status = (parts[3] || 'visited').trim().toLowerCase();
  if (!RANK[status]) { problems.push(`line ${lineNo}: unknown status "${parts[3]}"`); continue; }

  if (!countryTrips.has(id)) countryTrips.set(id, {years: new Set(), status: 'visited'});
  const trip = countryTrips.get(id);
  trip.years.add(year);
  trip.status = strongest(trip.status, status);

  const cityField = (parts[2] || '').trim();
  if (!cityField) continue;

  for (const entry of cityField.split(',')) {
    const bracket = entry.match(/\(([^)]*)\)/);
    const note = bracket ? bracket[1].trim() : '';
    const name = entry.replace(/\([^)]*\)/g, '').trim();
    if (!name) continue;

    const wanted = CITY_ALIASES[fold(name)] || fold(name);
    const cc = countries.find((c) => c.id === id);
    let hit = cityIndex.get((cc.iso2 || '') + '|' + wanted);

    // Second pass for the places whose official name carries more than what
    // anyone calls them: "Donostia / San Sebastian", "Jeju City".
    if (!hit) {
      const near = cityRows
        .filter((c) => c.cc === cc.iso2 && new RegExp('(^|[ /])' + wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[ /])').test(fold(c.name)))
        .sort((a, b) => b.pop - a.pop);
      if (near.length) {
        hit = near[0];
        loose.push(`${name} -> ${hit.name}`);
      }
    }

    if (!hit) {
      const extra = EXTRA_PLACES[fold(name)];
      if (extra) {
        hit = {
          id: 'x-' + fold(name).replace(/ /g, '-'),
          name: name, cc: extra.cc, pop: 0, lon: extra.lon, lat: extra.lat,
          country: iso2ToId[extra.cc] || id, region: null, custom: true,
        };
      }
    }
    if (!hit) { problems.push(`line ${lineNo}: no city "${name}" in ${cc.name}`); continue; }

    const key = String(hit.id);
    if (!cityTrips.has(key)) {
      cityTrips.set(key, {city: hit, years: new Set(), note: '', status: 'visited', trip: tripId});
    }
    const slot = cityTrips.get(key);
    slot.years.add(year);
    slot.status = strongest(slot.status, status);
    if (note && !slot.note) slot.note = note;
  }
}

if (problems.length) {
  console.error('Unresolved:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// Resolve each declared home against the city list, so a base is a real point.
const homes = [];
for (const h of homeLines) {
  const folded = CITY_ALIASES[fold(h.raw)] || fold(h.raw);
  let hit = null;
  for (const c of cityRows) {
    if (fold(c.name) !== folded) continue;
    if (!hit || c.pop > hit.pop) hit = c;
  }
  if (!hit) { problems.push(`@${h.kind}: no city called "${h.raw}"`); continue; }
  homes.push({
    name: hit.name, lon: hit.lon, lat: hit.lat,
    country: hit.country, region: hit.region,
    from: ym(h.from), to: h.to ? ym(h.to) : null
  });
}

const out = {
  version: 1,
  settings: {countStopovers: false, theme: null, homes: homes, trips: trips},
  countries: {}, regions: {}, cities: {}
};

for (const [id, t] of countryTrips) {
  const years = [...t.years].sort();
  out.countries[id] = {status: t.status, first: years[0], last: years[years.length - 1]};
}
for (const [key, t] of cityTrips) {
  const years = [...t.years].sort();
  const c = t.city;
  out.cities[key] = {
    status: t.status, name: c.name, cc: c.cc, lon: c.lon, lat: c.lat,
    country: c.country,
    region: c.region || regionAt(c.lon, c.lat, c.country),
    first: years[0], last: years[years.length - 1],
  };
  out.cities[key].trip = t.trip;
  if (t.note) out.cities[key].note = t.note;
  if (c.custom) out.cities[key].custom = true;
}

await writeFile(path.join(data, 'travels.js'), `window.TM_TRAVELS=${JSON.stringify(out)};\n`);

const touched = new Set();
for (const c of Object.values(out.cities)) if (c.region) touched.add(c.region);
const noRegion = Object.values(out.cities).filter((c) => !c.region);

if (loose.length) console.log(`matched    ${loose.join(' · ')}`);
const notPlain = Object.entries(out.countries).filter(([, v]) => v.status !== 'visited');
if (notPlain.length) console.log(`status     ${notPlain.map(([k, v]) => k + ' ' + v.status).join(', ')}`);
console.log(`trips      ${Object.keys(trips).length}`);
console.log(`homes      ${homes.map((h) => h.name + (h.from ? ' ' + h.from + '-' + (h.to || '') : '')).join(' · ') || 'none'}`);
console.log(`countries  ${Object.keys(out.countries).length}`);
console.log(`cities     ${Object.keys(out.cities).length}`);
console.log(`regions    ${touched.size} lit up by those cities`);
if (noRegion.length) {
  console.log(`no region  ${noRegion.map((c) => c.name).join(', ')}`);
}
