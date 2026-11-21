const LEGACY_SESSION_TOKEN_STORAGE_KEY = 'mgammon_session_token';
let inMemoryCsrfToken: string | null = null;
let inMemorySessionToken: string | null = null;

// پاکسازی خودکار هرگونه توکن نشست قدیمی باقی‌مانده از نسخه‌های قبلی در localStorage / sessionStorage
if (typeof window !== 'undefined') {
  try {
    window.localStorage?.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
    window.sessionStorage?.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

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
  return inMemorySessionToken;
}

export function setStoredToken(token: string | null): void {
  const normalized = token && token.trim().length >= 32 ? token.trim() : null;
  inMemorySessionToken = normalized;
  if (!normalized) {
    inMemoryCsrfToken = null;
  }
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
      window.localStorage?.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * نشانی امن فایل‌ها و گزارش‌ها:
 * احراز هویت از طریق کوکی HttpOnly نشست انجام می‌شود و توکن هرگز در Query String قرار نمی‌گیرد.
 */
export function withAuthTokenUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url;
}

export const AUTH_EXPIRED_EVENT = 'mgammon:auth-expired';
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'mgammon:password-change-required';
export const CONNECTION_RESTORED_EVENT = 'mgammon:connection-restored';

export function isConnectionErrorMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return (
    msg.includes('عدم برقراری ارتباط با سرور') ||
    msg.includes('ارتباط با سرور برقرار نیست') ||
    msg.includes('پایگاه داده هنوز آماده') ||
    msg.includes('پاسخ نامعتبر از سرور')
  );
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const cookieCsrfToken = readCookie('mgammon_csrf_token');
  const csrfToken = inMemoryCsrfToken || cookieCsrfToken;
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // در محیط عادی مرورگر (Same-Origin)، احراز هویت کاملاً از طریق کوکی HttpOnly + توکن CSRF انجام می‌شود.
  // تنها در صورت مسدود بودن کوکی (مثلاً پیش‌نمایش داخل iframe با دامنه متفاوت)، توکن حافظه موقت (RAM) ارسال می‌شود.
  const sessionToken = getStoredToken();
  if (sessionToken && !cookieCsrfToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const method = (options.method || 'GET').toUpperCase();
  const isSafeGet = method === 'GET';
  const maxAttempts = isSafeGet ? 3 : 1;

  let response: Response | null = null;
  let data: Record<string, unknown> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await fetch(endpoint, {
        cache: 'no-store',
        ...options,
        credentials: 'include',
        headers,
      });
    } catch {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 650));
        continue;
      }
      throw new Error(
        'عدم برقراری ارتباط با سرور. لطفاً اتصال اینترنت یا وضعیت سرور را بررسی کنید.'
      );
    }

    const headerCsrf = response.headers.get('X-CSRF-Token');
    if (headerCsrf) {
      inMemoryCsrfToken = headerCsrf;
    }

    try {
      data = await response.json();
    } catch {
      // در هاست‌های اشتراکی/cPanel هنگام بیدار شدن سرویس Node.js ممکن است برای ۱ ثانیه پاسخ HTML 502/503 برگردد
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        continue;
      }
      throw new Error('پاسخ نامعتبر از سرور دریافت شد.');
    }

    if (
      (response.status === 502 || response.status === 503 || response.status === 504) &&
      attempt < maxAttempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      continue;
    }

    break;
  }

  if (!response || !data) {
    throw new Error(
      'عدم برقراری ارتباط با سرور. لطفاً اتصال اینترنت یا وضعیت سرور را بررسی کنید.'
    );
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
    if (
      response.status === 403 &&
      data.code === 'PASSWORD_CHANGE_REQUIRED' &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT));
    }
    const msg =
      typeof data.message === 'string'
        ? data.message
        : 'خطایی در انجام عملیات رخ داد.';
    throw new Error(msg);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONNECTION_RESTORED_EVENT));
  }

  return data as T;
}

export const TX_TYPE_LABELS: Record<string, string> = {
  ADVANCE: 'مساعده تعهدی',
  ON_ACCOUNT: 'پرداخت علی‌الحساب',
  SALARY: 'تسویه حقوق و مزایا',
  PETTY_CASH: 'خرید کارگاهی / هزینه تنخواه (بستانکاری پرسنل)',
  OTHER: 'واگذاری ملزومات / پرداخت خارج از حکم حقوق (تعهد پرسنلی)',
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
