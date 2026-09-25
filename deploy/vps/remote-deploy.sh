#!/usr/bin/env sh
# Met à jour une instance BetterVault sur le VPS, appelé par le workflow Deploy :
#   ./remote-deploy.sh <staging|production> <image@sha256:…>
# Tire l'image, remplace le conteneur, attend le contrôle de santé ; en cas
# d'échec, revient à l'image précédente et sort en erreur.
set -eu

ENV_NAME="${1:?environnement manquant (staging ou production)}"
IMAGE="${2:?image manquante}"
case "$ENV_NAME" in staging|production) ;; *) echo "Environnement inconnu : $ENV_NAME" >&2; exit 2 ;; esac
case "$IMAGE" in *@sha256:*) ;; *) echo "L'image doit être fixée par son empreinte (…@sha256:…)" >&2; exit 2 ;; esac

cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Fichier .env absent dans $(pwd) : le créer d'abord (voir env.example et docs/development/ci-cd.md)" >&2
  exit 1
fi

export BV_ENV="$ENV_NAME"
PREVIOUS="$(cat .image 2>/dev/null || true)"

echo "→ $ENV_NAME : $IMAGE"
BV_IMAGE="$IMAGE" docker compose -f compose.yaml pull --quiet
if BV_IMAGE="$IMAGE" docker compose -f compose.yaml up -d --wait --wait-timeout 120; then
  printf '%s\n' "$IMAGE" > .image
  # Garder l'image précédente pour un retour en arrière, nettoyer le reste (plus de 7 jours)
  docker image prune -f --filter "until=168h" >/dev/null || true
  echo "✓ $ENV_NAME à jour et en bonne santé"
  exit 0
fi

echo "✗ Le contrôle de santé a échoué ; journaux :" >&2
docker logs --tail 80 "bettervault-$ENV_NAME" >&2 || true
if [ -n "$PREVIOUS" ]; then
  echo "↺ Retour à l'image précédente : $PREVIOUS" >&2
  BV_IMAGE="$PREVIOUS" docker compose -f compose.yaml up -d --wait --wait-timeout 120 || echo "Le retour en arrière a lui aussi échoué" >&2
fi
exit 1
