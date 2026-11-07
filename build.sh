#!/bin/sh
# Build dist/ (the plugin folder) and package.zip for the release.
set -e
export PATH="$HOME/.local/node/bin:$PATH"
node esbuild.config.mjs
npx tsc -p .
mkdir -p dist/i18n
cp src/index.css plugin.json icon.png preview.png README.md README.zh-CN.md LICENSE dist/ 2>/dev/null || true
cp src/i18n/*.json dist/i18n/
rm -f package.zip && python3 -c "import shutil; shutil.make_archive(\"package\", \"zip\", \"dist\")"
echo built: $(ls dist) && python3 -c "import zipfile; print(zipfile.ZipFile(\"package.zip\").namelist())"
