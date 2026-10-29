#!/usr/bin/env bash
# Construit BetterVault.ipa avec xtool à partir du dépôt monté dans /src.
set -euo pipefail

# SDK iOS : extrait une fois d'Xcode.xip (téléchargé par vous sur developer.apple.com)
if ! swift sdk list 2>/dev/null | grep -q darwin; then
  if [ ! -f /Xcode.xip ]; then
    cat >&2 <<'EOF'
Le SDK iOS n'est pas encore installé.
Téléchargez Xcode (fichier .xip) sur https://developer.apple.com/download/all/?q=Xcode
avec votre identifiant Apple, puis relancez en montant le fichier :
  -v "/chemin/vers/Xcode.xip:/Xcode.xip:ro"
EOF
    exit 2
  fi
  xtool sdk install /Xcode.xip
fi

# Copie propre du dépôt, modifications en cours comprises, sans node_modules de l'hôte
git config --global --add safe.directory '*'
rm -rf /work && git clone --quiet /src /work
cd /src && git ls-files -m -o --exclude-standard -z | xargs -0 -r -I{} cp --parents {} /work/ 2>/dev/null || true
cd /work

npm ci --no-audit --no-fund
npm run build
bash scripts/build-ios.sh --prepare-only

cd ios
# Sans --sign : .ipa à signer par l'outil d'installation (Sideloadly, AltStore, xtool dev)
xtool dev build --ipa --configuration release
version=$(node -p "require('../package.json').version")
mkdir -p /out
ipa=$(find . -name '*.ipa' -newer Package.swift | head -1)
cp "$ipa" "/out/BetterVault_${version}_ios-unsigned.ipa"
ls -lh /out
