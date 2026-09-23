package app.bettervault

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import androidx.annotation.RequiresApi

/** Champs de connexion trouvés dans l'écran à remplir */
data class LoginFields(
    val usernameIds: List<AutofillId>,
    val passwordIds: List<AutofillId>,
    val webDomain: String?
)

@RequiresApi(Build.VERSION_CODES.O)
object StructureParser {
    private val USERNAME_WORDS = Regex("user|login|email|e-mail|mail|identifiant|account|compte", RegexOption.IGNORE_CASE)

    fun parse(structure: AssistStructure): LoginFields {
        val usernames = mutableListOf<AutofillId>()
        val passwords = mutableListOf<AutofillId>()
        var domain: String? = null

        fun visit(node: AssistStructure.ViewNode) {
            node.webDomain?.takeIf { it.isNotBlank() }?.let { domain = it.lowercase().removePrefix("www.") }
            val id = node.autofillId
            if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
                val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
                val variation = node.inputType and InputType.TYPE_MASK_VARIATION
                val htmlType = node.htmlInfo?.attributes?.firstOrNull { it.first == "type" }?.second?.lowercase()
                val isPassword = hints.any { it.contains("password") }
                    || variation == InputType.TYPE_TEXT_VARIATION_PASSWORD
                    || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
                    || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    || htmlType == "password"
                val isUsername = !isPassword && (
                    hints.any { it.contains("username") || it.contains("email") }
                        || variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                        || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
                        || htmlType == "email"
                        || USERNAME_WORDS.containsMatchIn(listOfNotNull(node.idEntry, node.hint, node.htmlInfo?.attributes?.firstOrNull { it.first == "name" }?.second).joinToString(" "))
                    )
                if (isPassword) passwords.add(id) else if (isUsername) usernames.add(id)
            }
            for (i in 0 until node.childCount) visit(node.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode)
        return LoginFields(usernames, passwords, domain)
    }
}

/**
 * Service de remplissage automatique d'Android.
 * Il ne lit aucun identifiant sans authentification : il propose « Déverrouiller BetterVault »,
 * et c'est l'activité d'authentification qui déchiffre le cache après la biométrie.
 */
@RequiresApi(Build.VERSION_CODES.O)
class BetterVaultAutofillService : AutofillService() {

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        val packageName = structure.activityComponent.packageName
        // Pas de remplissage dans BetterVault lui-même ni sans cache préparé par l'application
        if (packageName == this.packageName || !SecureStore.exists(this, "autofill")) return callback.onSuccess(null)

        val fields = StructureParser.parse(structure)
        if (fields.passwordIds.isEmpty() && fields.usernameIds.isEmpty()) return callback.onSuccess(null)

        /*
         * Le domaine d'une page web est déclaré par l'application qui affiche
         * l'écran : n'importe quelle application peut prétendre montrer
         * « banque.fr » et recevoir ses identifiants (famille « AutoSpill »).
         * On ne le croit que venant d'un navigateur connu ; ailleurs, seul le nom
         * de paquet compte — Android le garantit, il ne se falsifie pas.
         */
        val trustedDomain = if (packageName in TRUSTED_BROWSERS) fields.webDomain else null

        val intent = Intent(this, AutofillAuthActivity::class.java).apply {
            putExtra(AutofillAuthActivity.EXTRA_DOMAIN, trustedDomain)
            putExtra(AutofillAuthActivity.EXTRA_PACKAGE, packageName)
            putExtra(AutofillAuthActivity.EXTRA_USERNAME_IDS, fields.usernameIds.toTypedArray())
            putExtra(AutofillAuthActivity.EXTRA_PASSWORD_IDS, fields.passwordIds.toTypedArray())
        }
        val flags = PendingIntent.FLAG_CANCEL_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val sender = PendingIntent.getActivity(this, (System.nanoTime() and 0x7fffffff).toInt(), intent, flags).intentSender

        val presentation = RemoteViews(this.packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, getString(R.string.autofill_unlock))
        }
        val ids = (fields.usernameIds + fields.passwordIds).toTypedArray()
        callback.onSuccess(FillResponse.Builder().setAuthentication(ids, sender, presentation).build())
    }

    companion object {
        /** Navigateurs dont le domaine de page est fiable : ils l'obtiennent de leur propre barre d'adresse */
        val TRUSTED_BROWSERS = setOf(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary", "org.chromium.chrome",
            "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix", "org.mozilla.focus", "org.mozilla.klar",
            "com.brave.browser", "com.brave.browser_beta", "com.microsoft.emmx", "com.opera.browser", "com.opera.gx",
            "com.sec.android.app.sbrowser", "com.duckduckgo.mobile.android", "com.vivaldi.browser",
            "com.kiwibrowser.browser", "org.bromite.bromite", "app.vanadium.browser", "com.ecosia.android",
            "com.yandex.browser", "com.mi.globalbrowser", "com.huawei.browser"
        )
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // L'enregistrement de nouveaux identifiants se fait dans l'application
        callback.onSuccess()
    }
}
