const TOKEN_STORAGE_KEY = 'mgammon_session_token';

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new Error('پاسخ نامعتبر از سرور دریافت شد.');
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
