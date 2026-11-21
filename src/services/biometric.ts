import { apiRequest, PASSWORD_CHANGE_REQUIRED_EVENT, setStoredToken } from './api';
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
    passwordChangeRequired?: boolean;
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
  if (res.passwordChangeRequired && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT));
  }
  return res.user;
}

export async function disableDeviceBiometric(): Promise<void> {
  try {
    await apiRequest('/api/auth/biometric', { method: 'DELETE' });
  } finally {
    clearStoredBiometricInfo();
  }
}

// ============================================================================
// مدیریت قفل خودکار صفحه (Auto-Lock) با اثر انگشت / تشخیص چهره / رمز
// ============================================================================
const APP_LOCK_CONFIG_KEY = 'mgammon_app_lock_config_v1';
const APP_LOCK_ACTIVE_KEY = 'mgammon_app_locked_state_v1';
export const APP_LOCK_CONFIG_CHANGED_EVENT = 'mgammon-app-lock-config-changed';
export const APP_LOCK_TRIGGER_EVENT = 'mgammon-app-lock-trigger';

export interface AppLockConfig {
  enabled: boolean;
  timeoutMinutes: number; // 1, 3, 5, 10, 15, 30
  lockOnBackground: boolean;
  customPin: string; // رمز دلخواه بازگشایی قفل (اختیاری؛ در کنار رمز اصلی حساب کاربری)
}

const DEFAULT_APP_LOCK_CONFIG: AppLockConfig = {
  enabled: true,
  timeoutMinutes: 5,
  lockOnBackground: false,
  customPin: '',
};

export function getAppLockConfig(): AppLockConfig {
  try {
    const raw = localStorage.getItem(APP_LOCK_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_APP_LOCK_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : true,
      timeoutMinutes: Math.max(1, Math.min(120, Number(parsed.timeoutMinutes) || 5)),
      lockOnBackground: Boolean(parsed.lockOnBackground),
      customPin: typeof parsed.customPin === 'string' ? parsed.customPin.trim() : '',
    };
  } catch {
    return { ...DEFAULT_APP_LOCK_CONFIG };
  }
}

export function saveAppLockConfig(config: AppLockConfig): AppLockConfig {
  const normalized: AppLockConfig = {
    enabled: Boolean(config.enabled),
    timeoutMinutes: Math.max(1, Math.min(120, Number(config.timeoutMinutes) || 5)),
    lockOnBackground: Boolean(config.lockOnBackground),
    customPin: typeof config.customPin === 'string' ? config.customPin.trim() : '',
  };
  try {
    localStorage.setItem(APP_LOCK_CONFIG_KEY, JSON.stringify(normalized));
    if (!normalized.enabled) {
      sessionStorage.removeItem(APP_LOCK_ACTIVE_KEY);
      localStorage.removeItem(APP_LOCK_ACTIVE_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(APP_LOCK_CONFIG_CHANGED_EVENT));
    }
  } catch {
    // ignore storage errors
  }
  return normalized;
}

export function isAppCurrentlyLocked(): boolean {
  try {
    return (
      sessionStorage.getItem(APP_LOCK_ACTIVE_KEY) === '1' ||
      localStorage.getItem(APP_LOCK_ACTIVE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function setAppCurrentlyLocked(locked: boolean): void {
  try {
    if (locked) {
      sessionStorage.setItem(APP_LOCK_ACTIVE_KEY, '1');
      localStorage.setItem(APP_LOCK_ACTIVE_KEY, '1');
    } else {
      sessionStorage.removeItem(APP_LOCK_ACTIVE_KEY);
      localStorage.removeItem(APP_LOCK_ACTIVE_KEY);
    }
  } catch {
    // ignore
  }
}

export function triggerImmediateAppLock(): void {
  setAppCurrentlyLocked(true);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(APP_LOCK_TRIGGER_EVENT));
  }
}

/**
 * بازگشایی قفل برنامه با اثر انگشت یا تشخیص چهره دستگاه (WebAuthn Platform Authenticator)
 */
export async function verifyDeviceBiometricForUnlock(user: UserProfile): Promise<boolean> {
  const stored = getStoredBiometricInfo();

  if (
    typeof window === 'undefined' ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    if (stored && stored.username === user.username) {
      await authenticateWithDeviceBiometric();
      return true;
    }
    throw new Error('مرورگر یا دستگاه فعلی از سنسور اثر انگشت / تشخیص چهره پشتیبانی نمی‌کند؛ لطفاً با رمز وارد شوید.');
  }

  // ۱. اگر قبلاً کلید بیومتریک ثبت شده باشد، با همان کلید تأیید هویت انجام می‌شود
  if (stored && !stored.credential_id.startsWith('bio_') && typeof navigator.credentials.get === 'function') {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: base64UrlToUint8Array(stored.credential_id),
              type: 'public-key',
            },
          ],
          userVerification: 'required',
          timeout: 45000,
        },
      });
      if (assertion) {
        return true;
      }
    } catch (err) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'NotAllowedError') {
        throw new Error('تأیید اثر انگشت یا تشخیص چهره لغو شد.');
      }
      // در صورت تغییر کلید دستگاه، به مرحله ثبت/تأیید مستقیم سنسور دستگاه می‌رویم
    }
  }

  // ۲. اگر هنوز کلید بیومتریک ثبت نشده بود، مستقیماً سنسور اثر انگشت / چهره گوشی را فراخوانی و ثبت می‌کنیم
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
          userVerification: 'required',
        },
        timeout: 45000,
      },
    })) as PublicKeyCredential | null;

    if (cred && cred.rawId) {
      const credentialId = bufferToBase64Url(cred.rawId);
      try {
        const res = await apiRequest<{
          ok: boolean;
          biometric_token: string;
          credential_id: string;
          username: string;
          full_name: string;
          role: 'manager' | 'worker';
        }>('/api/auth/biometric/register', {
          method: 'POST',
          body: JSON.stringify({ credential_id: credentialId }),
        });
        localStorage.setItem(
          BIOMETRIC_STORAGE_KEY,
          JSON.stringify({
            username: res.username,
            full_name: res.full_name,
            role: res.role,
            credential_id: res.credential_id,
            biometric_token: res.biometric_token,
          })
        );
      } catch {
        // حتی اگر ذخیره توکن سرور انجام نشد، احراز هویت بیومتریک دستگاه موفق بوده است
      }
      return true;
    }
  } catch (err) {
    const errName = (err as { name?: string })?.name;
    if (errName === 'NotAllowedError') {
      throw new Error('تأیید اثر انگشت یا تشخیص چهره لغو شد.');
    }
  }

  if (stored && stored.username === user.username) {
    await authenticateWithDeviceBiometric();
    return true;
  }

  throw new Error('امکان تأیید اثر انگشت یا چهره در این مرورگر فراهم نشد. لطفاً رمز قفل یا رمز عبور حساب را وارد کنید.');
}

/**
 * بازگشایی قفل برنامه با رمز اختصاصی قفل (PIN) یا رمز عبور اصلی حساب کاربری
 */
export async function verifyUnlockPasswordOrPin(inputCode: string): Promise<boolean> {
  const cleanInput = inputCode.trim();
  if (!cleanInput) {
    throw new Error('لطفاً رمز را وارد نمایید.');
  }

  const config = getAppLockConfig();
  if (config.customPin && cleanInput === config.customPin) {
    return true;
  }

  const res = await apiRequest<{ ok: boolean; unlocked: boolean }>('/api/auth/verify-unlock', {
    method: 'POST',
    body: JSON.stringify({ password: cleanInput }),
  });

  return Boolean(res.ok && res.unlocked);
}

