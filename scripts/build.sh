#!/usr/bin/env sh
# Assemble the deployable site: design from site/, content from data/.
set -e
cd "$(dirname "$0")/.."
python3 scripts/update_data.py check
rm -rf _site && mkdir -p _site/data
cp site/* _site/
cp data/properties.json data/sources.json data/isochrone.geojson _site/data/
echo "built _site/ — preview with: python3 -m http.server -d _site 8000"
