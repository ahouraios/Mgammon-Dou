import React, { useEffect, useState } from 'react';
import { SystemSettings, UserProfile } from './shared/types';
import { AUTH_EXPIRED_EVENT, apiRequest, setStoredToken } from './services/api';
import {
  authenticateWithDeviceBiometric,
  getStoredBiometricInfo,
  StoredBiometricInfo,
} from './services/biometric';
import { BrandLogo, updateAppNotificationBadge } from './components/BrandLogo';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TopShamsiCalendarBar } from './components/TopShamsiCalendarBar';
import { ForgotPasswordModal } from './components/ForgotPasswordModal';
import { Footer } from './components/Footer';
import { WorkerPanel } from './components/WorkerPanel';
import { ManagerPanel } from './components/ManagerPanel';
import { LogOut, AlertTriangle, Fingerprint, Eye, EyeOff } from 'lucide-react';

const REMEMBERED_USERNAME_KEY = 'mgammon_remembered_username';
const REMEMBER_ME_KEY = 'mgammon_remember_me';

function getRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [serverShamsiDate, setServerShamsiDate] = useState('1405/07/30');
  const [bannerBgUrl, setBannerBgUrl] = useState<string | null>('/assets/media/banner-bg.webp');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // فرم ورود
  const [username, setUsername] = useState(() => getRememberedUsername());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => Boolean(getRememberedUsername()));
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [storedBio, setStoredBio] = useState<StoredBiometricInfo | null>(null);
  const [isForgotOpen, setIsForgotOpen] = useState(false);

  useEffect(() => {
    setStoredBio(getStoredBiometricInfo());
  }, [user]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setStoredToken(null);
      setUser(null);
      updateAppNotificationBadge(0);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, []);

  useEffect(() => {
    try {
      if (rememberMe && username.trim()) {
        localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim());
      } else if (!rememberMe) {
        localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [rememberMe, username]);

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
          setStoredToken(null);
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
    const trimmedUsername = username.trim();
    try {
      try {
        if (rememberMe && trimmedUsername) {
          localStorage.setItem(REMEMBERED_USERNAME_KEY, trimmedUsername);
        } else {
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
        }
      } catch {
        // ignore storage errors
      }

      const res = await apiRequest<{
        ok: boolean;
        token: string;
        user: UserProfile;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: trimmedUsername, password }),
      });
      setStoredToken(res.token);
      try {
        localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');
        if (rememberMe && username.trim()) {
          localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim());
        } else {
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
        }
      } catch {
        // ignore storage errors
      }
      setUser(res.user);
      setPassword('');
      setShowPassword(false);
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
      updateAppNotificationBadge(0);
      const savedUsername = getRememberedUsername();
      setUsername(savedUsername);
      setRememberMe(Boolean(savedUsername));
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
    <div className="min-h-screen flex flex-col bg-[#F9FAFB] text-[#0B192C] overflow-x-hidden">
      {/* هدر مینیمال سفید، سرمه‌ای و طلایی همراه با تقویم کوچک شمسی */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#C5A059]/45 px-3.5 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm sm:text-base font-extrabold tracking-tight text-[#0B192C] truncate">
                  Mgammon
                </span>
              </div>
              <p className="hidden xs:block text-[10px] sm:text-[11px] text-slate-500 truncate">
                سامانه مدیریت کارکرد و امور مالی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <TopShamsiCalendarBar serverShamsiDate={serverShamsiDate} />
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
              <div className="overflow-hidden rounded-2xl bg-[#0B192C] border border-[#C5A059]/60">
                <img
                  src="/assets/media/start_baner.webp"
                  alt="Mgammon"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    if (!img.dataset.triedUploads) {
                      img.dataset.triedUploads = '1';
                      img.src = '/uploads/start_baner.webp';
                    } else if (!img.dataset.triedRoot) {
                      img.dataset.triedRoot = '1';
                      img.src = '/start_baner.webp';
                    }
                  }}
                  className="w-full h-auto object-cover block"
                />
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
                    onChange={(e) => {
                      const val = e.target.value;
                      setUsername(val);
                      try {
                        if (rememberMe && val.trim()) {
                          localStorage.setItem(REMEMBERED_USERNAME_KEY, val.trim());
                        } else if (!val.trim()) {
                          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    placeholder="نام کاربری خود را وارد کنید"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    رمز عبور
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-10 pr-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                      title={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                      className="absolute inset-y-0 left-0 flex items-center px-3 text-slate-400 hover:text-[#0B192C] transition-colors cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRememberMe(checked);
                        try {
                          localStorage.setItem(REMEMBER_ME_KEY, checked ? 'true' : 'false');
                          if (checked && username.trim()) {
                            localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim());
                          } else if (!checked) {
                            localStorage.removeItem(REMEMBERED_USERNAME_KEY);
                          }
                        } catch {
                          // ignore
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 accent-[#0B192C] cursor-pointer"
                    />
                    <span>مرا به خاطر بسپار</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setIsForgotOpen(true)}
                    className="text-xs font-bold text-[#9A7428] hover:text-[#0B192C] transition-colors cursor-pointer"
                  >
                    فراموشی رمز عبور؟
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full min-h-[46px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-sm font-bold hover:bg-[#142844] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loginLoading ? 'در حال ورود...' : 'ورود به سامانه'}
                </button>
              </form>
            </div>

            <ForgotPasswordModal
              isOpen={isForgotOpen}
              initialUsername={username}
              onClose={() => setIsForgotOpen(false)}
              onResetSuccess={(loggedInUser) => {
                setUser(loggedInUser);
                setPassword('');
              }}
            />
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
