import React, { useState } from 'react';
import { UserProfile } from '../shared/types';
import {
  verifyDeviceBiometricForUnlock,
  verifyUnlockPasswordOrPin,
} from '../services/biometric';
import { BrandLogo } from './BrandLogo';
import {
  Fingerprint,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  LogOut,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';

interface AppLockOverlayProps {
  user: UserProfile;
  onUnlock: () => void;
  onLogout: () => void;
}

export const AppLockOverlay: React.FC<AppLockOverlayProps> = ({
  user,
  onUnlock,
  onLogout,
}) => {
  const [pinOrPassword, setPinOrPassword] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const defaultAvatar =
    user.role === 'manager'
      ? '/assets/media/manager-avatar.svg'
      : '/assets/media/worker-avatar.svg';

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!pinOrPassword.trim()) {
      setErrorMsg('لطفاً رمز قفل یا رمز عبور حساب خود را وارد نمایید.');
      return;
    }

    setLoading(true);
    try {
      const ok = await verifyUnlockPasswordOrPin(pinOrPassword);
      if (ok) {
        setPinOrPassword('');
        onUnlock();
      } else {
        setErrorMsg('رمز واردشده صحیح نیست.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'رمز واردشده صحیح نیست.');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setErrorMsg(null);
    setBioLoading(true);
    try {
      const ok = await verifyDeviceBiometricForUnlock(user);
      if (ok) {
        onUnlock();
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBioLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#0B192C]/95 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-3xl bg-white border-2 border-[#C5A059] p-6 sm:p-7 shadow-2xl space-y-5 text-[#0B192C]">
        {/* سربرگ قفل امنیتی */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl border-2 border-[#C5A059] bg-slate-50 overflow-hidden shadow-md">
              <img
                src={user.avatar_url || defaultAvatar}
                alt={user.full_name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = defaultAvatar;
                }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -bottom-1.5 -left-1.5 w-7 h-7 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] flex items-center justify-center shadow-sm">
              <Lock className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-0.5 pt-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#FCF9F2] border border-[#C5A059]/60 text-[11px] font-bold text-[#9A7428]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>صفحه برنامه به دلیل عدم استفاده قفل شده است</span>
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-[#0B192C] pt-1">
              {user.full_name}
            </h2>
            <p className="text-xs text-slate-500">
              {user.role === 'manager' ? 'پنل مدیریت مجموعه Mgammon' : 'پنل پرسنل مجموعه Mgammon'}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-800 text-center">
            {errorMsg}
          </div>
        )}

        {/* دکمه بزرگ بازگشایی با اثر انگشت یا تشخیص چهره */}
        <button
          type="button"
          disabled={bioLoading || loading}
          onClick={handleBiometricUnlock}
          className="w-full min-h-[52px] px-4 py-3 rounded-2xl bg-gradient-to-l from-[#0B192C] to-[#162B47] text-[#C5A059] border-2 border-[#C5A059] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2.5 shadow-md hover:opacity-95 transition-opacity cursor-pointer"
        >
          <Fingerprint className="w-5 h-5 text-[#C5A059] shrink-0" />
          <ScanFace className="w-5 h-5 text-[#C5A059] shrink-0" />
          <span>
            {bioLoading
              ? 'در حال بررسی سنسور بیومتریک...'
              : 'باز کردن قفل با اثر انگشت / تشخیص چهره'}
          </span>
        </button>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-200 w-full" />
          <span className="bg-white px-3 text-[11px] font-semibold text-slate-400 shrink-0">
            یا بازگشایی با رمز
          </span>
          <div className="border-t border-slate-200 w-full" />
        </div>

        {/* فرم بازگشایی با رمز قفل یا رمز عبور حساب */}
        <form onSubmit={handlePasswordUnlock} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              رمز قفل صفحه یا رمز عبور حساب کاربری
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                dir="ltr"
                autoFocus
                value={pinOrPassword}
                onChange={(e) => setPinOrPassword(e.target.value)}
                placeholder="رمز را وارد کنید..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 pl-10 pr-3.5 text-sm text-center font-bold tracking-widest focus:outline-none focus:border-[#0B192C]"
              />
              <button
                type="button"
                onClick={() => setShowSecret((p) => !p)}
                className="absolute inset-y-0 left-0 flex items-center px-3 text-slate-400 hover:text-[#0B192C] cursor-pointer"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || bioLoading}
            className="w-full min-h-[46px] rounded-xl bg-[#FCF9F2] hover:bg-[#C5A059]/25 text-[#0B192C] border border-[#C5A059] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Unlock className="w-4 h-4 text-[#9A7428]" />
            <span>{loading ? 'در حال بررسی رمز...' : 'باز کردن قفل برنامه'}</span>
          </button>
        </form>

        {/* فوتر کوچک قفل صفحه */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <BrandLogo size="sm" />
            <span className="text-[11px] font-bold text-slate-500">حفاظت امنیتی Mgammon</span>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="text-[11px] font-bold text-red-700 hover:text-red-900 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج کامل از حساب</span>
          </button>
        </div>
      </div>
    </div>
  );
};
