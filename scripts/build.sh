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
echo "built _site/ — preview with: python3 -m http.server -d _site 8000"
