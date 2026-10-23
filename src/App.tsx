import React, { useEffect, useState } from 'react';
import { UserProfile } from './shared/types';
import { apiRequest, setStoredToken } from './services/api';
import { BrandLogo } from './components/BrandLogo';
import { PWAInstallButton } from './components/PWAInstallButton';
import { Footer } from './components/Footer';
import { PasswordModal } from './components/PasswordModal';
import { WorkerPanel } from './components/WorkerPanel';
import { ManagerPanel } from './components/ManagerPanel';
import { KeyRound, LogOut, AlertTriangle } from 'lucide-react';

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [serverShamsiDate, setServerShamsiDate] = useState('1405/07/30');
  const [dbError, setDbError] = useState<string | null>(null);

  // فرم ورود
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // مودال تغییر رمز عبور
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const health = await apiRequest<{
          ok: boolean;
          dbConnected: boolean;
          serverTime: { shamsiDate: string };
        }>('/api/health');

        if (mounted && health.serverTime?.shamsiDate) {
          setServerShamsiDate(health.serverTime.shamsiDate);
        }

        try {
          const meRes = await apiRequest<{
            ok: boolean;
            user: UserProfile;
            serverTime: { shamsiDate: string };
          }>('/api/auth/me');

          if (mounted) {
            setUser(meRes.user);
            if (meRes.serverTime?.shamsiDate) {
              setServerShamsiDate(meRes.serverTime.shamsiDate);
            }
          }
        } catch {
          // کاربر هنوز وارد نشده است
        }
      } catch (err) {
        if (mounted) {
          setDbError((err as Error).message);
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
    setDbError(null);
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

  // صفحه بارگذاری اولیه با لوگوی /uploads/logo.png، عنوان Mgammon و زیرعنوان «سامانه مدیریت کارکرد و حقوق پرسنل»
  if (initializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] p-6 text-center">
        <div className="rounded-3xl bg-white border border-[#C5A059]/50 p-8 shadow-sm max-w-sm w-full flex flex-col items-center space-y-4">
          <BrandLogo size="lg" />
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0B192C]">
              Mgammon
            </h1>
            <p className="text-xs font-medium text-slate-600">
              سامانه مدیریت کارکرد و حقوق پرسنل
            </p>
          </div>
          <div className="w-24 h-0.5 bg-[#C5A059]/60 rounded-full" />
          <p className="text-[11px] text-slate-500">در حال بارگذاری و بررسی اتصال امن...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0B192C]">
      {/* هدر اصلی برنامه */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#C5A059]/40 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-[#0B192C] truncate">
                  Mgammon
                </span>
                {user && (
                  <span className="text-xs text-[#9A7428] font-semibold whitespace-nowrap">
                    · {user.role === 'manager' ? 'پنل مدیر' : 'پنل نیروی کاری'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                سامانه مدیریت کارکرد و حقوق پرسنل
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(true)}
                  title="تغییر رمز عبور"
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] text-xs font-medium text-[#0B192C] flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#C5A059]" />
                  <span className="hidden sm:inline">تغییر رمز</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="خروج امن از حساب"
                  className="min-h-[40px] px-3 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-700 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>خروج</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* محتوای اصلی */}
      <main className="flex-1">
        {dbError && (
          <div className="max-w-xl mx-auto mt-6 px-4">
            <div className="rounded-2xl bg-red-50 border border-red-300 p-4 flex items-start gap-3 text-xs text-red-900">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">خطا در ارتباط با پایگاه داده MySQL</div>
                <p>{dbError}</p>
              </div>
            </div>
          </div>
        )}

        {!user ? (
          <div className="max-w-md mx-auto px-4 py-10">
            <div className="rounded-3xl bg-white border border-[#C5A059]/50 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col items-center text-center space-y-3">
                <BrandLogo size="lg" />
                <div>
                  <h1 className="text-xl font-extrabold text-[#0B192C]">Mgammon</h1>
                  <p className="mt-1 text-xs text-slate-600">
                    سامانه مدیریت کارکرد و حقوق پرسنل
                  </p>
                </div>
                <div className="w-16 h-0.5 bg-[#C5A059]/60 rounded-full" />
              </div>

              {loginError && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                  {loginError}
                </div>
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
                    placeholder="manager / worker"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
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
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full min-h-[48px] rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/70 text-sm font-bold hover:bg-[#142844] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loginLoading ? 'در حال بررسی و ورود...' : 'ورود امن به سامانه'}
                </button>
              </form>

              {/* راهنمای دسترسی سریع برای تست و تحویل اولیه */}
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-medium text-slate-500 text-center">
                  حساب‌های پیش‌فرض اولیه (قابل تغییر رمز پس از ورود):
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUsername('manager');
                      setPassword('Mgammon@1405');
                    }}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-slate-200 hover:border-[#C5A059] text-[11px] text-slate-700 bg-slate-50/70 transition-colors cursor-pointer"
                  >
                    حساب مدیر (manager)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsername('worker');
                      setPassword('Worker@1405');
                    }}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-slate-200 hover:border-[#C5A059] text-[11px] text-slate-700 bg-slate-50/70 transition-colors cursor-pointer"
                  >
                    حساب نیرو (worker)
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : user.role === 'manager' ? (
          <ManagerPanel initialShamsiDate={serverShamsiDate} />
        ) : (
          <WorkerPanel user={user} initialShamsiDate={serverShamsiDate} />
        )}
      </main>

      <PasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      <Footer />
    </div>
  );
}
