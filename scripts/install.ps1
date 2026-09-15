# Installation guidée du serveur BetterVault avec Docker (Windows)
# Usage : powershell -ExecutionPolicy Bypass -File scripts\install.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Ask([string]$Question, [string]$Default = '') {
  $label = if ($Default) { "$Question [$Default]" } else { $Question }
  $answer = Read-Host $label
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim()
}

function New-RandomText([int]$Length) {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker Desktop est nécessaire : https://docs.docker.com/desktop/'
  exit 1
}

if (Test-Path .env) {
  $replace = Ask 'Un fichier .env existe déjà. Le remplacer ? (o/N)' 'N'
  if ($replace -notmatch '^(o|oui|y|yes)$') { Write-Host "Rien n'a été modifié."; exit 0 }
}

Write-Host ''
Write-Host '== BetterVault : installation du serveur =='
Write-Host ''

$domain = Ask 'Nom de domaine (ex. vault.exemple.fr, vide pour un accès local seulement)'
$port = '8787'
if ($domain) { $publicUrl = "https://$domain" } else { $port = Ask 'Port local' '8787'; $publicUrl = "http://127.0.0.1:$port" }

$registration = Ask 'Autoriser la création de comptes ? (o/n)' 'o'
$registrationOpen = if ($registration -match '^(n|non|no)$') { 'false' } else { 'true' }

Write-Host ''
Write-Host 'Emails (codes de réinitialisation et alertes). Laissez vide pour ne pas en envoyer.'
$smtpHost = Ask 'Serveur SMTP'
$smtpPort = '587'; $smtpSecurity = 'starttls'; $smtpUser = ''; $smtpPassword = ''; $smtpFrom = ''
if ($smtpHost) {
  $smtpSecurity = Ask 'Sécurité (starttls, tls ou none)' 'starttls'
  if ($smtpSecurity -eq 'tls') { $smtpPort = '465' }
  $smtpPort = Ask 'Port' $smtpPort
  $smtpUser = Ask 'Utilisateur'
  if ($smtpUser) {
    $secure = Read-Host 'Mot de passe SMTP' -AsSecureString
    $smtpPassword = [System.Net.NetworkCredential]::new('', $secure).Password
  }
  $defaultFrom = if ($smtpUser) { "BetterVault <$smtpUser>" } else { "BetterVault <no-reply@$domain>" }
  $smtpFrom = Ask "Adresse d'expédition" $defaultFrom
}

Write-Host ''
Write-Host 'Limites (Entrée pour garder les valeurs proposées).'
$maxCredentials = Ask 'Identifiants par coffre' '5000'
$maxNote = Ask 'Caractères par note' '20000'
$maxVaultMb = Ask "Taille maximale d'un coffre (Mo)" '20'

$secret = New-RandomText 64
$adminToken = New-RandomText 32
$trustProxy = if ($domain) { 'true' } else { 'false' }

$content = @"
# Généré par scripts/install.ps1 le $(Get-Date -Format 'yyyy-MM-dd HH:mm')
BETTERVAULT_SECRET=$secret
BETTERVAULT_PORT=$port
DOMAIN=$domain
PUBLIC_URL=$publicUrl
TRUST_PROXY=$trustProxy
CORS_ORIGINS=
REGISTRATION_OPEN=$registrationOpen
ADMIN_TOKEN=$adminToken

SMTP_HOST=$smtpHost
SMTP_PORT=$smtpPort
SMTP_SECURITY=$smtpSecurity
SMTP_USER=$smtpUser
SMTP_PASSWORD=$smtpPassword
SMTP_FROM=$smtpFrom

LIMIT_MAX_CREDENTIALS_PER_VAULT=$maxCredentials
LIMIT_MAX_NOTE_LENGTH=$maxNote
LIMIT_MAX_VAULT_MB=$maxVaultMb
"@
# UTF-8 sans BOM : docker compose lit mal un .env qui commence par un BOM
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $content, [System.Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host 'Fichier .env créé. Démarrage des conteneurs…'
if ($domain) { docker compose --profile https up -d --build } else { docker compose up -d --build }

Write-Host ''
Write-Host "BetterVault est en ligne : $publicUrl"
Write-Host "Administration : $publicUrl/admin"
Write-Host "Jeton d'administration : $adminToken"
Write-Host '(il est aussi dans le fichier .env, gardez ce fichier en lieu sûr)'
