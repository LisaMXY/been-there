/* Badges, every one of them earned by something in your own data. No "explorer
   level 3" - each says exactly what it counted, so it can be checked and
   argued with. Anything not yet earned shows how far off it is. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;

  /* The trait bits, copied from data/cities.js. They live here because that
     file is four megabytes and only loads when you search or spin the
     roulette, and a badge must not depend on whether you happened to do
     either. A test fails if the two tables ever drift apart. */
  var TRAIT = {coast: 1, island: 2, mountain: 4, desert: 8, tropical: 16,
    cold: 32, city: 64, town: 128, capital: 256, satellite: 512};

  var ARCTIC = 66.56;   // where the Sun stays up for a whole day once a year
  var TROPIC = 23.44;   // where it passes directly overhead

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

    /* The odd corners of the data, which is where the odd badges live. */
    var zones = {};      // 15-degree slices of longitude, one per hour of the day
    var letters = {};    // first letters of the places you have been
    var months = {};     // months of the year you have travelled in
    var traits = 0;      // everything your pins have been, rolled together
    var headcount = 0;   // the people who live where you have stood
    var eastWest = {east: false, west: false};
    var smallestPlace = null;
    var biggestPlace = null;
    var shortestName = null;

    cities.forEach(function (c) {
      zones[Math.floor(((c.lon + 180) % 360) / 15)] = true;
      var first = (c.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().charAt(0);
      if (first >= 'A' && first <= 'Z') letters[first] = true;
      traits |= c.traits || 0;
      headcount += c.pop || 0;
      if (c.lon > 0) eastWest.east = true;
      if (c.lon < 0) eastWest.west = true;
      if (c.pop && (!smallestPlace || c.pop < smallestPlace.pop)) smallestPlace = c;
      if (c.pop && (!biggestPlace || c.pop > biggestPlace.pop)) biggestPlace = c;
      var plain = (c.name || '').replace(/[^A-Za-z]/g, '');
      if (plain && (!shortestName || plain.length < shortestName.length)) shortestName = c.name;
    });

    var tripMonths = Store.trips();
    Object.keys(tripMonths).forEach(function (id) {
      var m = tripMonths[id].ym % 100;
      if (m >= 1 && m <= 12) months[m] = true;
    });

    /* Countries reached in one journey. A trip is stamped with the month it
       began, so counting "countries in a month" would credit a trip that ran
       from May to July to May alone; countries per trip is the honest form of
       the same idea, and a better one. */
    var byTrip = {};
    var cityById = Store.cities();
    Object.keys(cityById).forEach(function (id) {
      var c = cityById[id];
      if (!c.trip || !c.country) return;
      if (!byTrip[c.trip]) byTrip[c.trip] = {};
      byTrip[c.trip][c.country] = true;
    });
    var busiestTrip = 0;
    Object.keys(byTrip).forEach(function (k) {
      var n = Object.keys(byTrip[k]).length;
      if (n > busiestTrip) busiestTrip = n;
    });

    /* Letters, names and the shapes they make. */
    var awkward = null, palindrome = null, longestName = null, longerThan = null;
    var byName = {};
    cities.forEach(function (c) {
      var plain = (c.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z]/g, '');
      if (!plain) return;
      var first = plain.toUpperCase().charAt(0);
      if (!awkward && 'QXZ'.indexOf(first) > -1) awkward = c.name;
      var low = plain.toLowerCase();
      if (!palindrome && low.length >= 3 &&
          low === low.split('').reverse().join('')) palindrome = c.name;
      if (!longestName || plain.length > longestName.len) {
        longestName = {name: c.name, len: plain.length};
      }
      var owner = Atlas.index.country[c.country];
      if (owner && !longerThan && plain.length > owner.name.replace(/[^A-Za-z]/g, '').length) {
        longerThan = {place: c.name, country: owner.name};
      }
      var key = (c.name || '').toLowerCase();
      if (!byName[key]) byName[key] = {};
      if (c.country) byName[key][c.country] = true;
    });
    var twinName = null;
    Object.keys(byName).forEach(function (k) {
      if (!twinName && Object.keys(byName[k]).length > 1) twinName = k;
    });

    /* Capitals. A pin carries the traits of the place it sits on, so this asks
       which countries you pinned the capital of, and which you pinned only
       everywhere else. */
    var pinnedIn = {}, capitalIn = {};
    cities.forEach(function (c) {
      if (!c.country) return;
      pinnedIn[c.country] = true;
      if (c.traits & TRAIT.capital) capitalIn[c.country] = true;
    });
    var missedCapital = Object.keys(pinnedIn).filter(function (id) {
      return !capitalIn[id];
    }).map(function (id) {
      return Atlas.index.country[id] ? Atlas.index.country[id].name : id;
    }).sort();

    /* The three bands of latitude, which is a blunter idea than climate but an
       honest one: where the Sun can be overhead, where it never is, and where
       it sometimes does not set. */
    var bands = {};
    cities.forEach(function (c) {
      var a = Math.abs(c.lat);
      bands[a <= TROPIC ? 'tropics' : a >= ARCTIC ? 'polar' : 'temperate'] = true;
    });

    /* The biggest group of your countries you could cross between by land. */
    var borderMap = window.TM_BORDERS || {};
    var mine = {};
    countries.forEach(function (c) { mine[c.id] = true; });
    var seen = {}, drive = 0;
    countries.forEach(function (c) {
      if (seen[c.id]) return;
      var queue = [c.id], size = 0;
      seen[c.id] = true;
      while (queue.length) {
        var at = queue.pop();
        size++;
        (borderMap[at] || []).forEach(function (nb) {
          if (mine[nb] && !seen[nb]) { seen[nb] = true; queue.push(nb); }
        });
      }
      if (size > drive) drive = size;
    });

    // A trip that crossed the equator without going home in between.
    var tripLats = {};
    cities.forEach(function (c) {
      if (!c.trip) return;
      if (!tripLats[c.trip]) tripLats[c.trip] = {n: false, s: false};
      if (c.lat > 0) tripLats[c.trip].n = true;
      if (c.lat < 0) tripLats[c.trip].s = true;
    });
    var equatorTrip = Object.keys(tripLats).some(function (t) {
      return tripLats[t].n && tripLats[t].s;
    });

    // The longest stretch of years with no trip in it at all.
    var travelYears = {};
    Object.keys(tripMonths).forEach(function (id) {
      travelYears[Math.floor(tripMonths[id].ym / 100)] = true;
    });
    var ordered = Object.keys(travelYears).map(Number).sort(function (a, b) { return a - b; });
    var gap = 0, gapFrom = null, gapTo = null;
    for (var g = 1; g < ordered.length; g++) {
      var run = ordered[g] - ordered[g - 1] - 1;
      if (run > gap) { gap = run; gapFrom = ordered[g - 1]; gapTo = ordered[g]; }
    }

    // A country you came back to a decade or more later.
    var decades = countries.filter(function (c) {
      return c.first && c.last && c.last - c.first >= 10;
    });

    var lats = cities.map(function (c) { return c.lat; });
    var years = countries.filter(function (c) { return c.first; }).map(function (c) { return c.first; });

    // The two pins furthest apart, which is a more interesting number than it sounds.
    var apart = 0;
    var apartPair = null;
    var sameLine = null;   // two places on nearly the same parallel, far apart
    for (var i = 0; i < cities.length; i++) {
      for (var j = i + 1; j < cities.length; j++) {
        var d = greatCircle(cities[i], cities[j]);
        if (d > apart) { apart = d; apartPair = [cities[i], cities[j]]; }
        if (d > 5000 && Math.abs(cities[i].lat - cities[j].lat) <= 0.5 &&
            (!sameLine || d > sameLine.km)) {
          sameLine = {a: cities[i], b: cities[j], km: d, lat: cities[i].lat};
        }
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
      }, null),
      biggest: countries.reduce(function (a, c) {
        var km2 = (c.meta.area || 0) * EARTH_KM2;
        return !a || km2 > a.km2 ? {name: c.meta.name, km2: km2} : a;
      }, null),
      zones: Object.keys(zones).length,
      letters: Object.keys(letters).length,
      months: Object.keys(months).length,
      traits: traits,
      headcount: headcount,
      bothSides: eastWest.east && eastWest.west,
      smallestPlace: smallestPlace, biggestPlace: biggestPlace,
      shortestName: shortestName, busiestTrip: busiestTrip,
      awkward: awkward, palindrome: palindrome, longestName: longestName,
      longerThan: longerThan, twinName: twinName, sameLine: sameLine,
      capitals: Object.keys(capitalIn).length, missedCapital: missedCapital,
      bands: Object.keys(bands).length, drive: drive, equatorTrip: equatorTrip,
      gap: gap, gapFrom: gapFrom, gapTo: gapTo, decades: decades
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

      /* A ladder, because one lap stops meaning much once you are past five.
         The equator is 40,075 km and the Moon is 384,400 away; everything here
         is one of those two, multiplied. */
      {id: 'lap', title: 'Once round the world', have: Math.round(km), need: 40075,
       unit: 'km', note: Math.round(km).toLocaleString() + ' km of travelling'},
      {id: 'lap3', title: 'Three times round', have: Math.round(km), need: 120225,
       unit: 'km', note: (km / 40075).toFixed(1) + ' laps of the equator'},
      {id: 'lap5', title: 'Five times round', have: Math.round(km), need: 200375,
       unit: 'km', note: (km / 40075).toFixed(1) + ' laps of the equator'},
      {id: 'lap10', title: 'Ten times round', have: Math.round(km), need: 400750,
       unit: 'km', note: (km / 40075).toFixed(1) + ' laps of the equator'},
      {id: 'moon', title: 'As far as the Moon', have: Math.round(km), need: 384400,
       unit: 'km', note: Math.round(km).toLocaleString() + ' of the 384,400 km up there'},
      {id: 'moonback', title: 'The Moon and back', have: Math.round(km), need: 768800,
       unit: 'km', note: (km / 384400).toFixed(1) + ' trips to the Moon'},

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
    ].concat(odd(s)).concat(odder(s));

    return list.map(function (b) {
      b.earned = b.have >= b.need;
      return b;
    });
  }

  /* The odd ones. Each still counts something the data can answer, but the
     question is stranger: which slices of longitude you have stood in, which
     letters of the alphabet your places start with, whether you have been to a
     country that is nowhere near the sea. */
  function odd(s) {
    var borders = window.TM_BORDERS || {};
    var landlocked = window.TM_LANDLOCKED || [];

    var inland = s.countries.filter(function (c) {
      return landlocked.indexOf(c.id) > -1;
    });
    var lonely = s.countries.filter(function (c) {
      return (borders[c.id] || []).length === 1;
    });
    // Nowhere near the sea and one neighbour only: a country inside another one.
    var swallowed = s.countries.filter(function (c) {
      return (borders[c.id] || []).length === 1 && landlocked.indexOf(c.id) > -1;
    });

    /* Named in the title, so the badge asks for exactly those four and says
       which one you are missing rather than quietly counting something else. */
    var wanted = ['coast', 'mountain', 'desert', 'island'];
    var kinds = wanted.filter(function (k) { return s.traits & TRAIT[k]; });
    var missing = wanted.filter(function (k) { return !(s.traits & TRAIT[k]); });

    var list = [
      {id: 'zones', title: 'Round the clock', have: s.zones, need: 24,
       note: s.zones + ' of the 24 slices of longitude, an hour of the day each'},

      {id: 'alphabet', title: 'A to Z', have: s.letters, need: 26,
       note: s.letters + ' letters of the alphabet begin a place you have been'},

      {id: 'calendar', title: 'Every month of the year', have: s.months, need: 12,
       note: s.months + ' of 12 months have a trip in them'},

      {id: 'antipodes', title: 'Very nearly the other side of the Earth',
       have: Math.round(s.apart), need: 18000, unit: 'km',
       note: s.apartPair ? Math.round(s.apart).toLocaleString() +
         ' km apart, of the 20,015 that is the furthest two places can be' : ''},

      {id: 'meridian', title: 'Both sides of Greenwich',
       have: s.bothSides ? 1 : 0, need: 1,
       note: 'pins east and west of the prime meridian'},

      {id: 'inland', title: 'Nowhere near the sea', have: inland.length, need: 3,
       note: inland.length + ' landlocked ' + (inland.length === 1 ? 'country' : 'countries') +
         (inland.length ? ': ' + inland.map(function (c) { return c.meta.name; }).sort().join(', ') : '')},

      {id: 'lonely', title: 'A country with one neighbour', have: lonely.length, need: 1,
       note: lonely.length
         ? lonely.map(function (c) { return c.meta.name; }).sort().join(', ')
         : ''},

      {id: 'swallowed', title: 'A country inside another country',
       have: swallowed.length, need: 1,
       note: swallowed.length
         ? swallowed.map(function (c) { return c.meta.name; }).sort().join(', ') +
           ' — landlocked, and one neighbour all the way round'
         : ''},

      {id: 'extremes', title: 'The biggest and the smallest',
       have: (s.biggest && s.smallest && s.biggest.name !== s.smallest.name) ? 1 : 0, need: 1,
       note: s.biggest && s.smallest
         ? s.biggest.name + ' is the largest country you have been to, ' + s.smallest.name +
           ' the smallest'
         : ''},

      {id: 'hamlet', title: 'Somewhere with almost nobody in it',
       have: s.smallestPlace && s.smallestPlace.pop && s.smallestPlace.pop < 5000 ? 1 : 0, need: 1,
       note: s.smallestPlace && s.smallestPlace.pop
         ? s.smallestPlace.name + ', ' + s.smallestPlace.pop.toLocaleString() + ' people'
         : ''},

      {id: 'megacity', title: 'Somewhere with a great many',
       have: s.biggestPlace ? s.biggestPlace.pop : 0, need: 5000000,
       note: s.biggestPlace
         ? s.biggestPlace.name + ', ' + (s.biggestPlace.pop || 0).toLocaleString() + ' people'
         : ''},

      {id: 'headcount', title: 'Stood among a hundred million',
       have: s.headcount, need: 100000000,
       note: (s.headcount / 1000000).toFixed(0) + ' million people live in the places you pinned'},

      {id: 'variety', title: 'Coast, mountain, desert and island',
       have: kinds.length, need: 4,
       note: missing.length
         ? 'your pins cover ' + kinds.join(', ') + ' — no ' + missing.join(' or ') + ' yet'
         : 'your pins have been all four'},

      {id: 'manyinatrip', title: 'Several countries without coming home',
       have: s.busiestTrip, need: 3,
       note: s.busiestTrip ? s.busiestTrip + ' countries in a single trip' : ''},

      {id: 'shortname', title: 'A place you can say in one breath',
       have: s.shortestName && s.shortestName.replace(/[^A-Za-z]/g, '').length <= 4 ? 1 : 0,
       need: 1,
       note: s.shortestName ? s.shortestName + ', the shortest name on your map' : ''}
    ];

    return list;
  }

  /* Weirder still. These ask questions nobody sets out to answer - whether any
     of your places reads the same backwards, whether you could have driven
     between them, which years you stayed put - but the data knows, so they may
     as well be worth something. */
  function odder(s) {
    var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

    return [
      {id: 'drive', title: 'You could have driven it', have: s.drive, need: 5,
       note: s.drive + ' of your countries are joined to each other by land ' +
         'borders, so you could cross between them without a boat'},

      {id: 'polar', title: 'Inside the Arctic Circle',
       have: s.north >= ARCTIC ? 1 : 0, need: 1,
       note: s.north !== null ? 'furthest north ' + s.north.toFixed(1) + '°, past the ' +
         ARCTIC + '° line where the Sun does not set in midsummer' : ''},

      {id: 'bands', title: 'Tropics, temperate and polar', have: s.bands, need: 3,
       note: s.bands + ' of the 3 bands of latitude'},

      {id: 'equatortrip', title: 'Crossed the equator without going home',
       have: s.equatorTrip ? 1 : 0, need: 1,
       note: 'one trip with places in both hemispheres'},

      {id: 'sameline', title: 'The same line of latitude',
       have: s.sameLine ? 1 : 0, need: 1,
       note: s.sameLine ? s.sameLine.a.name + ' and ' + s.sameLine.b.name + ' sit on ' +
         Math.abs(s.sameLine.lat).toFixed(1) + '°' + (s.sameLine.lat < 0 ? 'S' : 'N') +
         ', ' + Math.round(s.sameLine.km).toLocaleString() + ' km apart' : ''},

      {id: 'capitals', title: 'Capital collector', have: s.capitals, need: 10,
       note: plural(s.capitals, 'capital city', 'capital cities') + ' pinned'},

      {id: 'nocapital', title: 'Gave the capital a miss',
       have: s.missedCapital.length, need: 1,
       note: s.missedCapital.length
         ? 'you have pins in ' + s.missedCapital.join(', ') + ' but never the capital'
         : ''},

      {id: 'decades', title: 'Back after a decade', have: s.decades.length, need: 1,
       note: s.decades.length
         ? s.decades.map(function (c) {
             return c.meta.name + ', ' + c.first + ' then ' + c.last;
           }).sort().join('; ')
         : ''},

      {id: 'gap', title: 'The long gap', have: s.gap, need: 3, unit: 'years',
       note: s.gap ? plural(s.gap, 'year', 'years') + ' without a trip, between ' +
         s.gapFrom + ' and ' + s.gapTo : ''},

      {id: 'awkward', title: 'The awkward letters', have: s.awkward ? 1 : 0, need: 1,
       note: s.awkward ? s.awkward + ' begins with Q, X or Z' : ''},

      {id: 'palindrome', title: 'The same backwards',
       have: s.palindrome ? 1 : 0, need: 1,
       note: s.palindrome ? s.palindrome + ' reads the same either way' : ''},

      {id: 'longname', title: 'A name you need a run-up for',
       have: s.longestName ? s.longestName.len : 0, need: 15, unit: 'letters',
       note: s.longestName
         ? s.longestName.name + ', ' + s.longestName.len + ' letters'
         : ''},

      {id: 'longerthan', title: 'A place with a longer name than its country',
       have: s.longerThan ? 1 : 0, need: 1,
       note: s.longerThan ? s.longerThan.place + ' is longer than ' + s.longerThan.country : ''},

      {id: 'twinname', title: 'The same name twice', have: s.twinName ? 1 : 0, need: 1,
       note: s.twinName ? 'two places called ' + s.twinName + ', in different countries' : ''}
    ];
  }

  function evaluate(km) {
    var s = survey();
    if (!s.countries.length) return [];
    return build(s, km || 0);
  }

  window.Badges = {evaluate: evaluate};
})();
