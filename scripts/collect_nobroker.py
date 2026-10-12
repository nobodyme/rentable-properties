#!/usr/bin/env python3
"""Fetch 3BHK rentals around Stanley from NoBroker's public search API.

Usage: python3 scripts/collect_nobroker.py OUT.json

Writes listings in the collection format (see UPDATING.md). Only basic
listing-level requirements are applied here (3BHK, full-home rent, car
parking, live); drive-time and move-in checks happen in update_data.py.
"""
import base64, json, math, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import travel

IST = timezone(timedelta(hours=5, minutes=30))
RADIUS_KM = 10.0  # straight-line search radius; road-distance filter comes later
API = "https://www.nobroker.in/api/v3/multi/property/RENT/filter?searchParam={sp}&type=BHK3&city=chennai&pageNo={page}&radius={r}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
           "Accept": "application/json"}
LOCALITIES = Path(__file__).resolve().parent.parent / "data" / "localities.json"

BUILDING = {"AP": "apartment", "SB": "apartment", "IH": "independent-house", "IF": "independent-floor", "GC": "villa"}
FURNISHING = {"NOT_FURNISHED": "unfurnished", "SEMI_FURNISHED": "semi-furnished", "FULLY_FURNISHED": "fully-furnished"}
PARKING = {"BOTH": "car+bike", "FOUR_WHEELER": "car"}
# NoBroker drops listings with no geocoded address onto a generic city-centre pin.
PLACEHOLDER_PINS = [(13.0834478, 80.2685457), (13.0826802, 80.2707184), (13.0830589, 80.2690060)]


def km(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def ist_date(ms):
    return datetime.fromtimestamp(ms / 1000, IST).date() if ms else None


def fetch_all():
    sp = base64.b64encode(json.dumps([{"lat": travel.STANLEY[0], "lon": travel.STANLEY[1],
                                       "placeId": "stanley", "placeName": "stanley"}]).encode()).decode()
    seen = {}
    for page in range(1, 60):
        req = urllib.request.Request(API.format(sp=sp, page=page, r=RADIUS_KM), headers=HEADERS)
        data = json.load(urllib.request.urlopen(req, timeout=60)).get("data") or []
        if not data:
            break
        for x in data:
            seen[x["id"]] = x
        time.sleep(1)
    return list(seen.values())


def locality_from_text(text, names):
    text = text.lower()
    for n in sorted(names, key=len, reverse=True):
        if re.search(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", text):
            return n
    return None


def convert(x, today, names):
    if x.get("type") != "BHK3" or x.get("propertyType") != "RENT" or not x.get("active"):
        return None
    if x.get("accomodationType") or x.get("sharedAccomodation"):
        return None
    if x.get("parking") not in PARKING or x.get("buildingType") not in BUILDING:
        return None
    if not x.get("rent") or (x.get("forLease") and x.get("rent") == x.get("deposit")):
        return None  # lease-only (lump sum), no monthly rent

    lat, lon = x.get("latitude"), x.get("longitude")
    address = (x.get("address") or x.get("secondaryTitle") or "").strip(" ,") or None
    locality = x.get("nbLocality") or x.get("locality")
    if not lat or any(km(lat, lon, a, b) < 0.25 for a, b in PLACEHOLDER_PINS):
        # Unreliable pin: fall back to a known locality named in the address, else skip.
        found = locality_from_text(" ".join(str(x.get(k) or "") for k in ("address", "street", "society")), names)
        if not found:
            return None
        lat = lon = None
        locality = found.title()

    af = ist_date(x.get("availableFrom"))
    fl, tf = x.get("floor"), x.get("totalFloor")
    lease = x.get("leaseTypeNew") or ([x["leaseType"]] if x.get("leaseType") else [])
    notes = []
    if x.get("negotiable"):
        notes.append("Rent negotiable")
    if x.get("maintenanceIncluded"):
        notes.append("Maintenance included")
    if x.get("lift") is not None:
        notes.append("Lift" if x["lift"] else "No lift")
    if x.get("propertyAge") is not None:
        notes.append(f"{x['propertyAge']} yrs old")
    if x.get("facingDesc") and "know" not in x["facingDesc"].lower():
        notes.append(f"{x['facingDesc']} facing")
    if lat is None:
        notes.append("Location approximate (locality only)")

    return {
        "source": "nobroker",
        "source_url": "https://www.nobroker.in" + x["detailUrl"],
        "source_key": x["id"],
        "title": x.get("propertyTitle") or x.get("title"),
        "type": BUILDING[x["buildingType"]],
        "bhk": 3,
        "rent": int(x["rent"]),
        "maintenance": int(x["maintenanceAmount"]) if x.get("maintenanceAmount") not in (None, "", 0) else None,
        "deposit": int(x["deposit"]) if x.get("deposit") else None,
        "locality": locality,
        "address": address,
        "lat": lat,
        "lon": lon,
        "area_sqft": int(x["propertySize"]) if x.get("propertySize") else None,
        "furnishing": FURNISHING.get(x.get("furnishing")),
        "parking": PARKING[x["parking"]],
        "available_from": "immediate" if af is None or af <= today else af.isoformat(),
        "posted_on": ist_date(x.get("activationDate")).isoformat() if x.get("activationDate") else None,
        "posted_by": "owner",  # NoBroker is owner-listed only
        "floor": None if fl is None else ("Ground" if fl == 0 else str(fl)) + (f" of {tf}" if tf is not None else ""),
        "bathrooms": x.get("bathroom"),
        "preferred_tenants": "any" if "ANYONE" in lease else "family" if lease == ["FAMILY"] else
                             "bachelors" if lease and all(t.startswith("BACHELOR") for t in lease) else None,
        "notes": " · ".join(notes) or None,
    }


def main(out):
    names = list(json.loads(LOCALITIES.read_text()).keys())
    today = datetime.now(IST).date()
    raw = fetch_all()
    rows = [r for r in (convert(x, today, names) for x in raw) if r]
    Path(out).write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(f"nobroker: {len(raw)} fetched, {len(rows)} pass listing checks -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
