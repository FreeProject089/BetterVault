#!/usr/bin/env bash
# Application iOS avec xtool (sans Xcode) : prépare ios/ puis construit l'.ipa.
#
#   bash scripts/build-ios.sh                 # sur Linux ou WSL, xtool installé
#   bash scripts/build-ios.sh --prepare-only  # recopie seulement l'application web
#   bash scripts/build-ios.sh --device        # construit, signe et installe sur l'iPhone branché
#
# Sans xtool sur la machine : packaging/ios/Dockerfile fait la même chose dans un conteneur.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
build=$(git rev-list --count HEAD 2>/dev/null || echo 1)

# Application web construite ; npm run build la produit dans dist/
[ -f dist/index.html ] || npm run build

rm -rf ios/Web && mkdir -p ios/Web ios/Resources
cp -R dist/. ios/Web/
cp src-tauri/icons/ios/AppIcon-512@2x.png ios/Resources/AppIcon.png
sed -e "s/@VERSION@/${version}/" -e "s/@BUILD@/${build}/" ios/Info.plist.in > ios/Info.plist

[ "${1:-}" = "--prepare-only" ] && exit 0

cd ios
if [ "${1:-}" = "--device" ]; then
  # Connexion Apple demandée par xtool au premier lancement (xtool setup)
  xtool dev run --configuration release
else
  xtool dev build --ipa --configuration release
  find . -name '*.ipa' -newer Package.swift -exec ls -lh {} \;
fi
