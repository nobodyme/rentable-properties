"""Peak-hour travel-time model shared by the build and update steps.

Minutes = road distance (OSRM driving route) / TomTom 2025 Chennai rush-hour speed.
Evening rush (14.6 km/h) is the worst case and is what the site reports as
"minutes from Stanley"; morning rush (17.7 km/h) is kept alongside.
"""
import json, urllib.request

STANLEY = (13.1058, 80.2872)  # Stanley Medical College Hospital, Old Jail Rd, Royapuram
EVENING_KMH = 14.6
MORNING_KMH = 17.7
UA = {"User-Agent": "rentable-properties/1.0 (personal rental search)"}


def _get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))


def road_km(points):
    """Road distance in km from Stanley to each (lat, lon), one OSRM table call."""
    out = []
    for i in range(0, len(points), 90):
        chunk = points[i:i + 90]
        coords = ";".join(f"{lon},{lat}" for lat, lon in [STANLEY, *chunk])
        r = _get(f"https://router.project-osrm.org/table/v1/driving/{coords}?sources=0&annotations=distance")
        out += [d / 1000 if d is not None else None for d in r["distances"][0][1:]]
    return out


def minutes(km):
    return {
        "minutes_peak": round(km / EVENING_KMH * 60),
        "minutes_morning": round(km / MORNING_KMH * 60),
        "road_km": round(km, 1),
    }


def geocode(q):
    from urllib.parse import quote
    r = _get(f"https://photon.komoot.io/api/?q={quote(q)}&limit=1&lat={STANLEY[0]}&lon={STANLEY[1]}")
    if not r["features"]:
        return None
    lon, lat = r["features"][0]["geometry"]["coordinates"]
    return lat, lon
