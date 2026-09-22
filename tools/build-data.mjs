// Builds every data file the app ships with. Run once; the output is committed,
// so the app itself never needs a build step or a network connection.
//
//   cd tools && npm install && npm run data
//
// Sources
//   Natural Earth (public domain) - country and admin-1 boundaries
//   GeoNames via all-the-cities (CC BY 4.0) - city coordinates

import {execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {geoArea, geoContains, geoBounds, geoCentroid} from 'd3-geo';
import {feature as toFeatures} from 'topojson-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const out = path.join(here, '..', 'data');
const bin = (name) => path.join(here, 'node_modules', '.bin', name);

// Data ships as plain scripts that assign a global, not as JSON. A browser
// opened on file:// refuses to fetch() a sibling file (opaque origin), but it
// will happily run <script src="data/...js">. That one choice is what lets the
// app work by double-clicking index.html, with no server and no network.
async function writeDataFile(name, global, value) {
  const file = path.join(out, `${name}.js`);
  await writeFile(file, `window.${global}=${JSON.stringify(value)};\n`);
  return file;
}

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
// 50m for countries: 110m drops most small island states, which is exactly the
// kind of country a traveller wants to colour in. 10m for admin-1 because it is
// the only scale Natural Earth publishes with worldwide subdivision coverage.
const SOURCES = {
  countries: `${NE}/ne_50m_admin_0_countries.geojson`,
  admin1: `${NE}/ne_10m_admin_1_states_provinces.geojson`,
};

async function fetchCached(name, url) {
  const file = path.join(cache, `${name}.geojson`);
  try {
    await stat(file);
    console.log(`cached  ${name}`);
    return file;
  } catch {}
  console.log(`fetch   ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

// geo2topo | toposimplify, via the CLIs so the knobs match what the topojson
// docs describe. Deliberately no `-f`: ring filtering deletes small features
// outright, which costs you 23 countries (Monaco, Nauru, Bermuda...) and 140
// regions. Micro-states survive as a few vertices and the app draws a marker
// dot for anything too small to hit with a cursor.
async function toTopology(name, geojson, {retain, quantize = 1e5}) {
  const tmp = path.join(cache, `${name}.reduced.geojson`);
  await writeFile(tmp, JSON.stringify(geojson));
  let topo = execFileSync(bin('geo2topo'), ['-q', String(quantize), `${name}=${tmp}`], {
    maxBuffer: 1 << 30,
  });
  if (retain) {
    topo = execFileSync(bin('toposimplify'), ['-P', String(retain)], {
      input: topo,
      maxBuffer: 1 << 30,
    });
  }
  const result = JSON.parse(topo);
  const kept = result.objects[name].geometries.length;
  if (kept !== geojson.features.length) {
    throw new Error(`${name}: simplification dropped ${geojson.features.length - kept} features`);
  }
  return result;
}

/* Simplification can leave a ring wound the wrong way round. On a plane that is
   harmless; on a sphere a backwards ring means "everything except this", so one
   mangled county paints the entire globe and hides the map behind it. Detect it
   by area - no polygon on this map covers half the Earth - and flip the ones
   that do, then rebuild the topology from the corrected outlines. */
async function repairWinding(name, topo) {
  const HALF = 2 * Math.PI;
  const features = toFeatures(topo, topo.objects[name]).features;
  let flipped = 0;

  const fix = (rings) => {
    if (geoArea({type: 'Polygon', coordinates: rings}) <= HALF) return rings;
    flipped++;
    return rings.map((ring) => ring.slice().reverse());
  };

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') g.coordinates = fix(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fix);
  }

  if (!flipped) return topo;
  console.log(`repaired   ${name}: ${flipped} inverted polygon(s)`);
  const rebuilt = await toTopology(name, {type: 'FeatureCollection', features}, {retain: null});

  const still = toFeatures(rebuilt, rebuilt.objects[name]).features
    .filter((f) => geoArea(f) > HALF)
    .map((f) => f.properties.id);
  if (still.length) throw new Error(`${name}: still inverted after repair: ${still.join(', ')}`);
  return rebuilt;
}

/* Several ISO-2 codes are claimed by more than one Natural Earth feature - AU
   is Australia, the Indian Ocean Territories and Ashmore & Cartier Islands.
   Last-wins put Darwin in Ashmore & Cartier, so resolve to the sovereign
   country, largest first. */
function isoIndex(props) {
  const map = new Map();
  for (const p of props) {
    if (!p.iso2) continue;
    const held = map.get(p.iso2);
    if (!held) { map.set(p.iso2, p); continue; }
    const better = (a, b) =>
      (a.kind === 'country' ? 0 : 1) - (b.kind === 'country' ? 0 : 1) || (b.area || 0) - (a.area || 0);
    if (better(p, held) < 0) map.set(p.iso2, p);
  }
  return new Map([...map].map(([k, p]) => [k, p.id]));
}

function sovereignty(props) {
  const t = String(props.TYPE || '').toLowerCase();
  if (t.includes('sovereign') || t === 'country') return 'country';
  if (t.includes('dependency') || t.includes('lease')) return 'dependency';
  if (t.includes('disputed') || t.includes('indeterminate')) return 'disputed';
  return 'other';
}

// Natural Earth's 50m admin-0 layer has no Gibraltar, which is a place people
// actually go. Its admin-1 layer does, so borrow the outline from there.
const BORROW_FROM_ADMIN1 = {
  GIB: {
    iso2: 'GI', iso3: 'GIB', name: 'Gibraltar', longName: 'Gibraltar',
    sovereign: 'GB1', kind: 'dependency',
    continent: 'Europe', region: 'Europe', subregion: 'Southern Europe', pop: 32688,
  },
};

async function buildCountries(admin1Features) {
  const src = JSON.parse(await readFile(await fetchCached('countries', SOURCES.countries), 'utf8'));
  const dash = (v) => (v === '-99' || v === -99 || v === '' ? null : v);

  const features = src.features.map((f) => ({
    type: 'Feature',
    properties: {
      id: f.properties.ADM0_A3,
      iso2: dash(f.properties.ISO_A2_EH),
      iso3: dash(f.properties.ISO_A3_EH),
      name: f.properties.NAME,
      longName: f.properties.NAME_LONG,
      sovereign: f.properties.SOV_A3,
      kind: sovereignty(f.properties),
      continent: f.properties.CONTINENT,
      region: f.properties.REGION_UN,
      subregion: f.properties.SUBREGION,
      pop: f.properties.POP_EST || 0,
      // Share of the globe's surface, in steradians / 4pi. Used for the
      // "percent of the world" stat, which is otherwise a units nightmare.
      area: Number(geoArea(f.geometry).toFixed(8)),
      centroid: geoCentroid(f).map((n) => Number(n.toFixed(3))),
      bounds: geoBounds(f).flat().map((n) => Number(n.toFixed(3))),
    },
    geometry: f.geometry,
  }));

  const ids = new Set();
  for (const f of features) {
    if (ids.has(f.properties.id)) throw new Error(`duplicate country id ${f.properties.id}`);
    ids.add(f.properties.id);
  }

  for (const [id, meta] of Object.entries(BORROW_FROM_ADMIN1)) {
    if (ids.has(id)) continue;
    const parts = admin1Features.filter((f) => f.properties.adm0 === id);
    if (!parts.length) throw new Error(`no admin-1 geometry to borrow for ${id}`);
    const geometry = {
      type: 'MultiPolygon',
      coordinates: parts.flatMap((f) =>
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      ),
    };
    features.push({
      type: 'Feature',
      properties: {
        id, ...meta,
        area: Number(geoArea(geometry).toFixed(8)),
        centroid: geoCentroid(geometry).map((n) => Number(n.toFixed(3))),
        bounds: geoBounds(geometry).flat().map((n) => Number(n.toFixed(3))),
      },
      geometry,
    });
    ids.add(id);
    console.log(`borrowed   ${id} outline from admin-1`);
  }

  const topo = await repairWinding('countries',
    await toTopology('countries', {type: 'FeatureCollection', features}, {retain: 0.35}));
  await writeDataFile('countries', 'TM_COUNTRIES', topo);
  console.log(`countries  ${features.length} features`);
  return features;
}

async function reduceAdmin1() {
  const src = JSON.parse(await readFile(await fetchCached('admin1', SOURCES.admin1), 'utf8'));

  // iso_3166_2 is the id worth exposing, but Natural Earth reuses it across a
  // handful of split features; fall back to the guaranteed-unique adm1_code.
  const isoCount = new Map();
  for (const f of src.features) {
    const iso = f.properties.iso_3166_2;
    if (iso) isoCount.set(iso, (isoCount.get(iso) || 0) + 1);
  }

  const features = src.features.map((f) => {
    const p = f.properties;
    const iso = p.iso_3166_2 && p.iso_3166_2.length > 2 && isoCount.get(p.iso_3166_2) === 1
      ? p.iso_3166_2
      : p.adm1_code;
    /* Natural Earth's admin-1 layer is finer than how people think. The UK is
       232 councils, not four home nations; Italy is 110 provinces, not 20
       regions. `geonunit` names the constituent country where there is one and
       `region` the statistical grouping, so a country's list can be shown in
       chunks people recognise and marked a chunk at a time. */
    const group = p.geonunit && p.geonunit !== p.admin ? p.geonunit : (p.region || null);
    return {
      type: 'Feature',
      properties: {
        id: iso,
        name: p.name_en || p.name || p.adm1_code,
        adm0: p.adm0_a3,
        kind: p.type_en || 'Region',
        group: group || undefined,
      },
      geometry: f.geometry,
    };
  }).filter((f) => f.geometry);

  const ids = new Set();
  for (const f of features) {
    if (ids.has(f.properties.id)) throw new Error(`duplicate region id ${f.properties.id}`);
    ids.add(f.properties.id);
  }

  return features;
}

async function writeAdmin1(features) {
  const topo = await repairWinding('admin1',
    await toTopology('admin1', {type: 'FeatureCollection', features}, {retain: 0.08}));
  await writeDataFile('admin1', 'TM_ADMIN1', topo);
  console.log(`admin1     ${features.length} features`);
}

// Every city gets resolved to the region that actually contains it, at build
// time, so adding a city in the app can light up its region and country with no
// geometry work in the browser.
function assignRegions(cities, regions) {
  const boxes = regions.map((f) => {
    const [[w, s], [e, n]] = geoBounds(f);
    return {w, s, e, n, f};
  });
  // Coarse 10-degree grid over the bounding boxes: brute force over 4.5k
  // polygons per city is minutes; this is seconds.
  const grid = new Map();
  const key = (x, y) => `${x}:${y}`;
  for (const b of boxes) {
    const crosses = b.w > b.e; // antimeridian
    const x0 = Math.floor((crosses ? -180 : b.w) / 10);
    const x1 = Math.floor((crosses ? 180 : b.e) / 10);
    for (let x = x0; x <= x1; x++) {
      for (let y = Math.floor(b.s / 10); y <= Math.floor(b.n / 10); y++) {
        const k = key(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
    }
  }

  let hit = 0;
  for (const c of cities) {
    const [lon, lat] = c.loc;
    const bucket = grid.get(key(Math.floor(lon / 10), Math.floor(lat / 10))) || [];
    for (const b of bucket) {
      if (lat < b.s || lat > b.n) continue;
      if (geoContains(b.f, [lon, lat])) {
        c.region = b.f.properties.id;
        c.country = b.f.properties.adm0;
        hit++;
        break;
      }
    }
  }
  console.log(`cities     ${hit}/${cities.length} resolved to a region`);
}

async function buildCities(regions, countries) {
  const {default: all} = await import('all-the-cities');
  // Everything over 15k, plus every national and first-order capital however
  // small, plus mid-size county seats. Anything smaller, you drop a pin by hand.
  const keep = all.filter(
    (c) =>
      c.population >= 15000 ||
      c.featureCode === 'PPLC' ||
      c.featureCode === 'PPLA' ||
      (c.featureCode === 'PPLA2' && c.population >= 5000)
  );

  const byIso2 = isoIndex(countries.map((f) => f.properties));

  const cities = keep.map((c) => ({
    id: c.cityId,
    name: c.name,
    cc: c.country,
    pop: c.population,
    loc: c.loc.coordinates.map((n) => Number(n.toFixed(4))),
    country: byIso2.get(c.country) || null,
    region: null,
    capital: c.featureCode === 'PPLC' || undefined,
  }));

  assignRegions(cities, regions);

  // Columnar, because 28k objects of identical shape is a lot of repeated keys.
  const payload = {
    format: 'columns',
    columns: ['id', 'name', 'cc', 'pop', 'lon', 'lat', 'country', 'region', 'capital'],
    rows: cities.map((c) => [
      c.id, c.name, c.cc, c.pop, c.loc[0], c.loc[1], c.country, c.region, c.capital ? 1 : 0,
    ]),
  };
  await writeDataFile('cities', 'TM_CITIES', payload);
  console.log(`cities     ${cities.length} kept`);
}

await mkdir(cache, {recursive: true});
await mkdir(out, {recursive: true});
const regions = await reduceAdmin1();
const countries = await buildCountries(regions);
await writeAdmin1(regions);
await buildCities(regions, countries);

for (const f of ['countries.js', 'admin1.js', 'cities.js']) {
  const {size} = await stat(path.join(out, f));
  console.log(`  ${f.padEnd(22)} ${(size / 1024).toFixed(0)} KB`);
}
