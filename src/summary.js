/* The summary view: what the map adds up to.

   Charts are hand-rolled SVG - one series each, one axis each, no library. The
   only colour that carries meaning is the visited blue; everything else is
   recessive chrome so the bars are the loudest thing on screen. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;
  var NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    apply(node, attrs);
    (kids || []).forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }

  function s(tag, attrs, kids) {
    var node = document.createElementNS(NS, tag);
    apply(node, attrs);
    (kids || []).forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }

  function apply(node, attrs) {
    if (!attrs) return;
    for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
        node.setAttribute(k === 'class' ? 'class' : k, attrs[k]);
      }
    }
  }

  /* The only innerHTML in the app, and it is only ever handed strings this file
     builds out of years and counts - never a name that came from a file. */
  var tip = null;
  function hoverable(node, html) {
    node.addEventListener('pointerenter', function (e) {
      if (!tip) {
        tip = h('div', {class: 'chart-tip'});
        document.body.appendChild(tip);
      }
      tip.innerHTML = html;
      tip.hidden = false;
      move(e);
    });
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', function () { if (tip) tip.hidden = true; });
    function move(e) {
      if (!tip) return;
      var w = tip.offsetWidth;
      tip.style.left = Math.min(window.innerWidth - w - 10, Math.max(8, e.clientX - w / 2)) + 'px';
      tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 12) + 'px';
    }
  }

  // ---- charts ------------------------------------------------------------

  /* Bars over an ordinal axis (years). Labels are selective: the ends, the
     peak, and every fifth year - a number over every bar is noise. */
  // A 720-wide viewBox scaled into a phone leaves a 70px-tall chart. Narrow the
  // box instead, so the aspect stays readable rather than squat.
  function chartWidth() { return window.innerWidth < 620 ? 420 : 720; }

  function yearBars(rows, opts) {
    var w = chartWidth(), hgt = opts.height || 150;
    var pad = {t: 14, r: 4, b: 22, l: 4};
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    var innerW = w - pad.l - pad.r;
    var innerH = hgt - pad.t - pad.b;
    var step = innerW / rows.length;
    var barW = Math.max(3, Math.min(26, step - 4));
    var peak = rows.reduce(function (a, b) { return b.value > a.value ? b : a; }, rows[0]);

    var g = s('svg', {viewBox: '0 0 ' + w + ' ' + hgt, class: 'chart',
      role: 'img', 'aria-label': opts.label});

    g.appendChild(s('line', {x1: pad.l, x2: w - pad.r, y1: pad.t + innerH, y2: pad.t + innerH,
      class: 'axis'}));

    rows.forEach(function (r, i) {
      var x = pad.l + step * i + (step - barW) / 2;
      var bh = r.value === 0 ? 0 : Math.max(2, (r.value / max) * innerH);
      var y = pad.t + innerH - bh;
      if (bh) {
        var bar = s('rect', {x: x, y: y, width: barW, height: bh, rx: Math.min(4, barW / 2),
          class: 'bar' + (r.dim ? ' dim' : '')});
        hoverable(bar, '<b>' + r.key + '</b>' + opts.tip(r));
        g.appendChild(bar);
      }
      var showYear = tickAt(i, rows.length, r.key);
      if (showYear) {
        g.appendChild(s('text', {x: x + barW / 2, y: hgt - 7, class: 'tick', 'text-anchor': 'middle',
          text: String(r.key)}));
      }
      if (r === peak && r.value) {
        g.appendChild(s('text', {x: x + barW / 2, y: y - 5, class: 'value', 'text-anchor': 'middle',
          text: String(r.value)}));
      }
    });
    return g;
  }

  function runningLine(rows, opts) {
    var w = chartWidth(), hgt = opts.height || 150;
    var pad = {t: 16, r: 34, b: 22, l: 4};
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    var innerW = w - pad.l - pad.r;
    var innerH = hgt - pad.t - pad.b;
    var x = function (i) { return pad.l + (rows.length < 2 ? 0 : (i / (rows.length - 1)) * innerW); };
    var y = function (v) { return pad.t + innerH - (v / max) * innerH; };

    var g = s('svg', {viewBox: '0 0 ' + w + ' ' + hgt, class: 'chart',
      role: 'img', 'aria-label': opts.label});

    [0, 0.5, 1].forEach(function (f) {
      g.appendChild(s('line', {x1: pad.l, x2: w - pad.r, y1: y(max * f), y2: y(max * f),
        class: f === 0 ? 'axis' : 'grid'}));
    });

    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(r.value); }).join(' ');
    g.appendChild(s('path', {d: d + ' L' + x(rows.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z',
      class: 'area'}));
    g.appendChild(s('path', {d: d, class: 'line'}));

    rows.forEach(function (r, i) {
      var dot = s('circle', {cx: x(i), cy: y(r.value), r: 9, class: 'hit'});
      hoverable(dot, '<b>' + r.key + '</b>' + opts.tip(r));
      g.appendChild(dot);
      if (i === rows.length - 1) {
        g.appendChild(s('circle', {cx: x(i), cy: y(r.value), r: 4, class: 'knot'}));
        g.appendChild(s('text', {x: x(i) + 9, y: y(r.value) + 4, class: 'value', text: String(r.value)}));
      }
    });
    rows.forEach(function (r, i) {
      if (tickAt(i, rows.length, r.key)) {
        g.appendChild(s('text', {x: x(i), y: hgt - 7, class: 'tick',
          'text-anchor': i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle',
          text: String(r.key)}));
      }
    });
    return g;
  }

  /* First year, last year, every fifth in between - but never a round year so
     close to an end that the two labels collide. */
  function tickAt(i, n, key) {
    if (i === 0 || i === n - 1) return true;
    return Number(key) % 5 === 0 && i > 1 && i < n - 2;
  }

  function ranked(rows, opts) {
    var list = h('ul', {class: 'ranked'});
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    rows.forEach(function (r) {
      var fill = h('i');
      fill.style.width = (r.value / max) * 100 + '%';
      if (r.of) fill.style.opacity = '1';
      var row = h('li', {}, [
        h('span', {class: 'r-label', text: r.key}),
        h('span', {class: 'r-track'}, [fill]),
        h('span', {class: 'r-value', text: opts.format(r)})
      ]);
      if (opts.onpick) {
        row.classList.add('pickable');
        row.addEventListener('click', function () { opts.onpick(r); });
      }
      list.appendChild(row);
    });
    return list;
  }

  // ---- the numbers -------------------------------------------------------

  function collect() {
    var raw = Store.raw();
    var eff = Store.effective();
    var floor = Store.settings().countStopovers ? 2 : 3;
    var counted = {};
    var out = {
      countries: [], regionsHit: 0, cities: [], wishlist: [],
      firstByYear: {}, cityByYear: {}, continents: {}, years: []
    };

    Object.keys(eff.countries).forEach(function (id) {
      var meta = Atlas.index.country[id];
      if (!meta) return;
      var rank = Store.rank(eff.countries[id]);
      if (rank === 1) { out.wishlist.push(meta); return; }
      if (rank < floor) return;
      counted[id] = true;
      var entry = raw.countries[id] || {};
      out.countries.push({
        meta: meta, status: eff.countries[id],
        first: entry.first || null, last: entry.last || null
      });
    });

    Object.keys(eff.regions).forEach(function (rid) {
      if (Store.rank(eff.regions[rid]) >= floor) out.regionsHit++;
    });

    Object.keys(raw.cities).forEach(function (cid) {
      var c = raw.cities[cid];
      if (Store.rank(c.status) < floor) return;
      out.cities.push(c);
      if (c.first) out.cityByYear[c.first] = (out.cityByYear[c.first] || 0) + 1;
    });

    out.countries.forEach(function (c) {
      if (c.first) out.firstByYear[c.first] = (out.firstByYear[c.first] || 0) + 1;
      var k = c.meta.continent || 'Elsewhere';
      out.continents[k] = (out.continents[k] || 0) + 1;
    });

    var years = Object.keys(out.firstByYear).concat(Object.keys(out.cityByYear)).map(Number);
    if (years.length) {
      var lo = Math.min.apply(null, years);
      var hi = Math.max.apply(null, years);
      for (var y = lo; y <= hi; y++) out.years.push(y);
    }

    // Countries with no year on them still count; they just cannot be placed on
    // the timeline, and saying so beats quietly dropping them.
    out.undated = out.countries.filter(function (c) { return !c.first; }).length;
    out.counted = counted;
    return out;
  }

  /* Countries you have not been to that touch one you have. Being next door to
     three of your countries is a better prompt than being next door to one, so
     that is the order. Borders come out of the map's own shared edges, so the
     awkward cases are right: France borders Brazil, through French Guiana. */
  function nextDoor(counted) {
    var borders = window.TM_BORDERS;
    if (!borders) return [];
    var eff = Store.effective();
    var out = {};
    Object.keys(counted).forEach(function (id) {
      (borders[id] || []).forEach(function (other) {
        if (counted[other]) return;
        if (Store.rank(eff.countries[other]) >= 3) return;
        var meta = Atlas.index.country[other];
        if (!meta || meta.kind !== 'country') return;
        if (!out[other]) out[other] = {id: other, meta: meta, from: [], wish: eff.countries[other]};
        out[other].from.push(Atlas.index.country[id] ? Atlas.index.country[id].name : id);
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) {
        return b.from.length - a.from.length || a.meta.name.localeCompare(b.meta.name);
      });
  }

  function andList(names) {
    var sorted = names.slice().sort();
    if (sorted.length === 1) return sorted[0];
    if (sorted.length === 2) return sorted.join(' and ');
    return sorted.slice(0, -1).join(', ') + ' and ' + sorted[sorted.length - 1];
  }

  function continentTotals() {
    var totals = {};
    Atlas.countries().forEach(function (f) {
      var p = f.properties;
      if (p.kind !== 'country') return;
      var k = p.continent || 'Elsewhere';
      totals[k] = (totals[k] || 0) + 1;
    });
    return totals;
  }

  var EARTH_R = 6371;
  var rad = function (d) { return (d * Math.PI) / 180; };

  function greatCircle(a, b) {
    var dLat = rad(b.lat - a.lat);
    var dLon = rad(b.lon - a.lon);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* How far the pins add up to. Ordering matters enormously - the same 89 pins
     come to 82,000 km in a sensible order and 519,000 in a random one - so the
     order is fixed and defensible rather than arbitrary: chronological by the
     year you first got there, and within a year always the nearest place next,
     which is roughly how a trip actually goes. It is a floor, not a total: it
     has no idea you flew home in between. */
  function distance(cities) {
    var dated = cities.filter(function (c) { return c.first && isFinite(c.lon) && isFinite(c.lat); });
    if (dated.length < 2) return null;

    var years = [];
    dated.forEach(function (c) { if (years.indexOf(c.first) === -1) years.push(c.first); });
    years.sort(function (a, b) { return a - b; });

    var km = 0;
    var prev = null;
    var hops = 0;
    years.forEach(function (y) {
      var pool = dated.filter(function (c) { return c.first === y; });
      if (!prev) pool.sort(function (a, b) { return a.name.localeCompare(b.name); });
      while (pool.length) {
        var pick = 0;
        if (prev) {
          var best = Infinity;
          pool.forEach(function (c, i) {
            var d = greatCircle(prev, c);
            if (d < best) { best = d; pick = i; }
          });
        }
        var next = pool.splice(pick, 1)[0];
        if (prev) { km += greatCircle(prev, next); hops++; }
        prev = next;
      }
    });
    return {km: km, hops: hops, places: dated.length, undated: cities.length - dated.length};
  }

  var YARDSTICKS = [
    {km: 40075, one: 'once round the equator', many: 'times round the equator'},
    {km: 384400, one: 'the distance to the Moon', many: 'trips to the Moon'}
  ];

  function farBlock(d) {
    var laps = d.km / YARDSTICKS[0].km;
    var moon = d.km / YARDSTICKS[1].km;
    var lines = [];
    lines.push(laps >= 1
      ? laps.toFixed(1) + ' times round the equator'
      : Math.round(laps * 100) + '% of the way round the equator');
    lines.push(moon >= 1
      ? moon.toFixed(1) + ' trips to the Moon'
      : Math.round(moon * 100) + '% of the way to the Moon');

    return h('div', {class: 'far'}, [
      h('div', {class: 'far-figure'}, [
        h('b', {text: Math.round(d.km).toLocaleString()}),
        h('span', {text: 'km'})
      ]),
      h('ul', {class: 'far-list'}, lines.map(function (t) { return h('li', {text: t}); })),
      h('p', {class: 'far-note', text: 'Each place counted once, in the order you first reached ' +
        'it, taking the nearest one next within each year — ' + d.hops.toLocaleString() +
        ' hops between ' + d.places + ' places. A floor, not a total: it has no idea you flew ' +
        'home in between.' + (d.undated ? ' ' + d.undated + ' pins have no year and sit this out.' : '')})
    ]);
  }

  function extremes(cities) {
    if (!cities.length) return null;
    var pick = function (fn) {
      return cities.reduce(function (a, b) { return fn(b) > fn(a) ? b : a; });
    };
    return {
      north: pick(function (c) { return c.lat; }),
      south: pick(function (c) { return -c.lat; }),
      east: pick(function (c) { return c.lon; }),
      west: pick(function (c) { return -c.lon; })
    };
  }

  // ---- the view ----------------------------------------------------------

  function render(root, api) {
    var d = collect();
    root.textContent = '';

    if (!d.countries.length) {
      root.appendChild(h('div', {class: 'summary-empty'}, [
        h('h2', {text: 'Nothing to add up yet'}),
        h('p', {text: 'Colour in a country or two and this page fills with the arithmetic: how much of the world, which years, how deep into each place.'}),
        h('button', {class: 'btn primary', type: 'button', text: 'Back to the map',
          onclick: api.close})
      ]));
      return;
    }

    var stats = Store.stats();
    var sovereign = d.countries.filter(function (c) { return c.meta.kind === 'country'; }).length;
    var territories = d.countries.length - sovereign;

    root.appendChild(h('div', {class: 'checklist-head'}, [
      h('h2', {text: 'The arithmetic'}),
      h('p', {text: 'Everything below counts a place from the moment you marked it Visited or Lived there.'}),
      api.saveCard ? h('button', {class: 'btn', type: 'button', text: 'Save a picture',
        onclick: api.saveCard}) : null,
      h('button', {class: 'btn', type: 'button', text: 'Back to the map', onclick: api.close})
    ]));

    // hero
    var hero = h('div', {class: 'hero'});
    [
      [String(sovereign), 'countries', 'of ' + stats.countriesTotal + ' on the map'],
      [stats.areaPct.toFixed(1) + '%', 'of the land', 'by area'],
      [stats.popPct.toFixed(0) + '%', 'of the people', 'live in them'],
      [String(Object.keys(d.continents).length), 'continents', 'of 7'],
      [String(d.regionsHit), 'regions', 'states, provinces, prefectures'],
      [String(d.cities.length), 'cities', territories ? 'and ' + territories + ' territories' : 'pinned']
    ].forEach(function (t) {
      hero.appendChild(h('div', {class: 'hero-tile'}, [
        h('b', {text: t[0]}), h('span', {text: t[1]}), h('small', {text: t[2]})
      ]));
    });
    root.appendChild(hero);

    // timeline
    if (d.years.length > 1) {
      var running = 0;
      var cumulative = d.years.map(function (y) {
        running += d.firstByYear[y] || 0;
        return {key: y, value: running};
      });
      root.appendChild(section('Countries, running total',
        d.undated ? d.undated + ' without a year are counted but not plotted.' : null,
        runningLine(cumulative, {
          label: 'Cumulative countries visited by year',
          tip: function (r) { return '<span>' + r.value + ' countries by the end of ' + r.key + '</span>'; }
        })));

      root.appendChild(section('Somewhere new, by year', 'Countries you set foot in for the first time.',
        yearBars(d.years.map(function (y) {
          return {key: y, value: d.firstByYear[y] || 0};
        }), {
          label: 'New countries each year',
          tip: function (r) { return '<span>' + (r.value || 'no') + ' new ' + (r.value === 1 ? 'country' : 'countries') + '</span>'; }
        })));

      root.appendChild(section('Cities, by year', 'First time in each place, so a city you keep going back to counts once.',
        yearBars(d.years.map(function (y) {
          return {key: y, value: d.cityByYear[y] || 0};
        }), {
          label: 'New cities each year',
          tip: function (r) { return '<span>' + (r.value || 'no') + ' new ' + (r.value === 1 ? 'city' : 'cities') + '</span>'; }
        })));
    }

    var far = distance(d.cities);
    if (far) root.appendChild(section('How far that is', null, farBlock(far)));

    // badges
    var badges = window.Badges ? window.Badges.evaluate(far ? far.km : 0) : [];
    if (badges.length) {
      var got = badges.filter(function (b) { return b.earned; });
      var next = badges.filter(function (b) { return !b.earned; })
        .sort(function (a, b) { return (b.have / b.need) - (a.have / a.need); });

      var grid = h('div', {class: 'badges'});
      got.concat(next.slice(0, 6)).forEach(function (b) {
        grid.appendChild(h('div', {class: 'badge' + (b.earned ? ' got' : '')}, [
          h('b', {text: b.title}),
          h('span', {text: b.earned ? b.note : shortfall(b)})
        ]));
      });
      root.appendChild(section('Badges',
        got.length + ' of ' + badges.length + ' earned. Each one counts something you can check.',
        grid));
    }

    // continents
    var totals = continentTotals();
    var continentRows = Object.keys(d.continents).sort(function (a, b) {
      return d.continents[b] - d.continents[a];
    }).map(function (k) {
      return {key: k, value: d.continents[k], of: totals[k] || d.continents[k]};
    });
    root.appendChild(section('Continents', null, ranked(continentRows, {
      format: function (r) { return r.value + ' of ' + r.of; }
    })));

    // what is one border away
    var near = nextDoor(d.counted);
    if (near.length) {
      var list = h('ul', {class: 'nextdoor'});
      near.slice(0, 12).forEach(function (n) {
        list.appendChild(h('li', {class: 'pickable', onclick: function () {
          api.open({kind: 'country', id: n.id});
        }}, [
          h('span', {class: 'nd-count', text: String(n.from.length)}),
          h('span', {class: 'nd-main'}, [
            h('b', {text: n.meta.name}),
            h('span', {class: 'nd-from', text: 'borders ' + andList(n.from)})
          ]),
          n.wish ? h('span', {class: 'chip-tag', text: 'Want to go'}) : null
        ]));
      });
      root.appendChild(section('One border away',
        near.length + ' countries you have not been to touch one you have' +
        (near.length > 12 ? ' — the twelve most surrounded are here' : '') + '.',
        list));
    }

    // deepest countries
    var byCountry = {};
    d.cities.forEach(function (c) {
      if (!c.country) return;
      byCountry[c.country] = (byCountry[c.country] || 0) + 1;
    });
    var deepest = Object.keys(byCountry).map(function (id) {
      var meta = Atlas.index.country[id];
      return {key: meta ? meta.name : id, id: id, value: byCountry[id]};
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12);

    if (deepest.length) {
      root.appendChild(section('Where you went deepest', 'Cities pinned per country.',
        ranked(deepest, {
          format: function (r) { return String(r.value); },
          onpick: function (r) { api.open({kind: 'country', id: r.id}); }
        })));
    }

    // extremes and oddments
    var ex = extremes(d.cities);
    var facts = [];
    var dated = d.countries.filter(function (c) { return c.first; });
    if (dated.length) {
      var earliest = dated.reduce(function (a, b) { return b.first < a.first ? b : a; });
      var latestYear = Math.max.apply(null, dated.map(function (c) { return c.last || c.first; }));
      facts.push(['First on the board', earliest.meta.name + ', ' + earliest.first]);
      facts.push(['Most recent year', String(latestYear)]);
      var busiest = null;
      d.years.forEach(function (y) {
        var n = (d.cityByYear[y] || 0);
        if (!busiest || n > busiest[1]) busiest = [y, n];
      });
      if (busiest && busiest[1]) facts.push(['Busiest year', busiest[0] + ' · ' + busiest[1] + ' new cities']);
      var gap = null;
      var active = d.years.filter(function (y) { return d.firstByYear[y] || d.cityByYear[y]; });
      for (var i = 1; i < active.length; i++) {
        if (!gap || active[i] - active[i - 1] > gap[2]) gap = [active[i - 1], active[i], active[i] - active[i - 1]];
      }
      if (gap && gap[2] > 1) facts.push(['Longest gap', gap[2] + ' years, ' + gap[0] + ' to ' + gap[1]]);
    }
    if (ex) {
      facts.push(['Furthest north', ex.north.name + ' · ' + coord(ex.north.lat, 'N', 'S')]);
      facts.push(['Furthest south', ex.south.name + ' · ' + coord(ex.south.lat, 'N', 'S')]);
      facts.push(['Furthest west', ex.west.name + ' · ' + coord(ex.west.lon, 'E', 'W')]);
      facts.push(['Furthest east', ex.east.name + ' · ' + coord(ex.east.lon, 'E', 'W')]);
    }
    if (facts.length) {
      var grid = h('div', {class: 'facts'});
      facts.forEach(function (f) {
        grid.appendChild(h('div', {class: 'fact'}, [
          h('span', {text: f[0]}), h('b', {text: f[1]})
        ]));
      });
      root.appendChild(section('Odds and ends', null, grid));
    }

    // the table - also the non-colour way to read everything above
    var table = h('table', {class: 'ledger'});
    table.appendChild(h('thead', {}, [h('tr', {}, [
      h('th', {text: 'Country'}), h('th', {text: 'Status'}),
      h('th', {class: 'n', text: 'First'}), h('th', {class: 'n', text: 'Last'}),
      h('th', {class: 'n', text: 'Regions'}), h('th', {class: 'n', text: 'Cities'})
    ])]));
    var body = h('tbody');
    var eff = Store.effective();
    d.countries.slice().sort(function (a, b) {
      return (a.first || 9999) - (b.first || 9999) || a.meta.name.localeCompare(b.meta.name);
    }).forEach(function (c) {
      var ids = Atlas.index.regionsByCountry[c.meta.id] || [];
      var hit = ids.filter(function (r) { return Store.rank(eff.regions[r]) >= 2; }).length;
      var sw = h('span', {class: 'sw'});
      sw.style.background = 'var(' + Store.byId[c.status].css + ')';
      var row = h('tr', {class: 'pickable', onclick: function () { api.open({kind: 'country', id: c.meta.id}); }}, [
        h('td', {text: c.meta.name}),
        h('td', {}, [sw, h('span', {text: Store.byId[c.status].label})]),
        h('td', {class: 'n', text: c.first || '—'}),
        h('td', {class: 'n', text: c.last && c.last !== c.first ? c.last : ''}),
        h('td', {class: 'n', text: ids.length ? hit + ' / ' + ids.length : '—'}),
        h('td', {class: 'n', text: String(byCountry[c.meta.id] || 0)})
      ]);
      body.appendChild(row);
    });
    table.appendChild(body);
    root.appendChild(section('Every country, in the order you first got there', null, table));

    if (d.wishlist.length) {
      root.appendChild(section('Still to go', null, h('div', {class: 'chips-plain'},
        d.wishlist.sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
          return h('button', {class: 'chip', type: 'button',
            onclick: function () { api.open({kind: 'country', id: m.id}); }}, [
            h('span', {class: 'name', text: m.name})
          ]);
        }))));
    }
  }

  /* What is left to do, in the badge's own units, so it reads as a target
     rather than a scolding. */
  function shortfall(b) {
    var left = b.need - b.have;
    if (b.need === 1) return 'not yet';
    if (b.unit === 'km') return Math.round(left).toLocaleString() + ' km to go';
    if (b.unit === 'years') return left + (left === 1 ? ' year to go' : ' years to go');
    return b.have + ' of ' + b.need;
  }

  function coord(v, pos, neg) {
    return Math.abs(v).toFixed(1) + '° ' + (v >= 0 ? pos : neg);
  }

  function section(title, note, content) {
    return h('section', {class: 'sum-section'}, [
      h('h3', {text: title}),
      note ? h('p', {class: 'sub', text: note}) : null,
      content
    ]);
  }

  function distanceKm() {
    var d = collect();
    var far = distance(d.cities);
    return far ? far.km : 0;
  }

  window.Summary = {render: render, distanceKm: distanceKm};
})();
