#!/usr/bin/env python3
"""Fetch 2BHK and 3BHK rental ads in Chennai from OLX and keep those with car parking.

Usage: python3 scripts/collect_olx.py OUT.json

OLX's search JSON API is blocked, but the server-rendered category pages embed
the ads in `window.__APP = {... states: {...}}`. OLX ads have no move-in date,
so available_from is left null (shown on the site as "not stated").
"""
import json, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
LIST = "https://www.olx.in/chennai_g4059162/for-rent-houses-apartments_c1723?filter=rooms_eq_{rooms}&page={page}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
}
MAX_AGE_DAYS = 90
TYPES = {"rent-apartments": "apartment", "houses": "independent-house", "floors": "independent-floor", "duplex": "independent-house"}
FURNISHING = {"unfurnished": "unfurnished", "semi": "semi-furnished", "furnished": "fully-furnished"}
POSTED_BY = {"owner": "owner", "broker": "agent", "builder": "builder"}
NOT_A_HOME_RENTAL = re.compile(r"\b(for sale|lease only|on lease|office|commercial|pg\b|hostel)", re.I)


def states(html):
    i = html.find("window.__APP = ")
    if i < 0:
        return None
    k = html.find("states:", i) + len("states:")
    while html[k] in " \n":
        k += 1
    return json.JSONDecoder().raw_decode(html[k:])[0]


def get(url):
    # OLX's CDN rejects Python's TLS client; curl with browser headers gets through.
    cmd = ["curl", "-sS", "--compressed", "-m", "60"] + [a for k, v in HEADERS.items() for a in ("-H", f"{k}: {v}")] + [url]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def fetch_all():
    ads, links = {}, {}
    for rooms in (2, 3):
        for page in range(1, 40):
            html = get(LIST.format(rooms=rooms, page=page))
            links.update({m[1]: m[0] for m in re.findall(r'href="(/item/[^"]*-iid-(\d+))"', html)})
            items = (states(html) or {}).get("items", {}).get("elements", {})
            new = {v["id"]: v for v in items.values() if v["id"] not in ads}
            if not new:
                break
            ads.update(new)
            time.sleep(1.5)
    for v in ads.values():
        v["_path"] = links.get(v["id"])
    return list(ads.values())


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def convert(v, today):
    p = {x["key"]: x.get("value") for x in v.get("parameters", [])}
    text = f"{v.get('title', '')} {v.get('description', '')}"
    if v.get("status", {}).get("status") != "active" or p.get("rooms") not in ("2", "3"):
        return None
    if int(p.get("carparking") or 0) < 1 or p.get("type") not in TYPES or NOT_A_HOME_RENTAL.search(text):
        return None
    rent = (v.get("price") or {}).get("value", {}).get("raw")
    if not rent or rent > 500_000:  # larger figures are lease/sale amounts
        return None
    created = datetime.fromisoformat(v["created_at"]).date()
    if (today - created).days > MAX_AGE_DAYS:
        return None
    loc = (v.get("locations") or [{}])[0]
    fl, tf = p.get("floorno"), p.get("totalfloors")
    cars = int(p["carparking"])
    return {
        "source": "olx",
        "source_url": "https://www.olx.in" + (v["_path"] or f"/item/{slug(v['title'])}-iid-{v['id']}"),
        "source_key": v["id"],
        "title": v["title"].strip(),
        "type": TYPES[p["type"]],
        "bhk": int(p["rooms"]),
        "rent": int(rent),
        "maintenance": int(m) if (m := p.get("maintenance") or "").isdigit() and int(m) else None,
        "deposit": None,
        "locality": v.get("locations_resolved", {}).get("SUBLOCALITY_LEVEL_1_name"),
        "address": None,
        "lat": loc.get("lat"),
        "lon": loc.get("lon"),
        "area_sqft": int(p["ft"]) if (p.get("ft") or "").isdigit() else None,
        "furnishing": FURNISHING.get(p.get("furnished")),
        "parking": "car",
        "available_from": None,
        "posted_on": created.isoformat(),
        "posted_by": POSTED_BY.get(p.get("listed_by")),
        "floor": None if fl is None else ("Ground" if fl == "0" else fl) + (f" of {tf}" if tf else ""),
        "bathrooms": int(p["bathrooms"]) if (p.get("bathrooms") or "").isdigit() else None,
        "preferred_tenants": "family" if p.get("bachelors") == "no" else None,
        "notes": f"{cars} car park{'s' if cars > 1 else ''} · Move-in date not stated on OLX, ask the poster",
    }


def main(out):
    today = datetime.now(IST).date()
    raw = fetch_all()
    rows = [r for r in (convert(v, today) for v in raw) if r]
    Path(out).write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"olx: {len(raw)} fetched, {len(rows)} pass listing checks -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
