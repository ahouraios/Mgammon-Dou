let inMemoryCsrfToken: string | null = null;

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
  return null;
}

export function setStoredToken(_token: string | null): void {
  // توکن نشست صرفاً در کوکی امن HttpOnly نگهداری می‌شود و در localStorage یا sessionStorage ذخیره نمی‌گردد
  try {
    sessionStorage.removeItem('mgammon_session_token');
    localStorage.removeItem('mgammon_session_token');
  } catch {
    // ignore
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const csrfToken = inMemoryCsrfToken || readCookie('mgammon_csrf_token');
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
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

  if (!response.ok || data.ok === false) {
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
  PETTY_CASH: 'هزینه متفرقه / تنخواه (طلب پرسنل)',
  OTHER: 'هزینه متفرقه پرسنل (اسنپ، وسیله و...)',
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
