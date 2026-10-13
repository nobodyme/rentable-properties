#!/usr/bin/env sh
# Assemble the deployable site: design from site/, content from data/.
set -e
cd "$(dirname "$0")/.."
python3 scripts/update_data.py check
rm -rf _site && mkdir -p _site/data
cp site/* _site/
cp data/sources.json data/isochrone.geojson _site/data/
# The site only needs the origin's coordinates; keep its name out of the published copy.
python3 -c "import json; d = json.load(open('data/properties.json')); d['origin'].pop('name', None); json.dump(d, open('_site/data/properties.json', 'w'), ensure_ascii=False)"
# Atomic updates: style.css and app.js are published under content-hashed names
# (style.<hash>.css), so each index.html points at files that never change.
# GitHub Pages lets browsers cache any file for 10 minutes and ignores ?query
# strings, so plain names or ?v= tags can still pair a new page with an old
# stylesheet (or the reverse).
# With KEEP_LIVE_ASSETS=<site url>, the files the live page uses right now are
# copied into this build too, so a phone still showing the previous page keeps
# getting the previous page's files instead of a 404. Each deploy starts from an
# empty _site/, so at most two versions (current + previous) are ever published.
python3 - <<'PY'
import hashlib, os, pathlib, re, urllib.request
site = pathlib.Path("_site")
html = (site / "index.html").read_text()
for name in ("style.css", "app.js"):
    data = (site / name).read_bytes()
    stem, ext = name.rsplit(".", 1)
    hashed = f"{stem}.{hashlib.sha1(data).hexdigest()[:10]}.{ext}"
    (site / hashed).write_bytes(data)
    (site / name).unlink()  # only hashed copies are published
    html = html.replace(f'"{name}"', f'"{hashed}"')
(site / "index.html").write_text(html)

live = os.environ.get("KEEP_LIVE_ASSETS")
if live:
    live = live.rstrip("/") + "/"
    try:
        page = urllib.request.urlopen(live, timeout=30).read().decode()
        for ref in set(re.findall(r'"((?:style|app)\.[0-9a-f]{10}\.(?:css|js))"', page)):
            if not (site / ref).exists():
                (site / ref).write_bytes(urllib.request.urlopen(live + ref, timeout=30).read())
                print("kept live asset", ref)
    except Exception as e:  # first deploy, or site unreachable: nothing to keep
        print("could not fetch live assets:", e)
PY
echo "built _site/ — preview with: python3 -m http.server -d _site 8000"
