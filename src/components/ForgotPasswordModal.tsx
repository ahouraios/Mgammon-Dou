import React, { useEffect, useState } from 'react';
import { KeyRound, Smartphone, ArrowRight, Eye, EyeOff, CheckCircle2, X } from 'lucide-react';
import { apiRequest, setStoredToken } from '../services/api';
import { UserProfile } from '../shared/types';
import { toPersianDigits } from '../shared/jalali';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  initialUsername: string;
  onClose: () => void;
  onResetSuccess: (user: UserProfile) => void;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  initialUsername,
  onClose,
  onResetSuccess,
}) => {
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [username, setUsername] = useState(initialUsername || 'worker');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('request');
      setUsername(initialUsername.trim() || 'worker');
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setErrorMsg(null);
      setInfoMsg(null);
      setSecondsLeft(0);
    }
  }, [isOpen, initialUsername]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  if (!isOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        maskedPhone: string;
        expiresInSeconds: number;
        message: string;
      }>('/api/auth/forgot-password/request-otp', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim() }),
      });
      setMaskedPhone(res.maskedPhone || '');
      setSecondsLeft(res.expiresInSeconds || 120);
      setInfoMsg(res.message);
      setStep('verify');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('رمز عبور جدید باید حداقل ۸ کاراکتر باشد.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('رمز عبور جدید و تکرار آن یکسان نیستند.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        token: string;
        user: UserProfile;
        message: string;
      }>('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          otpCode: otpCode.trim(),
          newPassword,
        }),
      });
      setStoredToken(res.token);
      onResetSuccess(res.user);
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-3xl bg-white border border-[#C5A059] p-5 sm:p-6 space-y-4 shadow-xl text-[#0B192C]">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#0B192C] text-[#C5A059] flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold text-[#0B192C]">
                بازیابی رمز عبور با پیامک
              </h3>
              <p className="text-[11px] text-slate-500">
                ارسال کد یک‌بارمصرف از طریق سامانه ملی‌پیامک
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:text-[#0B192C] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 leading-5">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2 leading-5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {step === 'request' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                انتخاب حساب کاربری جهت بازیابی رمز:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUsername('manager')}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    username.trim().toLowerCase() === 'manager'
                      ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                      : 'bg-white text-[#0B192C] border-slate-200 hover:border-[#C5A059]'
                  }`}
                >
                  مدیریت: مجید نورایی
                </button>
                <button
                  type="button"
                  onClick={() => setUsername('worker')}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    username.trim().toLowerCase() === 'worker'
                      ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                      : 'bg-white text-[#0B192C] border-slate-200 hover:border-[#C5A059]'
                  }`}
                >
                  پرسنل: امید میثمی
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                نام کاربری
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
              />
            </div>

            <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/40 p-3 text-[11px] text-slate-600 leading-5">
              کد تایید ۶ رقمی به شماره موبایل ثبت‌شده برای این حساب پیامک می‌شود. همچنین برای حساب پرسنل، مدیریت می‌تواند از داخل پنل خود رمز عبور را مستقیماً بازنشانی کند.
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 min-h-[44px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#142844] disabled:opacity-50 cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>{loading ? 'در حال ارسال پیامک...' : 'ارسال کد بازیابی با پیامک'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyAndReset} className="space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  کد تایید ۶ رقمی پیامک‌شده {maskedPhone ? `(${maskedPhone})` : ''}
                </label>
                {secondsLeft > 0 && (
                  <span className="text-[11px] font-bold text-[#9A7428] tabular-nums">
                    اعتبار: {toPersianDigits(secondsLeft)} ثانیه
                  </span>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                dir="ltr"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="------"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-center text-base font-extrabold tracking-widest focus:outline-none focus:border-[#0B192C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                رمز عبور جدید (حداقل ۸ کاراکتر)
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  dir="ltr"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 pl-10 pr-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((p) => !p)}
                  className="absolute inset-y-0 left-0 flex items-center px-3 text-slate-400 hover:text-[#0B192C] cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                تکرار رمز عبور جدید
              </label>
              <input
                type={showNewPassword ? 'text' : 'password'}
                required
                minLength={8}
                dir="ltr"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3.5 text-sm text-right focus:outline-none focus:border-[#0B192C]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 min-h-[44px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'در حال ثبت...' : 'تایید کد و تغییر رمز عبور'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('request');
                  setErrorMsg(null);
                }}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 flex items-center gap-1 hover:bg-slate-50 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>بازگشت</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
