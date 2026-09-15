package app.bettervault

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray

/**
 * Déverrouille le cache de remplissage avec la biométrie, puis propose les identifiants
 * dont le domaine (site) ou le nom de paquet (application) correspond à l'écran.
 */
@RequiresApi(Build.VERSION_CODES.O)
class AutofillAuthActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_DOMAIN = "bettervault.domain"
        const val EXTRA_PACKAGE = "bettervault.package"
        const val EXTRA_USERNAME_IDS = "bettervault.usernameIds"
        const val EXTRA_PASSWORD_IDS = "bettervault.passwordIds"
    }

    private data class Entry(val title: String, val username: String, val password: String, val domains: List<String>, val packages: List<String>)

    @Suppress("DEPRECATION")
    private inline fun <reified T> Intent.parcelables(name: String): List<T> =
        getParcelableArrayExtra(name)?.filterIsInstance<T>() ?: emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val domain = intent.getStringExtra(EXTRA_DOMAIN)
        val packageName = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val usernameIds = intent.parcelables<AutofillId>(EXTRA_USERNAME_IDS)
        val passwordIds = intent.parcelables<AutofillId>(EXTRA_PASSWORD_IDS)

        SecureStore.authenticate(this, getString(R.string.autofill_prompt_title), domain ?: packageName,
            onSuccess = { cipher ->
                val entries = try {
                    parse(String(SecureStore.open(this, "autofill", cipher), Charsets.UTF_8))
                } catch (e: Exception) {
                    emptyList()
                }
                val matches = entries.filter { matches(it, domain, packageName) }
                if (matches.isEmpty()) {
                    Toast.makeText(this, getString(R.string.autofill_no_match), Toast.LENGTH_SHORT).show()
                    finishWith(null)
                } else {
                    val response = FillResponse.Builder()
                    for (entry in matches.take(20)) {
                        val presentation = RemoteViews(this.packageName, android.R.layout.simple_list_item_2).apply {
                            setTextViewText(android.R.id.text1, entry.title)
                            setTextViewText(android.R.id.text2, entry.username)
                        }
                        val dataset = Dataset.Builder()
                        usernameIds.forEach { dataset.setValue(it, AutofillValue.forText(entry.username), presentation) }
                        passwordIds.forEach { dataset.setValue(it, AutofillValue.forText(entry.password), presentation) }
                        response.addDataset(dataset.build())
                    }
                    finishWith(response.build())
                }
            },
            onError = { _, _ -> finishWith(null) }
        )
    }

    private fun finishWith(response: FillResponse?) {
        if (response == null) {
            setResult(Activity.RESULT_CANCELED)
        } else {
            setResult(Activity.RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, response))
        }
        finish()
    }

    private fun parse(json: String): List<Entry> {
        val array = JSONArray(json)
        return (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            fun list(name: String) = item.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.getString(it).lowercase() } } ?: emptyList()
            Entry(item.optString("title"), item.optString("username"), item.optString("password"), list("domains"), list("packages"))
        }
    }

    /** Site : domaine identique ou sous-domaine. Application : nom de paquet identique. */
    private fun matches(entry: Entry, domain: String?, packageName: String): Boolean {
        if (domain != null && entry.domains.any { domain == it || domain.endsWith(".$it") }) return true
        return domain == null && packageName.isNotEmpty() && entry.packages.contains(packageName.lowercase())
    }
}
