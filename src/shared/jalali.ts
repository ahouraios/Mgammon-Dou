import * as jalaali from 'jalaali-js';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export const PERSIAN_MONTHS = [
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
 * محاسبه تعداد روزهای یک ماه شمسی و جایگاه روز اول ماه در هفته (۰=شنبه تا ۶=جمعه)
 */
export function getShamsiMonthCalendar(jy: number, jm: number): {
  monthLength: number;
  startDayOffset: number; // 0 = شنبه, 1 = یکشنبه, ..., 6 = جمعه
} {
  const monthLength = jalaali.jalaaliMonthLength(jy, jm);
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, 1);
  const dt = new Date(Date.UTC(gy, gm - 1, gd, 12, 0, 0));
  const jsDay = dt.getUTCDay(); // 0=Sun..6=Sat
  const startDayOffset = (jsDay + 1) % 7; // 0=Sat, 1=Sun, ..., 6=Fri
  return { monthLength, startDayOffset };
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

export function getShamsiDayOfWeekName(shamsiDate: string): string {
  try {
    const greg = shamsiToGregorian(shamsiDate);
    return getPersianDayName(greg);
  } catch {
    return '';
  }
}

export function formatShamsiVerbose(shamsiDate: string | null | undefined): string {
  if (!shamsiDate) return '';
  const clean = toEnglishDigits(String(shamsiDate)).replace(/-/g, '/');
  const [jy, jm, jd] = clean.split('/').map(Number);
  if (!jy || !jm || !jd) return toPersianDigits(shamsiDate);
  const monthName = PERSIAN_MONTHS[jm - 1] || '';
  return `${toPersianDigits(jd)} ${monthName} ${toPersianDigits(jy)}`;
}

export function isValidTimeHHMMOrHHMMSS(timeStr: string | null | undefined, allowSeconds = true): boolean {
  if (!timeStr) return false;
  const clean = toEnglishDigits(String(timeStr)).trim();
  const regex = allowSeconds
    ? /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
    : /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return regex.test(clean);
}

export function parseTimeToMinutes(timeStr: string | null | undefined): number {
  const clean = toEnglishDigits(String(timeStr || '08:00')).trim();
  const parts = clean.split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return 8 * 60;
  }
  return parts[0] * 60 + parts[1];
}

export function formatMinutesToDurationPersian(totalMinutes: number | null | undefined): string {
  const safe = Math.max(0, Math.round(Number(totalMinutes) || 0));
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

export const formatDurationPersian = formatMinutesToDurationPersian;

export const SHAMSI_MONTH_NAMES = PERSIAN_MONTHS;

export function getShamsiMonthDays(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm);
}

export const getShamsiMonthLength = getShamsiMonthDays;

export function isShamsiLeapYear(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

export function getShamsiMonthRange(jy: number, jm: number): {
  startShamsi: string;
  endShamsi: string;
  fromShamsi: string;
  toShamsi: string;
  monthLength: number;
  isLeapYear: boolean;
} {
  if (jm < 1 || jm > 12) {
    throw new Error(`ماه شمسی نامعتبر است: ${jm}`);
  }
  const monthLength = jalaali.jalaaliMonthLength(jy, jm);
  const isLeapYear = jalaali.isLeapJalaaliYear(jy);
  const startShamsi = `${jy}/${pad2(jm)}/01`;
  const endShamsi = `${jy}/${pad2(jm)}/${pad2(monthLength)}`;
  return {
    startShamsi,
    endShamsi,
    fromShamsi: startShamsi,
    toShamsi: endShamsi,
    monthLength,
    isLeapYear,
  };
}

export function formatMinutesToHHMM(totalMinutes: number | null | undefined): string {
  const safe = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return toPersianDigits(`${pad2(hours)}:${pad2(mins)}`);
}

export function formatToman(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '۰ تومان';
  const num = typeof amount === 'number' ? amount : Number(toEnglishDigits(String(amount)).replace(/,/g, ''));
  if (!Number.isFinite(num)) return '۰ تومان';
  return `${toPersianDigits(Math.round(num).toLocaleString('en-US'))} تومان`;
}

/**
 * فرمت کردن رشته عددی با جداکننده سه‌رقمی (مثلاً ۱۲,۵۰۰,۰۰۰)
 */
export function formatNumericInputWithCommas(raw: string | number): string {
  const digitsOnly = toEnglishDigits(String(raw ?? '')).replace(/\D/g, '');
  if (!digitsOnly) return '';
  const clean = digitsOnly.replace(/^0+/, '') || '0';
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseFormattedAmount(raw: string | number): number {
  const digitsOnly = toEnglishDigits(String(raw ?? '')).replace(/\D/g, '');
  if (!digitsOnly) return 0;
  return Number(digitsOnly);
}

/**
 * تبدیل عدد مبلغ به حروف فارسی دقیق (تومان) برای جلوگیری از اشتباه در ورود ارقام مالی
 */
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد'];

function threeDigitToWords(num: number): string {
  if (num === 0) return '';
  const h = Math.floor(num / 100);
  const rem = num % 100;
  const parts: string[] = [];

  if (h > 0) parts.push(HUNDREDS[h]);

  if (rem >= 10 && rem <= 19) {
    parts.push(TEENS[rem - 10]);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (t > 0) parts.push(TENS[t]);
    if (o > 0) parts.push(ONES[o]);
  }

  return parts.join(' و ');
}

export function numberToPersianTomanWords(input: string | number): string {
  const num = typeof input === 'number' ? Math.floor(input) : parseFormattedAmount(input);
  if (!num || Number.isNaN(num) || num <= 0) return '';
  if (num >= 1_000_000_000_000_000) return 'مبلغ خارج از محدوده مجاز';

  let remaining = num;
  let scaleIdx = 0;
  const groups: string[] = [];

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkWords = threeDigitToWords(chunk);
      const scaleLabel = SCALES[scaleIdx] || '';
      groups.unshift(scaleLabel ? `${chunkWords} ${scaleLabel}` : chunkWords);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIdx += 1;
  }

  return `${groups.join(' و ')} تومان`;
}
