#!/usr/bin/env bash
# Construit l'APK à partir du dépôt monté en lecture seule dans /src.
# Sans keystore, l'APK n'est pas signé : Android refuse de l'installer tel quel
# (voir docs/development/build.md pour le signer).
set -euo pipefail

git config --global --add safe.directory '*'
rm -rf /work && git clone --quiet /src /work
cd /src && git ls-files -m -o --exclude-standard -z | xargs -0 -r -I{} cp --parents {} /work/ 2>/dev/null || true
cd /work

npm ci --no-audit --no-fund
npx tauri android build --apk

version=$(node -p "require('./package.json').version")
mkdir -p /out
for apk in $(find src-tauri/gen/android -name '*.apk' -path '*release*'); do
  case "$apk" in
    *unsigned*) cp "$apk" "/out/BetterVault_${version}_android-unsigned.apk" ;;
    *) cp "$apk" "/out/BetterVault_${version}_android.apk" ;;
  esac
done
ls -lh /out
