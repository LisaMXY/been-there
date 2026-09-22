// Sanity checks on the generated data files. Run after `npm run data`.
//
//   cd tools && npm run check

import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {feature} from 'topojson-client';
import {geoArea} from 'd3-geo';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
globalThis.window = {};

async function load(name) {
  // eslint-disable-next-line no-eval
  eval(await readFile(path.join(out, `${name}.js`), 'utf8'));
  return globalThis.window;
}

const fails = [];
const check = (ok, message) => { if (!ok) fails.push(message); };

await load('countries');
await load('admin1');
await load('cities');
const w = globalThis.window;

const countries = feature(w.TM_COUNTRIES, w.TM_COUNTRIES.objects.countries).features;
const regions = feature(w.TM_ADMIN1, w.TM_ADMIN1.objects.admin1).features;
const cities = w.TM_CITIES;

check(countries.length > 240, `only ${countries.length} countries`);
check(regions.length > 4500, `only ${regions.length} regions`);
check(cities.rows.length > 25000, `only ${cities.rows.length} cities`);

// The one that actually broke: a ring wound the wrong way covers the globe.
const HALF = 2 * Math.PI;
for (const f of countries.concat(regions)) {
  if (geoArea(f) > HALF) fails.push(`${f.properties.id} (${f.properties.name}) covers the whole sphere`);
}

const ids = new Set();
for (const f of countries.concat(regions)) {
  if (ids.has(f.properties.id)) fails.push(`duplicate id ${f.properties.id}`);
  ids.add(f.properties.id);
}

const countryIds = new Set(countries.map((f) => f.properties.id));
for (const f of countries) {
  check(f.properties.centroid && f.properties.bounds, `${f.properties.id} has no centroid/bounds`);
  check(typeof f.properties.area === 'number', `${f.properties.id} has no area`);
}

const orphanRegions = new Set(
  regions.filter((f) => !countryIds.has(f.properties.adm0)).map((f) => f.properties.adm0)
);
// Uninhabited islets and military base areas that Natural Earth maps at admin-1
// but not admin-0. The app ignores them; anything else here is a real problem.
const KNOWN_ORPHANS = ['ESB', 'WSB', 'USG', 'KAB', 'UMI', 'CSI', 'PGA', 'CLP'];
for (const o of orphanRegions) {
  if (!KNOWN_ORPHANS.includes(o)) fails.push(`regions reference unknown country ${o}`);
}

const col = Object.fromEntries(cities.columns.map((c, i) => [c, i]));
const withRegion = cities.rows.filter((r) => r[col.region]).length;
check(withRegion / cities.rows.length > 0.95, `only ${withRegion} cities resolved to a region`);
const regionIds = new Set(regions.map((f) => f.properties.id));
const badRefs = cities.rows.filter((r) => r[col.region] && !regionIds.has(r[col.region])).length;
check(badRefs === 0, `${badRefs} cities point at a region that does not exist`);

// Catches the ISO-2 collision that once filed Darwin under Ashmore & Cartier.
const regionOwner = Object.fromEntries(regions.map((f) => [f.properties.id, f.properties.adm0]));
const mismatched = cities.rows.filter(
  (r) => r[col.region] && r[col.country] && regionOwner[r[col.region]] !== r[col.country]
);
check(mismatched.length === 0,
  `${mismatched.length} cities disagree with their region about which country they are in`);
const iso2Owner = Object.fromEntries(countries.filter((f) => f.properties.iso2)
  .map((f) => [f.properties.iso2, f.properties.id]));
const stray = cities.rows.filter((r) => !r[col.region] && r[col.country] &&
  iso2Owner[r[col.cc]] && !countryIds.has(r[col.country]));
check(stray.length === 0, `${stray.length} region-less cities point at an unknown country`);

if (fails.length) {
  console.error('FAILED\n  ' + fails.slice(0, 20).join('\n  '));
  process.exit(1);
}
console.log(`ok  ${countries.length} countries · ${regions.length} regions · ${cities.rows.length} cities`);
