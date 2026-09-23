/* Badges, every one of them earned by something in your own data. No "explorer
   level 3" - each says exactly what it counted, so it can be checked and
   argued with. Anything not yet earned shows how far off it is. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;

  var EARTH_KM2 = 510072000;
  var EARTH_R = 6371;
  var rad = function (d) { return (d * Math.PI) / 180; };

  function greatCircle(a, b) {
    var dLat = rad(b.lat - a.lat);
    var dLon = rad(b.lon - a.lon);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Everything the badges need, worked out once. */
  function survey() {
    var eff = Store.effective();
    var raw = Store.raw();
    var floor = Store.settings().countStopovers ? 2 : 3;

    var countries = [];
    var continents = {};
    for (var id in eff.countries) {
      if (Store.rank(eff.countries[id]) < floor) continue;
      var meta = Atlas.index.country[id];
      if (!meta) continue;
      var entry = raw.countries[id] || {};
      countries.push({id: id, meta: meta, first: entry.first, last: entry.last});
      if (meta.continent) continents[meta.continent] = true;
    }

    var cities = [];
    var saved = Store.cities();
    for (var cid in saved) {
      if (Store.rank(saved[cid].status) >= floor) cities.push(saved[cid]);
    }

    // Which years anything was first reached, and how many countries each brought.
    var newPerYear = {};
    countries.forEach(function (c) {
      if (c.first) newPerYear[c.first] = (newPerYear[c.first] || 0) + 1;
    });

    // Countries you went back to in a different year.
    var returns = countries.filter(function (c) { return c.first && c.last && c.last > c.first; });

    // Regions, by country, so "seen most of somewhere" can be a badge.
    var regionsBy = {};
    for (var rid in eff.regions) {
      if (Store.rank(eff.regions[rid]) < floor) continue;
      var owner = Atlas.index.countryOfRegion[rid];
      if (owner) regionsBy[owner] = (regionsBy[owner] || 0) + 1;
    }
    var deepest = null;
    for (var oid in regionsBy) {
      var total = (Atlas.index.regionsByCountry[oid] || []).length;
      var row = {id: oid, have: regionsBy[oid], total: total,
        name: Atlas.index.country[oid] ? Atlas.index.country[oid].name : oid};
      if (!deepest || row.have > deepest.have) deepest = row;
    }

    var lats = cities.map(function (c) { return c.lat; });
    var years = countries.filter(function (c) { return c.first; }).map(function (c) { return c.first; });

    // The two pins furthest apart, which is a more interesting number than it sounds.
    var apart = 0;
    var apartPair = null;
    for (var i = 0; i < cities.length; i++) {
      for (var j = i + 1; j < cities.length; j++) {
        var d = greatCircle(cities[i], cities[j]);
        if (d > apart) { apart = d; apartPair = [cities[i], cities[j]]; }
      }
    }

    return {
      countries: countries, cities: cities, continents: continents,
      newPerYear: newPerYear, returns: returns, deepest: deepest,
      north: lats.length ? Math.max.apply(null, lats) : null,
      south: lats.length ? Math.min.apply(null, lats) : null,
      span: years.length ? Math.max.apply(null, years) - Math.min.apply(null, years) : 0,
      apart: apart, apartPair: apartPair,
      smallest: countries.reduce(function (a, c) {
        var km2 = (c.meta.area || 0) * EARTH_KM2;
        return !a || km2 < a.km2 ? {name: c.meta.name, km2: km2} : a;
      }, null)
    };
  }

  /* Each badge names its own evidence. `have` and `need` drive the progress
     line; `note` is what it says once earned. */
  function build(s, km) {
    var best = function (obj) {
      var top = 0;
      for (var k in obj) if (obj[k] > top) top = obj[k];
      return top;
    };
    var bestYear = function (obj) {
      var top = 0, at = null;
      for (var k in obj) if (obj[k] > top) { top = obj[k]; at = k; }
      return at;
    };

    var n = s.countries.length;
    var continents = Object.keys(s.continents).length;
    /* An island country is one with no land neighbour, which the borders data
       already knows. Iceland, Japan and Australia count; Ireland does not,
       because it shares a border with the United Kingdom. */
    var borders = window.TM_BORDERS || {};
    var islands = s.countries.filter(function (c) {
      return c.meta.kind === 'country' && !(borders[c.id] && borders[c.id].length);
    });
    var burst = best(s.newPerYear);

    var list = [
      {id: 'ten', title: 'Ten countries', have: n, need: 10,
       note: n + ' countries on the board'},
      {id: 'twentyfive', title: 'Twenty-five', have: n, need: 25,
       note: n + ' countries on the board'},
      {id: 'fifty', title: 'Half a century', have: n, need: 50,
       note: n + ' countries on the board'},
      {id: 'hundred', title: 'The hundred club', have: n, need: 100,
       note: n + ' countries on the board'},

      {id: 'continents', title: 'Every continent', have: continents, need: 7,
       note: continents + ' of 7, and Antarctica counts'},

      {id: 'equator', title: 'Both hemispheres',
       have: (s.north > 0 && s.south < 0) ? 1 : 0, need: 1,
       note: s.north !== null ? 'from ' + s.north.toFixed(1) + '°N to ' +
         Math.abs(s.south).toFixed(1) + '°' + (s.south < 0 ? 'S' : 'N') : ''},

      {id: 'arctic', title: 'Above the sixtieth', have: s.north >= 60 ? 1 : 0, need: 1,
       note: s.north !== null ? 'furthest north ' + s.north.toFixed(1) + '°' : ''},

      {id: 'lap', title: 'Once round the world', have: Math.round(km), need: 40075,
       note: Math.round(km).toLocaleString() + ' km of hops',
       unit: 'km'},

      {id: 'farflung', title: 'Opposite ends of the Earth',
       have: Math.round(s.apart), need: 15000, unit: 'km',
       note: s.apartPair ? s.apartPair[0].name + ' and ' + s.apartPair[1].name + ', ' +
         Math.round(s.apart).toLocaleString() + ' km apart' : ''},

      {id: 'burst', title: 'Ten in one year', have: burst, need: 10,
       note: burst ? burst + ' new countries in ' + bestYear(s.newPerYear) : ''},

      {id: 'span', title: 'Twenty years of it', have: s.span, need: 20, unit: 'years',
       note: s.span + ' years between your first and your latest'},

      {id: 'returner', title: 'Somewhere worth returning to',
       have: s.returns.length, need: 3,
       note: s.returns.length + ' countries you went back to in another year'},

      {id: 'deep', title: 'Ten regions in one country',
       have: s.deepest ? s.deepest.have : 0, need: 10,
       note: s.deepest ? s.deepest.have + ' of ' + s.deepest.total + ' in ' + s.deepest.name : ''},

      /* No figure attached on purpose. Natural Earth draws the micro-states
         larger than life so they are visible at all, so its Vatican is 10 km²
         rather than the real 0.44, and a wrong number is worse than none. */
      {id: 'micro', title: 'A country you could walk across',
       have: s.smallest && s.smallest.km2 < 1000 ? 1 : 0, need: 1,
       note: s.smallest ? s.smallest.name + ', the smallest you have been to' : ''},

      {id: 'cities', title: 'A hundred cities', have: s.cities.length, need: 100,
       note: s.cities.length + ' pinned'},

      {id: 'islands', title: 'Island hopper', have: islands.length, need: 5,
       note: islands.length + ' countries with no land border: ' +
         islands.map(function (c) { return c.meta.name; }).sort().join(', ')}
    ];

    return list.map(function (b) {
      b.earned = b.have >= b.need;
      return b;
    });
  }

  function evaluate(km) {
    var s = survey();
    if (!s.countries.length) return [];
    return build(s, km || 0);
  }

  window.Badges = {evaluate: evaluate};
})();
