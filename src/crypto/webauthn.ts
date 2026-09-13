/**
 * BUM WebAuthn / Passkey Biometric Vault Unlock
 * Enables biometric authenticator (Windows Hello, TouchID, FaceID, Android Biometrics)
 * to unlock or protect vault sessions without retyping long master passphrases.
 */

export async function isBiometricsAvailable(): Promise<boolean> {
  if (window.PublicKeyCredential && 
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }
  return false;
}

export async function registerBiometrics(userId: string, username: string): Promise<string | null> {
  if (!window.PublicKeyCredential) return null;

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const userIdBytes = new TextEncoder().encode(userId);

  const createOptions: CredentialCreationOptions = {
    publicKey: {
      challenge,
      rp: {
        name: 'BUM Vault Studio Pro',
        id: window.location.hostname || 'localhost'
      },
      user: {
        id: userIdBytes,
        name: username,
        displayName: username
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    }
  };

  try {
    const cred = await navigator.credentials.create(createOptions) as PublicKeyCredential | null;
    if (cred) {
      return cred.id;
    }
  } catch (err) {
    console.warn('Biometric registration canceled or unsupported:', err);
  }
  return null;
}

export async function verifyBiometrics(credentialId?: string): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const getOptions: CredentialRequestOptions = {
    publicKey: {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: credentialId ? [{
        id: Uint8Array.from(atob(credentialId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
        type: 'public-key'
      }] : []
    }
  };

  try {
    const assertion = await navigator.credentials.get(getOptions);
    return assertion !== null;
  } catch (err) {
    console.warn('Biometric verification failed or canceled:', err);
    return false;
  }
}
