import { SystemSettings } from '../shared/types';
import { toEnglishDigits, toPersianDigits } from '../shared/jalali';

export interface SmsSendResult {
  sent: boolean;
  statusMessage: string;
  rawCode?: string;
}

const MELIPAYAMAK_ERROR_CODES: Record<string, string> = {
  '0': 'نام کاربری یا رمز عبور (کلید وب‌سرویس) ملی‌پیامک صحیح نیست.',
  '2': 'اعتبار پنل پیامک کافی نیست.',
  '3': 'محدودیت در ارسال روزانه پنل پیامک.',
  '4': 'محدودیت در حجم ارسال پیامک.',
  '5': 'شماره خط فرستنده معتبر نیست یا متعلق به این پنل نمی‌باشد.',
  '6': 'سامانه پیامکی در حال بروزرسانی است.',
  '7': 'متن پیامک حاوی کلمه فیلترشده است.',
  '9': 'ارسال از خطوط عمومی از طریق وب‌سرویس امکان‌پذیر نیست.',
  '10': 'کاربر پنل پیامکی فعال نیست.',
  '11': 'کد ۱۱ ملی‌پیامک (بلک‌لیست مخابرات): شماره گیرنده دریافت پیامک‌های تبلیغاتی را مسدود کرده است. برای دریافت پیامک از خط ۵۰۰۰، گیرنده باید کد *8999# را شماره‌گیری کند (یا در پنل ملی‌پیامک از خط خدماتی / کد پترن استفاده شود).',
  '12': 'مدارک کاربری در پنل ملی‌پیامک تکمیل یا تأیید نشده است.',
  '14': 'متن پیامک حاوی لینک است و سرشماره مجوز ارسال لینک ندارد.',
  '15': 'در متن پیامک عبارت «لغو11» درج نشده است.',
  '16': 'شماره گیرنده یافت نشد.',
  '17': 'متن پیامک خالی است.',
  '35': 'اطلاعات ارسالی به وب‌سرویس نامعتبر است.',
  '-108': 'آی‌پی سرور به دلیل تلاش ناموفق مسدود شده است.',
  '-109': 'محدودیت آی‌پی (IP) در تنظیمات وب‌سرویس پنل ملی‌پیامک فعال است؛ لطفاً در پنل ملی‌پیامک محدودیت IP وب‌سرویس را غیرفعال کنید.',
  '-110': 'در تنظیمات امنیتی پنل ملی‌پیامک، استفاده از کلید وب‌سرویس (API Key) الزامی شده است.',
};

function buildUsernameCandidates(rawUsername: string): string[] {
  const clean = toEnglishDigits(rawUsername).trim();
  const set = new Set<string>();
  if (clean) set.add(clean);

  if (/^09\d{9}$/.test(clean)) {
    set.add(`98${clean.slice(1)}`);
    set.add(clean.slice(1));
  } else if (/^989\d{9}$/.test(clean)) {
    set.add(`0${clean.slice(2)}`);
    set.add(clean.slice(2));
  } else if (/^9\d{9}$/.test(clean)) {
    set.add(`98${clean}`);
    set.add(`0${clean}`);
  }

  return Array.from(set);
}

function normalizeRecipientPhone(rawPhone: string): string {
  const clean = toEnglishDigits(rawPhone).replace(/\s+/g, '').trim();
  if (/^\+989\d{9}$/.test(clean)) {
    return `0${clean.slice(3)}`;
  }
  if (/^989\d{9}$/.test(clean)) {
    return `0${clean.slice(2)}`;
  }
  if (/^9\d{9}$/.test(clean)) {
    return `0${clean}`;
  }
  return clean;
}

export async function checkMelipayamakCredit(
  usernameRaw: string,
  passwordRaw: string
): Promise<{ ok: boolean; credit?: number; matchedUsername?: string; message: string }> {
  const candidates = buildUsernameCandidates(usernameRaw);
  const password = passwordRaw.trim();

  if (candidates.length === 0 || !password) {
    return { ok: false, message: 'نام کاربری و رمز وب‌سرویس وارد نشده است.' };
  }

  for (const username of candidates) {
    try {
      const resp = await fetch('https://rest.payamak-panel.com/api/SendSMS/GetCredit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as {
        Value?: string;
        RetStatus?: number;
        StrRetStatus?: string;
      };
      if (data.RetStatus === 1 && data.Value) {
        const creditNum = Math.floor(Number(data.Value) || 0);
        return {
          ok: true,
          credit: creditNum,
          matchedUsername: username,
          message: `اتصال به پنل ملی‌پیامک برقرار است (اعتبار فعلی: ${toPersianDigits(creditNum)} پیامک).`,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    message: 'نام کاربری یا رمز عبور (کلید وب‌سرویس) در ملی‌پیامک تأیید نشد.',
  };
}

/**
 * ارسال پیامک از طریق وب‌سرویس رسمی ملی‌پیامک (REST JSON + Fallback به SOAP)
 */
export async function sendMelipayamakSms(
  settings: SystemSettings,
  recipientPhone: string,
  text: string
): Promise<SmsSendResult> {
  const cleanPhone = normalizeRecipientPhone(recipientPhone || '');
  const cleanFrom = toEnglishDigits(settings.melipayamak_from_number || '').trim();
  const rawUsername = (settings.melipayamak_username || '').trim();
  const password = (settings.melipayamak_password || '').trim();

  if (!cleanPhone || cleanPhone.length < 10) {
    return {
      sent: false,
      statusMessage: 'شماره تلفن همراه گیرنده در تنظیمات ثبت نشده یا معتبر نیست.',
    };
  }

  if (!rawUsername || !password) {
    return {
      sent: false,
      statusMessage: 'اطلاعات حساب کاربری پنل ملی‌پیامک در بخش تنظیمات تکمیل نشده است.',
    };
  }

  const usernameCandidates = buildUsernameCandidates(rawUsername);

  // در صورتی که مدیر در فیلد «شماره خط ارسال‌کننده» کد پترن خدماتی (مثلاً پترن ۵ یا ۶ رقمی) وارد کرده باشد:
  const isPatternBodyId = /^\d{4,7}$/.test(cleanFrom) && !cleanFrom.startsWith('5000') && !cleanFrom.startsWith('3000') && !cleanFrom.startsWith('2000') && !cleanFrom.startsWith('1000') && !cleanFrom.startsWith('9000');

  // برای خطوط تبلیغاتی ۵۰۰۰ در صورت نبودن عبارت لغو11، آن را به انتهای پیامک اضافه می‌کنیم تا خطای کد ۱۵ یا ۱۱ رخ ندهد
  let finalSmsText = text.trim();
  if (cleanFrom.startsWith('5000') && !finalSmsText.includes('لغو')) {
    finalSmsText = `${finalSmsText}\nلغو11`;
  }

  let lastCode = '';

  for (const username of usernameCandidates) {
    try {
      if (isPatternBodyId) {
        const patternRes = await fetch(
          'https://rest.payamak-panel.com/api/SendSMS/SendByBaseNumber',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username,
              password,
              text: [text.trim()],
              to: cleanPhone,
              bodyId: Number(cleanFrom),
            }),
          }
        );
        if (patternRes.ok) {
          const pData = (await patternRes.json()) as { Value?: string; RetStatus?: number };
          const val = String(pData.Value || '').trim();
          if (val && /^\d+$/.test(val) && val.length > 12) {
            return {
              sent: true,
              rawCode: val,
              statusMessage: `پیامک خدماتی با موفقیت ارسال شد (کد رهگیری: ${toPersianDigits(val)}).`,
            };
          }
          if (val) lastCode = val;
        }
      }

      if (!cleanFrom) {
        return {
          sent: false,
          statusMessage: 'شماره خط ارسال‌کننده در تنظیمات پیامک وارد نشده است.',
        };
      }

      // ۱. ارسال از طریق وب‌سرویس رسمی REST JSON ملی‌پیامک
      const restResp = await fetch('https://rest.payamak-panel.com/api/SendSMS/SendSMS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          to: cleanPhone,
          from: cleanFrom,
          text: finalSmsText,
          isFlash: Boolean(settings.melipayamak_is_flash),
        }),
      });

      if (restResp.ok) {
        const data = (await restResp.json()) as {
          Value?: string;
          RetStatus?: number;
          StrRetStatus?: string;
        };
        const code = String(data.Value ?? '').trim();

        // اگر کد رهگیری بیش از ۴ رقم باشد یعنی ارسال با موفقیت انجام شده است
        if (/^\d+$/.test(code) && code.length > 4) {
          return {
            sent: true,
            rawCode: code,
            statusMessage: `پیامک با موفقیت ارسال شد (کد رهگیری: ${toPersianDigits(code)}).`,
          };
        }

        // اگر نام کاربری با این فرمت اشتباه بود (کد 0)، فرمت بعدی نام کاربری (مثلاً 989... یا 09...) را امتحان کن
        if (code === '0' || data.RetStatus === 0) {
          lastCode = '0';
          continue;
        }

        if (code) {
          lastCode = code;
          break;
        }
      }

      // ۲. مسیر جایگزین (Fallback): وب‌سرویس SendSimpleSMS2
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      formData.append('to', cleanPhone);
      formData.append('from', cleanFrom);
      formData.append('text', finalSmsText);
      formData.append('isflash', settings.melipayamak_is_flash ? 'true' : 'false');

      const soapResp = await fetch(
        'https://api.payamak-panel.com/post/Send.asmx/SendSimpleSMS2',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body: formData.toString(),
        }
      );

      if (soapResp.ok) {
        const rawXml = await soapResp.text();
        const match = rawXml.match(/<string[^>]*>([^<]+)<\/string>/i);
        const extracted = match ? match[1].trim() : rawXml.trim();

        if (/^\d+$/.test(extracted) && extracted.length > 4) {
          return {
            sent: true,
            rawCode: extracted,
            statusMessage: `پیامک با موفقیت ارسال شد (کد رهگیری: ${toPersianDigits(extracted)}).`,
          };
        }

        if (extracted === '0') {
          lastCode = '0';
          continue;
        }

        lastCode = extracted;
        break;
      }
    } catch (err) {
      return {
        sent: false,
        statusMessage: `خطا در ارتباط شبکه با سرور ملی‌پیامک: ${(err as Error).message}`,
      };
    }
  }

  const knownReason =
    MELIPAYAMAK_ERROR_CODES[lastCode] ||
    `ارسال پیامک توسط اپراتور رد شد (کد وضعیت ملی‌پیامک: ${toPersianDigits(lastCode || 'نامشخص')}).`;

  return {
    sent: false,
    rawCode: lastCode,
    statusMessage: knownReason,
  };
}
