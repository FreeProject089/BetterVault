// swift-tools-version: 6.0

import PackageDescription

/*
 * Application iOS construite avec xtool (https://github.com/xtool-org/xtool),
 * sans Xcode ni Mac : une webview native qui sert l'application web embarquée
 * (dossier Web, recopié par scripts/build-ios.sh) et répond aux mêmes commandes
 * natives que l'application Tauri (trousseau, Face ID, stockage, liens).
 */
let package = Package(
    name: "BetterVault",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        // Un projet xtool contient exactement une bibliothèque : l'application
        .library(
            name: "BetterVault",
            targets: ["BetterVault"]
        ),
    ],
    targets: [
        .target(
            name: "BetterVault",
            linkerSettings: [
                .linkedFramework("WebKit"),
                .linkedFramework("LocalAuthentication"),
                .linkedFramework("Security"),
            ]
        ),
    ],
    swiftLanguageModes: [.v5]
)
