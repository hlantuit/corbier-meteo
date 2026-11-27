#!/bin/sh
# Stamp a new version on the page's CSS and JS URLs so browsers load the new code right away.
cd "$(dirname "$0")/.." && V=$(date -u +%Y%m%d%H%M) && sed -i -E "s/\?v=[0-9A-Za-z-]+/?v=$V/g" index.html && echo "version $V"
