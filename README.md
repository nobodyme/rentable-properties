# Rentable Properties

A static, filterable list of 2BHK and 3BHK homes for rent that are within a 30-minute
peak-traffic drive of a chosen point. Every listing needs four-wheeler parking
and a move-in date by January 2027.

The listings are collected from vetted property portals and refreshed every two days.

## How it works

Layout and data are deliberately separated:

| Path | Role |
| --- | --- |
| `site/index.html` | Page shell / structure |
| `site/style.css` | Design, responsive layout, light + dark themes |
| `site/app.js` | Fetches `data/*.json` and renders the map, cards, filters, search and sort in the browser |
| `data/properties.json` | **The listings.** This is the only file a routine refresh changes |
| `data/sources.json` | Portals that were evaluated: verdict, ratings (Google reviews, app stores, Trustpilot) and reasoning |
| `data/isochrone.geojson` | The 30-minute drive zones drawn on the map |
| `data/localities.json` | Locality → coordinate cache, used when a listing has no exact pin |
| `scripts/collect_*.py` | Per-portal collectors that write listings in the collection format |
| `scripts/update_data.py` | Validates, geolocates, adds drive times, de-duplicates and merges into `data/properties.json` |
| `scripts/travel.py` | The drive-time model |
| `scripts/build.sh` | Validates data and assembles `site/` + `data/` into `_site/` |
| `.github/workflows/pages.yml` | Publishes to GitHub Pages on every push to `main` |
| `UPDATING.md` | The refresh runbook followed by the scheduled job |

Changing the data never requires touching the site. Changing the design never
requires touching the data.

## Drive-time model

The drive time comes from road distance, not straight-line distance, divided
by the city's measured rush-hour speed. The speeds are from the TomTom Traffic
Index 2025: 14.6 km/h in the evening peak and 17.7 km/h in the morning peak.
The listed minutes use the slower evening figure. Road distance comes from
OSRM, and the map zones are Valhalla isochrones of 7.3 km and 8.85 km by road,
both from OpenStreetMap data.

## Filters

Search text, bedrooms (2/3 BHK, defaults to 3), max rent, max drive time, property type, furnishing, move-in
date, posted by (owner/agent), source portal, and an option to include
listings that are no longer live. Sort by distance, rent, newest or size.

## Run locally

```sh
sh scripts/build.sh
python3 -m http.server -d _site 8000   # open http://localhost:8000
```

## Refreshing data

```sh
python3 scripts/collect_nobroker.py /tmp/nobroker.json
python3 scripts/collect_olx.py /tmp/olx.json
python3 scripts/collect_magicbricks.py /tmp/magicbricks.json
python3 scripts/update_data.py merge /tmp/nobroker.json /tmp/olx.json /tmp/magicbricks.json --swept nobroker,olx,magicbricks
```

See [UPDATING.md](UPDATING.md) for the full procedure, including portals that are collected by hand.

## Deployment

Every push to `main` that touches `site/`, `data/` or the build scripts runs
`.github/workflows/pages.yml`. The workflow builds `_site/` and deploys it to
GitHub Pages. You can also run it from the Actions tab.

## Automated refresh

An AI agent runs the refresh on a two-day schedule, following `UPDATING.md`.
It pushes the updated `data/properties.json` to `main`, which triggers a
redeploy. Always confirm a listing with the owner or agent before paying anything.
