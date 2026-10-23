import React, { useState } from 'react';
import { X, KeyRound } from 'lucide-react';
import { apiRequest } from '../services/api';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PasswordModal: React.FC<PasswordModalProps> = ({ isOpen, onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('رمز عبور جدید و تکرار آن یکسان نیستند.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess(res.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-[#C5A059]/50 p-5 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#C5A059]" />
            <h3 className="text-sm font-bold text-[#0B192C]">تغییر رمز عبور حساب کاربری</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {success}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              رمز عبور فعلی
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              رمز عبور جدید (حداقل ۸ کاراکتر)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              تکرار رمز عبور جدید
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 min-h-[44px] rounded-xl bg-[#0B192C] text-white text-xs font-semibold hover:bg-[#152944] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading ? 'در حال ثبت...' : 'ذخیره رمز جدید'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              بستن
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
