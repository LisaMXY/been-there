// What a place is actually like, derived from Natural Earth's physical geography
// rather than from anyone's opinion. Used by build-data.mjs to tag every city.

import {createWriteStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {geoContains, geoBounds, geoArea} from 'd3-geo';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

/* Each of these is something the data can answer. There is deliberately no
   "charming" or "good nightlife" - a boundary file has no opinion about that,
   and inventing one would make the filters lie. */
export const TRAIT = {
  coast: 1,        // within 30 km of the sea
  island: 2,       // on a named island or island group
  mountain: 4,     // in, or within 45 km of, a named mountain range
  desert: 8,       // in a named desert
  tropical: 16,    // between the tropics
  cold: 32,        // 55 degrees of latitude or higher, either way
  city: 64,        // a million people or more
  town: 128,       // under fifty thousand
  capital: 256,    // a national capital
  satellite: 512,  // a suburb of somewhere much bigger, not a destination
};

/* Great Britain, Honshu and Madagascar are islands, and saying so is useless:
   nobody picks "island" hoping for Newton Abbot. Only landmasses small enough
   to feel like an island count - Iceland and Java are in, Britain is not. */
const ISLAND_MAX_KM2 = 200000;
const EARTH_KM2_PER_STERADIAN = 6371 * 6371;

const KM_PER_DEG = 111.32;

async function fetchCached(name, url) {
  const file = path.join(cache, `${name}.geojson`);
  try {
    await stat(file);
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

/* A degree grid over a pile of vertices, so "how far is the nearest coastline"
   is a handful of cell lookups rather than sixty thousand distance sums. */
function vertexGrid(features, cellDeg) {
  const grid = new Map();
  const key = (x, y) => x + ':' + y;
  const add = (lon, lat) => {
    const k = key(Math.floor(lon / cellDeg), Math.floor(lat / cellDeg));
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(lon, lat);
  };
  const walk = (coords, depth) => {
    if (depth === 0) add(coords[0], coords[1]);
    else coords.forEach((c) => walk(c, depth - 1));
  };
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const depth = {Point: 0, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3}[g.type];
    if (depth === undefined) continue;
    walk(g.coordinates, depth);
  }
  return function within(lon, lat, maxDeg) {
    const reach = Math.ceil(maxDeg / cellDeg);
    const cx = Math.floor(lon / cellDeg);
    const cy = Math.floor(lat / cellDeg);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const limit = maxDeg * maxDeg;
    for (let x = cx - reach; x <= cx + reach; x++) {
      for (let y = cy - reach; y <= cy + reach; y++) {
        const bucket = grid.get(key(x, y));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 2) {
          const dx = (bucket[i] - lon) * cosLat;
          const dy = bucket[i + 1] - lat;
          if (dx * dx + dy * dy <= limit) return true;
        }
      }
    }
    return false;
  };
}

function polyIndex(features) {
  const boxes = features.map((f) => {
    const [[w, s], [e, n]] = geoBounds(f);
    return {w, s, e, n, f};
  });
  return function contains(lon, lat) {
    for (const b of boxes) {
      if (lat < b.s - 0.05 || lat > b.n + 0.05) continue;
      const inLon = b.w <= b.e
        ? lon >= b.w - 0.05 && lon <= b.e + 0.05
        : lon >= b.w - 0.05 || lon <= b.e + 0.05;
      if (!inLon) continue;
      if (geoContains(b.f, [lon, lat])) return true;
    }
    return false;
  };
}

export async function loadTagger() {
  const coast = await fetchCached('ne_50m_coastline', `${NE}/ne_50m_coastline.geojson`);
  const phys = await fetchCached('ne_10m_geography_regions_polys',
    `${NE}/ne_10m_geography_regions_polys.geojson`);

  const pick = (classes) => phys.features.filter(
    (f) => classes.includes(f.properties.FEATURECLA) && f.geometry
  );
  const ranges = pick(['Range/mtn']);
  const islands = pick(['Island', 'Island group']).filter(
    (f) => geoArea(f) * EARTH_KM2_PER_STERADIAN <= ISLAND_MAX_KM2
  );
  const deserts = pick(['Desert']);

  const nearCoast = vertexGrid(coast.features, 1);
  const inRange = polyIndex(ranges);
  const nearRange = vertexGrid(ranges, 1);
  const inIsland = polyIndex(islands);
  const inDesert = polyIndex(deserts);

  const COAST_DEG = 30 / KM_PER_DEG;
  const RANGE_DEG = 45 / KM_PER_DEG;

  return {
    summary: `${ranges.length} ranges · ${deserts.length} deserts · ` +
      `${islands.length} islands under ${ISLAND_MAX_KM2.toLocaleString()} km2`,
    tag(lon, lat, pop, isCapital) {
      let t = 0;
      if (nearCoast(lon, lat, COAST_DEG)) t |= TRAIT.coast;
      if (inIsland(lon, lat)) t |= TRAIT.island;
      if (inRange(lon, lat) || nearRange(lon, lat, RANGE_DEG)) t |= TRAIT.mountain;
      if (inDesert(lon, lat)) t |= TRAIT.desert;
      if (Math.abs(lat) <= 23.5) t |= TRAIT.tropical;
      if (Math.abs(lat) >= 55) t |= TRAIT.cold;
      if (pop >= 1000000) t |= TRAIT.city;
      if (pop < 50000) t |= TRAIT.town;
      if (isCapital) t |= TRAIT.capital;
      return t;
    },
  };
}
