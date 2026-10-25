import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  ShieldAlert,
  Smartphone,
  Volume2,
  X,
  Zap,
} from 'lucide-react';

export interface PhoneNotificationPayload {
  tag: string;
  title: string;
  body: string;
  tab?: string;
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

interface MobileNotificationBannerAndModalProps {
  onInstallPwaClick?: () => void;
  canInstallPwa?: boolean;
}

export const MobileNotificationBannerAndModal: React.FC<
  MobileNotificationBannerAndModalProps
> = ({ onInstallPwaClick, canInstallPwa }) => {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [keepAliveActive, setKeepAliveActive] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mgammon_xiaomi_keepalive') === '1';
    } catch {
      return false;
    }
  });
  const [testFeedback, setTestFeedback] = useState<string | null>(null);
  const keepAliveAudioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    ensureNotificationServiceWorker();
  }, []);

  // حفظ بیداری پس‌زمینه برای جلوگیری از بسته شدن تب در شیائومی (MIUI / HyperOS)
  useEffect(() => {
    if (!keepAliveActive) {
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
        gain.gain.value = 0.0001; // کاملاً بی‌صدا اما مانع خواب رفتن پردازش در MIUI می‌شود
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        keepAliveAudioCtxRef.current = ctx;
      } catch {
        // ignore until user interaction
      }
    };

    window.addEventListener('click', startSilentKeepAlive, { once: true });
    return () => {
      window.removeEventListener('click', startSilentKeepAlive);
    };
  }, [keepAliveActive]);

  const handleRequestPermission = async () => {
    setTestFeedback(null);
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setTestFeedback('مرورگر فعلی از نوتیفیکیشن وب پشتیبانی نمی‌کند. لطفاً از مرورگر Chrome استفاده کنید.');
      return;
    }
    try {
      const res = await Notification.requestPermission();
      setPermission(res);
      if (res === 'granted') {
        await triggerNativePhoneNotification({
          tag: `test-enable-${Date.now()}`,
          title: 'اعلان‌های Mgammon فعال شد',
          body: 'از این پس هنگام ارسال تسک یا پیام از سمت مدیریت، گوشی شما زنگ و اعلان دریافت می‌کند.',
        });
        setTestFeedback('نوتیفیکیشن گوشی با موفقیت فعال شد و یک اعلان آزمایشی ارسال گردید.');
      } else {
        setTestFeedback(
          'مجوز اعلان در مرورگر مسدود است. از آیکون قفل کنار آدرس سایت در کروم، گزینه Notifications را روی Allow قرار دهید.'
        );
      }
    } catch {
      setTestFeedback('خطا در درخواست مجوز نوتیفیکیشن.');
    }
  };

  const handleSendTestNotification = async () => {
    setTestFeedback(null);
    if (permission !== 'granted') {
      await handleRequestPermission();
      return;
    }
    const ok = await triggerNativePhoneNotification({
      tag: `test-manual-${Date.now()}`,
      title: 'تست اعلان مدیریت (مجید نورایی)',
      body: 'این یک اعلان آزمایشی همراه با صدا و ویبره برای اطمینان از عملکرد روی گوشی شیائومی/اندروید شماست.',
    });
    setTestFeedback(
      ok
        ? 'اعلان آزمایشی با صدا و ویبره ارسال شد! بالای صفحه گوشی را بررسی کنید.'
        : 'صدای هشدار پخش شد. برای نمایش در نوار بالای گوشی مجوز Notifications را بررسی کنید.'
    );
  };

  const toggleKeepAlive = () => {
    const next = !keepAliveActive;
    setKeepAliveActive(next);
    try {
      localStorage.setItem('mgammon_xiaomi_keepalive', next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* نوار جمع‌وجور وضعیت نوتیفیکیشن گوشی و راهنمای شیائومی */}
      <div className="rounded-2xl bg-white border border-[#C5A059]/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
              permission === 'granted'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {permission === 'granted' ? (
              <BellRing className="w-3.5 h-3.5" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-extrabold text-[#0B192C]">
                نوتیفیکیشن تسک و پیام مدیر در گوشی:
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  permission === 'granted'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                {permission === 'granted' ? 'فعال (صدا + اعلان)' : 'نیازمند فعال‌سازی'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {permission !== 'granted' && (
            <button
              type="button"
              onClick={handleRequestPermission}
              className="min-h-[30px] px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <BellRing className="w-3 h-3" />
              <span>فعال‌سازی با ۱ کلیک</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowGuideModal(true)}
            className="min-h-[30px] px-2.5 rounded-xl bg-[#FCF9F2] hover:bg-amber-50 border border-[#C5A059] text-[#0B192C] text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Smartphone className="w-3.5 h-3.5 text-[#9A7428]" />
            <span>تنظیمات شیائومی و تست اعلان</span>
          </button>
        </div>
      </div>

      {/* مودال جامع تنظیم نوتیفیکیشن در گوشی‌های اندروید و شیائومی (MIUI / HyperOS) */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="bg-white rounded-2xl border-2 border-[#C5A059] max-w-lg w-full p-4 space-y-3.5 shadow-xl my-auto max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#0B192C] text-[#C5A059] flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                    تنظیم قطعی نوتیفیکیشن در گوشی اندروید و شیائومی
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    دریافت آنی تسک‌ها، پیام‌ها و تصمیمات مدیریت همراه با صدا و ویبره
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* دکمه‌های عملیاتی فوری */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleRequestPermission}
                className="min-h-[40px] rounded-xl bg-[#0B192C] hover:bg-[#152a47] text-[#C5A059] border border-[#C5A059] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <BellRing className="w-4 h-4" />
                <span>
                  {permission === 'granted'
                    ? 'مجوز نوتیفیکیشن فعال است'
                    : '۱. فعال‌سازی مجوز نوتیفیکیشن'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleSendTestNotification}
                className="min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Volume2 className="w-4 h-4" />
                <span>تست نوتیفیکیشن و زنگ همین الان</span>
              </button>
            </div>

            {canInstallPwa && onInstallPwaClick && (
              <button
                type="button"
                onClick={onInstallPwaClick}
                className="w-full min-h-[38px] rounded-xl bg-[#FCF9F2] border border-[#C5A059] text-[#0B192C] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-4 h-4 text-[#9A7428]" />
                <span>نصب مستقیم برنامه روی صفحه اصلی گوشی (پیشنهاد ویژه شیائومی)</span>
              </button>
            )}

            {/* سوییچ ضد قطع پس‌زمینه ویژه شیائومی */}
            <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-extrabold text-[#0B192C] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#9A7428]" />
                  <span>حالت بیداربمان پس‌زمینه (ضد قطع شیائومی MIUI/HyperOS)</span>
                </div>
                <p className="text-[10.5px] text-slate-600 leading-5">
                  با روشن کردن این گزینه، برنامه در پس‌زمینه گوشی شیائومی بسته نمی‌شود و به محض ارسال تسک یا پیام توسط مدیر، زنگ می‌زند.
                </p>
              </div>
              <button
                type="button"
                onClick={toggleKeepAlive}
                className={`min-w-[64px] min-h-[32px] px-2.5 rounded-xl text-[11px] font-extrabold transition-colors cursor-pointer shrink-0 ${
                  keepAliveActive
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {keepAliveActive ? 'روشن ✓' : 'خاموش'}
              </button>
            </div>

            {testFeedback && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-900 font-semibold">
                {testFeedback}
              </div>
            )}

            {/* راهنمای گام‌به‌گام ترفند شیائومی */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0B192C]">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  ۴ ترفند حیاتی برای گوشی‌های شیائومی (Xiaomi MIUI / HyperOS) و اندروید:
                </span>
              </div>
              <p className="text-[10.5px] text-slate-600 leading-5">
                سیستم‌عامل شیائومی به صورت پیش‌فرض برنامه‌ها و مرورگر را در پس‌زمینه می‌بندد. برای دریافت ۱۰۰٪ نوتیفیکیشن‌ها این ۴ کار ساده را یک بار انجام دهید:
              </p>

              <ol className="space-y-2 text-[11px] text-slate-700 leading-5 list-decimal pr-4">
                <li>
                  <strong className="text-[#0B192C]">نصب برنامه (Add to Home Screen):</strong> در مرورگر Chrome روی سه نقطه بالا بزنید و گزینه{' '}
                  <strong className="text-[#9A7428]">«Install app / افزودن به صفحه اصلی»</strong> را بزنید تا برنامه مثل اپلیکیشن مستقل نصب شود.
                </li>
                <li>
                  <strong className="text-[#0B192C]">حذف محدودیت باتری شیائومی (مهم‌ترین گام):</strong> انگشت خود را روی آیکون برنامه (یا Chrome) نگه دارید ← گزینه{' '}
                  <strong>App Info (اطلاعات برنامه)</strong> ← بخش{' '}
                  <strong>Battery Saver (ذخیره باتری)</strong> را باز کنید و روی{' '}
                  <strong className="text-emerald-700">«No restrictions / بدون محدودیت»</strong> قرار دهید.
                </li>
                <li>
                  <strong className="text-[#0B192C]">فعال‌سازی اجرای خودکار (Autostart):</strong> در همان صفحه App Info، تیک گزینه{' '}
                  <strong className="text-emerald-700">Autostart (اجرای خودکار در پس‌زمینه)</strong> را روشن کنید و در بخش{' '}
                  <strong>Notifications</strong> تیک <strong>Allow sound & vibration</strong> و <strong>Lock screen</strong> را فعال کنید.
                </li>
                <li>
                  <strong className="text-[#0B192C]">قفل کردن برنامه در Recent Apps:</strong> دکمه مربع پایین گوشی (برنامه‌های اخیر) را بزنید، کارت برنامه را کمی به پایین بکشید (یا نگه دارید) و روی آیکون{' '}
                  <strong className="text-[#9A7428]">قفل (Lock)</strong> بزنید تا سیستم شیائومی هرگز آن را نبندد.
                </li>
              </ol>

              <div className="pt-2 border-t border-slate-200 flex items-start gap-1.5 text-[10.5px] text-slate-600">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>پشتیبان پیامکی (SMS):</strong> همچنین مدیر می‌تواند در بخش تنظیمات سامانه تیک «ارسال پیامک هم‌زمان برای تسک و پیام» را فعال کند تا حتی در زمان قطع بودن اینترنت گوشی، پیامک فوری دریافت کنید.
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="min-h-[36px] px-4 rounded-xl bg-[#0B192C] text-white text-xs font-bold cursor-pointer"
              >
                متوجه شدم و بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
