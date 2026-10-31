import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellOff,
  BellRing,
  CheckCircle2,
  HelpCircle,
  Volume2,
  Zap,
} from 'lucide-react';

export interface PhoneNotificationPayload {
  tag: string;
  title: string;
  body: string;
  tab?: string;
}

const NOTIF_STATUS_EVENT = 'mgammon-notification-status-changed';
const KEEPALIVE_STORAGE_KEY = 'mgammon_xiaomi_keepalive';

function notifyStatusChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIF_STATUS_EVENT));
  }
}

/**
 * پخش صدای زنگ هشدار ملایم و استاندارد با Web Audio API + ویبره گوشی اندروید/شیائومی
 */
export function playAlertChimeAndVibrate(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([300, 120, 300, 120, 450]);
    }
  } catch {
    // ignore vibration error
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playTone(880, 0, 0.18);
    playTone(1174.66, 0.22, 0.28);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // ignore audio error if user hasn't interacted yet
  }
}

/**
 * اطمینان از ثبت سرویس‌ورکر برای نمایش نوتیفیکیشن واقعی در نوار اعلان اندروید و شیائومی
 */
export async function ensureNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      return existing;
    }
    const reg = await navigator.serviceWorker.register('/sw-notifications.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}

/**
 * ارسال نوتیفیکیشن به نوار بالای گوشی (اندروید / شیائومی / دسکتاپ) از طریق Service Worker
 */
export async function triggerNativePhoneNotification(
  payload: PhoneNotificationPayload
): Promise<boolean> {
  playAlertChimeAndVibrate();

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const notifOptions: NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
  } = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 120, 300, 120, 450],
    dir: 'rtl',
    lang: 'fa',
    data: { tab: payload.tab || 'overview' },
  };

  try {
    const reg = await ensureNotificationServiceWorker();
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(payload.title, notifOptions);
      return true;
    }
  } catch {
    // fallback to standard Notification constructor
  }

  try {
    new Notification(payload.title, notifOptions);
    return true;
  } catch {
    return false;
  }
}

/**
 * هوک وضعیت نوتیفیکیشن برای نمایش آیکون کوچک و بدون متن در بنر هدر و حفظ سرویس پس‌زمینه
 */
export function useNotificationStatus(): {
  permission: NotificationPermission;
  isNotificationActive: boolean;
  refreshStatus: () => void;
} {
  const getPerm = useCallback((): NotificationPermission => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  }, []);

  const [permission, setPermission] = useState<NotificationPermission>(getPerm);
  const keepAliveAudioCtxRef = useRef<AudioContext | null>(null);

  const refreshStatus = useCallback(() => {
    setPermission(getPerm());
  }, [getPerm]);

  useEffect(() => {
    ensureNotificationServiceWorker();
    const onUpdate = () => setPermission(getPerm());
    window.addEventListener(NOTIF_STATUS_EVENT, onUpdate);
    window.addEventListener('focus', onUpdate);
    document.addEventListener('visibilitychange', onUpdate);
    return () => {
      window.removeEventListener(NOTIF_STATUS_EVENT, onUpdate);
      window.removeEventListener('focus', onUpdate);
      document.removeEventListener('visibilitychange', onUpdate);
    };
  }, [getPerm]);

  useEffect(() => {
    const syncKeepAlive = () => {
      let enabled = false;
      try {
        enabled = localStorage.getItem(KEEPALIVE_STORAGE_KEY) === '1';
      } catch {
        enabled = false;
      }

      if (!enabled) {
        if (keepAliveAudioCtxRef.current) {
          keepAliveAudioCtxRef.current.close().catch(() => {});
          keepAliveAudioCtxRef.current = null;
        }
        return;
      }

      const startSilentKeepAlive = () => {
        try {
          if (keepAliveAudioCtxRef.current) return;
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioCtx) return;
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 30;
          gain.gain.value = 0.0001;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          keepAliveAudioCtxRef.current = ctx;
        } catch {
          // ignore until user interaction
        }
      };

      window.addEventListener('click', startSilentKeepAlive, { once: true });
    };

    syncKeepAlive();
    window.addEventListener(NOTIF_STATUS_EVENT, syncKeepAlive);
    return () => {
      window.removeEventListener(NOTIF_STATUS_EVENT, syncKeepAlive);
    };
  }, []);

  return {
    permission,
    isNotificationActive: permission === 'granted',
    refreshStatus,
  };
}

interface NotificationSettingsGuideSectionProps {
  role: 'manager' | 'worker';
}

/**
 * بخش فعال‌سازی نوتیفیکیشن و راهنمای تنظیمات گوشی — فقط در تب «تنظیمات ← راهنما» قرار می‌گیرد
 */
export const NotificationSettingsGuideSection: React.FC<
  NotificationSettingsGuideSectionProps
> = ({ role }) => {
  const { permission, isNotificationActive, refreshStatus } = useNotificationStatus();
  const [keepAliveActive, setKeepAliveActive] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEEPALIVE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  const handleRequestPermission = async () => {
    setTestFeedback(null);
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setTestFeedback(
        'مرورگر فعلی از نوتیفیکیشن وب پشتیبانی نمی‌کند. لطفاً از مرورگر Chrome استفاده کنید.'
      );
      return;
    }
    try {
      const res = await Notification.requestPermission();
      refreshStatus();
      notifyStatusChange();
      if (res === 'granted') {
        await triggerNativePhoneNotification({
          tag: `test-enable-${Date.now()}`,
          title: 'اعلان‌های Mgammon فعال شد',
          body:
            role === 'worker'
              ? 'از این پس هنگام ارسال برنامه کاری یا پیام از سمت مدیریت، گوشی شما زنگ و اعلان دریافت می‌کند.'
              : 'نوتیفیکیشن‌های سامانه روی این دستگاه با موفقیت فعال شد.',
        });
        setTestFeedback('نوتیفیکیشن با موفقیت فعال شد و آیکون وضعیت در بنر هدر به حالت فعال تغییر یافت.');
      } else {
        setTestFeedback(
          'مجوز اعلان در مرورگر مسدود است. از آیکون تنظیمات کنار آدرس سایت در مرورگر، گزینه Notifications را روی Allow قرار دهید.'
        );
      }
    } catch {
      setTestFeedback('خطا در درخواست مجوز نوتیفیکیشن.');
    }
  };

  const handleSendTestNotification = async () => {
    setTestFeedback(null);
    if (!isNotificationActive) {
      await handleRequestPermission();
      return;
    }
    const ok = await triggerNativePhoneNotification({
      tag: `test-manual-${Date.now()}`,
      title: 'تست اعلان سامانه Mgammon',
      body: 'این یک اعلان آزمایشی همراه با صدا و ویبره جهت اطمینان از عملکرد نوتیفیکیشن روی دستگاه شماست.',
    });
    setTestFeedback(
      ok
        ? 'اعلان آزمایشی با صدا و ویبره ارسال شد.'
        : 'صدای هشدار پخش شد. برای نمایش در نوار بالای گوشی مجوز Notifications را بررسی کنید.'
    );
  };

  const toggleKeepAlive = () => {
    const next = !keepAliveActive;
    setKeepAliveActive(next);
    try {
      localStorage.setItem(KEEPALIVE_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
    notifyStatusChange();
  };

  return (
    <div className="space-y-4">
      {/* کارت فعال‌سازی نوتیفیکیشن و تست صدا/ویبره */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                isNotificationActive
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {isNotificationActive ? (
                <BellRing className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4" />
              )}
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0B192C]">
                تنظیمات و فعال‌سازی نوتیفیکیشن دستگاه
              </h4>
              <p className="text-[11px] text-slate-500">
                وضعیت نوتیفیکیشن در بنر بالای صفحات فقط با یک آیکون کوچک بدون نوشته نمایش داده می‌شود.
              </p>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
              isNotificationActive
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {isNotificationActive ? 'فعال' : permission === 'denied' ? 'مسدود در مرورگر' : 'غیرفعال'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleRequestPermission}
            className="min-h-[42px] rounded-xl bg-[#0B192C] hover:bg-[#152a47] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <BellRing className="w-4 h-4" />
            <span>
              {isNotificationActive
                ? 'بررسی مجدد مجوز نوتیفیکیشن'
                : 'فعال‌سازی نوتیفیکیشن در این دستگاه'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleSendTestNotification}
            className="min-h-[42px] rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B192C] border border-slate-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Volume2 className="w-4 h-4 text-[#9A7428]" />
            <span>ارسال نوتیفیکیشن و صدای آزمایشی</span>
          </button>
        </div>

        {/* سوییچ حفظ فعالیت در پس‌زمینه ویژه شیائومی */}
        <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/55 p-3.5 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-[#0B192C] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#9A7428]" />
              <span>حفظ فعالیت در پس‌زمینه گوشی (ویژه اندروید و شیائومی)</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-5">
              جلوگیری از توقف خودکار برنامه در پس‌زمینه سیستم‌عامل‌های MIUI و HyperOS جهت دریافت به‌موقع اعلان برنامه‌های کاری و پیام‌ها
            </p>
          </div>
          <button
            type="button"
            onClick={toggleKeepAlive}
            className={`min-w-[68px] min-h-[34px] px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              keepAliveActive
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {keepAliveActive ? 'فعال' : 'غیرفعال'}
          </button>
        </div>

        {testFeedback && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 font-medium">
            {testFeedback}
          </div>
        )}
      </div>

      {/* کارت راهنمای گام‌به‌گام تنظیم گوشی‌های اندروید و شیائومی */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <HelpCircle className="w-4 h-4 text-[#9A7428] shrink-0" />
          <h4 className="text-sm font-bold text-[#0B192C]">
            راهنمای دریافت نوتیفیکیشن در گوشی‌های اندروید و شیائومی (MIUI / HyperOS)
          </h4>
        </div>

        <p className="text-xs text-slate-600 leading-6">
          در گوشی‌های شیائومی و اندروید، سیستم مدیریت باتری به‌صورت پیش‌فرض مرورگرها را در پس‌زمینه محدود می‌کند. برای دریافت آنی نوتیفیکیشن برنامه‌های کاری و پیام‌ها، مراحل زیر را یک بار در تنظیمات گوشی انجام دهید:
        </p>

        <ol className="space-y-2.5 text-xs text-slate-700 leading-6 list-decimal pr-4">
          <li>
            <strong className="text-[#0B192C]">نصب برنامه روی صفحه اصلی (Add to Home Screen):</strong>{' '}
            در مرورگر Chrome روی منوی سه نقطه بالا بزنید و گزینه{' '}
            <strong className="text-[#9A7428]">Install app / افزودن به صفحه اصلی</strong> را انتخاب کنید.
          </li>
          <li>
            <strong className="text-[#0B192C]">تنظیم باتری روی «بدون محدودیت»:</strong> انگشت خود را روی آیکون برنامه نگه دارید ←{' '}
            <strong>App Info (اطلاعات برنامه)</strong> ← بخش{' '}
            <strong>Battery Saver (ذخیره باتری)</strong> را روی{' '}
            <strong className="text-emerald-700">No restrictions (بدون محدودیت)</strong> قرار دهید.
          </li>
          <li>
            <strong className="text-[#0B192C]">فعال‌سازی اجرای خودکار (Autostart):</strong> در همان صفحه اطلاعات برنامه، گزینه{' '}
            <strong className="text-emerald-700">Autostart</strong> را روشن کرده و در بخش{' '}
            <strong>Notifications</strong> مجوز صدا، لرزش و نمایش روی صفحه قفل را فعال نمایید.
          </li>
          <li>
            <strong className="text-[#0B192C]">قفل برنامه در لیست برنامه‌های اخیر:</strong> در صفحه برنامه‌های اخیر گوشی (Recent Apps)، کارت برنامه را نگه داشته و آیکون{' '}
            <strong className="text-[#9A7428]">قفل (Lock)</strong> را بزنید.
          </li>
        </ol>

        <div className="pt-2.5 border-t border-slate-100 flex items-start gap-2 text-[11px] text-slate-600">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            در صورت فعال بودن گزینه «ارسال پیامک همزمان هنگام ثبت برنامه کاری و پیام جدید» در تنظیمات پیامک مدیریت، علاوه بر نوتیفیکیشن برنامه، پیامک نیز به شماره همراه پرسنل ارسال می‌گردد.
          </span>
        </div>
      </div>
    </div>
  );
};
