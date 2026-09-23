# Guide : construire BetterVault pas à pas

Ce guide part d'une machine vierge et va jusqu'aux fichiers installables. Chaque étape se termine par une commande qui vérifie qu'elle a marché : si la vérification échoue, pas la peine d'aller plus loin, la section [Dépannage](#depannage) donne la cause la plus fréquente.

Pour la référence (ce que produit chaque paquet, ce que fait la partie Rust), voir [Construire l'application](build.md). Pour mettre une version en ligne, voir [Publier une version](publier.md).

## Ce que vous voulez obtenir

| Objectif | Étapes | Machine | Durée de la première fois |
| --- | --- | --- | --- |
| Essayer ou modifier l'application | 1, 2, 3 | N'importe laquelle | 10 min |
| L'extension de navigateur | 1, 2, 4 | N'importe laquelle | 10 min |
| Installeur Windows (`.exe`, `.msi`) | 1, 2, 5 | Windows | 30 min |
| Paquets Linux (AppImage, `.deb`, `.rpm`) | 1, 2, 5 | Linux | 30 min |
| `.dmg` macOS | 1, 2, 5 | Mac | 30 min |
| APK Android | 1, 2, 6 | Windows, Mac ou Linux | 45 min |
| Application iOS | voir [macOS et iOS](../applications/apple.md) | Mac avec Xcode | — |
| Image Docker du serveur | 1, 7 | N'importe laquelle, avec Docker | 10 min |

La durée tient surtout à la première compilation Rust (5 à 15 minutes selon la machine) ; les suivantes réutilisent le cache et prennent une à deux minutes.

## 1. Préparer la machine

Il faut **Node.js 24** (le serveur utilise `node:sqlite`, absent des versions précédentes), **Git**, et pour les applications natives **Rust** et les outils de compilation du système.

=== "Windows"

    Dans un terminal PowerShell :

    ```powershell
    winget install OpenJS.NodeJS Git.Git Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    ```

    La seconde commande installe le compilateur C++ de Microsoft, indispensable à Rust. **WebView2**, le moteur qui affiche l'interface, est déjà présent sur Windows 10 à jour et Windows 11. Les outils qui fabriquent les installeurs (WiX pour le `.msi`, NSIS pour le `.exe`) sont téléchargés par Tauri à la première construction.

    Fermez puis rouvrez le terminal pour qu'il voie les nouveaux programmes.

=== "macOS"

    ```bash
    xcode-select --install
    brew install node@24 git
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

    Sans Homebrew, Node.js s'installe aussi depuis [nodejs.org](https://nodejs.org). Pour un `.dmg` qui marche sur les Mac Intel comme sur les Mac Apple Silicon, ajoutez les deux cibles :

    ```bash
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
    ```

=== "Linux (Debian, Ubuntu)"

    Ubuntu 22.04 ou plus récent, Debian 12 ou plus récent :

    ```bash
    sudo apt-get update
    sudo apt-get install -y build-essential curl wget file git libssl-dev libdbus-1-dev \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

=== "Linux (Fedora)"

    ```bash
    sudo dnf group install -y c-development
    sudo dnf install -y curl wget file git openssl-devel dbus-devel \
      webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel nodejs
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

    Vérifiez que `node --version` affiche bien 24 ou plus ; sinon, installez Node.js 24 avec [nvm](https://github.com/nvm-sh/nvm).

=== "Linux (Arch)"

    ```bash
    sudo pacman -S --needed base-devel curl wget file git openssl dbus \
      webkit2gtk-4.1 libappindicator-gtk3 librsvg nodejs npm rustup
    rustup default stable
    ```

**Vérification** :

```bash
node --version
cargo --version
```

La première doit afficher `v24` ou plus. La seconde n'est nécessaire que pour les applications natives (étapes 5 et 6).

## 2. Récupérer le code

```bash
git clone https://github.com/FreeProject089/BetterVault.git
cd BetterVault
npm ci
```

`npm ci` installe exactement les versions du fichier `package-lock.json`, celles que la CI utilise.

**Vérification** :

```bash
npm run typecheck
npm test
```

Les deux doivent se terminer sans erreur. Si les tests échouent sur une copie fraîche, c'est presque toujours la version de Node.js.

## 3. Lancer l'application et le serveur

Copiez la configuration d'exemple et remplacez le secret par une longue valeur aléatoire :

=== "Windows"

    ```powershell
    Copy-Item server/.env.example server/.env
    $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
    ```

=== "macOS, Linux"

    ```bash
    cp server/.env.example server/.env
    openssl rand -base64 48
    ```

Collez la valeur obtenue après `BETTERVAULT_SECRET=` dans `server/.env`. Puis, dans **deux terminaux** :

```bash
npm run server
```

```bash
npm run dev
```

**Vérification** : ouvrez [http://localhost:3000](http://localhost:3000) et créez un compte. Le jeton de la page `/admin` s'affiche dans le terminal du serveur au premier démarrage (sauf si vous l'avez fixé avec `ADMIN_TOKEN`).

!!! warning "Ne commitez jamais `server/.env`"
    Il contient le secret qui protège les sessions. Il est ignoré par Git ; gardez-le ainsi.

## 4. Construire l'extension de navigateur

```bash
npm run build:extension
```

**Vérification** : le dossier `dist-extension/` contient un `manifest.json`. Pour l'essayer :

- **Chrome, Edge, Brave** : ouvrez `chrome://extensions`, activez le **mode développeur**, cliquez sur **Charger l'extension non empaquetée** et choisissez `dist-extension/`.
- **Firefox** : ouvrez `about:debugging`, puis **Ce Firefox** → **Charger un module complémentaire temporaire** et choisissez `dist-extension/manifest.json`.

Pour une archive à distribuer, zippez le *contenu* du dossier (pas le dossier lui-même).

## 5. Construire l'application de bureau

Sur le système visé (Tauri ne fabrique pas un `.dmg` depuis Windows) :

```bash
npx tauri build
```

La commande construit d'abord l'application web, puis compile la partie Rust et fabrique les installeurs.

| Système | Fichiers produits | Dossier |
| --- | --- | --- |
| Windows | `BetterVault_<version>_x64-setup.exe`, `BetterVault_<version>_x64_en-US.msi` | `src-tauri/target/release/bundle/nsis/` et `msi/` |
| Linux | `.AppImage`, `.deb`, `.rpm` | `src-tauri/target/release/bundle/appimage/`, `deb/`, `rpm/` |
| macOS | `.app`, `.dmg` | `src-tauri/target/<cible>/release/bundle/dmg/` |

Sur Mac, précisez la cible : `npx tauri build --target aarch64-apple-darwin` pour Apple Silicon, `--target x86_64-apple-darwin` pour Intel.

**Vérification** : installez le fichier produit et lancez BetterVault. À la première ouverture, indiquez l'adresse de votre serveur (`http://127.0.0.1:8787` si c'est celui de l'étape 3).

!!! note "Installeurs non signés"
    Construits chez vous, les installeurs ne sont pas signés. Sur la machine qui les a construits, ils s'ouvrent normalement ; une fois envoyés ailleurs (téléchargement, messagerie), Windows affiche « Windows a protégé votre ordinateur » (**Informations complémentaires** → **Exécuter quand même**) et macOS refuse la première ouverture (clic droit → **Ouvrir**). Les versions publiées se signent avec les secrets décrits dans [Publier une version](publier.md#les-secrets-de-signature).

Pour travailler sur l'application de bureau avec rechargement à chaud : `npx tauri dev`.

## 6. APK Android

### Installer le SDK Android

Le plus simple est [Android Studio](https://developer.android.com/studio). Au premier lancement, laissez-le installer le SDK, puis dans **Settings → Languages & Frameworks → Android SDK → SDK Tools**, cochez **NDK (Side by side)** et installez la version `27.1.12297006` (celle de la CI).

Ajoutez les cibles Rust d'Android :

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### Indiquer où sont Java, le SDK et le NDK

=== "Windows"

    ```powershell
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
    $env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.1.12297006"
    ```

    Gradle échoue souvent sous Windows avec « Unable to establish loopback connection » quand le dossier temporaire a un nom court (`C:\Users\NOMLON~1\…`). Donnez-lui un dossier simple, avant de construire :

    ```powershell
    New-Item -ItemType Directory -Force C:\gradle-tmp | Out-Null
    $env:TEMP = 'C:\gradle-tmp'; $env:TMP = 'C:\gradle-tmp'
    $env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\gradle-tmp'
    ```

    Ces variables ne valent que pour le terminal ouvert. Pour les garder, ajoutez-les dans **Paramètres → Système → Informations système → Paramètres avancés → Variables d'environnement**.

=== "macOS"

    ```bash
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    export ANDROID_HOME="$HOME/Library/Android/sdk"
    export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
    ```

=== "Linux"

    ```bash
    export JAVA_HOME=/opt/android-studio/jbr
    export ANDROID_HOME="$HOME/Android/Sdk"
    export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
    ```

    Ajoutez ces lignes à `~/.bashrc` pour les garder.

### Construire

```bash
npx tauri android build --apk
```

Pour aller plus vite en ne visant que les téléphones récents : `npx tauri android build --apk --target aarch64`.

L'APK sort dans `src-tauri/gen/android/app/build/outputs/apk/universal/release/`, **non signé** : Android refuse de l'installer tel quel.

### Signer l'APK

Créez une clé une seule fois, **hors du dossier du projet**, et gardez-la précieusement : toutes les mises à jour devront être signées avec elle. `keytool` est fourni avec Java (`$JAVA_HOME/bin`) ; la commande demande un mot de passe, puis un nom (n'importe lequel).

Ensuite, alignez puis signez l'APK avec les outils du SDK. Remplacez `35.0.0` par une version présente dans `build-tools/` ; `apksigner` demande le mot de passe de la clé.

=== "Windows"

    ```powershell
    & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore $HOME\cles\release.keystore -alias bettervault -keyalg RSA -keysize 4096 -validity 10000

    $BT = "$env:ANDROID_HOME\build-tools\35.0.0"
    $APK = "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
    & "$BT\zipalign.exe" -f -p 4 $APK aligne.apk
    & "$BT\apksigner.bat" sign --ks $HOME\cles\release.keystore --ks-key-alias bettervault --out bettervault.apk aligne.apk
    & "$BT\apksigner.bat" verify bettervault.apk
    ```

=== "macOS, Linux"

    ```bash
    keytool -genkeypair -v -keystore ~/cles/release.keystore -alias bettervault -keyalg RSA -keysize 4096 -validity 10000

    BT="$ANDROID_HOME/build-tools/35.0.0"
    APK=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
    "$BT/zipalign" -f -p 4 "$APK" aligne.apk
    "$BT/apksigner" sign --ks ~/cles/release.keystore --ks-key-alias bettervault --out bettervault.apk aligne.apk
    "$BT/apksigner" verify bettervault.apk
    ```

**Vérification** : la dernière commande ne répond rien, et c'est bon signe (elle ne parle qu'en cas de problème). Copiez `bettervault.apk` sur le téléphone et ouvrez-le ; Android demande d'autoriser l'installation depuis cette source la première fois.

!!! danger "La clé ne va jamais dans le dépôt"
    Rangez `release.keystore` et son mot de passe hors du dossier du projet, avec une sauvegarde. Perdue, la clé empêche toute mise à jour : il faudrait désinstaller l'application sur chaque téléphone.

## 7. Construire l'image Docker du serveur

```bash
docker build -t bettervault:local .
```

L'image contient l'application web construite, le serveur et la documentation. Pour la lancer avec la configuration du dépôt :

```bash
docker compose up -d
```

**Vérification** :

```bash
curl http://127.0.0.1:8787/api/v1/health
```

La réponse contient `"ok":true`. La mise en service réelle (domaine, HTTPS, sauvegardes) est décrite dans [Docker](../deploiement/docker.md).

## 8. Construire la documentation

```bash
npm run docs:build
```

Il faut [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv`, `brew install uv` ou `pipx install uv`) : il installe MkDocs dans un environnement à part, sans toucher au Python du système. `npm run docs` sert la documentation sur [http://127.0.0.1:8000](http://127.0.0.1:8000) avec rechargement à chaud.

Le serveur BetterVault sert lui-même cette documentation sous `/docs` : cette étape ne sert qu'à vérifier les liens (`--strict` échoue sur un lien cassé).

## Dépannage

| Message | Cause | Solution |
| --- | --- | --- |
| `node:sqlite` introuvable, ou tests qui échouent tous | Node.js trop ancien | Installer Node.js 24 ou plus |
| `linker 'link.exe' not found` | Outils C++ absents (Windows) | Installer les Build Tools de l'étape 1, puis rouvrir le terminal |
| `failed to download WiX` / `NSIS` | Pas d'accès à GitHub pendant la construction | Relancer avec une connexion, ou construire seulement le `.exe` : `npx tauri build --bundles nsis` |
| `webkit2gtk-4.1 was not found` | Distribution trop ancienne, ou paquet manquant | Ubuntu 22.04+ / Debian 12+, puis la liste de l'étape 1 |
| `failed to run linuxdeploy` | Outils de l'AppImage absents | `sudo apt-get install file libfuse2`, ou seulement le `.deb` : `npx tauri build --bundles deb` |
| `keytool` introuvable | Java n'est pas dans le `PATH` | L'appeler par `JAVA_HOME` : `& "$env:JAVA_HOME\bin\keytool.exe"` (Windows) |
| `NDK_HOME` ou `ANDROID_HOME` non défini | Variables de l'étape 6 oubliées dans ce terminal | Les redéfinir, ou les rendre permanentes |
| `Unable to establish loopback connection` (Gradle, Windows) | Dossier temporaire au nom court, refusé par Java | Les trois lignes `C:\gradle-tmp` de l'[étape 6](#6-apk-android) |
| `the lock file needs to be updated but --locked was passed` | Dépendance Rust modifiée sans mettre à jour `Cargo.lock` | `cd src-tauri && cargo update -p <paquet>`, puis commiter `Cargo.lock` |
| `EADDRINUSE: 8787` | Un serveur tourne déjà sur ce port | Arrêter l'autre (un conteneur Docker ?) ou changer `PORT` dans `server/.env` |
| L'application native n'arrive pas au serveur | Adresse `127.0.0.1` sur un téléphone | Sur téléphone, `127.0.0.1` désigne le téléphone : utiliser l'adresse HTTPS du serveur |

Avant de proposer une modification, lancez les contrôles de la CI : voir [Vérifications avant de publier](build.md#verifications-avant-de-publier).
