/* Everything the app knows about where you have been.
   One object in localStorage, no server, no account, no network. */
(function () {
  'use strict';

  var KEY = 'beenthere.v1';
  var VERSION = 1;

  // Ordered worst-to-best. Rank matters: a country's colour is the best thing
  // that happened anywhere inside it, so "visited a region" beats "flagged the
  // country as a wishlist".
  var STATUS = [
    {id: 'wishlist', label: 'Want to go', rank: 1, css: '--s-wishlist', verb: 'on the list'},
    {id: 'stopover', label: 'Stopover',   rank: 2, css: '--s-stopover', verb: 'a stopover'},
    {id: 'visited',  label: 'Visited',    rank: 3, css: '--s-visited',  verb: 'visited'},
    {id: 'lived',    label: 'Lived there', rank: 4, css: '--s-lived',   verb: 'lived there'}
  ];
  var BY_ID = {};
  STATUS.forEach(function (s) { BY_ID[s.id] = s; });

  function rank(status) { return status && BY_ID[status] ? BY_ID[status].rank : 0; }

  function blank() {
    return {
      version: VERSION,
      updated: null,
      settings: {countStopovers: false, theme: null, lastExport: null, firstSaved: null},
      countries: {},
      regions: {},
      cities: {}
    };
  }

  var data = blank();
  var listeners = [];
  var storageWorks = true;
  // Set by atlas.js once the geometry is parsed; the store needs it to roll
  // regions and cities up into their country.
  var index = null;

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      storageWorks = false;
      return;
    }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      data = migrate(parsed);
    } catch (err) {
      // A corrupt blob is worth keeping a copy of rather than silently eating.
      try { window.localStorage.setItem(KEY + '.broken', raw); } catch (e2) {}
      data = blank();
    }
  }

  /* Anything coming back off disk - a backup file, a localStorage blob written
     by an older build - is checked field by field. A city with no coordinates
     or a status nobody recognises should be dropped quietly, not left to throw
     halfway through a repaint and take the whole page with it. */
  function migrate(parsed) {
    var fresh = blank();
    if (!parsed || typeof parsed !== 'object') return fresh;

    var str = function (v, max) {
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, max || 400) : undefined;
    };
    var year = function (v) {
      var n = Number(v);
      return isFinite(n) && n >= 1000 && n <= 3000 ? Math.round(n) : undefined;
    };
    var known = function (v) { return BY_ID[v] ? v : undefined; };

    var place = function (raw) {
      if (!raw || typeof raw !== 'object') return null;
      var out = {};
      if (known(raw.status)) out.status = raw.status;
      if (year(raw.first)) out.first = year(raw.first);
      if (year(raw.last)) out.last = year(raw.last);
      if (str(raw.note, 4000)) out.note = str(raw.note, 4000);
      return out.status || out.note || out.first || out.last ? out : null;
    };

    ['countries', 'regions'].forEach(function (k) {
      var src = parsed[k];
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (id) {
        var kept = place(src[id]);
        if (kept && str(id, 40)) fresh[k][id] = kept;
      });
    });

    if (parsed.cities && typeof parsed.cities === 'object') {
      Object.keys(parsed.cities).forEach(function (id) {
        var raw = parsed.cities[id];
        var kept = place(raw);
        // A pin with no name or no coordinates cannot be drawn or listed.
        if (!kept || !kept.status || !str(id, 60) || !str(raw.name, 200)) return;
        var lon = Number(raw.lon);
        var lat = Number(raw.lat);
        if (!isFinite(lon) || !isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        kept.name = str(raw.name, 200);
        kept.lon = lon;
        kept.lat = lat;
        kept.cc = str(raw.cc, 2) || null;
        kept.country = str(raw.country, 10) || null;
        kept.region = str(raw.region, 20) || null;
        if (raw.custom) kept.custom = true;
        fresh.cities[id] = kept;
      });
    }

    if (parsed.settings && typeof parsed.settings === 'object') {
      fresh.settings.countStopovers = !!parsed.settings.countStopovers;
      fresh.settings.theme = parsed.settings.theme === 'dark' || parsed.settings.theme === 'light'
        ? parsed.settings.theme : null;
      fresh.settings.lastExport = str(parsed.settings.lastExport, 40) || null;
      fresh.settings.firstSaved = str(parsed.settings.firstSaved, 40) || null;
    }
    fresh.updated = str(parsed.updated, 40) || null;
    return fresh;
  }

  var saveTimer = null;
  function save() {
    data.updated = new Date().toISOString();
    // When the first place went in, so a backup nudge can wait until there is
    // something worth backing up and a few days have passed.
    if (!data.settings.firstSaved && !isEmpty()) data.settings.firstSaved = data.updated;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
        storageWorks = true;
      } catch (err) {
        storageWorks = false;
        emit('storage-failed');
      }
    }, 120);
  }

  function emit(reason) {
    listeners.forEach(function (fn) { fn(reason); });
  }

  function changed(reason) {
    save();
    emit(reason || 'change');
  }

  function bucket(kind) {
    return kind === 'country' ? data.countries : kind === 'region' ? data.regions : data.cities;
  }

  // ---- reads -------------------------------------------------------------

  function entry(kind, id) {
    return bucket(kind)[id] || null;
  }

  function statusOf(kind, id) {
    var e = bucket(kind)[id];
    return e ? e.status : null;
  }

  /* A country is coloured by the best of: what you set on the country, what you
     set on any of its regions, and what you set on any city inside it. Set
     nothing and it stays blank, which is the point of the map. */
  function effectiveCountry(id) {
    var best = statusOf('country', id) || null;
    if (!index) return best;
    var kids = index.regionsByCountry[id] || [];
    for (var i = 0; i < kids.length; i++) {
      var s = statusOf('region', kids[i]);
      if (rank(s) > rank(best)) best = s;
    }
    var cityIds = Object.keys(data.cities);
    for (var j = 0; j < cityIds.length; j++) {
      var c = data.cities[cityIds[j]];
      if (c && c.country === id && rank(c.status) > rank(best)) best = c.status;
    }
    return best;
  }

  function effectiveRegion(id) {
    var best = statusOf('region', id) || null;
    var cityIds = Object.keys(data.cities);
    for (var i = 0; i < cityIds.length; i++) {
      var c = data.cities[cityIds[i]];
      if (c && c.region === id && rank(c.status) > rank(best)) best = c.status;
    }
    return best;
  }

  // Cached per repaint: effectiveCountry over 243 countries walking every city
  // each time is the one hot loop in the app.
  var cache = null;
  function effective() {
    if (cache) return cache;
    cache = {countries: {}, regions: {}};
    var id;
    for (id in data.countries) if (data.countries[id].status) cache.countries[id] = data.countries[id].status;
    for (id in data.regions) {
      if (!data.regions[id].status) continue;
      cache.regions[id] = data.regions[id].status;
      var owner = index && index.countryOfRegion[id];
      if (owner && rank(data.regions[id].status) > rank(cache.countries[owner])) {
        cache.countries[owner] = data.regions[id].status;
      }
    }
    for (id in data.cities) {
      var c = data.cities[id];
      if (!c.status) continue;
      if (c.region && rank(c.status) > rank(cache.regions[c.region])) cache.regions[c.region] = c.status;
      if (c.country && rank(c.status) > rank(cache.countries[c.country])) cache.countries[c.country] = c.status;
    }
    return cache;
  }

  // ---- writes ------------------------------------------------------------

  function set(kind, id, status, extra) {
    var b = bucket(kind);
    if (!status) {
      // Dropping the status on a city removes the pin outright; on a country or
      // region it only clears the colour, and any note you wrote stays put.
      if (kind === 'city') delete b[id];
      else if (b[id]) {
        delete b[id].status;
        if (!b[id].note && !b[id].first && !b[id].last) delete b[id];
      }
    } else {
      b[id] = b[id] || {};
      b[id].status = status;
      if (extra) for (var k in extra) b[id][k] = extra[k];
    }
    cache = null;
    changed('status');
  }

  function patch(kind, id, fields) {
    var b = bucket(kind);
    b[id] = b[id] || {};
    for (var k in fields) {
      var v = fields[k];
      if (v === '' || v === null || v === undefined) delete b[id][k];
      else b[id][k] = v;
    }
    if (!b[id].status && !b[id].note && !b[id].first && !b[id].last && kind !== 'city') delete b[id];
    cache = null;
    changed('detail');
  }

  function cycle(kind, id, ladder) {
    var order = ladder || ['visited', 'lived', 'stopover', 'wishlist', null];
    var current = statusOf(kind, id);
    var at = order.indexOf(current);
    set(kind, id, order[(at + 1) % order.length]);
  }

  function setMany(kind, ids, status) {
    var b = bucket(kind);
    ids.forEach(function (id) {
      if (!status) {
        if (kind === 'city') delete b[id];
        else if (b[id]) { delete b[id].status; if (!b[id].note && !b[id].first && !b[id].last) delete b[id]; }
      } else {
        b[id] = b[id] || {};
        b[id].status = status;
      }
    });
    cache = null;
    changed('status');
  }

  function addCity(city, status) {
    data.cities[city.id] = {
      status: status || 'visited',
      name: city.name,
      cc: city.cc || null,
      lon: city.lon,
      lat: city.lat,
      country: city.country || null,
      region: city.region || null,
      custom: city.custom || undefined
    };
    cache = null;
    changed('status');
  }

  function removeCity(id) {
    delete data.cities[id];
    cache = null;
    changed('status');
  }

  function setSetting(key, value) {
    data.settings[key] = value;
    changed('settings');
  }

  // ---- totals ------------------------------------------------------------

  function stats() {
    var eff = effective();
    var floor = data.settings.countStopovers ? 2 : 3;
    var totals = {
      countries: 0, territories: 0, stopovers: 0, wishlist: 0,
      regions: 0, cities: 0,
      area: 0, pop: 0,
      continents: {},
      countriesTotal: index ? index.sovereignCount : 0,
      areaTotal: index ? index.areaTotal : 1,
      popTotal: index ? index.popTotal : 1
    };

    for (var id in eff.countries) {
      var r = rank(eff.countries[id]);
      var meta = index && index.country[id];
      if (r === 1) { totals.wishlist++; continue; }
      if (r === 2 && floor > 2) { totals.stopovers++; continue; }
      if (r < floor) continue;
      if (!meta) continue;
      if (meta.kind === 'country') totals.countries++; else totals.territories++;
      totals.area += meta.area || 0;
      totals.pop += meta.pop || 0;
      if (meta.continent) totals.continents[meta.continent] = true;
    }
    for (var rid in eff.regions) if (rank(eff.regions[rid]) >= floor) totals.regions++;
    for (var cid in data.cities) if (rank(data.cities[cid].status) >= floor) totals.cities++;

    totals.continentCount = Object.keys(totals.continents).length;
    totals.areaPct = totals.areaTotal ? (totals.area / totals.areaTotal) * 100 : 0;
    totals.popPct = totals.popTotal ? (totals.pop / totals.popTotal) * 100 : 0;
    return totals;
  }

  // ---- backup ------------------------------------------------------------

  function toJSON() {
    return {
      app: 'been-there',
      version: VERSION,
      exported: new Date().toISOString(),
      data: data
    };
  }

  function fromJSON(payload, mode) {
    var incoming = payload && payload.data ? payload.data : payload;
    if (!incoming || typeof incoming !== 'object') throw new Error('That file is not a Been There backup.');
    if (!incoming.countries && !incoming.regions && !incoming.cities) {
      throw new Error('That file has no places in it.');
    }
    var next = migrate(incoming);
    if (!Object.keys(next.countries).length && !Object.keys(next.regions).length &&
        !Object.keys(next.cities).length) {
      throw new Error('Nothing in that file could be read as a place.');
    }
    if (mode === 'merge') {
      ['countries', 'regions', 'cities'].forEach(function (k) {
        for (var id in data[k]) {
          if (!next[k][id] || rank(next[k][id].status) < rank(data[k][id].status)) next[k][id] = data[k][id];
        }
      });
      next.settings = data.settings;
    }
    data = next;
    cache = null;
    changed('replace');
  }

  function reset() {
    var theme = data.settings.theme;
    data = blank();
    data.settings.theme = theme;
    cache = null;
    changed('replace');
  }

  function toCSV() {
    var rows = [['kind', 'id', 'name', 'status', 'country', 'first_year', 'last_year', 'note']];
    function esc(v) {
      v = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    for (var id in data.countries) {
      var c = index && index.country[id];
      rows.push(['country', id, c ? c.name : id, data.countries[id].status || '', '',
        data.countries[id].first || '', data.countries[id].last || '', data.countries[id].note || '']);
    }
    for (var rid in data.regions) {
      var rg = index && index.region[rid];
      rows.push(['region', rid, rg ? rg.name : rid, data.regions[rid].status || '',
        rg ? rg.adm0 : '', data.regions[rid].first || '', data.regions[rid].last || '', data.regions[rid].note || '']);
    }
    for (var cid in data.cities) {
      var ct = data.cities[cid];
      rows.push(['city', cid, ct.name, ct.status || '', ct.country || '',
        ct.first || '', ct.last || '', ct.note || '']);
    }
    return rows.map(function (r) { return r.map(esc).join(','); }).join('\n');
  }

  function isEmpty() {
    return !Object.keys(data.countries).length &&
      !Object.keys(data.regions).length &&
      !Object.keys(data.cities).length;
  }

  var DAY = 86400000;
  function daysSince(iso) {
    if (!iso) return null;
    var then = Date.parse(iso);
    return isFinite(then) ? Math.floor((Date.now() - then) / DAY) : null;
  }

  /* There is one copy of this data and it lives in a browser's local storage.
     The nudge waits a week after the first place goes in, then asks monthly -
     often enough to matter, rarely enough to still be worth reading. */
  function backupState() {
    var empty = isEmpty();
    var since = daysSince(data.settings.lastExport);
    var age = daysSince(data.settings.firstSaved);
    return {
      empty: empty,
      ever: !!data.settings.lastExport,
      days: since,
      overdue: !empty && (since === null ? (age === null || age >= 7) : since >= 30)
    };
  }

  function markExported() {
    data.settings.lastExport = new Date().toISOString();
    changed('settings');
  }

  load();

  window.Store = {
    STATUS: STATUS,
    byId: BY_ID,
    rank: rank,
    attachIndex: function (ix) { index = ix; cache = null; },
    subscribe: function (fn) { listeners.push(fn); },
    raw: function () { return data; },
    settings: function () { return data.settings; },
    setSetting: setSetting,
    entry: entry,
    statusOf: statusOf,
    effective: effective,
    effectiveCountry: effectiveCountry,
    effectiveRegion: effectiveRegion,
    set: set,
    setMany: setMany,
    patch: patch,
    cycle: cycle,
    addCity: addCity,
    removeCity: removeCity,
    cities: function () { return data.cities; },
    stats: stats,
    toJSON: toJSON,
    fromJSON: fromJSON,
    toCSV: toCSV,
    reset: reset,
    storageWorks: function () { return storageWorks; },
    isEmpty: isEmpty,
    backupState: backupState,
    markExported: markExported
  };
})();
