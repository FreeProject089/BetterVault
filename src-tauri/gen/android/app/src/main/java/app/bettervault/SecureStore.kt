package app.bettervault

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Secrets protégés par la biométrie.
 *
 * Une paire RSA vit dans l'Android Keystore : la clé publique chiffre sans demander l'empreinte
 * (activation, mise à jour du cache de remplissage), la clé privée ne déchiffre qu'après une
 * authentification biométrique forte. Un nouvel enrôlement d'empreinte rend la clé inutilisable.
 */
object SecureStore {
    private const val ALIAS = "bettervault-biometric"
    private val OAEP = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun biometricAvailable(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    private fun ensureKeyPair() {
        if (keyStore().containsAlias(ALIAS)) return
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setUserAuthenticationRequired(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    setInvalidatedByBiometricEnrollment(true)
                }
            }
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
            initialize(spec)
            generateKeyPair()
        }
    }

    private fun file(context: Context, name: String) = File(context.noBackupFilesDir, "$name.sealed")

    fun exists(context: Context, name: String) = file(context, name).exists()

    fun delete(context: Context, name: String) {
        file(context, name).delete()
    }

    /** Chiffre avec la clé publique : aucune invite n'est nécessaire */
    fun write(context: Context, name: String, data: ByteArray) {
        ensureKeyPair()
        val keystorePublic = keyStore().getCertificate(ALIAS).publicKey
        // Copie logicielle de la clé publique : le Keystore n'autorise pas MGF1-SHA256, d'où ce paramétrage OAEP
        val publicKey = KeyFactory.getInstance(keystorePublic.algorithm).generatePublic(X509EncodedKeySpec(keystorePublic.encoded))

        val aesKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val aes = Cipher.getInstance("AES/GCM/NoPadding")
        aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, iv))
        val ciphertext = aes.doFinal(data)

        val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEP)
        val wrapped = rsa.doFinal(aesKey)
        aesKey.fill(0)

        val buffer = ByteBuffer.allocate(2 + wrapped.size + iv.size + ciphertext.size)
        buffer.putShort(wrapped.size.toShort()).put(wrapped).put(iv).put(ciphertext)
        file(context, name).writeBytes(buffer.array())
    }

    private fun decryptCipher(): Cipher {
        val privateKey = keyStore().getKey(ALIAS, null) as PrivateKey
        return Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").apply { init(Cipher.DECRYPT_MODE, privateKey, OAEP) }
    }

    /** Déchiffre avec le Cipher débloqué par l'authentification biométrique */
    fun open(context: Context, name: String, cipher: Cipher): ByteArray {
        val buffer = ByteBuffer.wrap(file(context, name).readBytes())
        val wrapped = ByteArray(buffer.short.toInt()).also { buffer.get(it) }
        val iv = ByteArray(12).also { buffer.get(it) }
        val ciphertext = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val aesKey = cipher.doFinal(wrapped)
        try {
            val aes = Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, iv))
            return aes.doFinal(ciphertext)
        } finally {
            aesKey.fill(0)
        }
    }

    /** Affiche l'invite biométrique puis rend le Cipher de déchiffrement */
    fun authenticate(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        onSuccess: (Cipher) -> Unit,
        onError: (code: String, message: String) -> Unit
    ) {
        val cipher = try {
            decryptCipher()
        } catch (e: KeyPermanentlyInvalidatedException) {
            // Empreinte ajoutée ou supprimée : les secrets doivent être recréés depuis l'application
            keyStore().deleteEntry(ALIAS)
            onError("invalidated", "La biométrie de l'appareil a changé. Réactivez le déverrouillage biométrique.")
            return
        } catch (e: Exception) {
            onError("unavailable", e.message ?: "Clé biométrique indisponible")
            return
        }

        activity.runOnUiThread {
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val unlocked = result.cryptoObject?.cipher
                    if (unlocked == null) onError("unavailable", "Authentification sans clé") else onSuccess(unlocked)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val code = if (errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) "cancelled" else "failed"
                    onError(code, errString.toString())
                }
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(activity.getString(android.R.string.cancel))
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
        }
    }
}
