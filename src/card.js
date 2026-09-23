/* A picture of your map, drawn to an offscreen canvas and handed straight to
   you as a PNG. Nothing is uploaded anywhere - the file goes to your downloads
   and that is the end of it. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;

  var W = 1200;
  var H = 1200;
  var PAD = 72;

  function palette() {
    var cs = getComputedStyle(document.documentElement);
    var read = function (name) { return cs.getPropertyValue(name).trim(); };
    return {
      paper: read('--surface'), ink: read('--ink'), ink2: read('--ink-2'), ink3: read('--ink-3'),
      line: read('--line'), land: read('--land'), landLine: read('--land-line'), sea: read('--sea'),
      accent: read('--accent'), city: read('--s-city'),
      wishlist: read('--s-wishlist'), stopover: read('--s-stopover'),
      visited: read('--s-visited'), lived: read('--s-lived')
    };
  }

  function fillFor(c, status) {
    return status && c[status] ? c[status] : c.land;
  }

  function draw(canvas, opts) {
    var c = palette();
    var ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, W, H);

    var s = Store.stats();
    var eff = Store.effective();

    // ---- the map, given the whole middle of the card
    var mapTop = 232;
    var mapH = 560;
    var projection = window.geo.geoEqualEarth()
      .fitExtent([[PAD, mapTop], [W - PAD, mapTop + mapH]], {type: 'Sphere'});
    var path = window.geo.geoPath(projection, ctx);

    ctx.save();
    ctx.beginPath();
    path({type: 'Sphere'});
    ctx.fillStyle = c.sea;
    ctx.fill();

    var countries = Atlas.countries();
    for (var i = 0; i < countries.length; i++) {
      var p = countries[i].properties;
      ctx.beginPath();
      path(countries[i]);
      ctx.fillStyle = fillFor(c, eff.countries[p.id]);
      ctx.fill();
      ctx.strokeStyle = c.landLine;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // micro-states are a dot on the real map too, for the same reason
    for (var t = 0; t < countries.length; t++) {
      var tp = countries[t].properties;
      if (!tp.tiny) continue;
      var status = eff.countries[tp.id];
      if (!status) continue;
      var pt = projection(tp.centroid);
      if (!pt) continue;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2);
      ctx.fillStyle = fillFor(c, status);
      ctx.fill();
    }

    var saved = Store.cities();
    for (var key in saved) {
      var city = saved[key];
      var cp = projection([city.lon, city.lat]);
      if (!cp) continue;
      var wish = city.status === 'wishlist';
      ctx.beginPath();
      ctx.arc(cp[0], cp[1], 4.5, 0, Math.PI * 2);
      ctx.fillStyle = wish ? c.paper : c.city;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = wish ? c.city : c.paper;
      ctx.stroke();
    }
    ctx.restore();

    // ---- the words
    var sans = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = c.ink3;
    ctx.font = '600 24px ' + sans;
    ctx.letterSpacing = '2px';
    ctx.fillText('BEEN THERE', PAD, 104);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = c.ink;
    ctx.font = '700 84px ' + sans;
    var headline = s.countries + (s.countries === 1 ? ' country' : ' countries');
    ctx.fillText(headline, PAD, 186);

    var sub = [
      s.regions ? s.regions + ' regions' : null,
      s.cities ? s.cities + ' cities' : null,
      s.continentCount + ' of 7 continents'
    ].filter(Boolean).join('   ·   ');
    ctx.fillStyle = c.ink2;
    ctx.font = '400 30px ' + sans;
    ctx.fillText(sub, PAD, 224);

    // ---- the numbers under the map
    var figures = [
      [s.areaPct.toFixed(1) + '%', 'of the land'],
      [Math.round(s.popPct) + '%', 'of the people']
    ];
    if (opts && opts.km) {
      figures.push([Math.round(opts.km).toLocaleString(), 'km of hops']);
      figures.push([(opts.km / 40075).toFixed(1) + '×', 'round the equator']);
    }

    var cols = figures.length;
    var colW = (W - PAD * 2) / cols;
    var figY = mapTop + mapH + 118;
    figures.forEach(function (f, i) {
      var x = PAD + colW * i;
      ctx.fillStyle = c.ink;
      ctx.font = '700 52px ' + sans;
      ctx.fillText(f[0], x, figY);
      ctx.fillStyle = c.ink3;
      ctx.font = '400 24px ' + sans;
      ctx.fillText(f[1], x, figY + 34);
    });

    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, figY + 78);
    ctx.lineTo(W - PAD, figY + 78);
    ctx.stroke();

    // ---- the key, so the colours mean something to whoever you send it to
    var keys = [
      ['lived', 'Lived there'], ['visited', 'Visited'],
      ['stopover', 'Stopover'], ['wishlist', 'Want to go']
    ].filter(function (k) {
      for (var id in eff.countries) if (eff.countries[id] === k[0]) return true;
      return false;
    });
    var kx = PAD;
    var ky = figY + 128;
    ctx.font = '400 24px ' + sans;
    keys.forEach(function (k) {
      ctx.fillStyle = c[k[0]];
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(kx, ky - 16, 18, 18, 4) : ctx.rect(kx, ky - 16, 18, 18);
      ctx.fill();
      ctx.fillStyle = c.ink2;
      ctx.fillText(k[1], kx + 28, ky);
      kx += 28 + ctx.measureText(k[1]).width + 34;
    });

    ctx.fillStyle = c.ink3;
    ctx.font = '400 21px ' + sans;
    var stamp = new Date().toISOString().slice(0, 10);
    var note = 'as of ' + stamp;
    ctx.fillText(note, W - PAD - ctx.measureText(note).width, H - 48);

    return canvas;
  }

  function save(opts, done) {
    var canvas = document.createElement('canvas');
    draw(canvas, opts);
    canvas.toBlob(function (blob) {
      if (!blob) { done(new Error('This browser would not make the image.')); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'been-there-' + new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      done(null);
    }, 'image/png');
  }

  window.Card = {draw: draw, save: save, size: [W, H]};
})();
