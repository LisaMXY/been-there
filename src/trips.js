/* Trips and home bases, editable in the app rather than only in a text file.

   A trip is one journey out and back, and it is the unit the distance is
   counted in. Merging matters most for a long one: the 2017 Europe run was
   sixteen lines in a file and one flight out, so it has to be possible to say
   so without editing anything by hand. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
        node.setAttribute(k, attrs[k]);
      }
    }
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  var MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function label(ym) {
    if (!ym) return '';
    var y = Math.floor(ym / 100);
    var m = ym % 100;
    return (m >= 1 && m <= 12 ? MONTHS[m] + ' ' : '') + y;
  }

  function toInput(ym) {
    if (!ym) return '';
    var y = Math.floor(ym / 100);
    var m = ym % 100;
    return y + '-' + String(m < 1 || m > 12 ? 1 : m).padStart(2, '0');
  }

  function fromInput(text) {
    var m = String(text || '').match(/^(\d{4})(?:-(\d{1,2}))?$/);
    if (!m) return null;
    var month = m[2] ? Number(m[2]) : 1;
    if (month < 1 || month > 12) month = 1;
    return Number(m[1]) * 100 + month;
  }

  function nextId(trips) {
    var n = 1;
    while (trips['t' + n]) n++;
    return 't' + n;
  }

  /* Everything pinned, gathered into the trips it belongs to. Anything with no
     trip is grouped by year and shown as loose, which is also what the distance
     falls back to. */
  function gather() {
    var cities = Store.cities();
    var trips = Store.trips();
    var byTrip = {};
    var loose = {};

    Object.keys(cities).forEach(function (id) {
      var city = cities[id];
      if (city.trip && trips[city.trip]) {
        if (!byTrip[city.trip]) byTrip[city.trip] = [];
        byTrip[city.trip].push({id: id, city: city});
      } else {
        var y = city.first || 0;
        if (!loose[y]) loose[y] = [];
        loose[y].push({id: id, city: city});
      }
    });

    var rows = Object.keys(byTrip).map(function (tid) {
      return {id: tid, ym: trips[tid].ym, name: trips[tid].name || '', places: byTrip[tid]};
    });
    Object.keys(loose).forEach(function (y) {
      rows.push({id: null, ym: Number(y) * 100 + 1, year: Number(y), places: loose[y]});
    });
    rows.sort(function (a, b) { return (a.ym || 0) - (b.ym || 0); });
    return rows;
  }

  function saveTrip(id, patch) {
    var trips = Store.trips();
    var next = {};
    Object.keys(trips).forEach(function (k) { next[k] = {ym: trips[k].ym, name: trips[k].name}; });
    next[id] = next[id] || {ym: null};
    for (var k in patch) next[id][k] = patch[k];
    Store.setSetting('trips', next);
  }

  function assign(cityIds, tripId) {
    cityIds.forEach(function (id) { Store.patch('city', id, {trip: tripId}); });
  }

  /* A trip nobody is in is not a trip. Merging and ungrouping both leave these
     behind, and they would otherwise pile up invisibly in the backup. */
  function prune() {
    var cities = Store.cities();
    var used = {};
    Object.keys(cities).forEach(function (id) { if (cities[id].trip) used[cities[id].trip] = true; });
    var trips = Store.trips();
    var kept = {};
    var dropped = 0;
    Object.keys(trips).forEach(function (id) {
      if (used[id]) kept[id] = trips[id];
      else dropped++;
    });
    if (dropped) Store.setSetting('trips', kept);
  }

  // ---- the sheet ---------------------------------------------------------

  function render(ctx) {
    var rows = gather();
    var body = [];

    body.push(h('p', {class: 'roul-lead', text:
      'A trip is one journey out and back, and it is what the distance is counted in. ' +
      'Merge the legs of a long one together so it costs one flight out, not ten.'}));

    body.push(homesBlock(ctx));

    if (!rows.length) {
      body.push(h('p', {class: 'sub', text: 'Pin some cities and they will show up here.'}));
      ctx.sheet('Trips', body, [h('button', {class: 'btn', type: 'button', text: 'Done', onclick: ctx.close})]);
      return;
    }

    var list = h('div', {class: 'trips'});
    rows.forEach(function (row, i) {
      list.appendChild(tripCard(ctx, row, rows[i - 1]));
    });
    body.push(h('div', {class: 'group'}, [
      h('h3', {}, [
        h('span', {text: 'Your trips'}),
        h('span', {class: 'hint', text: rows.length + ' in all'})
      ]),
      list
    ]));

    ctx.sheet('Trips', body, [
      h('button', {class: 'btn primary', type: 'button', text: 'Done', onclick: ctx.close})
    ]);
  }

  function tripCard(ctx, row, above) {
    var names = row.places.map(function (p) { return p.city.name; });
    var card = h('div', {class: 'trip' + (row.id ? '' : ' loose')});

    var when = h('input', {
      class: 'trip-when', type: 'text', value: toInput(row.ym), placeholder: 'YYYY-MM',
      'aria-label': 'When', size: 8,
      onchange: function (e) {
        var ym = fromInput(e.target.value);
        if (!ym) { e.target.value = toInput(row.ym); return; }
        if (row.id) { saveTrip(row.id, {ym: ym}); render(ctx); }
      }
    });
    if (!row.id) when.disabled = true;

    var base = Store.homes().length ? Store.homeFor(row.ym) : null;

    card.appendChild(h('div', {class: 'trip-head'}, [
      when,
      h('span', {class: 'trip-count', text: names.length + (names.length === 1 ? ' place' : ' places')}),
      base ? h('span', {class: 'chip-tag', text: 'from ' + base.name}) : null,
      row.id ? null : h('span', {class: 'chip-tag', text: 'not grouped'})
    ]));

    card.appendChild(h('p', {class: 'trip-places', text: names.join(' · ')}));

    var actions = h('div', {class: 'inline-actions'});
    if (!row.id) {
      actions.appendChild(h('button', {class: 'btn', type: 'button',
        text: row.places.length > 1 ? 'Make these one trip' : 'Make this a trip',
        onclick: function () {
          var id = nextId(Store.trips());
          saveTrip(id, {ym: row.ym});
          assign(row.places.map(function (p) { return p.id; }), id);
          render(ctx);
        }}));
      if (row.places.length > 1) {
        // A year's loose pins are rarely one journey; more often they are
        // several, and starting from one-each is less work than splitting.
        actions.appendChild(h('button', {class: 'btn', type: 'button', text: 'Each its own trip',
          onclick: function () {
            row.places.forEach(function (p) {
              var id = nextId(Store.trips());
              saveTrip(id, {ym: row.ym});
              assign([p.id], id);
            });
            render(ctx);
          }}));
      }
    } else {
      if (above && above.id) {
        actions.appendChild(h('button', {class: 'btn', type: 'button', text: '↑ Merge into the one above',
          onclick: function () {
            assign(row.places.map(function (p) { return p.id; }), above.id);
            prune();
            render(ctx);
          }}));
      }
      if (row.places.length > 1) {
        actions.appendChild(h('button', {class: 'btn', type: 'button', text: 'Split every place out',
          onclick: function () {
            var trips = Store.trips();
            row.places.slice(1).forEach(function (p) {
              var id = nextId(trips);
              trips[id] = {ym: row.ym};
              saveTrip(id, {ym: row.ym});
              assign([p.id], id);
            });
            render(ctx);
          }}));
      }
      actions.appendChild(h('button', {class: 'btn', type: 'button', text: 'Ungroup',
        onclick: function () {
          assign(row.places.map(function (p) { return p.id; }), undefined);
          prune();
          render(ctx);
        }}));
    }
    card.appendChild(actions);
    return card;
  }

  function homesBlock(ctx) {
    var homes = Store.homes();
    var box = h('div', {class: 'group'});
    box.appendChild(h('h3', {}, [
      h('span', {text: 'Where you set off from'}),
      h('span', {class: 'hint', text: homes.length ? homes.length + ' set' : 'not set'})
    ]));

    if (!homes.length) {
      box.appendChild(h('p', {class: 'sub tiny', text:
        'Without this, a trip is a line between its places. With it, each trip flies out and back.'}));
    }

    var list = h('ul', {class: 'rows'});
    homes.forEach(function (home, i) {
      var span = home.from || home.to
        ? label(home.from) + ' to ' + (home.to ? label(home.to) : 'now')
        : 'always';
      list.appendChild(h('li', {}, [
        h('span', {class: 'name', text: home.name}),
        h('span', {class: 'note', text: span}),
        h('button', {class: 'kill', type: 'button', title: 'Remove', text: '×',
          onclick: function () {
            var next = Store.homes();
            next.splice(i, 1);
            Store.setSetting('homes', next);
            render(ctx);
          }})
      ]));
    });
    if (homes.length) box.appendChild(list);

    box.appendChild(h('div', {class: 'inline-actions'}, [
      h('button', {class: 'btn', type: 'button',
        text: homes.length ? 'Add another base' : 'Set where you set off from',
        onclick: function () { ctx.addHome(function () { render(ctx); }); }})
    ]));
    return box;
  }

  function open(ctx) {
    if (!Atlas.citiesReady()) {
      ctx.loading(true);
      Atlas.loadCities(function () { ctx.loading(false); open(ctx); });
      return;
    }
    render(ctx);
  }

  window.Trips = {open: open, label: label, fromInput: fromInput, toInput: toInput};
})();
