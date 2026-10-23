import React, { useEffect, useState } from 'react';
import { SystemSettings, UserProfile } from './shared/types';
import { apiRequest, setStoredToken } from './services/api';
import {
  authenticateWithDeviceBiometric,
  getStoredBiometricInfo,
  StoredBiometricInfo,
} from './services/biometric';
import { BrandLogo } from './components/BrandLogo';
import { PWAInstallButton } from './components/PWAInstallButton';
import { Footer } from './components/Footer';
import { WorkerPanel } from './components/WorkerPanel';
import { ManagerPanel } from './components/ManagerPanel';
import { LogOut, AlertTriangle, Fingerprint } from 'lucide-react';

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [serverShamsiDate, setServerShamsiDate] = useState('1405/07/30');
  const [bannerBgUrl, setBannerBgUrl] = useState<string | null>('/assets/media/banner-bg.svg');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // فرم ورود
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [storedBio, setStoredBio] = useState<StoredBiometricInfo | null>(null);

  useEffect(() => {
    setStoredBio(getStoredBiometricInfo());
  }, [user]);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const health = await apiRequest<{
          ok: boolean;
          dbConnected: boolean;
          serverTime: { shamsiDate: string };
          bannerBgUrl?: string | null;
        }>('/api/health');

        if (mounted) {
          if (health.serverTime?.shamsiDate) {
            setServerShamsiDate(health.serverTime.shamsiDate);
          }
          if (health.bannerBgUrl) {
            setBannerBgUrl(health.bannerBgUrl);
          }
        }

        try {
          const meRes = await apiRequest<{
            ok: boolean;
            user: UserProfile;
            serverTime: { shamsiDate: string };
            settings?: SystemSettings;
          }>('/api/auth/me');

          if (mounted) {
            setUser(meRes.user);
            if (meRes.serverTime?.shamsiDate) {
              setServerShamsiDate(meRes.serverTime.shamsiDate);
            }
            if (meRes.settings?.banner_bg_url) {
              setBannerBgUrl(meRes.settings.banner_bg_url);
            }
          }
        } catch {
          // کاربر هنوز وارد نشده است
        }
      } catch (err) {
        if (mounted) {
          setConnectionError((err as Error).message);
        }
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setConnectionError(null);
    setLoginLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        token: string;
        user: UserProfile;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setStoredToken(res.token);
      setUser(res.user);
      setPassword('');
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setLoginError(null);
    setConnectionError(null);
    setLoginLoading(true);
    try {
      const loggedInUser = await authenticateWithDeviceBiometric();
      setUser(loggedInUser);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setStoredToken(null);
      setUser(null);
    }
  };

  const handleUserAvatarChange = (newAvatarUrl: string | null) => {
    setUser((prev) => (prev ? { ...prev, avatar_url: newAvatarUrl } : prev));
  };

  if (initializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FFFFFF] p-6 text-center">
        <div className="rounded-3xl bg-white border border-[#C5A059]/60 p-8 max-w-sm w-full flex flex-col items-center space-y-4">
          <BrandLogo size="lg" />
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0B192C]">
              Mgammon
            </h1>
            <p className="text-xs font-medium text-slate-600">
              سامانه مدیریت کارکرد و حقوق پرسنل
            </p>
          </div>
          <div className="w-24 h-px bg-[#C5A059]" />
          <p className="text-[11px] text-slate-500">در حال بارگذاری سامانه...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9FAFB] text-[#0B192C]">
      {/* هدر مینیمال سفید، سرمه‌ای و طلایی */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#C5A059]/45 px-3.5 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm sm:text-base font-extrabold tracking-tight text-[#0B192C] truncate">
                  Mgammon
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                سامانه مدیریت کارکرد و امور مالی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                title="خروج از حساب کاربری"
                className="min-h-[38px] px-3 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059]/60 hover:bg-[#142844] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* محتوای اصلی */}
      <main className="flex-1">
        {connectionError && (
          <div className="max-w-xl mx-auto mt-4 px-4">
            <div className="rounded-2xl bg-red-50 border border-red-300 p-3.5 flex items-start gap-2.5 text-xs text-red-900">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold">عدم دسترسی موقت به سامانه</div>
                <p>لطفاً اتصال اینترنت خود را بررسی کرده و صفحه را مجدداً بارگذاری نمایید.</p>
              </div>
            </div>
          </div>
        )}

        {!user ? (
          <div className="max-w-md mx-auto px-4 py-8">
            <div className="rounded-3xl bg-white border border-[#C5A059]/60 p-5 sm:p-7 space-y-5 shadow-sm">
              {/* بنر بالای کارت ورود */}
              <div className="relative overflow-hidden rounded-2xl bg-[#0B192C] border border-[#C5A059]/60 p-5 text-center text-white">
                <img
                  src={bannerBgUrl || '/assets/media/banner-bg.svg'}
                  alt="Mgammon Banner"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = '/assets/media/banner-bg.svg';
                  }}
                  className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
                <div className="relative z-10 flex flex-col items-center space-y-2">
                  <BrandLogo size="lg" />
                  <h1 className="text-xl font-extrabold tracking-tight text-white">
                    Mgammon
                  </h1>
                  <p className="text-xs text-[#C5A059] font-medium">
                    سامانه مدیریت کارکرد و حقوق پرسنل
                  </p>
                  <div className="w-16 h-px bg-[#C5A059]/60 my-1" />
                  <div className="text-[11px] text-slate-300 flex items-center gap-2">
                    <span>
                      مدیریت: <strong>مجید نورایی</strong>
                    </span>
                    <span className="text-[#C5A059]">·</span>
                    <span>
                      پرسنل: <strong>امید میثمی</strong>
                    </span>
                  </div>
                </div>
              </div>

              {loginError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                  {loginError}
                </div>
              )}

              {/* دکمه ورود سریع با اثر انگشت / تشخیص چهره (در صورت فعال بودن روی دستگاه) */}
              {storedBio && (
                <button
                  type="button"
                  disabled={loginLoading}
                  onClick={handleBiometricLogin}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-gradient-to-l from-[#0B192C] to-[#162B47] text-[#C5A059] border border-[#C5A059] text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
                >
                  <Fingerprint className="w-5 h-5 text-[#C5A059]" />
                  <span>
                    ورود سریع با اثر انگشت / چهره ({storedBio.full_name})
                  </span>
                </button>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    نام کاربری
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="نام کاربری خود را وارد کنید"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    رمز عبور
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full min-h-[46px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-sm font-bold hover:bg-[#142844] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loginLoading ? 'در حال ورود...' : 'ورود به سامانه'}
                </button>
              </form>

              {/* انتخاب سریع حساب برای ورود */}
              <div className="pt-3.5 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-medium text-slate-500 text-center">
                  ورود سریع به حساب کاربری:
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUsername('manager');
                      setPassword('Mgammon@1405');
                    }}
                    className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#C5A059]/50 hover:border-[#C5A059] text-[11px] font-semibold text-[#0B192C] bg-white transition-colors cursor-pointer"
                  >
                    مدیریت: مجید نورایی
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsername('worker');
                      setPassword('Worker@1405');
                    }}
                    className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#C5A059]/50 hover:border-[#C5A059] text-[11px] font-semibold text-[#0B192C] bg-white transition-colors cursor-pointer"
                  >
                    پرسنل: امید میثمی
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : user.role === 'manager' ? (
          <ManagerPanel
            user={user}
            initialShamsiDate={serverShamsiDate}
            bannerBgUrl={bannerBgUrl}
            onUserAvatarChange={handleUserAvatarChange}
          />
        ) : (
          <WorkerPanel
            user={user}
            initialShamsiDate={serverShamsiDate}
            bannerBgUrl={bannerBgUrl}
            onUserAvatarChange={handleUserAvatarChange}
          />
        )}
      </main>

      <Footer hasBottomNav={Boolean(user)} />
    </div>
  );
}
