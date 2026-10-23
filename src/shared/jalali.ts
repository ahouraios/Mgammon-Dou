import * as jalaali from 'jalaali-js';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const PERSIAN_WEEKDAYS: Record<number, string> = {
  6: 'شنبه',
  0: 'یکشنبه',
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنجشنبه',
  5: 'جمعه',
};

export function toPersianDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toEnglishDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

/**
 * تبدیل تاریخ میلادی YYYY-MM-DD به تاریخ شمسی YYYY/MM/DD
 */
export function gregorianToShamsi(gregorianDateStr: string): string {
  const clean = toEnglishDigits(gregorianDateStr).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (!match) {
    throw new Error(`فرمت تاریخ میلادی نامعتبر است: ${gregorianDateStr}`);
  }
  const gy = Number(match[1]);
  const gm = Number(match[2]);
  const gd = Number(match[3]);
  const { jy, jm, jd } = jalaali.toJalaali(gy, gm, gd);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

/**
 * تبدیل تاریخ شمسی YYYY/MM/DD به تاریخ میلادی YYYY-MM-DD
 */
export function shamsiToGregorian(shamsiDateStr: string): string {
  const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, '/');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
  if (!match) {
    throw new Error(`فرمت تاریخ شمسی نامعتبر است: ${shamsiDateStr}`);
  }
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) {
    throw new Error(`تاریخ شمسی نامعتبر است: ${shamsiDateStr}`);
  }
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

export function isValidShamsiDate(shamsiDateStr: string): boolean {
  try {
    const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, '/');
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
    if (!match) return false;
    return jalaali.isValidJalaaliDate(Number(match[1]), Number(match[2]), Number(match[3]));
  } catch {
    return false;
  }
}

export function normalizeShamsiDate(shamsiDateStr: string): string {
  const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, '/');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
  if (!match) throw new Error('تاریخ شمسی نامعتبر است');
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) {
    throw new Error('تاریخ شمسی نامعتبر است');
  }
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

/**
 * دریافت تاریخ و ساعت جاری در منطقه زمانی مشخص‌شده (پیش‌فرض Asia/Tehran)
 */
export function getNowInTimezone(timezone = 'Asia/Tehran', referenceDate: Date = new Date()): {
  workDate: string;      // YYYY-MM-DD
  shamsiDate: string;    // YYYY/MM/DD
  timeHHMMSS: string;    // HH:MM:SS
  timeHHMM: string;      // HH:MM
  dayOfWeek: number;     // 0=Sun .. 6=Sat
  dayNamePersian: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(referenceDate);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  const workDate = `${map.year}-${map.month}-${map.day}`;
  const shamsiDate = gregorianToShamsi(workDate);
  const timeHHMMSS = `${hour}:${map.minute}:${map.second}`;
  const timeHHMM = `${hour}:${map.minute}`;

  const [y, m, d] = workDate.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = utcDate.getUTCDay();

  return {
    workDate,
    shamsiDate,
    timeHHMMSS,
    timeHHMM,
    dayOfWeek,
    dayNamePersian: PERSIAN_WEEKDAYS[dayOfWeek] || '',
  };
}

export function getDayOfWeekFromGregorian(workDate: string): number {
  const [y, m, d] = workDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.getUTCDay();
}

export function getPersianDayName(workDate: string): string {
  const dow = getDayOfWeekFromGregorian(workDate);
  return PERSIAN_WEEKDAYS[dow] || '';
}

export function formatShamsiVerbose(shamsiDate: string): string {
  const clean = toEnglishDigits(shamsiDate).replace(/-/g, '/');
  const [jy, jm, jd] = clean.split('/').map(Number);
  const monthName = PERSIAN_MONTHS[jm - 1] || '';
  return `${toPersianDigits(jd)} ${monthName} ${toPersianDigits(jy)}`;
}

export function parseTimeToMinutes(timeStr: string): number {
  const clean = toEnglishDigits(timeStr).trim();
  const parts = clean.split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    throw new Error(`فرمت ساعت نامعتبر است: ${timeStr}`);
  }
  return parts[0] * 60 + parts[1];
}

export function formatMinutesToDurationPersian(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `${toPersianDigits(mins)} دقیقه`;
  }
  if (mins === 0) {
    return `${toPersianDigits(hours)} ساعت`;
  }
  return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(mins)} دقیقه`;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return toPersianDigits(`${pad2(hours)}:${pad2(mins)}`);
}

export function formatToman(amount: number | string): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return '۰ تومان';
  return `${toPersianDigits(num.toLocaleString('en-US'))} تومان`;
}
