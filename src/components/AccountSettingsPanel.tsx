import React, { useRef, useState } from 'react';
import {
  Camera,
  KeyRound,
  CheckCircle2,
  Trash2,
  Fingerprint,
  Download,
  DatabaseBackup,
  Image as ImageIcon,
} from 'lucide-react';
import { UserProfile } from '../shared/types';
import { apiRequest } from '../services/api';
import {
  disableDeviceBiometric,
  getStoredBiometricInfo,
  registerDeviceBiometric,
} from '../services/biometric';
import { CameraCaptureModal } from './CameraCaptureModal';

interface AccountSettingsPanelProps {
  user: UserProfile;
  currentAvatarUrl: string | null;
  onAvatarUpdated: (newUrl: string | null) => void;
}

export const AccountSettingsPanel: React.FC<AccountSettingsPanelProps> = ({
  user,
  currentAvatarUrl,
  onAvatarUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [bioEnabled, setBioEnabled] = useState<boolean>(() => {
    const stored = getStoredBiometricInfo();
    return Boolean(user.biometric_enabled || (stored && stored.username === user.username));
  });
  const [bioLoading, setBioLoading] = useState(false);
  const [bioFeedback, setBioFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const defaultAvatar =
    user.role === 'manager'
      ? '/assets/media/manager-avatar.svg'
      : '/assets/media/worker-avatar.svg';

  const saveAvatarBase64 = async (fileName: string, base64Data: string) => {
    setAvatarFeedback(null);
    setAvatarLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        avatar_url: string | null;
        message: string;
      }>('/api/auth/avatar', {
        method: 'PUT',
        body: JSON.stringify({
          file_name: fileName,
          avatar_base64: base64Data,
        }),
      });
      onAvatarUpdated(res.avatar_url);
      setAvatarFeedback({ type: 'success', text: res.message });
    } catch (err) {
      setAvatarFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_500_000) {
      setAvatarFeedback({
        type: 'error',
        text: 'حجم تصویر انتخابی نباید بیشتر از ۲.۵ مگابایت باشد.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        saveAvatarBase64(file.name, reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleResetAvatar = async () => {
    setAvatarFeedback(null);
    setAvatarLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        avatar_url: string | null;
        message: string;
      }>('/api/auth/avatar', {
        method: 'PUT',
        body: JSON.stringify({ avatar_base64: null }),
      });
      onAvatarUpdated(null);
      setAvatarFeedback({ type: 'success', text: res.message });
    } catch (err) {
      setAvatarFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdFeedback(null);

    if (newPassword.length < 8) {
      setPwdFeedback({
        type: 'error',
        text: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdFeedback({
        type: 'error',
        text: 'رمز عبور جدید و تکرار آن یکسان نیستند.',
      });
      return;
    }

    setPwdLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdFeedback({ type: 'success', text: res.message });
    } catch (err) {
      setPwdFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setPwdLoading(false);
    }
  };

  const handleEnableBiometric = async () => {
    setBioFeedback(null);
    setBioLoading(true);
    try {
      await registerDeviceBiometric(user);
      setBioEnabled(true);
      setBioFeedback({
        type: 'success',
        text: 'ورود سریع با اثر انگشت / تشخیص چهره برای این دستگاه فعال شد.',
      });
    } catch (err) {
      setBioFeedback({
        type: 'error',
        text: (err as Error).message,
      });
    } finally {
      setBioLoading(false);
    }
  };

  const handleDisableBiometric = async () => {
    setBioFeedback(null);
    setBioLoading(true);
    try {
      await disableDeviceBiometric();
      setBioEnabled(false);
      setBioFeedback({
        type: 'success',
        text: 'ورود بیومتریک غیرفعال شد.',
      });
    } catch (err) {
      setBioFeedback({
        type: 'error',
        text: (err as Error).message,
      });
    } finally {
      setBioLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* کارت تغییر تصویر پروفایل شخصی کاربر */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Camera className="w-4 h-4 text-[#9A7428]" />
            <h4 className="text-sm font-bold text-[#0B192C]">تصویر پروفایل شما</h4>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-2xl border-2 border-[#C5A059] bg-slate-50 overflow-hidden shrink-0">
              <img
                src={currentAvatarUrl || defaultAvatar}
                alt={user.full_name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = defaultAvatar;
                }}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="text-sm font-extrabold text-[#0B192C]">{user.full_name}</div>
              <div className="text-xs text-slate-500">
                {user.role === 'manager' ? 'مدیریت مجموعه' : 'پرسنل مجموعه'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={avatarLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[36px] px-3 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{avatarLoading ? 'در حال ذخیره...' : 'انتخاب از گالری'}</span>
                </button>

                <button
                  type="button"
                  disabled={avatarLoading}
                  onClick={() => setIsCameraOpen(true)}
                  className="min-h-[36px] px-3 rounded-xl border border-[#C5A059]/60 bg-[#FCF9F2] text-[#0B192C] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#9A7428]" />
                  <span>دوربین</span>
                </button>

                {currentAvatarUrl && (
                  <button
                    type="button"
                    disabled={avatarLoading}
                    onClick={handleResetAvatar}
                    className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:text-red-600 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {avatarFeedback && (
            <div
              className={`rounded-xl p-3 text-xs font-medium flex items-center gap-2 ${
                avatarFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-red-50 text-red-900 border border-red-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{avatarFeedback.text}</span>
            </div>
          )}
        </div>

        {/* کارت تغییر رمز عبور */}
        <form
          onSubmit={handlePasswordSubmit}
          className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3.5"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <KeyRound className="w-4 h-4 text-[#9A7428]" />
            <h4 className="text-sm font-bold text-[#0B192C]">تغییر رمز عبور حساب</h4>
          </div>

          {pwdFeedback && (
            <div
              className={`rounded-xl p-3 text-xs font-medium ${
                pwdFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-red-50 text-red-900 border border-red-200'
              }`}
            >
              {pwdFeedback.text}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">رمز عبور فعلی</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                رمز عبور جدید
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="حداقل ۸ کاراکتر"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs focus:outline-none focus:border-[#0B192C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                تکرار رمز جدید
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs focus:outline-none focus:border-[#0B192C]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pwdLoading}
            className="w-full sm:w-auto min-h-[42px] px-5 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
          >
            {pwdLoading ? 'در حال ثبت...' : 'ذخیره رمز عبور جدید'}
          </button>
        </form>
      </div>

      {/* کارت ورود با اثر انگشت / تشخیص چهره موبایل + پشتیبان‌گیری برای مدیر */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Fingerprint className="w-4 h-4 text-[#9A7428]" />
            <h4 className="text-sm font-bold text-[#0B192C]">
              ورود سریع با اثر انگشت / تشخیص چهره گوشی
            </h4>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            با فعال‌سازی این قابلیت روی گوشی خود، در مراجعات بعدی بدون نیاز به تایپ رمز عبور می‌توانید با اثر انگشت یا تشخیص چهره وارد حساب خود شوید.
          </p>

          {bioFeedback && (
            <div
              className={`rounded-xl p-3 text-xs font-medium ${
                bioFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-red-50 text-red-900 border border-red-200'
              }`}
            >
              {bioFeedback.text}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {!bioEnabled ? (
              <button
                type="button"
                disabled={bioLoading}
                onClick={handleEnableBiometric}
                className="min-h-[42px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <Fingerprint className="w-4 h-4" />
                <span>{bioLoading ? 'در حال ثبت...' : 'فعال‌سازی ورود با اثر انگشت در این دستگاه'}</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>فعال روی این دستگاه</span>
                </span>
                <button
                  type="button"
                  disabled={bioLoading}
                  onClick={handleDisableBiometric}
                  className="min-h-[36px] px-3 rounded-xl border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                >
                  غیرفعال‌سازی
                </button>
              </div>
            )}
          </div>
        </div>

        {user.role === 'manager' && (
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <DatabaseBackup className="w-4 h-4 text-[#9A7428]" />
              <h4 className="text-sm font-bold text-[#0B192C]">
                پشتیبان‌گیری یک‌کلیکی از کل اطلاعات
              </h4>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              دریافت نسخه کامل آرشیو شامل تمام ترددها، مرخصی‌ها، گزارش‌های کار روزانه، پرداخت‌ها و هزینه‌های تنخواه در قالب فایل اکسل چندبرگه‌ای یا فایل پشتیبان کامل.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href="/api/manager/backup/excel"
                download="mgammon-full-backup.xlsx"
                className="min-h-[42px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center gap-2 hover:bg-[#142844]"
              >
                <Download className="w-4 h-4" />
                <span>دانلود اکسل جامع کارکرد و مالی</span>
              </a>
              <a
                href="/api/manager/backup/json"
                download="mgammon-backup.json"
                className="min-h-[42px] px-3.5 rounded-xl border border-[#C5A059]/60 bg-[#FCF9F2] text-[#0B192C] text-xs font-bold flex items-center gap-1.5 hover:border-[#C5A059]"
              >
                <DatabaseBackup className="w-4 h-4 text-[#9A7428]" />
                <span>فایل پشتیبان کامل</span>
              </a>
            </div>
          </div>
        )}
      </div>

      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(fileName, base64Data) => saveAvatarBase64(fileName, base64Data)}
        title="ثبت تصویر پروفایل با دوربین"
      />
    </div>
  );
};
