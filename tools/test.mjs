// Drives the real page in a real browser and checks the things that have
// actually broken before. Needs a Chromium once:
//
//   cd tools && npm install && npx playwright install chromium && npm test
//
// Set CHROME_PATH to use a Chromium already on the machine instead.

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream'});
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// CHROME_PATH points at a Chromium that is already on the machine, for a
// container or CI image that ships one instead of letting Playwright download.
const browser = await chromium.launch(process.env.CHROME_PATH
  ? {executablePath: process.env.CHROME_PATH, args: ['--no-sandbox']}
  : {});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const noise = [];
// data/travels.js is gitignored and absent from a clean checkout on purpose;
// the app asks for it, does not get it, and carries on. Everything else counts.
const expected = /travels\.js/;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const where = (m.location() && m.location().url) || '';
  if (expected.test(where) || expected.test(m.text())) return;
  noise.push('console: ' + m.text() + (where ? '  <- ' + where : ''));
});
page.on('pageerror', (e) => noise.push('pageerror: ' + e.message));
const offsite = [];
page.on('request', (r) => { if (!r.url().startsWith(base)) offsite.push(r.url()); });

let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log('  ok    ' + label);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + label + '  ::  ' + String(err.message).split('\n')[0]);
  }
}
const stats = () => page.evaluate(() => window.Store.stats());

/* The tests bring their own trips rather than leaning on whatever happens to be
   in data/travels.js, which in this repository is nothing at all. Two years far
   enough apart to make a gap, and pins spread far enough to make the compass
   points in the summary mean something. */
const FIXTURE = {
  countries: {
    JPN: {status: 'visited', first: 2016, last: 2019},
    GBR: {status: 'visited', first: 2017, last: 2017},
    NOR: {status: 'lived', first: 2017, last: 2017},
    ISL: {status: 'visited', first: 2017, last: 2017},
    AUS: {status: 'visited', first: 2019, last: 2019},
    PER: {status: 'wishlist'},
  },
  regions: {'JP-01': {status: 'visited'}},
  cities: {
    a: {status: 'visited', name: 'Tokyo', cc: 'JP', lon: 139.69, lat: 35.69, country: 'JPN', region: 'JP-13', first: 2016},
    b: {status: 'visited', name: 'Kyoto', cc: 'JP', lon: 135.75, lat: 35.02, country: 'JPN', region: 'JP-26', first: 2016},
    c: {status: 'visited', name: 'Sapporo', cc: 'JP', lon: 141.35, lat: 43.06, country: 'JPN', region: 'JP-01', first: 2019},
    d: {status: 'visited', name: 'London', cc: 'GB', lon: -0.13, lat: 51.51, country: 'GBR', region: 'GB-LND', first: 2017},
    e: {status: 'lived', name: 'Oslo', cc: 'NO', lon: 10.75, lat: 59.91, country: 'NOR', region: 'NO-03', first: 2017},
    f: {status: 'visited', name: 'Reykjavik', cc: 'IS', lon: -21.94, lat: 64.14, country: 'ISL', region: 'IS-1', first: 2017},
    g: {status: 'visited', name: 'Melbourne', cc: 'AU', lon: 144.96, lat: -37.81, country: 'AUS', region: 'AU-VIC', first: 2019},
  },
};
const loadFixture = () => page.evaluate((f) => window.Store.fromJSON({data: f}, 'replace'), FIXTURE);
const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

await page.goto(base + '/index.html', {waitUntil: 'networkidle'});
await page.waitForTimeout(2600);

console.log('\ndata');
await check('a fresh browser starts empty and usable', async () => {
  const s = await stats();
  if (s.countries || s.cities) throw new Error('not empty: ' + JSON.stringify(s));
  if (!(await page.$('.panel .empty-state'))) throw new Error('no empty state in the panel');
});
await check('this copy publishes nobody\'s travels', async () => {
  const res = await page.request.get(base + '/data/travels.js');
  if (res.ok()) throw new Error('a travel history is bundled with this checkout');
  await page.click('#menu-btn');
  await page.waitForTimeout(200);
  await page.click('[data-act=seed]');
  await page.waitForTimeout(900);
  const toast = await page.$('.toast');
  const text = toast ? await toast.textContent() : '';
  if (!/No travel history/.test(text)) throw new Error('menu said: ' + text);
  if ((await stats()).countries) throw new Error('something got loaded anyway');
});
await check('a history loads and adds up', async () => {
  await loadFixture();
  await page.waitForTimeout(400);
  const s = await stats();
  eq(s.countries, 5, 'countries');   // Peru is a wishlist, so it does not count
  eq(s.cities, 7, 'cities');
  eq(await page.evaluate(() => window.Store.effective().countries.NOR), 'lived', 'Norway');
});
await check('nothing is fetched from outside the page', () => {
  if (offsite.length) throw new Error(offsite.join(', '));
});
await check('a file with no readable place is rejected', async () => {
  const before = (await stats()).countries;
  const msg = await page.evaluate(() => {
    try { window.Store.fromJSON({data: {cities: {a: {status: 'visited', name: 'X'}}}}, 'replace'); return 'accepted'; }
    catch (e) { return e.message; }
  });
  if (msg === 'accepted') throw new Error('junk import accepted');
  eq((await stats()).countries, before, 'state after a rejected import');
});
await check('a half-valid file keeps only what is usable', async () => {
  await page.evaluate(() => window.Store.fromJSON({data: {
    countries: {FRA: {status: 'visited', first: 2017}, ZZ: {status: 'made-up'}},
    cities: {ok: {status: 'visited', name: 'Nice', lon: 7.27, lat: 43.7},
             bad: {status: 'visited', name: 'Nowhere', lon: 999, lat: 999}},
  }}, 'replace'));
  await page.waitForTimeout(300);
  const s = await stats();
  eq(s.countries, 1, 'countries kept');
  eq(s.cities, 1, 'cities kept');
  await loadFixture();
  await page.waitForTimeout(300);
});
await check('export and import round-trip', async () => {
  const before = await page.evaluate(() => JSON.stringify(window.Store.toJSON().data));
  const was = await stats();
  await page.evaluate(() => window.Store.reset());
  await page.waitForTimeout(200);
  eq((await stats()).countries, 0, 'countries after reset');
  await page.evaluate((j) => window.Store.fromJSON({data: JSON.parse(j)}, 'replace'), before);
  await page.waitForTimeout(200);
  eq((await stats()).countries, was.countries, 'countries after import');
  eq((await stats()).cities, was.cities, 'cities after import');
});
await check('a reload keeps everything', async () => {
  const was = await stats();
  await page.reload({waitUntil: 'networkidle'});
  await page.waitForTimeout(2200);
  eq((await stats()).cities, was.cities, 'cities after reload');
});

console.log('\nthe map');
await check('a country with region detail keeps its colour at world zoom', async () => {
  await loadFixture();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.Store.set('country', 'JPN', 'visited');
    const m = window.BeenThere.map;
    m.reset(); m.focus = null; m.render();
  });
  await page.waitForTimeout(400);
  const painted = await page.evaluate(() => {
    const m = window.BeenThere.map;
    const p = m.projection([131.0, 32.5]);   // inland Kyushu, clear of any pin
    const d = m.ctx.getImageData(Math.round(p[0] * m.dpr), Math.round(p[1] * m.dpr), 1, 1).data;
    return ['#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''), m.colors.visited];
  });
  eq(painted[0], painted[1], 'Japan at world zoom');
});
await check('zooming in breaks countries into regions', async () => {
  await page.evaluate(() => {
    const m = window.BeenThere.map;
    m.fitBounds(window.Atlas.index.country.JPN.bounds, 22);
    m.render();
  });
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => Object.keys(window.BeenThere.map.drilledSet()).length);
  if (!n) throw new Error('nothing drilled');
});
await check('clicking the map opens what is under the cursor', async () => {
  await page.evaluate(() => { window.BeenThere.map.reset(); window.BeenThere.select(null, false); });
  await page.waitForTimeout(400);
  const box = await page.$eval('#map', (el) => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y}; });
  const pt = await page.evaluate(() => {
    const m = window.BeenThere.map;
    const p = m.projection([-55, -10]);       // middle of Brazil
    return [p[0] * m.k + m.tx, p[1] * m.k + m.ty];
  });
  await page.mouse.click(box.x + pt[0], box.y + pt[1]);
  await page.waitForTimeout(500);
  const title = await page.textContent('.panel h2');
  if (!/Brazil/.test(title)) throw new Error('opened ' + title);
});
await check('a status button writes through', async () => {
  await page.click('.statuses button:has-text("Want to go")');
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => window.Store.statusOf('country', 'BRA')), 'wishlist', 'Brazil');
  await page.click('.statuses button:has-text("Want to go")');
  await page.waitForTimeout(200);
});

console.log('\nregions');
await check('search finds the country before its lookalikes', async () => {
  await page.fill('#q', 'united stat');
  await page.waitForTimeout(800);
  const first = await page.textContent('#results li .r-name');
  eq(first, 'United States of America', 'first result');
  await page.fill('#q', 'united king');
  await page.waitForTimeout(800);
  await page.click('#results li');
  await page.waitForTimeout(1100);
});
await check('the UK lists as four home nations, not 232 councils', async () => {
  const groups = await page.$$eval('.rows li.group-row .name', (n) => n.map((x) => x.textContent));
  eq(groups.join(','), 'England,Northern Ireland,Scotland,Wales', 'UK groups');
});
await check('a whole group marks and unmarks in one go', async () => {
  const before = (await stats()).regions;
  await page.click('.rows li.group-row button.kill >> nth=3');
  await page.waitForTimeout(400);
  eq((await stats()).regions - before, 22, 'Welsh regions added');
  await page.click('.rows li.group-row button.kill >> nth=3');
  await page.waitForTimeout(400);
  eq((await stats()).regions, before, 'regions after clearing the group');
});
await check('a single region cycles round and back', async () => {
  await page.click('.rows li.group-row button.cycle >> nth=3');
  await page.waitForTimeout(300);
  const before = (await stats()).regions;
  await page.click('.rows li.nested button.cycle >> nth=0');
  await page.waitForTimeout(300);
  eq((await stats()).regions, before + 1, 'after one click');
  for (let i = 0; i < 4; i++) await page.click('.rows li.nested button.cycle >> nth=0');
  await page.waitForTimeout(300);
  eq((await stats()).regions, before, 'after a full cycle');
});
await check('adding a city lights up its region and country', async () => {
  await page.evaluate(() => window.BeenThere.select({kind: 'country', id: 'USA'}, false));
  await page.waitForTimeout(400);
  await page.click('button:has-text("Add a city…")');
  await page.waitForTimeout(2500);
  await page.fill('#sheet input[type=search]', 'chicago');
  await page.waitForTimeout(500);
  await page.click('#sheet .rows button.cycle >> nth=0');
  await page.waitForTimeout(700);
  const out = await page.evaluate(() => {
    const eff = window.Store.effective();
    return [eff.regions['US-IL'], eff.countries.USA];
  });
  eq(out[0], 'visited', 'Illinois');
  eq(out[1], 'visited', 'the USA');
});

console.log('\nthe summary');
await check('the summary renders its charts and its table', async () => {
  await loadFixture();
  await page.waitForTimeout(400);
  await page.click('#sum-toggle');
  await page.waitForTimeout(800);
  eq((await page.$$('.hero-tile')).length, 6, 'hero tiles');
  eq((await page.$$('.chart')).length, 3, 'charts');
  if (!(await page.$$('.ledger tbody tr')).length) throw new Error('no table rows');
  if ((await page.$$('.fact')).length < 7) throw new Error('facts missing');
});
await check('the distance travelled is computed and stable', async () => {
  const read = async () => {
    const t = await page.textContent('.far-figure b');
    return Number(t.replace(/[^0-9]/g, ''));
  };
  const km = await read();
  if (!km) throw new Error('no distance shown');
  // Ordering is what makes this number mean anything, so it must not wobble.
  await page.click('#sum-toggle');
  await page.waitForTimeout(300);
  await page.click('#sum-toggle');
  await page.waitForTimeout(700);
  eq(await read(), km, 'distance on a re-render');
  const lines = await page.$$eval('.far-list li', (n) => n.map((x) => x.textContent));
  if (!lines.some((l) => /equator/.test(l))) throw new Error('no yardstick: ' + lines);
  if (!/floor, not a total/.test(await page.textContent('.far-note'))) {
    throw new Error('the estimate does not say what it is');
  }
});
await check('neighbours are found, and never somewhere already visited', async () => {
  const rows = await page.$$eval('.nextdoor li', (n) => n.map((x) => ({
    n: Number(x.querySelector('.nd-count').textContent),
    name: x.querySelector('b').textContent,
    from: x.querySelector('.nd-from').textContent,
  })));
  if (!rows.length) throw new Error('no neighbours found');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].n > rows[i - 1].n) throw new Error('not ordered by how surrounded they are');
  }
  const leaked = await page.evaluate((names) => {
    const eff = window.Store.effective();
    const byName = {};
    Object.keys(window.Atlas.index.country).forEach((k) => {
      byName[window.Atlas.index.country[k].name] = k;
    });
    return names.filter((nm) => byName[nm] && window.Store.rank(eff.countries[byName[nm]]) >= 3);
  }, rows.map((r) => r.name));
  if (leaked.length) throw new Error('suggests somewhere already visited: ' + leaked.join(', '));
  if (!/borders /.test(rows[0].from)) throw new Error('no neighbour names shown');
});
await check('a table row jumps to that country', async () => {
  await page.click('.ledger tbody tr >> nth=0');
  await page.waitForTimeout(800);
  if (!(await page.textContent('.panel h2'))) throw new Error('nothing opened');
});

console.log('\nbackups and installing');
await check('an untouched copy is not nagged on day one', async () => {
  await page.evaluate(() => window.Store.reset());
  await loadFixture();
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.Store.backupState());
  if (b.overdue) throw new Error('nagged immediately: ' + JSON.stringify(b));
});
await check('a week-old copy with no backup is flagged', async () => {
  await page.evaluate(() => {
    const old = new Date(Date.now() - 9 * 86400000).toISOString();
    window.Store.setSetting('firstSaved', old);
  });
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.Store.backupState());
  if (!b.overdue) throw new Error(JSON.stringify(b));
  const flagged = await page.evaluate(() => document.getElementById('menu-btn').classList.contains('flagged'));
  if (!flagged) throw new Error('no dot on the menu button');
  await page.click('#menu-btn');
  await page.waitForTimeout(200);
  const note = await page.textContent('#storage-note');
  if (!/never backed up/.test(note)) throw new Error('note says: ' + note);
  await page.click('#menu-btn');
});
await check('exporting clears the flag', async () => {
  await page.evaluate(() => window.Store.markExported());
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.Store.backupState());
  if (b.overdue) throw new Error(JSON.stringify(b));
  const flagged = await page.evaluate(() => document.getElementById('menu-btn').classList.contains('flagged'));
  if (flagged) throw new Error('dot still there');
});
await check('a backup older than a month is flagged again', async () => {
  await page.evaluate(() => {
    window.Store.setSetting('lastExport', new Date(Date.now() - 40 * 86400000).toISOString());
  });
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.Store.backupState());
  if (!b.overdue || b.days !== 40) throw new Error(JSON.stringify(b));
  await page.evaluate(() => window.Store.markExported());
  await page.waitForTimeout(300);
});
await check('the manifest is installable', async () => {
  const href = await page.getAttribute('link[rel=manifest]', 'href');
  const res = await page.request.get(base + '/' + href);
  if (!res.ok()) throw new Error('manifest ' + res.status());
  const m = await res.json();
  for (const key of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!m[key]) throw new Error('manifest has no ' + key);
  }
  if (m.display !== 'standalone') throw new Error('display is ' + m.display);
  if (!m.icons.some((i) => i.purpose === 'maskable')) throw new Error('no maskable icon');
  for (const icon of m.icons) {
    const r = await page.request.get(base + '/' + icon.src);
    if (!r.ok()) throw new Error(icon.src + ' -> ' + r.status());
  }
  const apple = await page.getAttribute('link[rel=apple-touch-icon]', 'href');
  if (!(await page.request.get(base + '/' + apple)).ok()) throw new Error('no apple-touch-icon');
});
await check('the service worker registers and serves the page offline', async () => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 820}});
  const p4 = await ctx.newPage();
  await p4.goto(base + '/index.html', {waitUntil: 'networkidle'});
  await p4.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {timeout: 20000});
  await p4.waitForTimeout(1500);
  // Put something in, so the check covers the data surviving as well as the page.
  await p4.evaluate(() => window.Store.set('country', 'JPN', 'visited'));
  await p4.waitForTimeout(500);
  await ctx.setOffline(true);
  await p4.reload({waitUntil: 'load'});
  await p4.waitForTimeout(2500);
  const title = await p4.title();
  const out = await p4.evaluate(() => [
    window.Store ? window.Store.stats().countries : -1,
    window.Atlas ? window.Atlas.countries().length : 0,
  ]);
  await ctx.setOffline(false);
  await ctx.close();
  if (!/Been There/.test(title)) throw new Error('offline page title: ' + title);
  if (out[1] < 200) throw new Error('offline reload did not get the map: ' + out[1]);
  if (out[0] !== 1) throw new Error('offline reload lost the data: ' + out[0]);
});

console.log('\nthe replay');
await check('it winds the map back and fills it in again', async () => {
  await loadFixture();
  await page.waitForTimeout(400);
  await page.click('#replay-toggle');
  await page.waitForTimeout(500);
  if (await page.getAttribute('#replay', 'hidden') !== null) throw new Error('the bar did not open');

  const years = await page.evaluate(() => window.Store.yearsCovered());
  if (years.length < 2) throw new Error('fixture has too few years');

  // Walking forward can only ever add countries, never take one away.
  let last = -1;
  for (let i = 0; i < years.length; i++) {
    await page.evaluate((idx) => {
      const r = document.getElementById('replay-range');
      r.value = String(idx);
      r.dispatchEvent(new Event('input', {bubbles: true}));
    }, i);
    await page.waitForTimeout(250);
    const n = await page.evaluate(() => {
      const as = window.Store.effectiveAsOf(window.BeenThere.map.asOf);
      return Object.keys(as.countries).filter((k) => window.Store.rank(as.countries[k]) >= 3).length;
    });
    if (n < last) throw new Error(`countries went down at ${years[i]}: ${last} -> ${n}`);
    last = n;
  }
});
await check('the last year matches the live map, bar what has no year', async () => {
  const out = await page.evaluate(() => {
    const as = window.Store.effectiveAsOf(window.BeenThere.map.asOf);
    const all = window.Store.effective();
    const raw = window.Store.raw();
    // A want-to-go country has no year because it has not happened; the replay
    // is of what did. Anything dated must be there by the last frame.
    const dated = Object.keys(all.countries).filter((k) => {
      const e = raw.countries[k];
      return e && e.first;
    });
    return {
      missing: dated.filter((k) => !as.countries[k]),
      extra: Object.keys(as.countries).filter((k) => !all.countries[k]),
      undated: Object.keys(all.countries).length - dated.length,
    };
  });
  if (out.missing.length) throw new Error('replay ends short of: ' + out.missing.join(', '));
  if (out.extra.length) throw new Error('replay invents: ' + out.extra.join(', '));
  if (!out.undated) throw new Error('fixture should include something undated to prove the point');
});
await check('the header and legend follow the clock', async () => {
  const years = await page.evaluate(() => window.Store.yearsCovered());
  await page.evaluate(() => {
    const r = document.getElementById('replay-range');
    r.value = '0';
    r.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.tile')]
      .find((t) => /COUNTRIES/i.test(t.textContent));
    const as = window.Store.effectiveAsOf(window.BeenThere.map.asOf);
    let n = 0;
    for (const id in as.countries) if (window.Store.rank(as.countries[id]) >= 3) n++;
    return {header: Number(tile.querySelector('b').textContent), expected: n};
  });
  eq(seen.header, seen.expected, 'the header while wound back to ' + years[0]);
});
await check('pausing holds, and closing puts it all back', async () => {
  await page.click('#replay-play');                 // play from the start
  await page.waitForTimeout(1900);
  await page.click('#replay-play');                 // pause
  const held = await page.textContent('#replay-year');
  await page.waitForTimeout(1500);
  eq(await page.textContent('#replay-year'), held, 'the year while paused');

  await page.click('#replay-close');
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.BeenThere.map.asOf) !== null) throw new Error('clock left wound back');
  const n = await page.evaluate(() => window.Store.stats().countries);
  const header = await page.evaluate(() => Number([...document.querySelectorAll('.tile')]
    .find((t) => /COUNTRIES/i.test(t.textContent)).querySelector('b').textContent));
  eq(header, n, 'the header after closing');
});
await check('editing while wound back stands the replay down', async () => {
  await page.click('#replay-toggle');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.Store.set('country', 'BRA', 'visited'));
  await page.waitForTimeout(500);
  if (await page.getAttribute('#replay', 'hidden') === null) {
    throw new Error('the replay kept running over an edit');
  }
  await page.evaluate(() => window.Store.set('country', 'BRA', null));
  await page.waitForTimeout(300);
});

console.log('\nthe roulette');
await check('it opens with filters and a pool', async () => {
  await loadFixture();
  await page.waitForTimeout(400);
  await page.click('#roulette');
  await page.waitForTimeout(4000);          // the city list loads on first use
  eq(await page.textContent('#sheet-title'), 'Where next?', 'sheet title');
  const chips = await page.$$('.chip-toggle');
  if (chips.length !== 9) throw new Error('filters: ' + chips.length);
  const n = Number((await page.textContent('.roul-count')).replace(/[^0-9]/g, ''));
  if (n < 1000) throw new Error('pool is only ' + n);
});
await check('filters only ever narrow the pool', async () => {
  const count = async () => Number((await page.textContent('.roul-count')).replace(/[^0-9]/g, ''));
  let last = await count();
  for (const chip of ['Coast', 'Tropical', 'Small towns']) {
    await page.click(`.chip-toggle:has-text("${chip}")`);
    await page.waitForTimeout(300);
    const now = await count();
    if (now > last) throw new Error(`adding ${chip} grew the pool ${last} -> ${now}`);
    last = now;
  }
  if (!last) throw new Error('nothing left to spin');
});
await check('every spin honours the filters', async () => {
  for (let i = 0; i < 6; i++) {
    await page.click('.sheet-actions .btn.primary');
    await page.waitForTimeout(1200);
    const tags = await page.$$eval('.slot .chip-tag', (n) => n.map((x) => x.textContent));
    for (const want of ['Coast', 'Tropical', 'Small towns']) {
      if (!tags.includes(want)) {
        throw new Error(await page.textContent('.result h3') + ' is not ' + want + ': ' + tags);
      }
    }
  }
});
await check('it never suggests a country you have been to', async () => {
  // The fixture has Japan, Norway, Iceland, Great Britain and Australia in it.
  for (const chip of ['Coast', 'Tropical', 'Small towns']) {
    await page.click(`.chip-toggle:has-text("${chip}")`);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  const been = await page.evaluate(() => {
    const eff = window.Store.effective();
    return Object.keys(eff.countries).filter((k) => window.Store.rank(eff.countries[k]) >= 3);
  });
  for (let i = 0; i < 10; i++) {
    await page.click('.sheet-actions .btn.primary');
    await page.waitForTimeout(1100);
    const where = await page.textContent('.result .eyebrow');
    const sub = await page.textContent('.result-sub');
    if (!/never been to/.test(sub)) throw new Error('suggested somewhere already visited: ' + where);
  }
  if (!been.length) throw new Error('fixture had no visited countries to exclude');
});
await check('the next-door filter narrows the roulette', async () => {
  for (const chip of ['Coast', 'Tropical', 'Small towns']) {
    const on = await page.getAttribute(`.chip-toggle:has-text("${chip}")`, 'aria-pressed');
    if (on === 'true') { await page.click(`.chip-toggle:has-text("${chip}")`); await page.waitForTimeout(200); }
  }
  await page.waitForTimeout(300);
  const count = async () => Number((await page.textContent('.roul-count')).replace(/[^0-9]/g, ''));
  const before = await count();
  await page.click('label[for=roul-door]');
  await page.waitForTimeout(400);
  const after = await count();
  if (after >= before) throw new Error(`next-door did not narrow: ${before} -> ${after}`);
  if (!after) throw new Error('next-door left nothing');
  await page.click('label[for=roul-door]');
  await page.waitForTimeout(300);
});
await check('a suggestion can be added to want to go', async () => {
  // Changing a filter clears the slot, so spin again before reaching for it.
  await page.click('.sheet-actions .btn.primary');
  await page.waitForTimeout(1300);
  const before = await page.evaluate(() => Object.keys(window.Store.cities()).length);
  await page.click('.result-actions .btn:not([disabled])');
  await page.waitForTimeout(600);
  const added = await page.evaluate(() => {
    const all = Object.values(window.Store.cities());
    return all.filter((c) => c.status === 'wishlist').length;
  });
  if (!added) throw new Error('nothing was added');
  const after = await page.evaluate(() => Object.keys(window.Store.cities()).length);
  if (after !== before + 1) throw new Error('added ' + (after - before));
  // and the country it is in now reads as somewhere you want to go
  const wish = await page.evaluate(() => {
    const c = Object.values(window.Store.cities()).find((x) => x.status === 'wishlist');
    return window.Store.effective().countries[c.country];
  });
  eq(wish, 'wishlist', 'the country');
  await page.click('.sheet-actions .btn:has-text("Close")');
  await page.waitForTimeout(400);
});

console.log('\non a phone');
await check('the map gets the whole stage and the panel becomes a sheet', async () => {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const p5 = await ctx.newPage();
  await p5.goto(base + '/index.html', {waitUntil: 'networkidle'});
  await p5.waitForTimeout(2400);
  await p5.evaluate((f) => window.Store.fromJSON({data: f}, 'replace'), FIXTURE);
  await p5.waitForTimeout(500);

  const share = await p5.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const map = document.querySelector('.map-wrap').getBoundingClientRect();
    return map.height / stage.height;
  });
  if (share < 0.95) throw new Error('map only gets ' + Math.round(share * 100) + '% of the stage');
  if (await p5.evaluate(() => document.getElementById('panel').classList.contains('open'))) {
    throw new Error('sheet is up with nothing selected');
  }

  await p5.evaluate(() => window.BeenThere.select({kind: 'country', id: 'JPN'}, true));
  await p5.waitForTimeout(700);

  // The whole point: what you selected has to be visible, not behind the sheet.
  const view = await p5.evaluate(() => {
    const m = window.BeenThere.map;
    const sheet = document.getElementById('panel').getBoundingClientRect();
    const stage = document.querySelector('.map-wrap').getBoundingClientRect();
    const pt = m.projection([138, 37]);
    const y = stage.top + pt[1] * m.k + m.ty;
    const ctl = document.querySelector('.map-controls').getBoundingClientRect();
    return {
      open: document.getElementById('panel').classList.contains('open'),
      inset: Math.round(m.inset),
      inBand: y > stage.top + 10 && y < sheet.top - 10,
      controlsClear: ctl.bottom < sheet.top,
      legendHidden: getComputedStyle(document.getElementById('legend')).opacity === '0',
    };
  });
  if (!view.open) throw new Error('sheet did not come up');
  if (!view.inset) throw new Error('map was not told about the sheet');
  if (!view.inBand) throw new Error('the selected country is hidden behind the sheet');
  if (!view.controlsClear) throw new Error('zoom and pin are buried under the sheet');
  if (!view.legendHidden) throw new Error('legend still covering the map');

  await p5.click('.sheet-grab');
  await p5.waitForTimeout(500);
  if (await p5.evaluate(() => document.getElementById('panel').classList.contains('open'))) {
    throw new Error('the handle did not close it');
  }
  if (await p5.evaluate(() => window.BeenThere.map.inset)) throw new Error('inset not released');

  await p5.click('#pin-drop');
  await p5.waitForTimeout(400);
  if (!(await p5.evaluate(() => document.getElementById('map').classList.contains('placing')))) {
    throw new Error('the pin button did not arm');
  }
  await ctx.close();
});

console.log('\nawkward browsers');
await check('a browser that blocks storage still works, and says so', async () => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 820}});
  await ctx.addInitScript(() => {
    const boom = () => { throw new DOMException('QuotaExceededError'); };
    Object.defineProperty(window, 'localStorage', {
      get() { return {getItem: boom, setItem: boom, removeItem: boom, clear: boom}; },
    });
  });
  const p2 = await ctx.newPage();
  const broke = [];
  p2.on('pageerror', (e) => broke.push(e.message));
  await p2.goto(base + '/index.html', {waitUntil: 'networkidle'});
  await p2.waitForTimeout(2600);
  if (broke.length) throw new Error(broke.join('; '));
  if (await p2.evaluate(() => window.Atlas.countries().length) < 200) throw new Error('map never loaded');
  // In memory only, but it must still take an edit rather than fall over.
  await p2.evaluate(() => window.Store.set('country', 'JPN', 'visited'));
  await p2.waitForTimeout(400);
  if (await p2.evaluate(() => window.Store.stats().countries) !== 1) throw new Error('edit did not stick');
  if (await p2.evaluate(() => window.Store.storageWorks())) throw new Error('claimed storage works');
  const note = await p2.textContent('#storage-note');
  if (!/blocking storage/.test(note)) throw new Error('no warning shown: ' + note);
  await ctx.close();
});
await check('nothing overflows sideways at phone width', async () => {
  const ctx = await browser.newContext({viewport: {width: 360, height: 800}, isMobile: true, hasTouch: true});
  const p3 = await ctx.newPage();
  await p3.goto(base + '/index.html', {waitUntil: 'networkidle'});
  await p3.waitForTimeout(2400);
  const map = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p3.click('#sum-toggle');
  await p3.waitForTimeout(800);
  const sum = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await ctx.close();
  eq(map, 0, 'map overflow');
  eq(sum, 0, 'summary overflow');
});

console.log('\nconsole');
await check('the page logged no errors along the way', () => {
  if (noise.length) throw new Error(noise.join(' | '));
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);
