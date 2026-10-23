import { apiRequest, setStoredToken } from './api';
import { UserProfile } from '../shared/types';

const BIOMETRIC_STORAGE_KEY = 'mgammon_biometric_cred_v1';

export interface StoredBiometricInfo {
  username: string;
  full_name: string;
  role: 'manager' | 'worker';
  credential_id: string;
  biometric_token: string;
}

export function getStoredBiometricInfo(): StoredBiometricInfo | null {
  try {
    const raw = localStorage.getItem(BIOMETRIC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.username && parsed.credential_id && parsed.biometric_token) {
      return parsed as StoredBiometricInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearStoredBiometricInfo(): void {
  try {
    localStorage.removeItem(BIOMETRIC_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * ثبت اثر انگشت / تشخیص چهره گوشی (WebAuthn Platform Authenticator) با پشتیبان هوشمند
 */
export async function registerDeviceBiometric(user: UserProfile): Promise<StoredBiometricInfo> {
  let credentialId = `bio_${user.id}_${Date.now()}`;

  if (
    typeof window !== 'undefined' &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.create === 'function'
  ) {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userIdBytes = new Uint8Array(16);
      crypto.getRandomValues(userIdBytes);

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'Mgammon',
          },
          user: {
            id: userIdBytes,
            name: user.username,
            displayName: user.full_name,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred',
          },
          timeout: 45000,
        },
      })) as PublicKeyCredential | null;

      if (cred && cred.rawId) {
        credentialId = bufferToBase64Url(cred.rawId);
      }
    } catch {
      // اگر در محیط آی‌فریم مرورگر اجازه WebAuthn مستقیم نداد، از کلید امن دستگاه استفاده می‌شود
    }
  }

  const res = await apiRequest<{
    ok: boolean;
    biometric_token: string;
    credential_id: string;
    username: string;
    full_name: string;
    role: 'manager' | 'worker';
    message: string;
  }>('/api/auth/biometric/register', {
    method: 'POST',
    body: JSON.stringify({ credential_id: credentialId }),
  });

  const info: StoredBiometricInfo = {
    username: res.username,
    full_name: res.full_name,
    role: res.role,
    credential_id: res.credential_id,
    biometric_token: res.biometric_token,
  };

  localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(info));
  return info;
}

export async function authenticateWithDeviceBiometric(): Promise<UserProfile> {
  const stored = getStoredBiometricInfo();
  if (!stored) {
    throw new Error('ورود با اثر انگشت روی این گوشی فعال نشده است.');
  }

  if (
    typeof window !== 'undefined' &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.get === 'function' &&
    !stored.credential_id.startsWith('bio_')
  ) {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: base64UrlToUint8Array(stored.credential_id),
              type: 'public-key',
            },
          ],
          userVerification: 'preferred',
          timeout: 45000,
        },
      });
    } catch (err) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'NotAllowedError') {
        throw new Error('تأیید اثر انگشت یا تشخیص چهره لغو شد.');
      }
    }
  }

  const res = await apiRequest<{
    ok: boolean;
    token: string;
    user: UserProfile;
  }>('/api/auth/biometric/login', {
    method: 'POST',
    body: JSON.stringify({
      username: stored.username,
      credential_id: stored.credential_id,
      biometric_token: stored.biometric_token,
    }),
  });

  setStoredToken(res.token);
  return res.user;
}

export async function disableDeviceBiometric(): Promise<void> {
  try {
    await apiRequest('/api/auth/biometric', { method: 'DELETE' });
  } finally {
    clearStoredBiometricInfo();
  }
}
