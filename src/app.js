/* UI: the panel, the checklist, search, and the wiring between a click on the
   canvas and a row in the store. */
(function () {
  'use strict';

  var Store = window.Store;
  var Atlas = window.Atlas;
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    tiles: $('tiles'), legend: $('legend'), panel: $('panel'), checklist: $('checklist'),
    canvas: $('map'), wrap: $('map-wrap'), tip: $('tip'), q: $('q'), results: $('results'),
    menu: $('menu'), menuBtn: $('menu-btn'), file: $('file'), sheet: $('sheet'),
    sheetTitle: $('sheet-title'), sheetBody: $('sheet-body'), sheetActions: $('sheet-actions'),
    listToggle: $('list-toggle'), sumToggle: $('sum-toggle'),
    summary: $('summary'), storageNote: $('storage-note')
  };

  var map = new Atlas.MapView(el.canvas);
  var selection = null;      // {kind, id}
  var pinMode = false;

  // ---- small helpers -----------------------------------------------------

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function swatch(status) {
    var box = h('span', {class: 'sw'});
    box.style.background = status ? 'var(' + statusVar(status) + ')' : 'var(--land)';
    return box;
  }

  function statusVar(status) {
    var found = Store.byId[status];
    return found ? found.css : '--land';
  }

  function num(n) { return n.toLocaleString(); }

  function toast(message) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = h('div', {class: 'toast', role: 'status', text: message});
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ---- header ------------------------------------------------------------

  function renderTiles() {
    var s = Store.stats();
    var tiles = [
      ['Countries', num(s.countries), s.countriesTotal ? 'of ' + s.countriesTotal : ''],
      ['Territories', num(s.territories), ''],
      ['Regions', num(s.regions), ''],
      ['Cities', num(s.cities), ''],
      ['Land', s.areaPct.toFixed(1) + '%', 'of the map'],
      ['People', s.popPct.toFixed(0) + '%', 'of the world'],
      ['Continents', num(s.continentCount), 'of 7']
    ];
    el.tiles.textContent = '';
    tiles.forEach(function (t) {
      el.tiles.appendChild(h('div', {class: 'tile', title: t[0] + ' ' + t[2]}, [
        h('b', {text: t[1]}),
        h('span', {text: t[0]})
      ]));
    });
  }

  function renderLegend() {
    var eff = Store.effective();
    var counts = {};
    for (var id in eff.countries) {
      counts[eff.countries[id]] = (counts[eff.countries[id]] || 0) + 1;
    }
    el.legend.textContent = '';
    Store.STATUS.slice().reverse().forEach(function (s) {
      var sw = h('span', {class: 'sw'});
      sw.style.background = 'var(' + s.css + ')';
      el.legend.appendChild(h('span', {class: 'key'}, [
        sw, h('span', {text: s.label}), h('span', {class: 'n', text: counts[s.id] ? String(counts[s.id]) : '0'})
      ]));
    });
    var pin = h('span', {class: 'sw dot'});
    pin.style.background = 'var(--s-city)';
    var cityCount = Object.keys(Store.cities()).length;
    el.legend.appendChild(h('span', {class: 'key'}, [
      pin, h('span', {text: 'City'}), h('span', {class: 'n', text: String(cityCount)})
    ]));
  }

  // ---- panel -------------------------------------------------------------

  function statusButtons(kind, id, onPick) {
    var current = Store.statusOf(kind, id);
    var box = h('div', {class: 'statuses'});
    Store.STATUS.slice().reverse().forEach(function (s) {
      box.appendChild(h('button', {
        type: 'button',
        'aria-pressed': current === s.id ? 'true' : 'false',
        onclick: function () { onPick(current === s.id ? null : s.id); }
      }, [swatch(s.id), h('span', {text: s.label})]));
    });
    box.appendChild(h('button', {
      type: 'button', class: 'wide', 'aria-pressed': 'false',
      disabled: current ? null : true,
      onclick: function () { onPick(null); }
    }, [swatch(null), h('span', {text: kind === 'city' ? 'Remove this pin' : 'Clear'})]));
    return box;
  }

  function detailFields(kind, id) {
    var e = Store.entry(kind, id) || {};
    function field(key, label, type) {
      return h('div', {class: 'field'}, [
        h('label', {text: label, for: 'f-' + key}),
        h('input', {
          id: 'f-' + key, type: type, value: e[key] || '',
          inputmode: type === 'number' ? 'numeric' : null,
          min: type === 'number' ? '1900' : null, max: type === 'number' ? '2100' : null,
          placeholder: type === 'number' ? '—' : '',
          onchange: function (ev) {
            var v = ev.target.value.trim();
            Store.patch(kind, id, definedOnly(key, v ? (type === 'number' ? Number(v) : v) : ''));
          }
        })
      ]);
    }
    function definedOnly(key, value) { var o = {}; o[key] = value; return o; }

    var note = h('textarea', {
      id: 'f-note', placeholder: 'Anything worth remembering',
      onchange: function (ev) { Store.patch(kind, id, {note: ev.target.value.trim()}); }
    });
    note.value = e.note || '';

    return h('div', {class: 'group'}, [
      h('h3', {text: 'Details'}),
      h('div', {class: 'fields'}, [
        field('first', 'First visit', 'number'),
        field('last', 'Last visit', 'number'),
        h('div', {class: 'field wide'}, [h('label', {text: 'Notes', for: 'f-note'}), note])
      ])
    ]);
  }

  function renderPanel() {
    el.panel.textContent = '';
    if (!selection) { el.panel.appendChild(emptyState()); return; }
    if (selection.kind === 'country') el.panel.appendChild(countryPanel(selection.id));
    else if (selection.kind === 'region') el.panel.appendChild(regionPanel(selection.id));
    else el.panel.appendChild(cityPanel(selection.id));
  }

  function emptyState() {
    var s = Store.stats();
    if (s.countries || s.territories || s.regions || s.cities) {
      return h('div', {class: 'panel-pad empty-state'}, [
        h('h2', {text: 'Pick a place'}),
        h('p', {text: 'Click anywhere on the map, or search, to set what a country, region or city was to you.'}),
        h('div', {class: 'inline-actions'}, [
          h('button', {class: 'btn', type: 'button', onclick: openChecklist, text: 'Open the checklist'}),
          h('button', {class: 'btn', type: 'button', onclick: armPin, text: 'Drop a pin'})
        ])
      ]);
    }
    return h('div', {class: 'panel-pad empty-state'}, [
      h('h2', {text: 'Start with a country'}),
      h('p', {text: 'Nothing is saved anywhere but this browser. Export a backup when it starts to matter.'}),
      h('ol', {}, [
        h('li', {text: 'Click a country on the map, or use the checklist to run through them in bulk.'}),
        h('li', {text: 'Been to only part of it? Open the country and colour its states or provinces.'}),
        h('li', {text: 'Add cities for the detail. A city lights up its region and country by itself.'})
      ]),
      h('div', {class: 'inline-actions'}, [
        h('button', {class: 'btn primary', type: 'button', onclick: openChecklist, text: 'Open the checklist'})
      ])
    ]);
  }

  function countryPanel(id) {
    var meta = Atlas.index.country[id];
    if (!meta) return h('div', {class: 'panel-pad', text: 'Unknown country.'});
    var eff = Store.effective();
    var derived = eff.countries[id];
    var explicit = Store.statusOf('country', id);

    var box = h('div', {class: 'panel-pad'});
    box.appendChild(h('p', {class: 'eyebrow', text: [meta.subregion, meta.kind === 'dependency' ? 'Territory' : null]
      .filter(Boolean).join(' · ')}));
    box.appendChild(h('h2', {text: meta.name}));
    var bits = [];
    if (meta.pop) bits.push(num(meta.pop) + ' people');
    if (derived && !explicit) bits.push('coloured ' + Store.byId[derived].verb + ' by what is inside it');
    if (bits.length) box.appendChild(h('p', {class: 'sub', text: bits.join(' · ')}));

    box.appendChild(h('div', {class: 'group'}, [
      h('h3', {text: 'This country'}),
      statusButtons('country', id, function (next) {
        Store.set('country', id, next);
      })
    ]));

    box.appendChild(detailFields('country', id));
    box.appendChild(regionSection(id));
    box.appendChild(citySection(id));
    return box;
  }

  var openGroups = {};

  function regionSection(countryId) {
    var group = h('div', {class: 'group'});
    if (!Atlas.regionsReady()) {
      group.appendChild(h('h3', {text: 'Regions'}));
      group.appendChild(h('p', {class: 'sub', text: 'Loading the state and province outlines…'}));
      Atlas.loadRegions(function (err) {
        if (err) { toast('Could not load region outlines.'); return; }
        refresh();
      });
      return group;
    }

    var ids = Atlas.index.regionsByCountry[countryId] || [];
    if (!ids.length) {
      group.appendChild(h('h3', {text: 'Regions'}));
      group.appendChild(h('p', {class: 'sub', text: 'No subdivisions mapped for this one.'}));
      return group;
    }

    var eff = Store.effective();
    var visited = function (rid) { return Store.rank(eff.regions[rid]) >= 2; };
    var done = ids.filter(visited).length;

    group.appendChild(h('h3', {}, [
      h('span', {text: pluralKind(ids)}),
      h('span', {class: 'hint', text: done + ' of ' + ids.length})
    ]));
    var meter = h('div', {class: 'meter'}, [h('i')]);
    meter.firstChild.style.width = (ids.length ? (done / ids.length) * 100 : 0) + '%';
    group.appendChild(meter);

    var list = h('ul', {class: 'rows scroller'});
    var grouped = groupRegions(ids);

    grouped.forEach(function (chunk) {
      if (chunk.name) {
        var hit = chunk.ids.filter(visited).length;
        var key = countryId + '/' + chunk.name;
        // Open a group on its own if you have been there, or if the country is
        // small enough that collapsing it helps nobody.
        if (openGroups[key] === undefined) openGroups[key] = hit > 0 || grouped.length < 3;
        var open = openGroups[key];
        list.appendChild(h('li', {class: 'group-row'}, [
          h('button', {
            class: 'cycle', type: 'button', 'aria-expanded': open ? 'true' : 'false',
            onclick: function () { openGroups[key] = !open; renderPanel(); }
          }, [
            h('span', {class: 'twist', text: open ? '▾' : '▸'}),
            swatch(bestOf(chunk.ids, eff)),
            h('span', {class: 'name', text: chunk.name}),
            h('span', {class: 'note', text: hit + ' / ' + chunk.ids.length})
          ]),
          h('button', {
            class: 'kill', type: 'button',
            title: hit === chunk.ids.length ? 'Clear all of ' + chunk.name : 'Mark all of ' + chunk.name + ' visited',
            text: hit === chunk.ids.length ? 'none' : 'all',
            onclick: function () {
              Store.setMany('region', chunk.ids, hit === chunk.ids.length ? null : 'visited');
            }
          })
        ]));
        if (!open) return;
      }

      chunk.ids.forEach(function (rid) {
        var rp = Atlas.index.region[rid];
        var status = eff.regions[rid];
        var own = Store.statusOf('region', rid);
        list.appendChild(h('li', {class: chunk.name ? 'nested' : ''}, [
          h('button', {
            class: 'cycle', type: 'button',
            title: 'Click to change · ' + (status ? Store.byId[status].label : 'not set'),
            onclick: function () { Store.cycle('region', rid); }
          }, [
            swatch(status),
            h('span', {class: 'name', text: rp ? rp.name : rid}),
            !own && status ? h('span', {class: 'note', text: 'via a city'}) : null
          ]),
          h('button', {
            class: 'kill', type: 'button', title: 'Open ' + (rp ? rp.name : rid),
            text: '\u203a',
            onclick: function () { select({kind: 'region', id: rid}, true); }
          })
        ]));
      });
    });
    group.appendChild(list);

    group.appendChild(h('div', {class: 'inline-actions'}, [
      h('button', {class: 'btn', type: 'button', text: 'Mark all visited',
        onclick: function () { Store.setMany('region', ids, 'visited'); }}),
      h('button', {class: 'btn', type: 'button', text: 'Clear all',
        onclick: function () { Store.setMany('region', ids, null); }}),
      h('button', {class: 'btn', type: 'button', text: map.focus === countryId ? 'Hide on map' : 'Show on map',
        onclick: function () {
          map.focus = map.focus === countryId ? null : countryId;
          map.draw();
          renderPanel();
        }})
    ]));
    group.appendChild(h('p', {class: 'sub tiny', text: map.focus === countryId
      ? 'Regions are drawn on the map until you hide them again.'
      : 'Regions draw themselves once you zoom in, or show them now.'}));
    return group;
  }

  /* "12 of 50 States", "3 of 47 Prefectures" - take whatever Natural Earth
     calls most of them and pluralise it. */
  function pluralKind(ids) {
    var counts = {};
    ids.forEach(function (rid) {
      var rp = Atlas.index.region[rid];
      var k = rp && rp.kind ? rp.kind : 'Region';
      counts[k] = (counts[k] || 0) + 1;
    });
    var best = 'Region', bestN = 0;
    for (var k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
    return best.replace(/y$/, 'ie') + 's';
  }

  function bestOf(ids, eff) {
    var best = null;
    ids.forEach(function (rid) {
      if (Store.rank(eff.regions[rid]) > Store.rank(best)) best = eff.regions[rid];
    });
    return best;
  }

  /* Natural Earth splits the UK into 232 councils and Italy into 110 provinces.
     Where it also tells us the grouping people actually use - England, Scotland,
     Toscana - list by that and let a whole chunk be marked at once. */
  function groupRegions(ids) {
    var named = {};
    var loose = [];
    var order = [];
    ids.forEach(function (rid) {
      var rp = Atlas.index.region[rid];
      var g = rp && rp.group;
      if (!g) { loose.push(rid); return; }
      if (!named[g]) { named[g] = []; order.push(g); }
      named[g].push(rid);
    });
    if (!order.length || ids.length < 12) return [{name: null, ids: ids}];
    var out = order.sort().map(function (g) { return {name: g, ids: named[g]}; });
    if (loose.length) out.push({name: 'Elsewhere', ids: loose});
    return out;
  }

  function citySection(countryId) {
    var group = h('div', {class: 'group'});
    var saved = Store.cities();
    var mine = Object.keys(saved).filter(function (k) { return saved[k].country === countryId; });
    group.appendChild(h('h3', {}, [
      h('span', {text: 'Cities'}),
      h('span', {class: 'hint', text: String(mine.length)})
    ]));

    if (mine.length) {
      var list = h('ul', {class: 'rows'});
      mine.sort(function (a, b) { return saved[a].name.localeCompare(saved[b].name); }).forEach(function (cid) {
        var city = saved[cid];
        list.appendChild(h('li', {}, [
          h('button', {class: 'cycle', type: 'button', onclick: function () { select({kind: 'city', id: cid}, true); }}, [
            swatch(city.status),
            h('span', {class: 'name', text: city.name}),
            city.first ? h('span', {class: 'note', text: String(city.first)}) : null
          ]),
          h('button', {class: 'kill', type: 'button', title: 'Remove', text: '\u00d7',
            onclick: function () { Store.removeCity(cid); }})
        ]));
      });
      group.appendChild(list);
    }

    group.appendChild(h('div', {class: 'inline-actions'}, [
      h('button', {class: 'btn', type: 'button', text: 'Add a city…',
        onclick: function () { openCityPicker(countryId); }}),
      h('button', {class: 'btn', type: 'button', text: 'Drop a pin', onclick: armPin})
    ]));
    return group;
  }

  function regionPanel(id) {
    var rp = Atlas.index.region[id];
    if (!rp) return h('div', {class: 'panel-pad', text: 'Unknown region.'});
    var parent = Atlas.index.country[rp.adm0];
    var box = h('div', {class: 'panel-pad'});
    box.appendChild(h('button', {
      class: 'back', type: 'button', text: '\u2039 ' + (parent ? parent.name : rp.adm0),
      onclick: function () { select({kind: 'country', id: rp.adm0}, false); }
    }));
    box.appendChild(h('p', {class: 'eyebrow', text: rp.kind || 'Region'}));
    box.appendChild(h('h2', {text: rp.name}));
    if (/^[A-Z]{2}-/.test(id)) box.appendChild(h('p', {class: 'sub', text: id}));

    box.appendChild(h('div', {class: 'group'}, [
      h('h3', {text: 'This region'}),
      statusButtons('region', id, function (next) { Store.set('region', id, next); })
    ]));
    box.appendChild(detailFields('region', id));

    var saved = Store.cities();
    var mine = Object.keys(saved).filter(function (k) { return saved[k].region === id; });
    if (mine.length) {
      var list = h('ul', {class: 'rows'});
      mine.forEach(function (cid) {
        list.appendChild(h('li', {}, [
          h('button', {class: 'cycle', type: 'button', onclick: function () { select({kind: 'city', id: cid}, true); }},
            [swatch(saved[cid].status), h('span', {class: 'name', text: saved[cid].name})])
        ]));
      });
      box.appendChild(h('div', {class: 'group'}, [h('h3', {text: 'Cities here'}), list]));
    }
    return box;
  }

  function cityPanel(id) {
    var city = Store.cities()[id];
    if (!city) { selection = null; return emptyState(); }
    var parent = city.country ? Atlas.index.country[city.country] : null;
    var region = city.region ? Atlas.index.region[city.region] : null;

    var box = h('div', {class: 'panel-pad'});
    if (parent) {
      box.appendChild(h('button', {
        class: 'back', type: 'button', text: '\u2039 ' + parent.name,
        onclick: function () { select({kind: 'country', id: parent.id}, false); }
      }));
    }
    box.appendChild(h('p', {class: 'eyebrow', text: 'City'}));
    box.appendChild(h('h2', {text: city.name}));
    box.appendChild(h('p', {class: 'sub', text: [region ? region.name : null, parent ? parent.name : null]
      .filter(Boolean).join(', ') || city.lat.toFixed(2) + ', ' + city.lon.toFixed(2)}));

    box.appendChild(h('div', {class: 'group'}, [
      h('h3', {text: 'This city'}),
      statusButtons('city', id, function (next) {
        if (!next) { Store.removeCity(id); selection = parent ? {kind: 'country', id: parent.id} : null; }
        else Store.set('city', id, next);
      })
    ]));
    box.appendChild(detailFields('city', id));
    return box;
  }

  // ---- city picker -------------------------------------------------------

  function openCityPicker(countryId) {
    withCities(function () {
      var meta = Atlas.index.country[countryId];
      var pool = (Atlas.index.citiesByCountry[countryId] || []).slice()
        .sort(function (a, b) { return b.pop - a.pop; });

      var input = h('input', {type: 'search', placeholder: 'Type a city name', autocomplete: 'off'});
      input.style.width = '100%';
      input.style.padding = '9px 11px';
      input.style.border = '1px solid var(--line-2)';
      input.style.borderRadius = '9px';
      input.style.background = 'var(--plane)';
      var list = h('ul', {class: 'rows scroller'});

      function paint() {
        var term = input.value.trim().toLowerCase();
        var hits = (term ? pool.filter(function (c) { return c.name.toLowerCase().indexOf(term) === 0; })
                         : pool).slice(0, 60);
        if (!hits.length && term) {
          hits = pool.filter(function (c) { return c.name.toLowerCase().indexOf(term) > -1; }).slice(0, 60);
        }
        list.textContent = '';
        if (!hits.length) {
          list.appendChild(h('li', {}, [h('span', {class: 'name', text: 'Nothing matches. Close this and use “Drop a pin”.'})]));
          return;
        }
        hits.forEach(function (c) {
          var already = !!Store.cities()[c.id];
          list.appendChild(h('li', {}, [
            h('button', {class: 'cycle', type: 'button', disabled: already ? true : null, onclick: function () {
              Store.addCity(c, 'visited');
              closeSheet();
              select({kind: 'city', id: String(c.id)}, false);
              toast(c.name + ' added');
            }}, [
              swatch(already ? Store.cities()[c.id].status : null),
              h('span', {class: 'name', text: c.name}),
              h('span', {class: 'note', text: already ? 'already pinned' : num(c.pop)})
            ])
          ]));
        });
      }

      input.addEventListener('input', paint);
      paint();
      openSheet('Add a city in ' + (meta ? meta.name : countryId), [input, list], [
        h('button', {class: 'btn', type: 'button', text: 'Done', onclick: closeSheet})
      ]);
      input.focus();
    });
  }

  function withCities(then) {
    if (Atlas.citiesReady()) { then(); return; }
    var note = h('div', {class: 'loading', text: 'Loading cities…'});
    el.wrap.appendChild(note);
    Atlas.loadCities(function (err) {
      note.remove();
      if (err) { toast('Could not load the city list.'); return; }
      then();
    });
  }

  function armPin() {
    pinMode = true;
    el.canvas.style.cursor = 'crosshair';
    toast('Click the map to drop a pin');
  }

  function dropPin(lonlat, hit) {
    var input = h('input', {type: 'text', placeholder: 'What is this place called?'});
    input.style.width = '100%';
    input.style.padding = '9px 11px';
    input.style.border = '1px solid var(--line-2)';
    input.style.borderRadius = '9px';
    input.style.background = 'var(--plane)';

    var country = hit && hit.kind === 'country' ? hit.id : (hit && hit.adm0) || null;
    var region = hit && hit.kind === 'region' ? hit.id : null;
    var where = country && Atlas.index.country[country] ? Atlas.index.country[country].name : 'open water';

    function commit() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var id = 'x' + Date.now().toString(36);
      Store.addCity({
        id: id, name: name, cc: null,
        lon: Number(lonlat[0].toFixed(4)), lat: Number(lonlat[1].toFixed(4)),
        country: country, region: region, custom: true
      }, 'visited');
      closeSheet();
      select({kind: 'city', id: id}, false);
    }

    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
    openSheet('Drop a pin', [
      h('p', {text: lonlat[1].toFixed(3) + ', ' + lonlat[0].toFixed(3) + ' — in ' + where}),
      input
    ], [
      h('button', {class: 'btn', type: 'button', text: 'Cancel', onclick: closeSheet}),
      h('button', {class: 'btn primary', type: 'button', text: 'Add pin', onclick: commit})
    ]);
    input.focus();
  }

  // ---- checklist ---------------------------------------------------------

  var view = 'map';   // 'map' | 'checklist' | 'summary'

  function show(next) {
    view = view === next ? 'map' : next;
    el.checklist.hidden = view !== 'checklist';
    el.summary.hidden = view !== 'summary';
    el.listToggle.setAttribute('aria-pressed', view === 'checklist' ? 'true' : 'false');
    el.sumToggle.setAttribute('aria-pressed', view === 'summary' ? 'true' : 'false');
    if (view === 'checklist') renderChecklist();
    if (view === 'summary') renderSummary();
    if (view === 'map') map.resize();
  }

  function openChecklist() { show('checklist'); }
  function openSummary() { show('summary'); }

  function renderSummary() {
    if (view !== 'summary') return;
    window.Summary.render(el.summary, {
      close: function () { show('map'); },
      open: function (target) { show('map'); select(target, true); }
    });
  }

  function renderChecklist() {
    if (view !== 'checklist') return;
    var eff = Store.effective();
    var byContinent = {};
    Atlas.countries().forEach(function (f) {
      var p = f.properties;
      var key = p.continent || 'Elsewhere';
      if (!byContinent[key]) byContinent[key] = [];
      byContinent[key].push(p);
    });

    el.checklist.textContent = '';
    el.checklist.appendChild(h('div', {class: 'checklist-head'}, [
      h('h2', {text: 'Every country on the map'}),
      h('p', {text: 'Click to cycle: visited → lived → stopover → want to go → blank. Faster than hunting for Andorra.'}),
      h('button', {class: 'btn', type: 'button', text: 'Back to the map', onclick: openChecklist})
    ]));

    Object.keys(byContinent).sort().forEach(function (continent) {
      var list = byContinent[continent].slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      var done = list.filter(function (p) { return Store.rank(eff.countries[p.id]) >= 2; }).length;
      var grid = h('div', {class: 'grid'});
      list.forEach(function (p) {
        var status = eff.countries[p.id];
        grid.appendChild(h('button', {
          class: 'chip' + (status ? ' on' : ''), type: 'button',
          title: p.longName + (status ? ' — ' + Store.byId[status].label : ''),
          onclick: function (ev) {
            if (ev.shiftKey) { show('map'); select({kind: 'country', id: p.id}, true); return; }
            Store.cycle('country', p.id);
          }
        }, [
          swatch(status),
          h('span', {class: 'name', text: p.name}),
          p.kind === 'dependency' ? h('span', {class: 'n', text: 'terr.'}) : null
        ]));
      });
      el.checklist.appendChild(h('section', {class: 'continent'}, [
        h('h3', {}, [h('span', {text: continent}), h('span', {class: 'n', text: done + ' / ' + list.length})]),
        grid
      ]));
    });

    el.checklist.appendChild(h('p', {class: 'sub', style: 'margin-top:26px;color:var(--ink-3);font-size:12.5px',
      text: 'Shift-click a country to open it on the map instead.'}));
  }

  // ---- search ------------------------------------------------------------

  var searchIndexReady = false;
  var activeResult = -1;

  function ensureSearchData() {
    if (searchIndexReady) return;
    searchIndexReady = true;
    Atlas.loadRegions(function () { if (el.q.value) runSearch(); });
    Atlas.loadCities(function () { if (el.q.value) runSearch(); });
  }

  /* Ranking, in order: a country whose name starts with what you typed, then
     its formal name, then a big city, then a region, then anything containing
     the term. Without the size tie-break "united stat" hands you the U.S.
     Virgin Islands, because its formal name also starts that way and it happens
     to be a shorter string. */
  function runSearch() {
    var term = el.q.value.trim().toLowerCase();
    if (term.length < 2) { hideResults(); return; }

    var hits = [];
    Atlas.countries().forEach(function (f) {
      var p = f.properties;
      var at = p.name.toLowerCase().indexOf(term);
      var atLong = p.longName ? p.longName.toLowerCase().indexOf(term) : -1;
      if (at === -1 && atLong === -1) return;
      var score = at === 0 ? 0 : atLong === 0 ? 1 : 4;
      hits.push({
        score: score,
        tie: (p.kind === 'country' ? 0 : 1e6) - (p.area || 0) * 1e5,
        kind: 'country', id: p.id, name: p.name, sub: p.subregion || p.continent
      });
    });

    if (Atlas.regionsReady()) {
      var regions = Atlas.regions();
      for (var i = 0; i < regions.length && hits.length < 500; i++) {
        var rp = regions[i].properties;
        var ra = rp.name.toLowerCase().indexOf(term);
        if (ra === -1) continue;
        var owner = Atlas.index.country[rp.adm0];
        hits.push({
          score: ra === 0 ? 3 : 5, tie: rp.name.length,
          kind: 'region', id: rp.id, name: rp.name,
          sub: (rp.kind || 'Region') + ' · ' + (owner ? owner.name : rp.adm0)
        });
      }
    }

    if (Atlas.citiesReady()) {
      var cities = Atlas.cities();
      var cityHits = [];
      for (var j = 0; j < cities.length; j++) {
        if (cities[j].name.toLowerCase().indexOf(term) === 0) cityHits.push(cities[j]);
      }
      cityHits.sort(function (a, b) { return b.pop - a.pop; });
      cityHits.slice(0, 12).forEach(function (c) {
        var home = c.country ? Atlas.index.country[c.country] : null;
        var region = c.region ? Atlas.index.region[c.region] : null;
        hits.push({
          score: 2, tie: -c.pop, kind: 'city', id: String(c.id), city: c, name: c.name,
          sub: [region ? region.name : null, home ? home.name : c.cc].filter(Boolean).join(', ')
        });
      });
    }

    hits.sort(function (a, b) { return a.score - b.score || a.tie - b.tie; });
    showResults(hits.slice(0, 40));
  }

  function showResults(hits) {
    el.results.textContent = '';
    activeResult = -1;
    if (!hits.length) {
      el.results.appendChild(h('li', {class: 'empty', text: 'Nothing found.'}));
    }
    hits.forEach(function (hit, i) {
      var status = hit.kind === 'city'
        ? (Store.cities()[hit.id] || {}).status
        : Store.effective()[hit.kind === 'country' ? 'countries' : 'regions'][hit.id];
      el.results.appendChild(h('li', {
        role: 'option', 'data-i': i, id: 'r-' + i,
        onclick: function () { pickResult(hit); }
      }, [
        swatch(status),
        h('span', {class: 'r-main'}, [
          h('span', {class: 'r-name', text: hit.name}),
          h('span', {class: 'r-sub', text: hit.sub || ''})
        ]),
        h('span', {class: 'r-kind', text: hit.kind})
      ]));
    });
    el.results.hidden = false;
    el.results.parentNode.setAttribute('aria-expanded', 'true');
  }

  function hideResults() {
    el.results.hidden = true;
    el.results.parentNode.setAttribute('aria-expanded', 'false');
    activeResult = -1;
  }

  function pickResult(hit) {
    el.q.value = '';
    hideResults();
    if (view !== 'map') show('map');
    if (hit.kind === 'city') {
      if (!Store.cities()[hit.id]) Store.addCity(hit.city, 'visited');
      select({kind: 'city', id: hit.id}, true);
    } else {
      select({kind: hit.kind, id: hit.id}, true);
    }
  }

  function moveResult(delta) {
    var items = el.results.querySelectorAll('li[role="option"]');
    if (!items.length) return;
    if (activeResult > -1) items[activeResult].removeAttribute('aria-selected');
    activeResult = (activeResult + delta + items.length) % items.length;
    items[activeResult].setAttribute('aria-selected', 'true');
    items[activeResult].scrollIntoView({block: 'nearest'});
  }

  // ---- selection ---------------------------------------------------------

  function select(next, fly) {
    selection = next;
    map.selected = next;
    if (next && next.kind === 'region') {
      map.focus = Atlas.index.countryOfRegion[next.id] || map.focus;
    } else if (next && next.kind === 'country') {
      if (map.focus && map.focus !== next.id) map.focus = null;
    }
    if (fly && next) flyTo(next);
    map.draw();
    renderPanel();
  }

  function flyTo(target) {
    if (target.kind === 'country') {
      var meta = Atlas.index.country[target.id];
      if (meta && meta.bounds) map.fitBounds(meta.bounds, meta.tiny ? 30 : 22);
    } else if (target.kind === 'region') {
      var owner = Atlas.index.country[Atlas.index.countryOfRegion[target.id]];
      if (owner && owner.bounds) map.fitBounds(owner.bounds, 22);
    } else {
      var city = Store.cities()[target.id];
      if (city) {
        var pad = 2.5;
        map.fitBounds([city.lon - pad, city.lat - pad, city.lon + pad, city.lat + pad], 40);
      }
    }
  }

  // ---- sheet -------------------------------------------------------------

  function openSheet(title, body, actions) {
    el.sheetTitle.textContent = title;
    el.sheetBody.textContent = '';
    body.forEach(function (n) { el.sheetBody.appendChild(n); });
    el.sheetActions.textContent = '';
    (actions || []).forEach(function (n) { el.sheetActions.appendChild(n); });
    el.sheet.hidden = false;
  }

  function closeSheet() { el.sheet.hidden = true; }

  el.sheet.addEventListener('click', function (e) { if (e.target === el.sheet) closeSheet(); });

  // ---- backup ------------------------------------------------------------

  function download(name, text, type) {
    var blob = new Blob([text], {type: type});
    var url = URL.createObjectURL(blob);
    var a = h('a', {href: url, download: name});
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  function menuAction(act) {
    el.menu.hidden = true;
    el.menuBtn.setAttribute('aria-expanded', 'false');
    if (act === 'export') {
      download('been-there-' + stamp() + '.json', JSON.stringify(Store.toJSON(), null, 2), 'application/json');
      Store.markExported();
      toast('Backup saved to your downloads');
    } else if (act === 'csv') {
      download('been-there-' + stamp() + '.csv', Store.toCSV(), 'text/csv');
    } else if (act === 'import') {
      el.file.click();
    } else if (act === 'reset') {
      openSheet('Erase everything?', [
        h('p', {text: 'This clears every country, region and city in this browser. It cannot be undone, and there is no copy anywhere else.'}),
        h('p', {text: 'Export a backup first if you are not sure.'})
      ], [
        h('button', {class: 'btn', type: 'button', text: 'Keep it', onclick: closeSheet}),
        h('button', {class: 'btn danger', type: 'button', text: 'Erase everything', onclick: function () {
          Store.reset();
          selection = null;
          map.focus = null;
          closeSheet();
          toast('Cleared');
        }})
      ]);
    } else if (act === 'seed') {
      offerSeed(true);
    } else if (act === 'counting') {
      var box = h('input', {type: 'checkbox'});
      box.checked = !!Store.settings().countStopovers;
      box.addEventListener('change', function () { Store.setSetting('countStopovers', box.checked); });
      openSheet('What counts as visited', [
        h('p', {text: 'The totals in the header count a place once it is marked Visited or Lived there. Want to go never counts.'}),
        h('p', {text: 'Stopovers are the argument everyone has with themselves: an airport layover, a train change, a cruise stop. They get their own colour so the map stays honest either way.'}),
        h('label', {style: 'display:flex;gap:9px;align-items:center;margin-top:14px'}, [
          box, h('span', {text: 'Count stopovers in my totals'})
        ]),
        h('p', {style: 'margin-top:18px', text: 'A city also counts its region and its country automatically — you never have to tick the same trip twice.'})
      ], [h('button', {class: 'btn primary', type: 'button', text: 'Got it', onclick: closeSheet})]);
    }
  }

  el.file.addEventListener('change', function () {
    var f = el.file.files && el.file.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(reader.result));
      } catch (err) {
        toast('That file is not valid JSON.');
        return;
      }
      openSheet('Import ' + f.name, [
        h('p', {text: 'Replace wipes what is in this browser and uses the file. Merge keeps both, and where they disagree the stronger status wins.'})
      ], [
        h('button', {class: 'btn', type: 'button', text: 'Cancel', onclick: closeSheet}),
        h('button', {class: 'btn', type: 'button', text: 'Merge', onclick: function () { doImport(payload, 'merge'); }}),
        h('button', {class: 'btn primary', type: 'button', text: 'Replace', onclick: function () { doImport(payload, 'replace'); }})
      ]);
    };
    reader.readAsText(f);
    el.file.value = '';
  });

  function doImport(payload, mode) {
    try {
      Store.fromJSON(payload, mode);
      // You are holding a file that contains all of this, so the nudge can rest.
      Store.markExported();
      selection = null;
      closeSheet();
      toast(mode === 'merge' ? 'Merged' : 'Imported');
    } catch (err) {
      closeSheet();
      toast(err.message);
    }
  }

  /* The repo ships a travel history in data/travels.js. It loads itself the
     first time the app runs with nothing saved, and can be merged back in from
     the menu afterwards - never silently over the top of your own edits. */
  function offerSeed(explicit) {
    if (window.TM_TRAVELS === undefined) {
      // Not looked for yet. It is gitignored, so most copies will not have one.
      Atlas.loadOptional('data/travels.js', function () {
        if (window.TM_TRAVELS === undefined) window.TM_TRAVELS = null;
        offerSeed(explicit);
      });
      return;
    }
    var seed = window.TM_TRAVELS;
    if (!seed) {
      if (explicit) toast('No travel history is bundled with this copy.');
      return;
    }
    var counts = Object.keys(seed.countries || {}).length + ' countries and ' +
      Object.keys(seed.cities || {}).length + ' cities';

    if (!explicit) {
      Store.fromJSON({data: seed}, 'merge');
      toast('Loaded ' + counts);
      return;
    }
    openSheet('Load the starter travels', [
      h('p', {text: 'This copy ships with ' + counts + '. Merge keeps anything you have already marked and adds the rest; replace throws yours away.'})
    ], [
      h('button', {class: 'btn', type: 'button', text: 'Cancel', onclick: closeSheet}),
      h('button', {class: 'btn', type: 'button', text: 'Replace', onclick: function () {
        Store.fromJSON({data: seed}, 'replace'); closeSheet(); toast('Loaded ' + counts);
      }}),
      h('button', {class: 'btn primary', type: 'button', text: 'Merge', onclick: function () {
        Store.fromJSON({data: seed}, 'merge'); closeSheet(); toast('Merged ' + counts);
      }})
    ]);
  }

  // ---- theme -------------------------------------------------------------

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    map.readTheme();
    map.draw();
  }

  function toggleTheme() {
    var current = Store.settings().theme;
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = current ? (current === 'dark' ? 'light' : 'dark') : (systemDark ? 'light' : 'dark');
    Store.setSetting('theme', next);
    applyTheme(next);
  }

  // ---- canvas interaction -------------------------------------------------

  var drag = null;
  var pointers = new Map();
  var pinchStart = null;

  function localPoint(e) {
    var rect = el.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  el.canvas.addEventListener('pointerdown', function (e) {
    el.canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localPoint(e));
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinchStart = {
        dist: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]),
        k: map.k
      };
      drag = null;
      return;
    }
    var p = localPoint(e);
    drag = {x: p[0], y: p[1], moved: 0, start: p};
    el.canvas.classList.add('dragging');
  });

  el.canvas.addEventListener('pointermove', function (e) {
    var p = localPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

    if (pointers.size === 2 && pinchStart) {
      var pts = Array.from(pointers.values());
      var dist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      var mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      var want = pinchStart.k * (dist / pinchStart.dist);
      map.zoomAt(want / map.k, mid[0], mid[1]);
      return;
    }

    if (drag) {
      var dx = p[0] - drag.x;
      var dy = p[1] - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = p[0];
      drag.y = p[1];
      map.panBy(dx, dy);
      hideTip();
      return;
    }

    if (e.pointerType === 'touch') return;
    var hit = map.at(p[0], p[1]);
    var changed = (hit && hit.id) !== (map.hover && map.hover.id);
    map.hover = hit ? {kind: hit.kind, id: hit.id} : null;
    if (changed) map.draw();
    if (hit) showTip(hit, p[0], p[1]); else hideTip();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    el.canvas.classList.remove('dragging');
    if (!drag) return;
    var moved = drag.moved;
    var start = drag.start;
    drag = null;
    if (moved > 6) return;
    var hit = map.at(start[0], start[1]);
    if (pinMode) {
      pinMode = false;
      el.canvas.style.cursor = '';
      var ll = map.toLonLat(start[0], start[1]);
      if (ll) dropPin(ll, hit);
      return;
    }
    if (!hit) { select(null, false); return; }
    select({kind: hit.kind, id: hit.id}, false);
  }

  el.canvas.addEventListener('pointerup', endPointer);
  el.canvas.addEventListener('pointercancel', endPointer);
  el.canvas.addEventListener('pointerleave', function () { map.hover = null; hideTip(); map.draw(); });

  el.canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = localPoint(e);
    var factor = Math.pow(1.0016, -e.deltaY * (e.deltaMode === 1 ? 16 : 1));
    map.zoomAt(factor, p[0], p[1]);
    hideTip();
  }, {passive: false});

  el.canvas.addEventListener('dblclick', function (e) {
    var p = localPoint(e);
    map.zoomAt(1.9, p[0], p[1]);
  });

  function showTip(hit, x, y) {
    var title, sub;
    if (hit.kind === 'city') {
      var city = Store.cities()[hit.id];
      if (!city) return;
      title = city.name;
      sub = city.status ? Store.byId[city.status].label : '';
    } else if (hit.kind === 'region') {
      var rp = Atlas.index.region[hit.id];
      if (!rp) return;
      title = rp.name;
      var rs = Store.effective().regions[hit.id];
      sub = (rs ? Store.byId[rs].label : 'Not set') + ' · ' +
        (Atlas.index.country[rp.adm0] ? Atlas.index.country[rp.adm0].name : rp.adm0);
    } else {
      var cp = Atlas.index.country[hit.id];
      if (!cp) return;
      title = cp.name;
      var cs = Store.effective().countries[hit.id];
      sub = cs ? Store.byId[cs].label : 'Not set';
    }
    el.tip.textContent = '';
    el.tip.appendChild(h('b', {text: title}));
    if (sub) el.tip.appendChild(h('span', {text: sub}));
    el.tip.hidden = false;
    var w = el.tip.offsetWidth;
    var hgt = el.tip.offsetHeight;
    var left = x + 14;
    var top = y + 14;
    if (left + w > el.wrap.clientWidth - 8) left = x - w - 14;
    if (top + hgt > el.wrap.clientHeight - 8) top = y - hgt - 14;
    el.tip.style.left = Math.max(8, left) + 'px';
    el.tip.style.top = Math.max(8, top) + 'px';
  }

  function hideTip() { el.tip.hidden = true; }

  // ---- wiring ------------------------------------------------------------

  $('zoom-in').addEventListener('click', function () { map.zoomAt(1.6, map.width / 2, map.height / 2); });
  $('zoom-out').addEventListener('click', function () { map.zoomAt(1 / 1.6, map.width / 2, map.height / 2); });
  $('zoom-reset').addEventListener('click', function () { map.reset(); });
  $('theme').addEventListener('click', toggleTheme);
  el.listToggle.addEventListener('click', openChecklist);
  el.sumToggle.addEventListener('click', openSummary);

  el.menuBtn.addEventListener('click', function () {
    var open = el.menu.hidden;
    el.menu.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  el.menu.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (b) menuAction(b.getAttribute('data-act'));
  });
  document.addEventListener('click', function (e) {
    if (!el.menu.hidden && !el.menu.contains(e.target) && e.target !== el.menuBtn && !el.menuBtn.contains(e.target)) {
      el.menu.hidden = true;
      el.menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (!el.results.hidden && !el.results.contains(e.target) && e.target !== el.q) hideResults();
  });

  el.q.addEventListener('focus', ensureSearchData);
  el.q.addEventListener('input', runSearch);
  el.q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveResult(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveResult(-1); }
    else if (e.key === 'Escape') { el.q.value = ''; hideResults(); }
    else if (e.key === 'Enter') {
      var items = el.results.querySelectorAll('li[role="option"]');
      if (items.length) items[Math.max(0, activeResult)].click();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!el.sheet.hidden) { closeSheet(); return; }
      if (pinMode) { pinMode = false; el.canvas.style.cursor = ''; return; }
      if (view !== 'map') { show('map'); return; }
      if (selection) select(null, false);
    }
    if (e.key === '/' && document.activeElement !== el.q) {
      e.preventDefault();
      el.q.focus();
    }
  });

  window.addEventListener('resize', function () { map.resize(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (!Store.settings().theme) applyTheme(null);
  });

  /* The data lives in one browser and nowhere else, so the menu always says
     where the last copy of it is, and the button carries a dot once that answer
     is uncomfortable. */
  function renderBackupState() {
    var b = Store.backupState();
    if (!Store.storageWorks()) {
      el.storageNote.textContent = 'This browser is blocking storage — export a backup before you close the tab.';
    } else if (b.empty) {
      el.storageNote.textContent = 'Saved in this browser only.';
    } else if (!b.ever) {
      el.storageNote.textContent = 'Saved in this browser only, and never backed up. Clearing site data would take it with it.';
    } else if (b.days === 0) {
      el.storageNote.textContent = 'Backed up today.';
    } else {
      el.storageNote.textContent = 'Last backup ' + b.days + (b.days === 1 ? ' day' : ' days') + ' ago.';
    }
    var nag = b.overdue || !Store.storageWorks();
    el.menuBtn.classList.toggle('flagged', nag);
    el.menuBtn.setAttribute('title', nag ? 'Data — no recent backup' : 'Data');

    if (nag && !nagged) {
      nagged = true;
      setTimeout(function () {
        if (!Store.backupState().overdue && Store.storageWorks()) return;
        toast(Store.storageWorks()
          ? 'Worth exporting a backup — this is the only copy'
          : 'This browser will not save. Export a backup before you close the tab.');
      }, 2500);
    }
  }

  var nagged = false;

  function refresh() {
    map.draw();
    renderTiles();
    renderLegend();
    renderPanel();
    renderChecklist();
    renderSummary();
    renderBackupState();
  }

  Store.subscribe(function (reason) {
    if (reason === 'storage-failed') nagged = false;
    refresh();
  });

  // ---- go ----------------------------------------------------------------

  Atlas.init();
  // Handy from the console, and the only thing the page puts on window besides
  // the data globals.
  window.BeenThere = {map: map, store: Store, atlas: Atlas, select: select, show: show};
  if (Store.isEmpty()) offerSeed(false);
  applyTheme(Store.settings().theme);
  map.readTheme();
  map.resize();
  refresh();

  // Region outlines are the second-biggest file and almost everyone drills into
  // something eventually, so start them once the first paint is on screen.
  requestAnimationFrame(function () {
    setTimeout(function () { Atlas.loadRegions(function () { refresh(); }); }, 400);
  });
})();
