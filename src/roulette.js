/* Where next: a spin over places you have not been, filtered by what a place is
   actually like. The traits come from Natural Earth's physical geography at
   build time - coastline distance, named mountain ranges, deserts, islands - so
   a filter never claims something the data cannot support. */
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

  // Order matters only in that it reads sensibly; the chips are independent.
  var FILTERS = [
    {key: 'coast', label: 'Coast'},
    {key: 'island', label: 'Islands'},
    {key: 'mountain', label: 'Mountains'},
    {key: 'desert', label: 'Desert'},
    {key: 'tropical', label: 'Tropical'},
    {key: 'cold', label: 'Far north or south'},
    {key: 'city', label: 'Big cities'},
    {key: 'town', label: 'Small towns'},
    {key: 'capital', label: 'Capitals'}
  ];

  var CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

  var state = null;
  var col = null;
  var spinning = false;

  function defaults() {
    var saved = Store.settings().roulette;
    return {
      traits: saved && saved.traits ? saved.traits.slice() : [],
      continent: saved && saved.continent ? saved.continent : '',
      unvisited: !saved || saved.unvisited !== false
    };
  }

  function remember() {
    Store.setSetting('roulette', {
      traits: state.traits.slice(), continent: state.continent, unvisited: state.unvisited
    });
  }

  function columns() {
    var out = {};
    window.TM_CITIES.columns.forEach(function (c, i) { out[c] = i; });
    return out;
  }

  function traitBits(keys) {
    var T = window.TM_CITIES.traits;
    var bits = 0;
    keys.forEach(function (k) { if (T[k]) bits |= T[k]; });
    return bits;
  }

  function labelFor(traits) {
    var T = window.TM_CITIES.traits;
    return FILTERS.filter(function (f) { return traits & T[f.key]; }).map(function (f) { return f.label; });
  }

  /* The pool of places worth suggesting, which never changes: a capital, or
     somewhere genuinely large, or somewhere with a character the geography can
     vouch for - a coast, a mountain range, an island, a desert. A city of two
     hundred thousand with none of those is a place you live, not a place you go.
     Anything in a bigger neighbour's shadow is out too, because "a suburb of
     Hamburg" is a suggestion of Hamburg. Filters only narrow this, so the count
     can only ever go down. */
  function candidates() {
    var w = window.TM_CITIES;
    var T = w.traits;
    var want = traitBits(state.traits);
    var STRONG = T.island | T.mountain | T.desert | T.coast;
    var eff = Store.effective();
    var out = [];

    for (var i = 0; i < w.rows.length; i++) {
      var r = w.rows[i];
      if (r[col.traits] & T.satellite) continue;

      var id = r[col.country];
      var meta = id && Atlas.index.country[id];
      if (!meta) continue;

      if (want && (r[col.traits] & want) !== want) continue;

      var worth = r[col.capital] === 1 || r[col.pop] >= 500000 || (r[col.traits] & STRONG);
      if (!worth) continue;

      if (state.continent && meta.continent !== state.continent) continue;
      if (state.unvisited && Store.rank(eff.countries[id]) >= 3) continue;

      out.push(r);
    }
    return out;
  }

  function toCity(r) {
    return {
      id: String(r[col.id]), name: r[col.name], cc: r[col.cc], pop: r[col.pop],
      lon: r[col.lon], lat: r[col.lat], country: r[col.country], region: r[col.region],
      traits: r[col.traits]
    };
  }

  // ---- the sheet ---------------------------------------------------------

  function render(ctx, result) {
    var pool = candidates();
    var body = [];

    body.push(h('p', {class: 'roul-lead', text: result
      ? ''
      : 'Pick what you are in the mood for, or spin as is.'}));

    var chips = h('div', {class: 'chips'});
    FILTERS.forEach(function (f) {
      var on = state.traits.indexOf(f.key) > -1;
      chips.appendChild(h('button', {
        class: 'chip-toggle' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
        onclick: function () {
          if (on) state.traits.splice(state.traits.indexOf(f.key), 1);
          else state.traits.push(f.key);
          remember();
          render(ctx, null);
        }
      }, [h('span', {text: f.label})]));
    });
    body.push(chips);

    var where = h('select', {
      class: 'roul-select', 'aria-label': 'Continent',
      onchange: function (e) { state.continent = e.target.value; remember(); render(ctx, null); }
    }, [h('option', {value: '', text: 'Anywhere in the world'})].concat(
      CONTINENTS.map(function (c) {
        return h('option', {value: c, text: c, selected: state.continent === c ? 'selected' : null});
      })
    ));

    var only = h('input', {type: 'checkbox', id: 'roul-new'});
    only.checked = state.unvisited;
    only.addEventListener('change', function () {
      state.unvisited = only.checked;
      remember();
      render(ctx, null);
    });

    body.push(h('div', {class: 'roul-row'}, [
      where,
      h('label', {class: 'roul-check', for: 'roul-new'}, [
        only, h('span', {text: 'Only countries I have not been to'})
      ])
    ]));

    body.push(h('p', {class: 'roul-count', text: pool.length
      ? pool.length.toLocaleString() + ' places match'
      : 'Nothing matches that combination.'}));

    var slot = h('div', {class: 'slot' + (result ? ' filled' : '')});
    if (result) slot.appendChild(resultCard(ctx, result));
    else slot.appendChild(h('p', {class: 'slot-idle', text: 'Spin to see where you are going.'}));
    body.push(slot);

    var actions = [
      h('button', {class: 'btn', type: 'button', text: 'Close', onclick: ctx.close}),
      h('button', {
        class: 'btn primary', type: 'button', disabled: pool.length ? null : true,
        text: result ? 'Spin again' : 'Spin',
        onclick: function () { spin(ctx, pool, slot); }
      })
    ];

    ctx.sheet('Where next?', body, actions);
  }

  function resultCard(ctx, city) {
    var meta = Atlas.index.country[city.country];
    var region = city.region ? Atlas.index.region[city.region] : null;
    var eff = Store.effective();
    var been = Store.rank(eff.countries[city.country]) >= 3;
    var entry = Store.raw().countries[city.country] || {};
    var already = !!Store.cities()[city.id];

    var tags = h('div', {class: 'chips'});
    labelFor(city.traits).forEach(function (t) {
      tags.appendChild(h('span', {class: 'chip-tag', text: t}));
    });

    return h('div', {class: 'result'}, [
      h('p', {class: 'eyebrow', text: [region ? region.name : null, meta ? meta.name : city.country]
        .filter(Boolean).join(' · ')}),
      h('h3', {text: city.name}),
      h('p', {class: 'result-sub', text: [
        city.pop ? city.pop.toLocaleString() + ' people' : null,
        been ? 'you have been to ' + meta.name + (entry.last ? ' (' + entry.last + ')' : '')
             : 'a country you have never been to'
      ].filter(Boolean).join(' · ')}),
      tags.childNodes.length ? tags : null,
      h('div', {class: 'result-actions'}, [
        h('button', {
          class: 'btn', type: 'button', disabled: already ? true : null,
          text: already ? 'Already on your map' : 'Add to want to go',
          onclick: function () {
            Store.addCity(city, 'wishlist');
            ctx.toast(city.name + ' added to Want to go');
            render(ctx, city);
          }
        }),
        h('button', {class: 'btn', type: 'button', text: 'Show me where', onclick: function () {
          if (!Store.cities()[city.id]) Store.addCity(city, 'wishlist');
          ctx.close();
          ctx.select({kind: 'city', id: city.id});
        }})
      ])
    ]);
  }

  /* A short shuffle before it settles. It is a roulette; landing instantly on
     an answer feels like a search result rather than a spin. */
  function spin(ctx, pool, slot) {
    if (spinning || !pool.length) return;
    var final = toCity(pool[Math.floor(Math.random() * pool.length)]);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || pool.length < 3) {
      render(ctx, final);
      return;
    }

    spinning = true;
    slot.classList.add('filled', 'rolling');
    var ticks = 0;
    var timer = setInterval(function () {
      var peek = pool[Math.floor(Math.random() * pool.length)];
      var meta = Atlas.index.country[peek[col.country]];
      slot.textContent = '';
      slot.appendChild(h('div', {class: 'result rolling-name'}, [
        h('p', {class: 'eyebrow', text: meta ? meta.name : ''}),
        h('h3', {text: peek[col.name]})
      ]));
      if (++ticks >= 11) {
        clearInterval(timer);
        spinning = false;
        slot.classList.remove('rolling');
        render(ctx, final);
      }
    }, 70);
  }

  function open(ctx) {
    if (!Atlas.citiesReady()) {
      ctx.loading(true);
      Atlas.loadCities(function (err) {
        ctx.loading(false);
        if (err) { ctx.toast('Could not load the places list.'); return; }
        open(ctx);
      });
      return;
    }
    col = columns();
    state = defaults();
    render(ctx, null);
  }

  window.Roulette = {open: open, FILTERS: FILTERS};
})();
