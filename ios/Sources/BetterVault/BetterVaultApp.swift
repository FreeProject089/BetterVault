import SwiftUI
import UIKit
import WebKit

@main
struct BetterVaultApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                // La page gère elle-même les zones sûres (env(safe-area-inset-*)), comme dans Tauri
                .ignoresSafeArea()
                .background(Color(red: 0.05, green: 0.06, blue: 0.09))
        }
    }
}

struct WebAppView: UIViewRepresentable {
    func makeCoordinator() -> WebAppController {
        WebAppController()
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeWebView()
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Webview de l'application : contenu embarqué, pont natif, liens externes vers Safari
final class WebAppController: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let bridge = NativeBridge()

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAppSchemeHandler(), forURLScheme: WebAppSchemeHandler.scheme)
        configuration.userContentController.addUserScript(WKUserScript(
            source: NativeBridge.injectedScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: NativeBridge.handlerName)
        configuration.allowsInlineMediaPlayback = true
        // Agent utilisateur mobile même sur iPad : l'application reconnaît iOS à « iPhone » ou « iPad »
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.applicationNameForUserAgent = "BetterVault"
        // Les coffres restent dans le stockage persistant de la webview, jamais dans un stockage éphémère
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.05, green: 0.06, blue: 0.09, alpha: 1)
        #if DEBUG
        webView.isInspectable = true
        #endif

        webView.load(URLRequest(url: WebAppSchemeHandler.startURL))
        return webView
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }
        // Contenu de l'application et documents produits par la page (aperçus, exports)
        if scheme == WebAppSchemeHandler.scheme || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        // Une adresse web dans la page principale quitte l'application : Safari, jamais la webview
        if navigationAction.targetFrame?.isMainFrame != false {
            openOutside(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    /// target="_blank" et window.open : ouverts dans Safari
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { openOutside(url) }
        return nil
    }

    private func openOutside(_ url: URL) {
        guard ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return }
        UIApplication.shared.open(url)
    }

    /// Le système peut arrêter le processus de la page en arrière-plan : on la recharge
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: Caméra (lecture des QR codes)

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        // Seule l'application embarquée y a droit ; iOS demande ensuite l'accord de l'utilisateur
        decisionHandler(origin.protocol == WebAppSchemeHandler.scheme && type == .camera ? .prompt : .deny)
    }

    // MARK: Boîtes de dialogue JavaScript

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, from: webView, orElse: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, from: webView) { completionHandler(false) }
    }

    private func present(_ alert: UIAlertController, from webView: WKWebView, orElse fallback: @escaping () -> Void) {
        var controller = webView.window?.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        guard let controller else {
            fallback()
            return
        }
        controller.present(alert, animated: true)
    }
}
