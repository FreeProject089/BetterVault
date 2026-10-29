#!/usr/bin/env bash
# Construit les paquets Linux à partir du dépôt monté en lecture seule dans /src.
# Le dépôt est recopié (sans node_modules ni target) : les binaires de la machine
# hôte, par exemple ceux de Windows, ne se mélangent pas à ceux du conteneur.
set -euo pipefail

# Dépôt monté depuis l'hôte : son propriétaire n'est pas l'utilisateur du conteneur
git config --global --add safe.directory '*'
rm -rf /work && git clone --quiet /src /work
# Les modifications pas encore validées comptent aussi : on les reprend par-dessus
cd /src && git ls-files -m -o --exclude-standard -z | xargs -0 -r -I{} cp --parents {} /work/ 2>/dev/null || true
cd /work

npm ci --no-audit --no-fund
# AppImage : linuxdeploy est lui-même une AppImage, sans FUSE dans un conteneur
export APPIMAGE_EXTRACT_AND_RUN=1
npx tauri build --bundles deb,rpm,appimage

mkdir -p /out
find src-tauri/target/release/bundle \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) -exec cp {} /out/ \;
ls -lh /out
