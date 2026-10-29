import Foundation
import WebKit

/**
 * Sert l'application web embarquée (dossier Web du paquet) à l'adresse
 * tauri://localhost, la même origine que l'application Tauri iOS : les
 * données déjà rangées par la webview, les règles du serveur (CORS, passkeys)
 * et la politique de sécurité valent à l'identique.
 */
final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "tauri"
    static let startURL = URL(string: "tauri://localhost/index.html")!

    /// Politique de src-tauri/tauri.conf.json : les deux applications ont les mêmes droits
    private static let contentSecurityPolicy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "frame-src blob:",
        "object-src 'none'",
        "connect-src 'self' https: http://127.0.0.1:8787 http://localhost:8787",
    ].joined(separator: "; ")

    private let root: URL

    override init() {
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
        root = (bundled ?? URL(fileURLWithPath: NSTemporaryDirectory())).standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "localhost" else {
            respond(urlSchemeTask, status: 404, body: Data("Not found".utf8), type: "text/plain")
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL

        // Rien hors du dossier embarqué, même avec « .. » dans l'adresse
        guard file.path.hasPrefix(root.path + "/") else {
            respond(urlSchemeTask, status: 403, body: Data("Forbidden".utf8), type: "text/plain")
            return
        }

        var isDirectory: ObjCBool = false
        if !FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory) || isDirectory.boolValue {
            // Une route de l'application (sans extension) retombe sur la page unique
            guard file.pathExtension.isEmpty else {
                respond(urlSchemeTask, status: 404, body: Data("Not found".utf8), type: "text/plain")
                return
            }
            file = root.appendingPathComponent("index.html")
        }

        do {
            let data = try Data(contentsOf: file)
            respond(urlSchemeTask, status: 200, body: data, type: Self.mimeType(for: file.pathExtension))
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Les réponses partent d'un bloc, avant que la page puisse annuler : rien à interrompre
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, body: Data, type: String) {
        guard let url = task.request.url else { return }
        var headers = [
            "Content-Type": type,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        ]
        if type.hasPrefix("text/html") { headers["Content-Security-Policy"] = Self.contentSecurityPolicy }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
