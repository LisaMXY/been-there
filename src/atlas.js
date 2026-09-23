/* Geometry, the canvas, and everything that answers "what did I just click on".

   Two of the three data files are loaded lazily, by appending a <script> rather
   than fetching: a page opened straight off the filesystem cannot fetch its own
   siblings, but it can always run a script. That is the whole reason the app
   works by double-clicking index.html. */
(function () {
  'use strict';

  var topo = window.geo;

  var STATUS_VAR = {
    wishlist: '--s-wishlist',
    stopover: '--s-stopover',
    visited: '--s-visited',
    lived: '--s-lived'
  };

  // Anything under this share of the globe disappears at world zoom once the
  // outline has been simplified, so it gets a marker dot instead. Singapore,
  // Malta, Bermuda, Vatican City: all real places, all invisible otherwise.
  var TINY = 4e-5;

  var countries = [];
  var regions = [];
  var cities = [];
  var index = {
    country: {},
    region: {},
    regionsByCountry: {},
    countryOfRegion: {},
    citiesByCountry: {},
    sovereignCount: 0,
    areaTotal: 0,
    popTotal: 0
  };

  var regionsReady = false;
  var citiesReady = false;
  var pending = {};

  function loadScript(src, done) {
    if (pending[src]) { pending[src].push(done); return; }
    pending[src] = [done];
    var el = document.createElement('script');
    el.src = src;
    el.onload = function () {
      var waiting = pending[src];
      pending[src] = null;
      waiting.forEach(function (fn) { fn(null); });
    };
    el.onerror = function () {
      var waiting = pending[src];
      pending[src] = null;
      waiting.forEach(function (fn) { fn(new Error('Could not load ' + src)); });
    };
    document.head.appendChild(el);
  }

  function initCountries() {
    var t = window.TM_COUNTRIES;
    countries = topo.feature(t, t.objects.countries).features;
    countries.forEach(function (f) {
      var p = f.properties;
      p.tiny = (p.area || 0) < TINY;
      index.country[p.id] = p;
      index.regionsByCountry[p.id] = [];
      index.areaTotal += p.area || 0;
      index.popTotal += p.pop || 0;
      if (p.kind === 'country') index.sovereignCount++;
    });
    countries.sort(function (a, b) { return (b.properties.area || 0) - (a.properties.area || 0); });
    window.Store.attachIndex(index);
  }

  function loadRegions(done) {
    if (regionsReady) { done(null); return; }
    loadScript('data/admin1.js', function (err) {
      if (err) { done(err); return; }
      var t = window.TM_ADMIN1;
      regions = topo.feature(t, t.objects.admin1).features;
      regions.forEach(function (f) {
        var p = f.properties;
        index.region[p.id] = p;
        index.countryOfRegion[p.id] = p.adm0;
        if (!index.regionsByCountry[p.adm0]) index.regionsByCountry[p.adm0] = [];
        index.regionsByCountry[p.adm0].push(p.id);
      });
      Object.keys(index.regionsByCountry).forEach(function (k) {
        index.regionsByCountry[k].sort(function (a, b) {
          return (index.region[a] ? index.region[a].name : a).localeCompare(
            index.region[b] ? index.region[b].name : b);
        });
      });
      regionsReady = true;
      window.Store.attachIndex(index);
      done(null);
    });
  }

  function loadCities(done) {
    if (citiesReady) { done(null); return; }
    loadScript('data/cities.js', function (err) {
      if (err) { done(err); return; }
      var raw = window.TM_CITIES;
      cities = raw.rows.map(function (r) {
        return {
          id: String(r[0]), name: r[1], cc: r[2], pop: r[3],
          lon: r[4], lat: r[5], country: r[6], region: r[7], capital: !!r[8]
        };
      });
      cities.forEach(function (c) {
        if (!c.country) return;
        if (!index.citiesByCountry[c.country]) index.citiesByCountry[c.country] = [];
        index.citiesByCountry[c.country].push(c);
      });
      citiesReady = true;
      done(null);
    });
  }

  // ---- the map ----------------------------------------------------------

  function MapView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    // How much of the bottom of the canvas is covered by something else - the
    // sheet on a phone. The map is still drawn full size; it just aims itself
    // at the part you can actually see.
    this.inset = 0;
    this.projection = topo.geoEqualEarth();
    this.path = topo.geoPath(this.projection, this.ctx);
    this.graticule = topo.geoGraticule().step([20, 20]);
    this.focus = null;        // country id whose regions are on show
    this.asOf = null;         // a year, while the replay is running
    this.hover = null;        // {kind, id}
    this.selected = null;     // {kind, id}
    this.pins = [];           // screen positions of drawn city pins, for hit tests
    this.colors = {};
    this.frame = null;
  }

  MapView.prototype.readTheme = function () {
    var cs = getComputedStyle(document.documentElement);
    var c = {};
    ['--land', '--land-line', '--sea', '--ink', '--ink-3', '--line', '--surface', '--s-city', '--plane']
      .forEach(function (name) { c[name] = cs.getPropertyValue(name).trim(); });
    Object.keys(STATUS_VAR).forEach(function (s) {
      c[s] = cs.getPropertyValue(STATUS_VAR[s]).trim();
    });
    this.colors = c;
  };

  MapView.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    var pad = 8;
    this.projection.fitExtent(
      [[pad, pad], [this.width - pad, this.height - pad]],
      {type: 'Sphere'}
    );
    this.clampPan();
    this.draw();
  };

  MapView.prototype.visibleCenterY = function () {
    return (this.height - this.inset) / 2;
  };

  /* Slide the view up by half of whatever is covering the bottom, so the thing
     you just selected is not hidden behind the panel describing it. */
  MapView.prototype.setInset = function (px) {
    px = Math.max(0, Math.min(this.height * 0.8, px || 0));
    if (Math.abs(px - this.inset) < 1) return;
    var delta = (px - this.inset) / 2;
    this.inset = px;
    this.ty -= delta;
    this.clampPan();
    this.draw();
  };

  MapView.prototype.clampPan = function () {
    // Let the map be dragged around but never completely off the stage.
    var slack = 0.45;
    var maxX = this.width * slack * this.k;
    var maxY = this.height * slack * this.k;
    var minX = this.width - this.width * this.k - maxX;
    var minY = this.height - this.height * this.k - maxY;
    this.tx = Math.min(maxX, Math.max(minX, this.tx));
    this.ty = Math.min(maxY, Math.max(minY, this.ty));
  };

  MapView.prototype.zoomAt = function (factor, cx, cy) {
    var next = Math.min(80, Math.max(1, this.k * factor));
    if (next === this.k) return;
    var px = (cx - this.tx) / this.k;
    var py = (cy - this.ty) / this.k;
    this.k = next;
    this.tx = cx - px * this.k;
    this.ty = cy - py * this.k;
    this.clampPan();
    this.draw();
  };

  MapView.prototype.panBy = function (dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this.clampPan();
    this.draw();
  };

  MapView.prototype.reset = function () {
    this.k = 1;
    this.tx = 0;
    this.ty = -this.inset / 2;
    this.draw();
  };

  /* Frame a lon/lat box [w, s, e, n]. */
  MapView.prototype.fitBounds = function (b, maxK) {
    var a = this.projection([b[0], b[3]]);
    var c = this.projection([b[2], b[1]]);
    var a2 = this.projection([b[0], b[1]]);
    var c2 = this.projection([b[2], b[3]]);
    if (!a || !c || !a2 || !c2) return;
    var x0 = Math.min(a[0], c[0], a2[0], c2[0]);
    var x1 = Math.max(a[0], c[0], a2[0], c2[0]);
    var y0 = Math.min(a[1], c[1], a2[1], c2[1]);
    var y1 = Math.max(a[1], c[1], a2[1], c2[1]);
    var w = Math.max(x1 - x0, 6);
    var h = Math.max(y1 - y0, 6);
    var k = Math.min(this.width / (w * 1.6), Math.max(80, this.height - this.inset) / (h * 1.6));
    this.k = Math.min(maxK || 26, Math.max(1, k));
    this.tx = this.width / 2 - ((x0 + x1) / 2) * this.k;
    this.ty = this.visibleCenterY() - ((y0 + y1) / 2) * this.k;
    this.clampPan();
    this.draw();
  };

  MapView.prototype.fillFor = function (status) {
    return status ? (this.colors[status] || this.colors['--land']) : this.colors['--land'];
  };

  MapView.prototype.draw = function () {
    if (this.frame) return;
    var self = this;
    this.frame = requestAnimationFrame(function () {
      self.frame = null;
      self.render();
    });
  };

  /* Which countries break out into regions rather than one flat fill.

     Not simply "anywhere you have region detail": pin a city in Japan and
     Japan would stop being blue at world zoom, because one prefecture is a
     speck. A map that greys out a country the moment you know MORE about it is
     backwards. So the country keeps its own colour at a glance, and the regions
     appear when you are close enough to read them, or when you ask. */
  MapView.prototype.DRILL_ZOOM = 3.5;

  MapView.prototype.drilledSet = function () {
    var drilled = {};
    if (!regionsReady) return drilled;
    if (this.focus) drilled[this.focus] = true;
    if (this.k >= this.DRILL_ZOOM) {
      var eff = this.asOf === null
        ? window.Store.effective()
        : window.Store.effectiveAsOf(this.asOf);
      for (var rid in eff.regions) {
        var owner = index.countryOfRegion[rid];
        if (owner) drilled[owner] = true;
      }
    }
    return drilled;
  };

  MapView.prototype.render = function () {
    var ctx = this.ctx;
    var eff = this.asOf === null
      ? window.Store.effective()
      : window.Store.effectiveAsOf(this.asOf);
    var c = this.colors;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c['--sea'];
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.k, this.k);

    var hair = 1 / this.k;

    // graticule, well behind everything
    ctx.beginPath();
    this.path(this.graticule());
    ctx.strokeStyle = c['--line'];
    ctx.lineWidth = hair * 0.8;
    ctx.globalAlpha = 0.65;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // countries
    var drilled = this.drilledSet();

    for (var i = 0; i < countries.length; i++) {
      var f = countries[i];
      var id = f.properties.id;
      ctx.beginPath();
      this.path(f);
      ctx.fillStyle = this.fillFor(eff.countries[id]);
      ctx.fill();
      ctx.strokeStyle = c['--land-line'];
      ctx.lineWidth = hair * 0.7;
      ctx.stroke();
    }

    // regions, only for countries that have region-level answers
    if (regionsReady) {
      for (var j = 0; j < regions.length; j++) {
        var rf = regions[j];
        var rp = rf.properties;
        if (!drilled[rp.adm0]) continue;
        ctx.beginPath();
        this.path(rf);
        ctx.fillStyle = this.fillFor(eff.regions[rp.id]);
        ctx.fill();
        ctx.strokeStyle = c['--land-line'];
        ctx.lineWidth = hair * 0.6;
        ctx.stroke();
      }
    }

    // tiny countries get a dot, otherwise they are unclickable and invisible
    ctx.lineWidth = hair;
    for (var t = 0; t < countries.length; t++) {
      var tf = countries[t];
      if (!tf.properties.tiny) continue;
      var pt = this.projection(tf.properties.centroid);
      if (!pt) continue;
      var status = eff.countries[tf.properties.id];
      var r = (status ? 4.2 : 2.6) / this.k;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      ctx.fillStyle = status ? this.fillFor(status) : c['--land-line'];
      ctx.fill();
      if (status) {
        ctx.strokeStyle = c['--surface'];
        ctx.lineWidth = 1.4 / this.k;
        ctx.stroke();
      }
    }

    ctx.restore();

    // city pins in screen space, so they stay a readable size at every zoom
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.pins = [];
    var saved = window.Store.cities();
    for (var key in saved) {
      var city = saved[key];
      // Mid-replay, a pin has not happened yet.
      if (this.asOf !== null && (!city.first || city.first > this.asOf)) continue;
      var p = this.projection([city.lon, city.lat]);
      if (!p) continue;
      var sx = p[0] * this.k + this.tx;
      var sy = p[1] * this.k + this.ty;
      if (sx < -20 || sy < -20 || sx > this.width + 20 || sy > this.height + 20) continue;
      this.pins.push({id: key, x: sx, y: sy, city: city});
      // Somewhere you want to go is a hollow pin, somewhere you have been is
      // solid. Shape rather than a second colour, so it survives a colourblind
      // reader and a black-and-white print.
      var wish = city.status === 'wishlist';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = wish ? c['--surface'] : c['--s-city'];
      ctx.fill();
      ctx.lineWidth = wish ? 2.4 : 2;
      ctx.strokeStyle = wish ? c['--s-city'] : c['--surface'];
      ctx.stroke();
    }

    // the thing under the cursor, and the thing you picked
    // Kept thin on purpose: a 2px ring is wider than Japan at world zoom and
    // swallows the fill it is meant to point at.
    this.outline(this.selected, 1.6, c['--ink']);
    this.outline(this.hover, 1.1, c['--ink-3']);
    ctx.restore();
  };

  MapView.prototype.outline = function (target, width, color) {
    if (!target) return;
    var f = target.kind === 'country' ? this.featureOfCountry(target.id)
          : target.kind === 'region' ? this.featureOfRegion(target.id) : null;
    var ctx = this.ctx;
    if (!f) {
      if (target.kind !== 'city') return;
      var pin = null;
      for (var i = 0; i < this.pins.length; i++) if (this.pins[i].id === target.id) pin = this.pins[i];
      if (!pin) return;
      ctx.beginPath();
      ctx.arc(pin.x, pin.y, 8.5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.k, this.k);
    ctx.beginPath();
    this.path(f);
    ctx.strokeStyle = color;
    ctx.lineWidth = width / this.k;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    if (f.properties.tiny) {
      var pt = this.projection(f.properties.centroid);
      if (!pt) return;
      ctx.beginPath();
      ctx.arc(pt[0] * this.k + this.tx, pt[1] * this.k + this.ty, 8, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };

  MapView.prototype.featureOfCountry = function (id) {
    for (var i = 0; i < countries.length; i++) if (countries[i].properties.id === id) return countries[i];
    return null;
  };

  MapView.prototype.featureOfRegion = function (id) {
    for (var i = 0; i < regions.length; i++) if (regions[i].properties.id === id) return regions[i];
    return null;
  };

  MapView.prototype.toLonLat = function (sx, sy) {
    var x = (sx - this.tx) / this.k;
    var y = (sy - this.ty) / this.k;
    return this.projection.invert ? this.projection.invert([x, y]) : null;
  };

  /* What is under this screen point: a pin beats a region beats a country,
     because that is the order of "how deliberately did you put it there". */
  MapView.prototype.at = function (sx, sy) {
    for (var i = this.pins.length - 1; i >= 0; i--) {
      var pin = this.pins[i];
      if ((pin.x - sx) * (pin.x - sx) + (pin.y - sy) * (pin.y - sy) <= 121) {
        return {kind: 'city', id: pin.id, city: pin.city};
      }
    }

    // A micro-state is a dot, not a shape; test it in screen space too.
    var best = null, bestD = 169;
    for (var t = 0; t < countries.length; t++) {
      var tp = countries[t].properties;
      if (!tp.tiny) continue;
      var pt = this.projection(tp.centroid);
      if (!pt) continue;
      var dx = pt[0] * this.k + this.tx - sx;
      var dy = pt[1] * this.k + this.ty - sy;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = {kind: 'country', id: tp.id}; }
    }
    if (best) return best;

    var ll = this.toLonLat(sx, sy);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;

    if (regionsReady) {
      var drilled = this.drilledSet();
      for (var r = 0; r < regions.length; r++) {
        var rp = regions[r].properties;
        if (!drilled[rp.adm0]) continue;
        if (topo.geoContains(regions[r], ll)) return {kind: 'region', id: rp.id, adm0: rp.adm0};
      }
    }

    for (var c = 0; c < countries.length; c++) {
      var p = countries[c].properties;
      var b = p.bounds;
      if (b && !this.inBounds(b, ll)) continue;
      if (topo.geoContains(countries[c], ll)) return {kind: 'country', id: p.id};
    }
    return null;
  };

  MapView.prototype.inBounds = function (b, ll) {
    var lon = ll[0], lat = ll[1];
    if (lat < b[1] - 0.2 || lat > b[3] + 0.2) return false;
    if (b[0] > b[2]) return lon >= b[0] - 0.2 || lon <= b[2] + 0.2; // crosses the antimeridian
    return lon >= b[0] - 0.2 && lon <= b[2] + 0.2;
  };

  window.Atlas = {
    init: initCountries,
    // For a file that may simply not be there. A clean checkout ships no travel
    // history at all, by design, so this is allowed to fail.
    loadOptional: function (src, done) { loadScript(src, function (err) { done(!err); }); },
    loadRegions: loadRegions,
    loadCities: loadCities,
    regionsReady: function () { return regionsReady; },
    citiesReady: function () { return citiesReady; },
    countries: function () { return countries; },
    regions: function () { return regions; },
    cities: function () { return cities; },
    index: index,
    MapView: MapView
  };
})();
