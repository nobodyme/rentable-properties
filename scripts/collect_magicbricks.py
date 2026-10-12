#!/usr/bin/env python3
"""Fetch 2BHK and 3BHK rentals near the origin from MagicBricks search pages.

Usage: python3 scripts/collect_magicbricks.py OUT.json

The search results page embeds its listings in `window.SERVER_PRELOADED_STATE_`.
The localities searched are listed in magicbricks_localities.txt, which holds
MagicBricks' own locality names. A listing is kept only if its parking field
shows a covered or open car slot.
"""
import json, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

IST = timezone(timedelta(hours=5, minutes=30))
HERE = Path(__file__).resolve().parent
SEARCH = ("https://www.magicbricks.com/property-for-rent/residential-real-estate?bedroom=2,3"
          "&proptype=Multistorey-Apartment,Builder-Floor-Apartment,Penthouse,Studio-Apartment,Residential-House,Villa"
          "&cityName=Chennai&Locality={locs}&page={page}")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
BATCH = 1  # multi-locality queries silently drop results, so search one at a time

TYPES = {"10002": "apartment", "10020": "apartment", "10021": "apartment", "10022": "apartment",
         "10003": "independent-floor", "10001": "independent-house", "10017": "villa"}
FURNISHING = {"Unfurnished": "unfurnished", "Semi-Furnished": "semi-furnished", "Furnished": "fully-furnished"}
POSTED_BY = {"owner": "owner", "agent": "agent", "dealer": "agent", "builder": "builder"}
TENANTS = {"Bachelors/Family": "any", "Family": "family", "Bachelors": "bachelors"}
MONTHS = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}


def get(url):
    cmd = ["curl", "-sS", "--compressed", "-m", "60", "-A", UA, url]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def state(html):
    i = html.find("window.SERVER_PRELOADED_STATE_")
    if i < 0:
        return None
    return json.JSONDecoder().raw_decode(html[html.find("=", i) + 1:].lstrip())[0]


def fetch_all():
    names = [n.strip() for n in (HERE / "magicbricks_localities.txt").read_text().splitlines() if n.strip()]
    seen = {}
    for i in range(0, len(names), BATCH):
        locs = ",".join(quote(n.replace(" ", "-")) for n in names[i:i + BATCH])
        page = 1
        while True:
            st = state(get(SEARCH.format(locs=locs, page=page))) or {}
            for x in st.get("searchResult") or []:
                seen.setdefault(x["id"], x)
            pages = int((st.get("searchAdditionalDataBean") or {}).get("pageCount") or 1)
            time.sleep(1)
            if page >= pages:
                break
            page += 1
    return list(seen.values())


def num(s):
    s = str(s or "").replace(",", "").strip()
    return int(float(s)) if re.fullmatch(r"\d+(\.\d+)?", s) else None


def convert(x, today):
    bhk = num(x.get("bedroomD"))
    parking = (x.get("parkingD") or "").strip()
    if bhk not in (2, 3) or x.get("transType") != "Rent" or x.get("ty") not in TYPES:
        return None
    if not re.search(r"covered|open", parking, re.I):
        return None  # no car slot listed
    rent = num(x.get("price"))
    if not rent:
        return None

    if x.get("possStatusD") == "Immediately":
        available = "immediate"
    else:  # month precision only, e.g. "Dec '26"
        m = re.match(r"([A-Za-z]{3})\s*'(\d{2})", x.get("availableFrom") or "")
        if not m:
            return None
        d = datetime(2000 + int(m[2]), MONTHS[m[1].title()], 1).date()
        available = "immediate" if d <= today else d.isoformat()

    lat = lon = None
    if x.get("ltcoordGeo"):
        lat, lon = (float(v) for v in x["ltcoordGeo"].split(","))
    posted = re.search(r"(\w{3}) (\d{1,2}), '(\d{2})", x.get("postedLabelD") or "")
    floor = re.sub(r"\s*Floor$", "", x.get("floorD") or "") or None
    return {
        "source": "magicbricks",
        "source_url": "https://www.magicbricks.com/propertyDetails/" + x["url"],
        "source_key": x["id"],
        "title": x.get("propertyTitle"),
        "type": TYPES[x["ty"]],
        "bhk": bhk,
        "rent": rent,
        "maintenance": None,
        "deposit": num(x.get("bookingAmtExact")),
        "locality": x.get("lmtDName"),
        "address": x.get("prjname") or None,
        "lat": lat,
        "lon": lon,
        "area_sqft": num(x.get("caSqFt")) if x.get("covAreaUnitDesc", "Sq-ft") == "Sq-ft" else None,
        "furnishing": FURNISHING.get(x.get("furnishedD")),
        "parking": "car",
        "available_from": available,
        "posted_on": f"20{posted[3]}-{MONTHS[posted[1].title()]:02d}-{int(posted[2]):02d}" if posted else None,
        "posted_by": POSTED_BY.get((x.get("userType") or "").lower()),
        "floor": floor,
        "bathrooms": num(x.get("bathD")),
        "preferred_tenants": TENANTS.get(x.get("tenantsPreference")),
        "notes": f"Car parking: {parking}",
    }


def main(out):
    today = datetime.now(IST).date()
    raw = fetch_all()
    rows = [r for r in (convert(x, today) for x in raw) if r]
    Path(out).write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"magicbricks: {len(raw)} fetched, {len(rows)} pass listing checks -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
