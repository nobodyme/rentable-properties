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
- Record `posted_on` (and `posted_at`, the exact time, when available) whenever the portal shows a posted or refreshed date. The site shows it on every
  card, and uses it with `first_seen` for the "Newest" sort and the "New since your last visit" badges.
- Real and currently listed. Never invent, guess or "fill in" a listing or a field. Use `null` when unknown.

## 1. Collect

Write each portal's results to a temp JSON file in the collection format below.

```sh
mkdir -p /tmp/refresh
# Independent of each other, so run them in parallel (about 5 minutes in total).
python3 scripts/collect_nobroker.py    /tmp/refresh/nobroker.json    > /tmp/refresh/nobroker.log 2>&1 &
python3 scripts/collect_olx.py         /tmp/refresh/olx.json         > /tmp/refresh/olx.log 2>&1 &
python3 scripts/collect_magicbricks.py /tmp/refresh/magicbricks.json > /tmp/refresh/magicbricks.log 2>&1 &
wait; cat /tmp/refresh/*.log
```

All three collect 2BHK and 3BHK, and record each listing's first photo URL and photo count. The site
hot-links the photo from the portal; never download photos into the repo. Each collector prints
`fetched` and `pass listing checks` counts. Typical counts on 2026-10-12:

| Collector | fetched | pass listing checks | live after merge |
| --- | --- | --- | --- |
| NoBroker | ~1,980 | ~540 | ~205 |
| OLX | ~1,870 | ~820 | ~20 |
| MagicBricks | ~420 | ~120 | ~65 |

How each portal is reached, in case a collector breaks:

- **NoBroker:** `GET /api/v3/multi/property/RENT/filter?searchParam=<base64 [{lat,lon,placeId,placeName}]>&type=BHK2,BHK3&city=chennai&pageNo=N&radius=9.0`,
  26 per page until `data` is empty. NoBroker puts listings with no usable address on placeholder pins and
  appends that pin's address to the owner's. The collector detects these pins and never matches localities
  against that appended text.
- **OLX:** the JSON API is blocked, and Python's own HTTP client gets 403, so the collector calls `curl` with
  full browser headers. Ads are in `window.__APP = {… states: {…}}` on
  `/chennai_g4059162/for-rent-houses-apartments_c1723?filter=rooms_eq_{2|3}&page=N`.
- **MagicBricks:** search pages embed results in `window.SERVER_PRELOADED_STATE_`. Search one locality per
  request: comma-separated multi-locality queries silently drop results. Locality names are in
  `scripts/magicbricks_localities.txt`. Car parking comes from the `parkingD` field ("1 Covered" etc.).

### Portals collected by hand

Collect from these with web search and fetch tools. Keep only listings that meet the requirements above.

- **Housing.com.** Two listings at present, collected by hand. Leave them as they are unless you can re-check
  them. Search and rent-detail pages are bot-blocked (HTTP 406), but project rent pages work:
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
  "posted_on": "YYYY-MM-DD: the date the portal shows as posted / last refreshed (shown on the card)",
  "posted_at": "ISO time with offset when the portal gives one (e.g. 2026-10-12T15:37+05:30); the card shows '3 hours ago'",
  "posted_by": "owner | agent | builder | null",
  "floor": "2 of 4",
  "bathrooms": 3,
  "preferred_tenants": "family | any | bachelors | null",
  "notes": "short, user-facing (e.g. 'Rent negotiable · Lift')",
  "photo": "https://… first photo, hot-linked from the portal (or null)",
  "photo_count": 6
}
```

If `lat`/`lon` are missing, `update_data.py` falls back to the locality centre. It uses
`data/localities.json` first, then the Photon geocoder.

### Listings found wrong by hand

If a listing turns out not to qualify and no rule can catch it (for example, its pin and its text
disagree but the portal gives no address), add its `id` and a reason to `data/excluded.json`. Every
merge skips those ids.

## 2. Merge

Always merge **into** the existing `data/properties.json`. Never empty it or rebuild it from scratch: that
loses `first_seen` dates, the no-longer-live history and hand-collected listings.

Before merging, check the collector counts against the table above. If a collector failed, returned nothing,
or returned far fewer listings than usual (say under half), the portal probably blocked it or changed its
format. Fix that collector minimally and re-run it. If you can't, leave its file out of the merge **and its
name out of `--swept`**, so its listings aren't wrongly marked as gone.

```sh
python3 scripts/update_data.py merge /tmp/refresh/*.json --swept nobroker,olx,magicbricks
```

Pass `--swept` only for portals that were **fully** re-searched in this run. The script then:

- adds new listings and refreshes existing ones (`last_checked`), matching by source id or URL
- works out road distance and peak-hour minutes for each listing
- counts a miss for each active listing from a swept portal that did not show up. After 2 misses in a row the listing becomes `inactive`. Inactive listings are dropped 30 days after they were last seen.
- prints a summary and validates the whole file

Listings from hand-collected portals that you could not re-check this run should stay as they are, so leave those portals out of `--swept`.

## 3. Build, commit, push, verify

```sh
sh scripts/build.sh   # validates data/ and assembles _site/ (gitignored; never commit it)
git add data/ && git commit -m "Refresh listings: +N new, M no longer live (YYYY-MM-DD)"
git push origin main  # triggers .github/workflows/pages.yml -> GitHub Pages
```

The site is https://nobodyme.github.io/rentable-properties/. About a minute after the push, check that
`https://nobodyme.github.io/rentable-properties/data/properties.json` shows today's date in `updated`. If it
doesn't, check the "Deploy to GitHub Pages" workflow run on `main`.

The build removes the origin's name from the published data copy, and the site itself refers only to the
"chosen point". Keep it that way: don't add place names for the origin to the site or to commit messages.

Only `data/` should change in a routine refresh. Re-vet the portals in `data/sources.json` about once a month:
ratings, whether each portal is still operating, and whether its scam reports have changed.
