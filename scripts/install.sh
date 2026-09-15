#!/usr/bin/env sh
# Installation guidée du serveur BetterVault avec Docker.
# Usage : ./scripts/install.sh   (depuis n'importe quel dossier)
set -eu

cd "$(dirname "$0")/.."

say() { printf '%s\n' "$*"; }
ask() {
  # ask "Question" "valeur par défaut"
  printf '%s' "$1" >&2
  [ -n "$2" ] && printf ' [%s]' "$2" >&2
  printf ' : ' >&2
  read -r answer || answer=""
  printf '%s' "${answer:-$2}"
}
ask_secret() {
  printf '%s : ' "$1" >&2
  stty -echo 2>/dev/null || true
  read -r answer || answer=""
  stty echo 2>/dev/null || true
  printf '\n' >&2
  printf '%s' "$answer"
}
random() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Docker est nécessaire : https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  say "Le plugin « docker compose » est nécessaire."
  exit 1
fi

if [ -f .env ]; then
  replace=$(ask "Un fichier .env existe déjà. Le remplacer ? (o/N)" "N")
  case "$replace" in o|O|oui|y|Y|yes) ;; *) say "Rien n'a été modifié."; exit 0 ;; esac
fi

say ""
say "== BetterVault : installation du serveur =="
say ""

domain=$(ask "Nom de domaine (ex. vault.exemple.fr, vide pour un accès local seulement)" "")
port="8787"
if [ -z "$domain" ]; then
  port=$(ask "Port local" "8787")
  public_url="http://127.0.0.1:$port"
else
  public_url="https://$domain"
fi

registration=$(ask "Autoriser la création de comptes ? (o/n)" "o")
case "$registration" in n|N|non|no) registration_open=false ;; *) registration_open=true ;; esac

say ""
say "Emails (codes de réinitialisation et alertes). Laissez vide pour ne pas en envoyer."
smtp_host=$(ask "Serveur SMTP" "")
smtp_port="587"; smtp_security="starttls"; smtp_user=""; smtp_password=""; smtp_from=""
if [ -n "$smtp_host" ]; then
  smtp_security=$(ask "Sécurité (starttls, tls ou none)" "starttls")
  [ "$smtp_security" = "tls" ] && smtp_port=465
  smtp_port=$(ask "Port" "$smtp_port")
  smtp_user=$(ask "Utilisateur" "")
  [ -n "$smtp_user" ] && smtp_password=$(ask_secret "Mot de passe SMTP")
  smtp_from=$(ask "Adresse d'expédition" "BetterVault <${smtp_user:-no-reply@$domain}>")
fi

say ""
say "Limites (Entrée pour garder les valeurs proposées)."
max_credentials=$(ask "Identifiants par coffre" "5000")
max_note=$(ask "Caractères par note" "20000")
max_vault_mb=$(ask "Taille maximale d'un coffre (Mo)" "20")

secret=$(random 64)
admin_token=$(random 32)

cat > .env <<EOF
# Généré par scripts/install.sh le $(date '+%Y-%m-%d %H:%M')
BETTERVAULT_SECRET=$secret
BETTERVAULT_PORT=$port
DOMAIN=$domain
PUBLIC_URL=$public_url
TRUST_PROXY=$([ -n "$domain" ] && echo true || echo false)
CORS_ORIGINS=
REGISTRATION_OPEN=$registration_open
ADMIN_TOKEN=$admin_token

SMTP_HOST=$smtp_host
SMTP_PORT=$smtp_port
SMTP_SECURITY=$smtp_security
SMTP_USER=$smtp_user
SMTP_PASSWORD=$smtp_password
SMTP_FROM=$smtp_from

LIMIT_MAX_CREDENTIALS_PER_VAULT=$max_credentials
LIMIT_MAX_NOTE_LENGTH=$max_note
LIMIT_MAX_VAULT_MB=$max_vault_mb
EOF
chmod 600 .env

say ""
say "Fichier .env créé. Démarrage des conteneurs…"
if [ -n "$domain" ]; then
  docker compose --profile https up -d --build
else
  docker compose up -d --build
fi

say ""
say "BetterVault est en ligne : $public_url"
say "Administration : $public_url/admin"
say "Jeton d'administration : $admin_token"
say "(il est aussi dans le fichier .env, gardez ce fichier en lieu sûr)"
