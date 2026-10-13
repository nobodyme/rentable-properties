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
# Cache-bust: version the stylesheet and script by content hash, so a browser can
# never pair a new index.html with an old cached style.css/app.js.
python3 - <<'PY'
import hashlib, pathlib
site = pathlib.Path("_site")
html = (site / "index.html").read_text()
for name in ("style.css", "app.js"):
    v = hashlib.sha1((site / name).read_bytes()).hexdigest()[:10]
    html = html.replace(f'"{name}"', f'"{name}?v={v}"')
(site / "index.html").write_text(html)
PY
echo "built _site/ — preview with: python3 -m http.server -d _site 8000"
