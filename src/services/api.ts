const SESSION_TOKEN_STORAGE_KEY = 'mgammon_session_token';
let inMemoryCsrfToken: string | null = null;
let inMemorySessionToken: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      return decodeURIComponent(v.join('='));
    }
  }
  return null;
}

export function getStoredToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  try {
    const stored =
      sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ||
      localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored && stored.trim().length >= 32) {
      inMemorySessionToken = stored.trim();
      return inMemorySessionToken;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  const normalized = token && token.trim().length >= 32 ? token.trim() : null;
  inMemorySessionToken = normalized;
  try {
    if (normalized) {
      sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, normalized);
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, normalized);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function withAuthTokenUrl(url: string | null | undefined): string {
  if (!url) return '';
  const token = getStoredToken();
  if (!token) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export const AUTH_EXPIRED_EVENT = 'mgammon:auth-expired';

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const sessionToken = getStoredToken();
  if (sessionToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const csrfToken = inMemoryCsrfToken || readCookie('mgammon_csrf_token');
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: 'no-store',
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('عدم برقراری ارتباط با سرور. لطفاً اتصال اینترنت یا وضعیت سرور را بررسی کنید.');
  }

  const headerCsrf = response.headers.get('X-CSRF-Token');
  if (headerCsrf) {
    inMemoryCsrfToken = headerCsrf;
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new Error('پاسخ نامعتبر از سرور دریافت شد.');
  }

  if (typeof data.csrfToken === 'string' && data.csrfToken) {
    inMemoryCsrfToken = data.csrfToken;
  }

  if (typeof data.token === 'string' && data.token.length >= 32) {
    setStoredToken(data.token);
  }

  if (!response.ok || data.ok === false) {
    const isLoginEndpoint =
      endpoint.includes('/api/auth/login') || endpoint.includes('/api/auth/biometric/login');
    if ((response.status === 401 || data.code === 'UNAUTHORIZED') && !isLoginEndpoint) {
      setStoredToken(null);
      if (typeof window !== 'undefined' && !endpoint.includes('/api/auth/me')) {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
      }
    }
    const msg =
      typeof data.message === 'string'
        ? data.message
        : 'خطایی در انجام عملیات رخ داد.';
    throw new Error(msg);
  }

  return data as T;
}

export const TX_TYPE_LABELS: Record<string, string> = {
  ADVANCE: 'مساعده',
  ON_ACCOUNT: 'علی‌الحساب',
  SALARY: 'حقوق',
  PETTY_CASH: 'خرید کارگاهی / هزینه تنخواه (طلب پرسنل)',
  OTHER: 'خرید وسیله / اسنپ / هزینه متفرقه (طلب پرسنل)',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  WORK_START: 'شروع کار',
  MISSION_START: 'شروع مأموریت',
  MISSION_END: 'پایان مأموریت و بازگشت',
  WORK_END: 'پایان کار',
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار تأیید',
  APPROVED: 'تأییدشده (قطعی)',
  REJECTED: 'ردشده',
};
