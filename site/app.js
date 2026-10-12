// Renders data/*.json. All content lives in data/; nothing here is listing-specific.
(async function () {
  const DATA = 'data/';
  const [db, sources, zones] = await Promise.all([
    fetch(DATA + 'properties.json').then(r => r.json()),
    fetch(DATA + 'sources.json').then(r => r.json()),
    fetch(DATA + 'isochrone.geojson').then(r => r.json()),
  ]);
  const all = db.properties;
  const srcName = Object.fromEntries(sources.sites.map(s => [s.id, s.name]));
  const caution = new Set(sources.sites.filter(s => s.verdict === 'included-with-caution').map(s => s.id));

  const LABEL = {
    type: { apartment: 'Apartment', 'independent-house': 'Independent house', 'independent-floor': 'Independent floor', villa: 'Villa' },
    furnishing: { unfurnished: 'Unfurnished', 'semi-furnished': 'Semi-furnished', 'fully-furnished': 'Fully furnished' },
    posted_by: { owner: 'Owner', agent: 'Agent / broker', builder: 'Builder' },
  };
  const label = (k, v) => (LABEL[k] && LABEL[k][v]) || v || 'Not stated';
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const $ = id => document.getElementById(id);

  // ---- header + method ----
  $('summary').textContent =
    `${all.filter(p => p.status === 'active').length} live listings · 3BHK · car parking · available by Jan 2027 · updated ${fmtDate(db.updated)}`;
  $('method').innerHTML = (db.method || []).map(p => `<p>${p}</p>`).join('');
  const tbody = document.querySelector('#src-table tbody');
  for (const s of sources.sites) {
    const tr = document.createElement('tr');
    const cls = s.verdict === 'excluded' ? 'excluded' : s.verdict === 'included-with-caution' ? 'caution' : '';
    const ratings = (s.ratings || []).map(r =>
      `${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${r.platform}</a>` : r.platform}: ${r.rating ?? '—'}${r.count ? ` (${Number(r.count).toLocaleString('en-IN')})` : ''}`
    ).join('<br>') || 'None found';
    tr.innerHTML = `<td><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></td>
      <td class="verdict ${cls}">${{ included: 'Used', 'included-with-caution': 'Used, with care', excluded: 'Not used' }[s.verdict] || s.verdict}</td>
      <td>${ratings}</td><td>${s.reason || ''}</td>`;
    tbody.appendChild(tr);
  }

  // Filters start collapsed on phones so the map and results are visible first.
  if (matchMedia('(max-width: 860px)').matches) $('filters-wrap').open = false;

  // ---- filter controls ----
  const rents = all.map(p => p.rent);
  const rentMax = Math.ceil(Math.max(...rents, 50000) / 5000) * 5000;
  const rentEl = $('f-rent');
  rentEl.min = Math.floor(Math.min(...rents, 10000) / 5000) * 5000;
  rentEl.max = rentMax;

  function chips(id, key, values) {
    const box = $(id);
    const counts = {};
    all.forEach(p => { const v = p[key] ?? 'unknown'; counts[v] = (counts[v] || 0) + 1; });
    for (const v of values.filter(v => counts[v])) {
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox" value="${v}"> ${key === 'source' ? (srcName[v] || v) : label(key, v === 'unknown' ? null : v)} <span class="n">${counts[v]}</span>`;
      box.appendChild(l);
    }
    return () => [...box.querySelectorAll('input:checked')].map(i => i.value);
  }
  const uniq = key => [...new Set(all.map(p => p[key] ?? 'unknown'))].sort();
  const getType = chips('f-type', 'type', uniq('type'));
  const getFurn = chips('f-furn', 'furnishing', uniq('furnishing'));
  const getBy = chips('f-by', 'posted_by', uniq('posted_by'));
  const getSrc = chips('f-src', 'source', uniq('source'));

  const defaults = { q: '', rent: rentMax, min: 30, avail: '', inactive: false, sort: 'minutes' };
  function setControls(s) {
    $('f-q').value = s.q; rentEl.value = s.rent; $('f-min').value = s.min;
    $('f-avail').value = s.avail; $('f-inactive').checked = s.inactive; $('f-sort').value = s.sort;
  }
  setControls(defaults);

  // ---- map ----
  const map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · Drive zone: Valhalla (FOSSGIS)',
  }).addTo(map);
  const css = getComputedStyle(document.documentElement);
  const zoneLayer = L.geoJSON(zones, {
    style: f => f.properties.id === 'evening'
      ? { color: css.getPropertyValue('--eve').trim(), weight: 2, fillOpacity: 0.12 }
      : { color: css.getPropertyValue('--mor').trim(), weight: 2, dashArray: '6 6', fill: false },
    onEachFeature: (f, l) => l.bindTooltip(f.properties.label),
  }).addTo(map);
  map.fitBounds(zoneLayer.getBounds(), { padding: [10, 10] });
  L.marker([db.origin.lat, db.origin.lon], { title: db.origin.name }).addTo(map).bindPopup(`<b>${db.origin.name}</b>`);
  const pins = L.layerGroup().addTo(map);
  const accent = css.getPropertyValue('--accent').trim();

  // ---- render ----
  const tpl = $('card-tpl');
  const list = $('list');

  function matches(p) {
    const q = $('f-q').value.trim().toLowerCase();
    if (!$('f-inactive').checked && p.status !== 'active') return false;
    if (p.rent > +rentEl.value) return false;
    if (p.minutes_peak > +$('f-min').value) return false;
    const inSet = (sel, v) => !sel.length || sel.includes(v ?? 'unknown');
    if (!inSet(getType(), p.type) || !inSet(getFurn(), p.furnishing) || !inSet(getBy(), p.posted_by) || !inSet(getSrc(), p.source)) return false;
    const a = $('f-avail').value, af = p.available_from;
    if (a && af === null) return false;
    if (a === 'now' && af !== 'immediate' && af > db.updated) return false;
    if (a && a !== 'now' && af !== 'immediate' && af > a) return false;
    if (q) {
      const hay = [p.title, p.locality, p.address, p.notes, srcName[p.source]].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(t => hay.includes(t))) return false;
    }
    return true;
  }

  function sortFn(key) {
    const desc = key.startsWith('-'); const k = desc ? key.slice(1) : key;
    const field = k === 'minutes' ? 'minutes_peak' : k;
    return (a, b) => {
      const x = a[field] ?? (desc ? -Infinity : Infinity), y = b[field] ?? (desc ? -Infinity : Infinity);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) || a.minutes_peak - b.minutes_peak;
    };
  }

  function render() {
    $('o-rent').textContent = 'up to ' + inr(rentEl.value);
    $('o-min').textContent = $('f-min').value + ' min';
    const rows = all.filter(matches).sort(sortFn($('f-sort').value));
    $('count').textContent = `${rows.length} of ${all.length} listing${all.length === 1 ? '' : 's'} shown`;
    list.replaceChildren();
    pins.clearLayers();
    if (!rows.length) list.innerHTML = '<li class="empty">Nothing matches these filters. Try widening rent or drive time.</li>';
    for (const p of rows) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.id = 'p-' + p.id;
      if (p.status !== 'active') li.classList.add('inactive');
      li.querySelector('.rent').innerHTML = `${inr(p.rent)}<small>/month${p.maintenance ? ' + ' + inr(p.maintenance) + ' maint.' : ''}</small>`;
      li.querySelector('.mins').textContent = `~${p.minutes_peak} min from Stanley`;
      li.querySelector('.mins').title = `${p.road_km} km by road · ~${p.minutes_morning} min in morning rush, ~${p.minutes_peak} min in evening rush`;
      li.querySelector('.title').textContent = p.title;
      li.querySelector('.loc').textContent = [p.address, p.locality].filter(Boolean).join(', ');
      const facts = [
        label('type', p.type),
        p.area_sqft && `${p.area_sqft.toLocaleString('en-IN')} sq ft`,
        label('furnishing', p.furnishing),
        p.parking === 'car+bike' ? 'Car + bike parking' : 'Car parking',
        p.available_from === 'immediate' ? 'Available now' : p.available_from ? 'From ' + fmtDate(p.available_from) : 'Move-in date not stated',
        p.deposit && 'Deposit ' + inr(p.deposit),
        p.floor && 'Floor ' + p.floor,
        p.posted_by && 'By ' + label('posted_by', p.posted_by).toLowerCase(),
      ].filter(Boolean);
      const ul = li.querySelector('.facts');
      facts.forEach(f => { const x = document.createElement('li'); x.textContent = f; ul.appendChild(x); });
      const notes = li.querySelector('.notes');
      notes.textContent = (p.status !== 'active' ? 'No longer live on the source site. ' : '') + (p.notes || '');
      if (caution.has(p.source)) {
        const w = document.createElement('span');
        w.className = 'badge-warn';
        w.textContent = 'Unverified site: see the home in person before paying anything. ';
        notes.prepend(w);
      }
      const a = li.querySelector('.link');
      a.href = p.source_url;
      a.textContent = 'View on ' + (srcName[p.source] || p.source) + ' ↗';
      li.querySelector('.seen').textContent = 'Checked ' + fmtDate(p.last_checked);
      list.appendChild(li);

      if (p.lat != null) {
        const m = L.circleMarker([p.lat, p.lon], {
          radius: 7, color: '#fff', weight: 1.5, fillColor: accent, fillOpacity: p.status === 'active' ? 0.95 : 0.35,
        }).bindPopup(`<b>${inr(p.rent)}/mo</b> · ~${p.minutes_peak} min<br>${p.title}<br><a href="#p-${p.id}">See details</a> · <a href="${p.source_url}" target="_blank" rel="noopener">Source ↗</a>`);
        m.on('click', () => {
          document.querySelectorAll('.card.hl').forEach(c => c.classList.remove('hl'));
          li.classList.add('hl');
        });
        pins.addLayer(m);
      }
    }
  }

  document.querySelector('.filters').addEventListener('input', render);
  $('f-reset').addEventListener('click', () => {
    setControls(defaults);
    document.querySelectorAll('.chips input').forEach(i => { i.checked = false; });
    render();
  });
  render();
})().catch(err => {
  document.getElementById('summary').textContent = 'Could not load data: ' + err.message;
});
