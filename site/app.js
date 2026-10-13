// Renders data/*.json. All content lives in data/; nothing here is listing-specific.
(async function () {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;

  // ---------- theme ----------
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches;
  const syncThemeBtn = () => $('theme-btn').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  $('theme-btn').addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    syncThemeBtn();
  });
  darkQuery.addEventListener('change', syncThemeBtn);
  syncThemeBtn();

  // Header height feeds the sticky map offset.
  const setHeadH = () => root.style.setProperty('--head-h', document.querySelector('.top').offsetHeight + 'px');
  new ResizeObserver(setHeadH).observe(document.querySelector('.top'));

  // ---------- data ----------
  const DATA = 'data/';
  let db, sources, zones;
  try {
    [db, sources, zones] = await Promise.all(['properties.json', 'sources.json', 'isochrone.geojson']
      .map(f => fetch(DATA + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); })));
  } catch (err) {
    $('count').textContent = 'Could not load listings (' + err.message + '). Please refresh.';
    return;
  }
  const all = db.properties;
  const site = Object.fromEntries(sources.sites.map(s => [s.id, s]));
  const srcName = id => (site[id] && site[id].name) || id;

  const LABEL = {
    type: { apartment: 'Apartment', 'independent-house': 'Independent house', 'independent-floor': 'Independent floor', villa: 'Villa' },
    furnishing: { unfurnished: 'Unfurnished', 'semi-furnished': 'Semi-furnished', 'fully-furnished': 'Fully furnished' },
    posted_by: { owner: 'Owner', agent: 'Agent / broker', builder: 'Builder' },
    preferred_tenants: { family: 'Family', any: 'Anyone', bachelors: 'Bachelors' },
  };
  const label = (k, v) => (LABEL[k] && LABEL[k][v]) || v || 'Not stated';
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');
  const short = n => n >= 100000 ? '₹' + +(n / 100000).toFixed(2) + 'L' : '₹' + +(n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k';
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = s => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  const availText = p => p.available_from === 'immediate' ? 'Available now'
    : p.available_from ? 'From ' + fmtDate(p.available_from) : 'Move-in date not stated';

  $('updated').textContent = `Updated ${fmtDate(db.updated)} · ${all.filter(p => p.status === 'active').length} live listings`;

  // ---------- new since last visit ----------
  // Remembered per browser: the ids live at the previous visit (a visit ends
  // after 3 hours, so reloads don't clear the "New" badges).
  const VISIT_GAP_MS = 3 * 3600 * 1000;
  const liveIds = all.filter(p => p.status === 'active').map(p => p.id);
  let newIds = new Set();
  try {
    const store = JSON.parse(localStorage.getItem('visits') || '{}');
    const now = Date.now();
    if (store.last && now - store.last.at > VISIT_GAP_MS) store.base = store.last;
    if (store.base) {
      const seen = new Set(store.base.ids);
      newIds = new Set(liveIds.filter(id => !seen.has(id)));
    }
    store.last = { at: now, ids: liveIds };
    localStorage.setItem('visits', JSON.stringify(store));
  } catch (e) {}
  const postedText = d => {
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((today - new Date(d + 'T00:00:00')) / 864e5);
    return days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : days < 7 ? `Posted ${days} days ago`
      : 'Posted ' + new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  // ---------- state ----------
  const rents = all.map(p => p.rent);
  const sortedRents = [...rents].sort((a, b) => a - b);
  const rentMin = Math.floor(sortedRents[0] / 1000) * 1000;
  // Top of the slider = "Any"; the scale stops at the 95th percentile so a few
  // very expensive homes don't squash the useful range.
  const rentMax = Math.ceil(sortedRents[Math.floor(sortedRents.length * 0.95)] / 5000) * 5000;
  const DEFAULTS = () => ({
    q: '', bhk: new Set(['3']), rent: rentMax, min: 30, avail: '', sort: 'newest',
    type: new Set(), furnishing: new Set(), posted_by: new Set(), source: new Set(), inactive: false,
    south: true, // only homes south of the chosen point (on by default)
    onlyNew: false,
  });
  let S = DEFAULTS();

  // ---------- controls ----------
  const bhkBox = $('f-bhk');
  [...new Set(all.map(p => p.bhk))].sort().forEach(b => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.dataset.v = String(b); btn.textContent = b + ' BHK';
    btn.addEventListener('click', () => {
      const v = btn.dataset.v;
      if (S.bhk.has(v) && S.bhk.size === 1) return; // keep at least one selected
      S.bhk.has(v) ? S.bhk.delete(v) : S.bhk.add(v);
      render();
    });
    bhkBox.appendChild(btn);
  });

  const rentEl = $('f-rent');
  rentEl.min = rentMin; rentEl.max = rentMax;
  $('rent-lo').textContent = inr(rentMin); $('rent-hi').textContent = inr(rentMax) + '+';
  rentEl.addEventListener('input', () => { S.rent = +rentEl.value; render(); });
  $('f-min').addEventListener('input', e => { S.min = +e.target.value; render(); });
  $('f-avail').addEventListener('change', e => { S.avail = e.target.value; render(); });
  $('f-sort').addEventListener('change', e => { S.sort = e.target.value; render(); });
  let qTimer;
  $('f-q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; render(); }, 120); });

  // One popover open at a time; close on outside click / Escape.
  const pops = [...document.querySelectorAll('details.pop')];
  pops.forEach(d => d.addEventListener('toggle', () => { if (d.open) pops.forEach(o => { if (o !== d) o.open = false; }); }));
  // A tap outside an open popover only closes it. The guard expires quickly so
  // a scroll gesture (pointerdown with no click) can't swallow a later tap.
  let swallowUntil = 0;
  document.addEventListener('pointerdown', e => {
    const open = pops.find(d => d.open);
    if (open && !e.target.closest('details.pop')) { open.open = false; swallowUntil = Date.now() + 500; }
  }, true);
  document.addEventListener('click', e => {
    if (Date.now() < swallowUntil && !e.target.closest('details.pop')) {
      swallowUntil = 0; e.preventDefault(); e.stopPropagation();
    }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = pops.find(d => d.open);
    if (open) { open.open = false; open.querySelector('summary').focus(); }
  });

  function optionGroup(boxId, key) {
    const counts = {};
    all.forEach(p => { const v = p[key] ?? 'unknown'; counts[v] = (counts[v] || 0) + 1; });
    const box = $(boxId);
    Object.keys(counts).sort().forEach(v => {
      const l = document.createElement('label');
      l.className = 'opt';
      const name = key === 'source' ? srcName(v) : label(key, v === 'unknown' ? null : v);
      l.innerHTML = `<input type="checkbox" value="${esc(v)}"> <span>${esc(name)}</span> <span class="n">${counts[v]}</span>`;
      l.querySelector('input').addEventListener('change', e => {
        e.target.checked ? S[key].add(v) : S[key].delete(v);
        render();
      });
      box.appendChild(l);
    });
  }
  optionGroup('f-type', 'type');
  optionGroup('f-furn', 'furnishing');
  optionGroup('f-by', 'posted_by');
  optionGroup('f-src', 'source');
  $('f-new').addEventListener('click', () => { S.onlyNew = !S.onlyNew; render(); });
  $('f-south').addEventListener('click', () => { S.south = !S.south; render(); });
  $('f-inactive').addEventListener('change', e => { S.inactive = e.target.checked; render(); });

  const moreDlg = $('more-dlg');
  $('more-btn').addEventListener('click', () => moreDlg.showModal());
  $('clear-btn').addEventListener('click', () => {
    const keep = { q: S.q, sort: S.sort };
    S = Object.assign(DEFAULTS(), keep);
    syncControls(); render();
  });
  moreDlg.addEventListener('click', e => { if (e.target === moreDlg) moreDlg.close(); });

  function syncControls() {
    $('f-q').value = S.q;
    rentEl.value = S.rent;
    $('f-min').value = S.min;
    $('f-sort').value = S.sort;
    $('f-inactive').checked = S.inactive;
    document.querySelectorAll('#f-avail input').forEach(i => { i.checked = i.value === S.avail; });
    for (const [box, key] of [['f-type', 'type'], ['f-furn', 'furnishing'], ['f-by', 'posted_by'], ['f-src', 'source']]) {
      $(box).querySelectorAll('input').forEach(i => { i.checked = S[key].has(i.value); });
    }
  }
  syncControls();

  // ---------- map ----------
  const hasMap = !!window.L;
  if (!hasMap) document.querySelector('.mapwrap').innerHTML = '<p class="empty" style="padding:24px">The map could not load. The list still works.</p>';
  const map = hasMap ? L.map('map', { zoomControl: true, scrollWheelZoom: true }) : null;
  let fitZone = () => {};
  if (hasMap) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · zone: Valhalla',
  }).addTo(map);
  const zoneLayer = L.geoJSON(zones, {
    style: f => ({ className: f.properties.id === 'evening' ? 'zone-eve' : 'zone-mor' }),
    interactive: false,
  }).addTo(map);
  fitZone = () => map.fitBounds(zoneLayer.getBounds(), { padding: [16, 16] });
  fitZone();
  // Price pills only once zoomed in; dots keep the overview readable.
  const syncZoom = () => map.getContainer().classList.toggle('far', map.getZoom() < 13);
  map.on('zoomend', syncZoom); syncZoom();
  L.marker([db.origin.lat, db.origin.lon], {
    icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: '<span class="origin" aria-label="Chosen point"></span>' }),
    zIndexOffset: 2000, keyboard: false,
  }).addTo(map).bindTooltip(esc(db.origin.label || 'Chosen point'));
  }
  // Dashed east-west line through the chosen point while "South only" is on.
  const southLine = hasMap ? L.polyline([[db.origin.lat, 79.9], [db.origin.lat, 80.6]],
    { className: 'south-line', interactive: false }) : null;
  const pins = hasMap ? L.layerGroup().addTo(map) : null;
  const markerById = new Map();

  function setActive(id, on) {
    const m = markerById.get(id);
    if (m && m.getElement()) {
      m.getElement().classList.toggle('on', on);
      m.getElement().firstElementChild.classList.toggle('on', on);
    }
    const card = $('p-' + id);
    if (card) card.classList.toggle('hl', on);
  }

  // Mobile list/map toggle.
  let fittedOnOpen = false;
  $('map-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('map-open');
    $('map-toggle').setAttribute('aria-pressed', open);
    if (!hasMap) return;
    setTimeout(() => {
      map.invalidateSize();
      if (!fittedOnOpen) { fitZone(); fittedOnOpen = true; } // map was 0x0 when first fitted
    }, 50);
  });

  // ---------- filtering ----------
  function matches(p) {
    if (!S.inactive && p.status !== 'active') return false;
    if (S.south && p.lat > db.origin.lat) return false;
    if (S.onlyNew && !p._ignoreNew && !newIds.has(p.id)) return false;
    if (!S.bhk.has(String(p.bhk))) return false;
    if ((S.rent < rentMax && p.rent > S.rent) || p.minutes_peak > S.min) return false;
    for (const key of ['type', 'furnishing', 'posted_by', 'source']) {
      if (S[key].size && !S[key].has(p[key] ?? 'unknown')) return false;
    }
    const a = S.avail, af = p.available_from;
    if (a && af === null) return false;
    if (a === 'now' && af !== 'immediate' && af > db.updated) return false;
    if (a && a !== 'now' && af !== 'immediate' && af > a) return false;
    const q = S.q.trim().toLowerCase();
    if (q) {
      const hay = [p.title, p.locality, p.address, p.notes, srcName(p.source)].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(t => hay.includes(t))) return false;
    }
    return true;
  }
  function sorter(key) {
    if (key === 'newest') {
      // Newest to this site first, then the most recently posted on the portal.
      const d = v => v || '';
      return (a, b) => d(b.first_seen).localeCompare(d(a.first_seen))
        || d(b.posted_on).localeCompare(d(a.posted_on)) || a.minutes_peak - b.minutes_peak;
    }
    const desc = key.startsWith('-'); const k = desc ? key.slice(1) : key;
    const f = k === 'minutes' ? 'minutes_peak' : k;
    return (a, b) => {
      const x = a[f] ?? (desc ? -Infinity : Infinity), y = b[f] ?? (desc ? -Infinity : Infinity);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) || a.minutes_peak - b.minutes_peak;
    };
  }

  // ---------- render ----------
  const GLYPH = {
    apartment: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="12" y="6" width="24" height="36" rx="2"/><path d="M18 13h4M26 13h4M18 20h4M26 20h4M18 27h4M26 27h4M21 42v-7h6v7"/></g></svg>',
    house: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 22 24 8l18 14"/><path d="M11 18v22h26V18"/><path d="M20 40V29h8v11"/></g></svg>',
  };

  const gmaps = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  const directions = p => `https://www.google.com/maps/dir/?api=1&origin=${db.origin.lat},${db.origin.lon}&destination=${p.lat},${p.lon}&travelmode=driving`;
  const lakh = n => n >= 100000 ? '₹' + +(n / 100000).toFixed(2) + 'L' : inr(n);

  function photoHtml(p, cls) {
    const fallback = `<div class="${cls}-none">${p.type === 'apartment' ? GLYPH.apartment : GLYPH.house}<span>No photos on ${esc(srcName(p.source))}</span></div>`;
    if (!p.photo) return fallback;
    return `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls}-none',textContent:'Photo unavailable'}))">
      ${p.photo_count > 1 ? `<span class="count-badge">${p.photo_count} photos</span>` : ''}`;
  }

  function card(p) {
    const li = document.createElement('li');
    li.className = 'card' + (p.status !== 'active' ? ' inactive' : '');
    li.id = 'p-' + p.id;
    const head = [`${p.bhk} BHK ${label('type', p.type).toLowerCase()}`, p.area_sqft && p.area_sqft.toLocaleString('en-IN') + ' sq ft'].filter(Boolean).join(' · ');
    const sub = [tidy(p.locality), p.deposit && 'Deposit ' + lakh(p.deposit)].filter(Boolean).join(' · ');
    const posted = postedText(p.posted_on);
    const chips = [
      newIds.has(p.id) && '<li class="new">New</li>',
      p.furnishing && `<li>${esc(label('furnishing', p.furnishing))}</li>`,
      `<li>${p.parking === 'car+bike' ? 'Car + bike parking' : 'Car parking'}</li>`,
      `<li class="${p.available_from ? 'ok' : ''}">${esc(availText(p))}</li>`,
      site[p.source] && site[p.source].verdict === 'included-with-caution' && '<li class="warn">Unverified site</li>',
      p.status !== 'active' && '<li class="warn">No longer live</li>',
    ].filter(Boolean).join('');
    const approx = p.location_precision !== 'listing';
    li.innerHTML = `
      <div class="thumb">${photoHtml(p, 'thumb')}</div>
      <div class="main">
        <p class="price"><b>${inr(p.rent)}</b> <span>/ month</span></p>
        <h3 class="title">${esc(head)}</h3>
        <p class="sub">${esc(sub)}</p>
        ${posted ? `<p class="posted">${esc(posted)}</p>` : ''}
        <ul class="chips">${chips}</ul>
      </div>
      <div class="side">
        <p class="time"><b>~${p.minutes_peak}</b> min<small>from chosen point · ${p.road_km} km</small></p>
        <div class="actions">
          <a class="btn btn-primary" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">View on ${esc(srcName(p.source))} ↗</a>
          <a class="btn" href="${gmaps(p)}" target="_blank" rel="noopener noreferrer" title="${approx ? 'Area centre: the listing gives no exact address' : 'Listing location on Google Maps'}">${approx ? 'Area on map' : 'Location'} ↗</a>
        </div>
      </div>
      <button class="card-open" type="button" aria-label="${esc(`${p.bhk} BHK in ${tidy(p.locality)}, ${inr(p.rent)} a month, ${p.minutes_peak} minutes away. Open details`)}"></button>`;
    li.querySelector('.card-open').addEventListener('click', () => openDetail(p));
    li.addEventListener('mouseenter', () => setActive(p.id, true));
    li.addEventListener('mouseleave', () => setActive(p.id, false));
    return li;
  }

  function render() {
    bhkBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', S.bhk.has(b.dataset.v)));
    $('o-rent').textContent = S.rent >= rentMax ? 'Any' : 'up to ' + short(S.rent);
    $('o-min').textContent = S.min + ' min';
    // The chosen value, shown inside the picker too.
    $('v-rent').textContent = S.rent >= rentMax ? `Any rent (${inr(rentMax)}+)` : `Up to ${inr(S.rent)} / month`;
    $('v-min').textContent = `Up to ${S.min} min`;
    $('o-avail').textContent = { '': 'Any', '2027-01-31': 'By Jan', '2026-12-31': 'By Dec', '2026-11-30': 'By Nov', now: 'Now' }[S.avail];
    document.getElementById('pop-rent').querySelector('.chip').classList.toggle('on', S.rent < rentMax);
    document.getElementById('pop-min').querySelector('.chip').classList.toggle('on', S.min !== 30);
    document.getElementById('pop-avail').querySelector('.chip').classList.toggle('on', S.avail !== '');
    const extra = S.type.size + S.furnishing.size + S.posted_by.size + S.source.size + (S.inactive ? 1 : 0);
    $('f-south').setAttribute('aria-pressed', S.south);
    $('f-south').classList.toggle('on', S.south);
    if (southLine) S.south ? southLine.addTo(map) : southLine.remove();
    $('more-count').hidden = !extra; $('more-count').textContent = extra;
    $('more-btn').classList.toggle('on', extra > 0);

    const rows = all.filter(matches).sort(sorter(S.sort));
    const newCount = all.filter(p => newIds.has(p.id) && matches(Object.assign({}, p, { _ignoreNew: true }))).length;
    $('f-new').hidden = !newIds.size;
    $('f-new').textContent = S.onlyNew ? `Showing new only · show all` : `${newCount} new since your last visit`;
    $('f-new').setAttribute('aria-pressed', S.onlyNew);
    $('f-new').classList.toggle('on', S.onlyNew);
    $('count').textContent = `${rows.length} home${rows.length === 1 ? '' : 's'} within ${S.min} min`;
    $('apply-btn').textContent = `Show ${rows.length} home${rows.length === 1 ? '' : 's'}`;

    const list = $('list');
    list.replaceChildren();
    if (!rows.length) {
      list.innerHTML = '<li class="empty">No homes match. Try a higher rent, a longer drive, or clearing filters.</li>';
    }
    const frag = document.createDocumentFragment();
    rows.forEach(p => frag.appendChild(card(p)));
    list.appendChild(frag);

    if (!hasMap) return;
    pins.clearLayers(); markerById.clear();
    for (const p of rows) {
      if (p.lat == null) continue;
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: `<span class="pin${p.status !== 'active' ? ' dim' : ''}">${short(p.rent)}</span>` }),
        title: `${p.bhk} BHK, ${tidy(p.locality)}, ${inr(p.rent)}`, keyboard: false,
      });
      m.on('click', () => openDetail(p));
      m.on('mouseover', () => setActive(p.id, true));
      m.on('mouseout', () => setActive(p.id, false));
      pins.addLayer(m);
      markerById.set(p.id, m);
    }
  }

  // ---------- detail ----------
  const detailDlg = $('detail-dlg');
  $('detail-close').addEventListener('click', () => detailDlg.close());
  detailDlg.addEventListener('click', e => { if (e.target === detailDlg) detailDlg.close(); });

  function openDetail(p) {
    const s = site[p.source] || {};
    const facts = [
      ['Bedrooms', p.bhk + ' BHK'],
      ['Type', label('type', p.type)],
      ['Area', p.area_sqft && p.area_sqft.toLocaleString('en-IN') + ' sq ft'],
      ['Bathrooms', p.bathrooms],
      ['Furnishing', label('furnishing', p.furnishing)],
      ['Parking', p.parking === 'car+bike' ? 'Car + bike' : 'Car'],
      ['Available', availText(p).replace('Available now', 'Now')],
      ['Floor', p.floor],
      ['Deposit', p.deposit && inr(p.deposit)],
      ['Maintenance', p.maintenance && inr(p.maintenance) + ' / month'],
      ['Posted by', p.posted_by && label('posted_by', p.posted_by)],
      ['Preferred tenants', p.preferred_tenants && label('preferred_tenants', p.preferred_tenants)],
      ['Drive, evening rush', `~${p.minutes_peak} min (${p.road_km} km)`],
      ['Drive, morning rush', `~${p.minutes_morning} min`],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 'Not stated');

    const approx = p.location_precision !== 'listing';
    $('detail-body').innerHTML = `
      ${p.photo ? `<div class="d-photo">${photoHtml(p, 'd-photo')}</div>` : ''}
      <h2 class="d-title" id="d-title">${esc(tidy(p.title))}</h2>
      <p class="d-sub">${esc([tidy(p.address), tidy(p.locality)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '))}</p>
      <div class="d-price"><b>${inr(p.rent)}</b><span>/ month</span>${p.maintenance ? `<span>+ ${inr(p.maintenance)} maintenance</span>` : ''}</div>
      ${hasMap ? `<figure class="d-map-wrap"><div id="d-map" class="d-map" role="img" aria-label="Map of this home, the chosen point and the 30-minute drive zone"></div>
        <figcaption><span><i class="dot-home"></i>This home</span><span><i class="dot-origin"></i>Chosen point</span><span><i class="sw sw-eve"></i>30 min, evening rush</span></figcaption></figure>` : ''}
      <dl class="d-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${p.notes ? `<p class="d-notes">${esc(p.notes)}</p>` : ''}
      ${p.location_precision !== 'listing' ? '<p class="d-notes">Map position and drive time are approximate: the site gives only the area, not the exact address.</p>' : ''}
      ${p.status !== 'active' ? '<p class="warn">This listing is no longer live on the source site.</p>' : ''}
      ${s.verdict === 'included-with-caution' ? `<p class="warn">${esc(s.name)} does not verify posters. See the home in person and never pay a token advance before that.</p>` : ''}
      <div class="d-links">
        <a class="btn" href="${gmaps(p)}" target="_blank" rel="noopener noreferrer">${approx ? 'Area on Google Maps' : 'Location on Google Maps'} ↗</a>
        <a class="btn" href="${directions(p)}" target="_blank" rel="noopener noreferrer">Directions from chosen point ↗</a>
      </div>
      <div class="d-cta">
        <small>Checked ${fmtDate(p.last_checked)}${p.posted_on ? ' · posted ' + fmtDate(p.posted_on) : ''}</small>
        <a class="primary accent" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">View on ${esc(srcName(p.source))} ↗</a>
      </div>`;
    detailDlg.showModal();
    detailDlg.querySelector('.sheet-body').scrollTop = 0;
    if (hasMap) drawMiniMap(p);
  }

  // Small map in the detail dialog: this home, the chosen point and the zone.
  let miniMap = null;
  function drawMiniMap(p) {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    miniMap = L.map('d-map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    const zone = L.geoJSON(zones, {
      style: f => ({ className: f.properties.id === 'evening' ? 'zone-eve' : 'zone-mor' }), interactive: false,
    });
    // The view must be set before vector layers are added.
    miniMap.fitBounds(zone.getBounds().extend([p.lat, p.lon]), { padding: [12, 12] });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(miniMap);
    zone.addTo(miniMap);
    L.polyline([[db.origin.lat, db.origin.lon], [p.lat, p.lon]], { className: 'link-line', interactive: false }).addTo(miniMap);
    L.marker([db.origin.lat, db.origin.lon], {
      icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: '<span class="origin"></span>' }), keyboard: false, interactive: false,
    }).addTo(miniMap);
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: `<span class="pin on">${short(p.rent)}</span>` }), keyboard: false, interactive: false,
    }).addTo(miniMap);
  }
  detailDlg.addEventListener('close', () => { if (miniMap) { miniMap.remove(); miniMap = null; } });

  // ---------- about ----------
  const aboutDlg = $('about-dlg');
  $('about-btn').addEventListener('click', () => aboutDlg.showModal());
  aboutDlg.addEventListener('click', e => { if (e.target === aboutDlg) aboutDlg.close(); });
  $('method').innerHTML = (db.method || []).map(p => `<p>${p}</p>`).join(''); // trusted, authored HTML
  const VERDICT = { included: ['Used', 'ok'], 'included-with-caution': ['Used with care', 'caution'], excluded: ['Not used', 'no'] };
  $('src-list').innerHTML = sources.sites.map(s => {
    const [vt, vc] = VERDICT[s.verdict] || [s.verdict, 'no'];
    const rates = (s.ratings || []).filter(r => r.rating != null).slice(0, 3).map(r =>
      `${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.platform)}</a>` : esc(r.platform)} ${r.rating}${r.count ? ` (${Number(r.count).toLocaleString('en-IN')})` : ''}`).join(' · ');
    return `<li><div class="src-head"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="verdict ${vc}">${vt}</span></div>
      <p>${esc(s.reason || '')}</p>${rates ? `<p class="src-rate">${rates}</p>` : ''}</li>`;
  }).join('');

  render();
})();
