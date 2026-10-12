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
  const short = n => n >= 100000 ? '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : '₹' + Math.round(n / 1000) + 'k';
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = s => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  const availText = p => p.available_from === 'immediate' ? 'Available now'
    : p.available_from ? 'From ' + fmtDate(p.available_from) : 'Move-in date not stated';

  $('updated').textContent = `Updated ${fmtDate(db.updated)} · ${all.filter(p => p.status === 'active').length} live listings`;

  // ---------- state ----------
  const rents = all.map(p => p.rent);
  const rentMin = Math.floor(Math.min(...rents) / 5000) * 5000;
  const rentMax = Math.ceil(Math.max(...rents) / 5000) * 5000;
  const DEFAULTS = () => ({
    q: '', bhk: new Set(['3']), rent: rentMax, min: 30, avail: '', sort: 'minutes',
    type: new Set(), furnishing: new Set(), posted_by: new Set(), source: new Set(), inactive: false,
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
  $('rent-lo').textContent = inr(rentMin); $('rent-hi').textContent = inr(rentMax);
  rentEl.addEventListener('input', () => { S.rent = +rentEl.value; render(); });
  $('f-min').addEventListener('input', e => { S.min = +e.target.value; render(); });
  $('f-avail').addEventListener('change', e => { S.avail = e.target.value; render(); });
  $('f-sort').addEventListener('change', e => { S.sort = e.target.value; render(); });
  let qTimer;
  $('f-q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; render(); }, 120); });

  // One popover open at a time; close on outside click / Escape.
  const pops = [...document.querySelectorAll('details.pop')];
  pops.forEach(d => d.addEventListener('toggle', () => { if (d.open) pops.forEach(o => { if (o !== d) o.open = false; }); }));
  document.addEventListener('click', e => { if (!e.target.closest('details.pop')) pops.forEach(d => { d.open = false; }); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pops.forEach(d => { d.open = false; }); });

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
  const map = L.map('map', { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · zone: Valhalla',
  }).addTo(map);
  const zoneLayer = L.geoJSON(zones, {
    style: f => ({ className: f.properties.id === 'evening' ? 'zone-eve' : 'zone-mor' }),
    onEachFeature: (f, l) => l.bindTooltip(f.properties.label, { sticky: true }),
  }).addTo(map);
  const fitZone = () => map.fitBounds(zoneLayer.getBounds(), { padding: [16, 16] });
  fitZone();
  // Price pills only once zoomed in; dots keep the overview readable.
  const syncZoom = () => map.getContainer().classList.toggle('far', map.getZoom() < 13);
  map.on('zoomend', syncZoom); syncZoom();
  L.marker([db.origin.lat, db.origin.lon], {
    icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: '<span class="origin" aria-label="Chosen point"></span>' }),
    zIndexOffset: 2000, keyboard: false,
  }).addTo(map).bindTooltip(esc(db.origin.label || 'Chosen point'));
  const pins = L.layerGroup().addTo(map);
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
    document.body.classList.toggle('map-open');
    setTimeout(() => {
      map.invalidateSize();
      if (!fittedOnOpen) { fitZone(); fittedOnOpen = true; } // map was 0x0 when first fitted
    }, 50);
  });

  // ---------- filtering ----------
  function matches(p) {
    if (!S.inactive && p.status !== 'active') return false;
    if (!S.bhk.has(String(p.bhk))) return false;
    if (p.rent > S.rent || p.minutes_peak > S.min) return false;
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

  function card(p) {
    const li = document.createElement('li');
    li.className = 'card' + (p.status !== 'active' ? ' inactive' : '');
    li.id = 'p-' + p.id;
    const meta = [label('type', p.type), p.area_sqft && p.area_sqft.toLocaleString('en-IN') + ' sq ft', label('furnishing', p.furnishing)]
      .filter(x => x && x !== 'Not stated').join(' · ');
    li.innerHTML = `
      <div class="card-cover">
        <span class="tag">${p.bhk} BHK</span>
        <div class="cover-time"><b>~${p.minutes_peak}</b> min<small>from chosen point · ${p.road_km} km by road</small></div>
        ${p.type === 'apartment' ? GLYPH.apartment : GLYPH.house}
      </div>
      <div class="card-row"><h3 class="card-title">${esc(tidy(p.locality) || 'Chennai')}</h3></div>
      <p class="card-meta">${esc(meta)}</p>
      <p class="card-meta">${esc(availText(p))} · <a class="src-link" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer" title="Open this listing on ${esc(srcName(p.source))}">${esc(srcName(p.source))} ↗</a></p>
      <p class="card-price"><b>${inr(p.rent)}</b> <span>month</span></p>
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
    $('o-avail').textContent = { '': 'Any', '2027-01-31': 'By Jan', '2026-12-31': 'By Dec', '2026-11-30': 'By Nov', now: 'Now' }[S.avail];
    document.getElementById('pop-rent').querySelector('.chip').classList.toggle('on', S.rent < rentMax);
    document.getElementById('pop-min').querySelector('.chip').classList.toggle('on', S.min !== 30);
    document.getElementById('pop-avail').querySelector('.chip').classList.toggle('on', S.avail !== '');
    const extra = S.type.size + S.furnishing.size + S.posted_by.size + S.source.size + (S.inactive ? 1 : 0);
    $('more-count').hidden = !extra; $('more-count').textContent = extra;
    $('more-btn').classList.toggle('on', extra > 0);

    const rows = all.filter(matches).sort(sorter(S.sort));
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

    pins.clearLayers(); markerById.clear();
    for (const p of rows) {
      if (p.lat == null) continue;
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: `<span class="pin${p.status !== 'active' ? ' dim' : ''}">${short(p.rent)}</span>` }),
        title: `${p.bhk} BHK, ${tidy(p.locality)}, ${inr(p.rent)}`,
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

    $('detail-body').innerHTML = `
      <h2 class="d-title" id="d-title">${esc(tidy(p.title))}</h2>
      <p class="d-sub">${esc([tidy(p.address), tidy(p.locality)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '))}</p>
      <div class="d-price"><b>${inr(p.rent)}</b><span>/ month</span>${p.maintenance ? `<span>+ ${inr(p.maintenance)} maintenance</span>` : ''}</div>
      <dl class="d-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${p.notes ? `<p class="d-notes">${esc(p.notes)}</p>` : ''}
      ${p.location_precision === 'locality' ? '<p class="d-notes">Map position is the locality centre; the exact address was not given.</p>' : ''}
      ${p.status !== 'active' ? '<p class="warn">This listing is no longer live on the source site.</p>' : ''}
      ${s.verdict === 'included-with-caution' ? `<p class="warn">${esc(s.name)} does not verify posters. See the home in person and never pay a token advance before that.</p>` : ''}
      <div class="d-cta">
        <small>Checked ${fmtDate(p.last_checked)}${p.posted_on ? ' · posted ' + fmtDate(p.posted_on) : ''}</small>
        <a class="primary accent" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">View on ${esc(srcName(p.source))} ↗</a>
      </div>`;
    detailDlg.showModal();
    detailDlg.querySelector('.sheet-body').scrollTop = 0;
  }

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
