# Refresh runbook

The scheduled job follows this runbook every two days. A person can follow it too.
The goal is to bring `data/properties.json` up to date without touching anything in `site/`.

## Requirements every listing must meet

`update_data.py` enforces all of these. Never hand-edit a listing to get it past a check.

- 2 BHK or 3 BHK, whole home for residential rent. No PG, shared rooms, lease-only (lump sum) or sale listings.
- The listing explicitly offers four-wheeler / car parking.
- Available now, or from a date no later than 2027-01-31. A missing date is allowed only when the portal has no date field, as on OLX.
- At most 36 minutes away at evening rush. The site's slider defaults to 30.
- From a portal whose verdict in `data/sources.json` is `included` or `included-with-caution`.
- The listing's own text (title, address, locality, URL) must not name a place that can't be inside the
  zone. That would mean its pin is wrong. Pins that are only area centres are also checked against
  neighbourhoods on the zone's edge.
- No lease (lump-sum) or per-head sharing listings. Implausible deposits are dropped. The same flat posted
  twice on one portal is kept once, at the lower rent.
- Real and currently listed. Never invent, guess or "fill in" a listing or a field. Use `null` when unknown.

## 1. Collect

Write each portal's results to a temp JSON file in the collection format below.

```sh
mkdir -p /tmp/refresh
python3 scripts/collect_nobroker.py    /tmp/refresh/nobroker.json     # public JSON API, ~90 pages, 2+3 BHK
python3 scripts/collect_olx.py         /tmp/refresh/olx.json          # category pages via curl, 2 and 3 rooms
python3 scripts/collect_magicbricks.py /tmp/refresh/magicbricks.json  # search pages, one locality per request
```

All three collect 2BHK and 3BHK. Each takes a few minutes because it waits between requests.
MagicBricks searches the locality names listed in `scripts/magicbricks_localities.txt`.

### Portals collected by hand

Collect from these with web search and fetch tools. Keep only listings that meet the requirements above.

- **Housing.com.** Search and rent-detail pages are bot-blocked (HTTP 406). Project rent pages work:
  `https://housing.com/rent-<any-slug>-rpid-AG<base36(projectId)>AH0`. Parse
  `window.__INITIAL_STATE__ = JSON.parse("…")` → `searchResults.data`. Known project with rentals:
  DLF Commanders Court, Egmore (`AGpuoAH0`).
- **99acres, Sulekha, ChennaiProperties.** 99acres hits a captcha wall, Sulekha is geo-blocked outside
  India, and ChennaiProperties is small. Try them when time allows. Skip them if blocked.

Do not use portals marked `excluded` in `data/sources.json`. These include Makaan (it redirects to
Housing), Quikr, CommonFloor, SquareYards, NestAway, co-living sites, aggregators and Facebook groups.

### Collection format

A JSON array of objects:

```json
{
  "source": "nobroker | magicbricks | olx | housing | 99acres | sulekha | chennaiproperties",
  "source_url": "https://… listing detail page",
  "source_key": "portal's own listing id (optional, keeps ids stable if the URL slug changes)",
  "title": "…",
  "type": "apartment | independent-house | independent-floor | villa",
  "bhk": 2,
  "rent": 45000,
  "maintenance": 3000,
  "deposit": 300000,
  "locality": "Perambur",
  "address": "society / street or null",
  "lat": 13.11, "lon": 80.24,
  "area_sqft": 1400,
  "furnishing": "unfurnished | semi-furnished | fully-furnished | null",
  "parking": "car | car+bike",
  "available_from": "immediate | YYYY-MM-DD | null",
  "posted_on": "YYYY-MM-DD or null",
  "posted_by": "owner | agent | builder | null",
  "floor": "2 of 4",
  "bathrooms": 3,
  "preferred_tenants": "family | any | bachelors | null",
  "notes": "short, user-facing (e.g. 'Rent negotiable · Lift')"
}
```

If `lat`/`lon` are missing, `update_data.py` falls back to the locality centre. It uses
`data/localities.json` first, then the Photon geocoder.

### Listings found wrong by hand

If a listing turns out not to qualify and no rule can catch it (for example, its pin and its text
disagree but the portal gives no address), add its `id` and a reason to `data/excluded.json`. Every
merge skips those ids.

## 2. Merge

```sh
python3 scripts/update_data.py merge /tmp/refresh/*.json --swept nobroker,olx,magicbricks
```

Pass `--swept` only for portals that were **fully** re-searched in this run. The script then:

- adds new listings and refreshes existing ones (`last_checked`), matching by source id or URL
- works out road distance and peak-hour minutes for each listing
- counts a miss for each active listing from a swept portal that did not show up. After 2 misses in a row the listing becomes `inactive`. Inactive listings are dropped 30 days after they were last seen.
- prints a summary and validates the whole file

Listings from hand-collected portals that you could not re-check this run should stay as they are, so leave those portals out of `--swept`.

## 3. Build, commit, push

```sh
sh scripts/build.sh   # fails if data/ is invalid
git add data/ && git commit -m "Refresh listings: +N new, M no longer live"
git push origin main  # triggers the GitHub Pages deploy
```

Only `data/` should change in a routine refresh. Re-vet the portals in `data/sources.json` about once a month:
ratings, whether each portal is still operating, and whether its scam reports have changed.
