package app.bettervault

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StoreArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class ReadArgs {
    lateinit var key: String
    var title: String = "BetterVault"
    var subtitle: String = ""
}

@InvokeArg
class KeyArgs {
    lateinit var key: String
}

@InvokeArg
class AutofillArgs {
    /** JSON : [{ title, username, password, domains: [], packages: [] }] */
    lateinit var entries: String
}

/** Fonctions natives appelées depuis l'application (commande Rust native_call) */
@TauriPlugin
class BetterVaultPlugin(private val activity: Activity) : Plugin(activity) {

    private fun secretName(key: String) = "secret_" + key.replace(Regex("[^A-Za-z0-9_-]"), "_")

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("biometricAvailable", SecureStore.biometricAvailable(activity))
        val autofillSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        result.put("autofillSupported", autofillSupported)
        result.put(
            "autofillEnabled",
            autofillSupported && activity.getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true
        )
        result.put("autofillReady", SecureStore.exists(activity, "autofill"))
        invoke.resolve(result)
    }

    @Command
    fun secureStore(invoke: Invoke) {
        val args = invoke.parseArgs(StoreArgs::class.java)
        try {
            SecureStore.write(activity, secretName(args.key), args.value.toByteArray(Charsets.UTF_8))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Enregistrement impossible")
        }
    }

    @Command
    fun secureRead(invoke: Invoke) {
        val args = invoke.parseArgs(ReadArgs::class.java)
        val name = secretName(args.key)
        if (!SecureStore.exists(activity, name)) {
            invoke.reject("Aucun secret enregistré", "not_found")
            return
        }
        val host = activity as? FragmentActivity
        if (host == null) {
            invoke.reject("Invite biométrique indisponible", "unavailable")
            return
        }
        SecureStore.authenticate(host, args.title, args.subtitle,
            onSuccess = { cipher ->
                try {
                    val result = JSObject()
                    result.put("value", String(SecureStore.open(activity, name, cipher), Charsets.UTF_8))
                    invoke.resolve(result)
                } catch (e: Exception) {
                    invoke.reject(e.message ?: "Secret illisible", "failed")
                }
            },
            onError = { code, message -> invoke.reject(message, code) }
        )
    }

    @Command
    fun secureDelete(invoke: Invoke) {
        SecureStore.delete(activity, secretName(invoke.parseArgs(KeyArgs::class.java).key))
        invoke.resolve()
    }

    /** Cache chiffré lu par le service de remplissage automatique, après authentification */
    @Command
    fun autofillUpdate(invoke: Invoke) {
        val args = invoke.parseArgs(AutofillArgs::class.java)
        try {
            SecureStore.write(activity, "autofill", args.entries.toByteArray(Charsets.UTF_8))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Mise à jour impossible")
        }
    }

    @Command
    fun autofillClear(invoke: Invoke) {
        SecureStore.delete(activity, "autofill")
        invoke.resolve()
    }

    @Command
    fun openAutofillSettings(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            invoke.reject("Remplissage automatique disponible à partir d'Android 8")
            return
        }
        try {
            val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).setData(Uri.parse("package:" + activity.packageName))
            activity.startActivity(intent)
        } catch (e: Exception) {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS))
        }
        invoke.resolve()
    }
}
