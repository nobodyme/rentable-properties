#!/usr/bin/env python3
"""Merge freshly collected listings into data/properties.json.

Usage:
  python3 scripts/update_data.py merge FRESH.json [FRESH2.json ...] [--swept nobroker,magicbricks]
  python3 scripts/update_data.py check          # validate data/ without changing it

FRESH files are JSON arrays in the collection format documented in UPDATING.md.
Each listing is checked against the hard requirements (2 or 3 BHK, car parking,
available by end of Jan 2027, within the drive zone), geocoded if needed,
given peak-hour minutes from Stanley, and upserted by source URL.

--swept lists the sources that were fully re-searched in this run. Active
listings from those sources that did not show up are counted as missed; after
MISSES_TO_INACTIVE consecutive misses they are marked inactive, and inactive
listings are dropped after PRUNE_DAYS.
"""
import argparse, datetime as dt, hashlib, json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import travel

ROOT = Path(__file__).resolve().parent.parent
PROPS = ROOT / "data" / "properties.json"
LOCALITIES = ROOT / "data" / "localities.json"
SOURCES = ROOT / "data" / "sources.json"
EXCLUDED = ROOT / "data" / "excluded.json"

LATEST_MOVE_IN = "2027-01-31"
MAX_MINUTES = 36          # evening-rush minutes; 36 == 30 min in morning rush. Site defaults to 30.
MISSES_TO_INACTIVE = 2
PRUNE_DAYS = 30

BHK = {2, 3}
TYPES = {"apartment", "independent-house", "independent-floor", "villa"}
FURNISHING = {"unfurnished", "semi-furnished", "fully-furnished", None}
POSTED_BY = {"owner", "agent", "builder", None}
PARKING = {"car", "car+bike"}
NO_DATE_SOURCES = {"olx", "housing"}  # portals that don't show a move-in date
# Localities that cannot be inside the zone (40+ min even from their nearest
# edge). If a listing's own text names one while its pin is inside the zone, the
# pin is wrong (portal placeholder or bad geocode), so the listing is rejected.
# Neighbourhoods bordering the zone (Kolathur, Madhavaram, Mylapore, Aminjikarai,
# Nungambakkam, ...) are deliberately absent: there the pin decides.
FAR = re.compile(r"\b(" + "|".join([
    r"velachery", r"val[a-z]{0,3}ravakk?am", r"navalur", r"semmancheri", r"sholinganallur", r"omr", r"perungudi",
    r"thoraipakkam", r"pallikaranai", r"medavakkam", r"selaiyur", r"tambaram", r"chromepet", r"pallavaram",
    r"porur", r"vadapalani", r"kodambakkam", r"ashok\s?nagar", r"west\s?mambalam", r"k\.?\s?k\.?\s?nagar",
    r"t\.?\s?nagar", r"saidapet", r"guindy", r"adyar", r"besant\s?nagar", r"thiruvanmiyur",
    r"anna\s?nagar(?!\s?east)", r"mogappair", r"arumbakkam", r"koyambedu", r"korattur", r"padi", r"ambattur",
    r"avadi", r"puzhal", r"surapet", r"red\s?hills", r"ennore", r"minjur"]) + r")\b", re.I)
# Bordering neighbourhoods: trusted only when the listing has its own exact pin.
NEAR_EDGE = re.compile(r"\b(kolathur|madhavaram|retteri|aminjikarai|shenoy\s?nagar|nungambakkam|teynampet|"
                       r"(?<!mannady\s)(?<!mannadi\s)mylapore|villivakkam|manali|alwarpet|anna\s?nagar\s?east)\b", re.I)


def stated_text(p):
    """The listing's own words about where it is: title, address, locality and URL slug."""
    url = p.get("source_url", "")
    slug = url.split("/")[-3] if p.get("source") == "nobroker" else url.split("/")[-1]
    return " ".join(str(p.get(k) or "") for k in ("title", "address", "locality", "stated_locality")) + " " + re.sub(r"[-_/]", " ", slug)

FIELDS = ["id", "status", "source", "source_url", "title", "type", "bhk", "rent", "maintenance", "deposit",
          "locality", "address", "lat", "lon", "location_precision", "road_km", "minutes_peak",
          "minutes_morning", "area_sqft", "furnishing", "parking", "available_from", "posted_on", "posted_at",
          "posted_by", "floor", "bathrooms", "preferred_tenants", "notes", "photo", "photo_count", "first_seen", "last_checked",
          "missed_sweeps"]


def today():
    return dt.date.today().isoformat()


def load(p, default):
    return json.loads(p.read_text()) if p.exists() else default


def save(p, obj):
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def listing_id(p):
    """Stable id: the site's own listing id when the collector gives one, else the URL."""
    key = str(p.get("source_key") or p["source_url"].strip().rstrip("/"))
    return p["source"] + "-" + hashlib.sha1(key.encode()).hexdigest()[:10]


def reject_reason(p):
    if p.get("bhk") not in BHK:
        return "not 2/3BHK"
    if p.get("parking") not in PARKING:
        return "no car parking"
    if p.get("type") not in TYPES:
        return f"unknown type {p.get('type')!r}"
    if not isinstance(p.get("rent"), int) or not 3000 <= p["rent"] <= 1_000_000:
        return f"bad rent {p.get('rent')!r}"
    af = p.get("available_from")
    if af is None:
        # Only portals with no date field may omit it; shown as "ask the poster".
        return None if p.get("source") in NO_DATE_SOURCES else "missing available_from"
    if af != "immediate" and not (isinstance(af, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", af)):
        return f"bad available_from {af!r}"
    if af != "immediate" and af > LATEST_MOVE_IN:
        return "available after Jan 2027"
    if not p.get("source_url", "").startswith("http"):
        return "missing source_url"
    if p.get("photo") and not p["photo"].startswith("https://"):
        return "photo must be an https URL"
    return None


def locate(p, locs):
    """Fill lat/lon. Listing coordinates win; else locality centroid (cached)."""
    if p.get("lat") is not None and p.get("lon") is not None:
        p["location_precision"] = p.get("location_precision") or "listing"
        return True
    key = (p.get("locality") or "").strip().lower()
    if not key:
        return False
    if key not in locs:
        g = travel.geocode(f"{p['locality']}, Chennai, Tamil Nadu")
        time.sleep(1)
        if not g or not (12.9 < g[0] < 13.3 and 80.1 < g[1] < 80.4):
            return False
        locs[key] = {"name": p["locality"], "lat": round(g[0], 5), "lon": round(g[1], 5)}
    p["lat"], p["lon"] = locs[key]["lat"], locs[key]["lon"]
    p["location_precision"] = "locality"
    return True


def merge(fresh_files, swept):
    db = load(PROPS, None)
    locs = load(LOCALITIES, {})
    existing = {p["id"]: p for p in db["properties"]}
    seen, added, updated, rejected = set(), 0, 0, {}

    incoming = []
    for f in fresh_files:
        incoming += json.loads(Path(f).read_text())

    excluded = {x["id"] for x in load(EXCLUDED, {"listings": []})["listings"]}
    for pid in excluded & existing.keys():
        del existing[pid]
    todo = []
    for raw in incoming:
        p = {k: raw.get(k) for k in FIELDS if k in raw}
        why = reject_reason(p)
        if not why and FAR.search(stated_text(raw)):
            why = "text names a far-away locality"
        if not why and not locate(p, locs):
            why = "could not locate"
        if why:
            rejected[why] = rejected.get(why, 0) + 1
            continue
        p["id"] = listing_id(raw)
        if p["id"] in excluded:
            rejected["excluded after review"] = rejected.get("excluded after review", 0) + 1
            continue
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        todo.append(p)

    kms = travel.road_km([(p["lat"], p["lon"]) for p in todo]) if todo else []
    for p, km in zip(todo, kms):
        if km is None:
            rejected["no road route"] = rejected.get("no road route", 0) + 1
            seen.discard(p["id"])
            continue
        p.update(travel.minutes(km))
        if p["minutes_peak"] > MAX_MINUTES:
            rejected["outside drive zone"] = rejected.get("outside drive zone", 0) + 1
            seen.discard(p["id"])
            continue
        old = existing.get(p["id"])
        p["first_seen"] = old["first_seen"] if old else today()
        p["last_checked"] = today()
        p["status"] = "active"
        p["missed_sweeps"] = 0
        if old:
            updated += 1
            old.update(p)
        else:
            added += 1
            existing[p["id"]] = p

    # Same flat posted twice on one portal: same BHK, area, floor and locality. Keep the lower rent.
    flats = {}
    for pid, p in list(existing.items()):
        if p["status"] != "active" or not p.get("area_sqft") or not p.get("floor"):
            continue
        key = (p["source"], p["bhk"], p["area_sqft"], p["floor"], (p.get("locality") or "").lower())
        if key in flats:
            keep, drop = sorted([flats[key], pid], key=lambda i: existing[i]["rent"])
            del existing[drop]
            flats[key] = keep
            seen.discard(drop)
            rejected["duplicate flat"] = rejected.get("duplicate flat", 0) + 1
        else:
            flats[key] = pid

    # OLX pins and pins shared by several listings are area centres, not the flat itself.
    pin_count = {}
    for p in existing.values():
        pin_count[(p["source"], round(p["lat"], 4), round(p["lon"], 4))] = pin_count.get((p["source"], round(p["lat"], 4), round(p["lon"], 4)), 0) + 1
    for p in existing.values():
        if p["location_precision"] == "listing" and (p["source"] == "olx" or pin_count[(p["source"], round(p["lat"], 4), round(p["lon"], 4))] >= 3):
            p["location_precision"] = "approximate"
    for pid, p in list(existing.items()):
        if p["status"] == "active" and p["location_precision"] != "listing" and NEAR_EDGE.search(stated_text(p)):
            del existing[pid]  # area-centre pin, and the text puts it on the far side of the zone edge
            seen.discard(pid)
            rejected["approximate pin, text names an edge locality"] = rejected.get("approximate pin, text names an edge locality", 0) + 1

    deactivated = pruned = 0
    for pid, p in list(existing.items()):
        if pid in seen or p["source"] not in swept:
            continue
        if p["status"] == "active":
            p["missed_sweeps"] = p.get("missed_sweeps", 0) + 1
            if p["missed_sweeps"] >= MISSES_TO_INACTIVE:
                p["status"] = "inactive"
                deactivated += 1
        elif (dt.date.today() - dt.date.fromisoformat(p["last_checked"])).days > PRUNE_DAYS:
            del existing[pid]
            pruned += 1

    # Move-in window can lapse for listings that stop being refreshed.
    for p in existing.values():
        if p["available_from"] not in ("immediate", None) and p["available_from"] > LATEST_MOVE_IN:
            p["status"] = "inactive"

    db["properties"] = sorted(([{k: p.get(k) for k in FIELDS} for p in existing.values()]),
                              key=lambda p: (p["status"] != "active", p["minutes_peak"]))
    db["updated"] = today()
    save(PROPS, db)
    save(LOCALITIES, dict(sorted(locs.items())))
    print(json.dumps({"added": added, "updated": updated, "deactivated": deactivated, "pruned": pruned,
                      "rejected": rejected, "active_total": sum(p["status"] == "active" for p in existing.values())},
                     indent=2))
    check()


def check():
    db = load(PROPS, None)
    known = {s["id"] for s in load(SOURCES, {"sites": []})["sites"] if s["verdict"] != "excluded"}
    errs = []
    ids = set()
    for p in db["properties"]:
        tag = p.get("id", "?")
        if p["id"] in ids:
            errs.append(f"{tag}: duplicate id")
        ids.add(p["id"])
        if (why := reject_reason(p)) and p["status"] == "active":
            errs.append(f"{tag}: {why}")
        if p["source"] not in known:
            errs.append(f"{tag}: source {p['source']!r} is not an approved site in sources.json")
        for k in ("minutes_peak", "lat", "lon", "last_checked", "first_seen"):
            if p.get(k) is None:
                errs.append(f"{tag}: missing {k}")
        if p.get("furnishing") not in FURNISHING or p.get("posted_by") not in POSTED_BY:
            errs.append(f"{tag}: bad furnishing/posted_by")
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print(f"ok: {len(db['properties'])} listings valid")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("merge")
    m.add_argument("files", nargs="+")
    m.add_argument("--swept", default="", help="comma-separated sources fully re-searched this run")
    sub.add_parser("check")
    a = ap.parse_args()
    if a.cmd == "merge":
        merge(a.files, {s for s in a.swept.split(",") if s})
    else:
        check()
