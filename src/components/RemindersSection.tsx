import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReminderRepeatType,
  ReminderTargetScope,
  UserReminderItem,
  UserRole,
} from '../shared/types';
import { apiRequest } from '../services/api';
import {
  formatShamsiVerbose,
  getNowInTimezone,
  getShamsiDayOfWeekName,
  toPersianDigits,
} from '../shared/jalali';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { TimePickerInput } from './TimePickerInput';
import {
  playAlertChimeAndVibrate,
  triggerNativePhoneNotification,
} from './MobileNotificationHelper';
import {
  AlarmClock,
  BellRing,
  Calendar,
  CheckCheck,
  Clock,
  Edit3,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  X,
  CheckCircle2,
  Users,
} from 'lucide-react';

export const REMINDERS_UPDATED_EVENT = 'mgammon-reminders-updated';

function notifyRemindersUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REMINDERS_UPDATED_EVENT));
  }
}

export const REPEAT_TYPE_OPTIONS: {
  value: ReminderRepeatType;
  label: string;
  desc: string;
}[] = [
  {
    value: 'ONCE',
    label: 'بدون تکرار (فقط یک‌بار)',
    desc: 'فقط یک‌بار در تاریخ و ساعت تعیین‌شده یادآوری می‌شود.',
  },
  {
    value: 'SAME_DAY_INTERVAL',
    label: 'تکرار چندباره با فاصله دقیقه‌ای (در همان روز)',
    desc: 'تکرار متوالی با فاصله زمانی مشخص (مثلاً هر ۱۵ یا ۳۰ دقیقه) به تعداد دلخواه.',
  },
  {
    value: 'DAILY',
    label: 'تکرار روزانه (هر روز در ساعت مشخص)',
    desc: 'هر روز در ساعت انتخاب‌شده به تعداد روزهای تعیین‌شده تکرار می‌گردد.',
  },
  {
    value: 'EVERY_N_DAYS',
    label: 'تکرار هر چند روز یک‌بار (فاصله روزانه دلخواه)',
    desc: 'هر N روز یک‌بار در ساعت مشخص‌شده به تعداد دفعات دلخواه تکرار می‌شود.',
  },
  {
    value: 'WEEKLY',
    label: 'تکرار هفتگی (هر هفته در همین روز و ساعت)',
    desc: 'هر هفته در همین روز هفته و ساعت به تعداد هفته‌های تعیین‌شده تکرار می‌گردد.',
  },
  {
    value: 'MONTHLY',
    label: 'تکرار ماهانه (هر ماه در همین تاریخ و ساعت)',
    desc: 'هر ماه در همین روز از ماه و ساعت مشخص‌شده به تعداد دفعات تعیین‌شده تکرار می‌شود.',
  },
];

export function formatReminderRepeatSummary(r: UserReminderItem): string {
  if (r.repeat_type === 'ONCE' || r.repeat_count <= 1) {
    return 'یک‌بار (بدون تکرار)';
  }
  const countStr = `${toPersianDigits(r.repeat_count)} مرتبه`;
  switch (r.repeat_type) {
    case 'SAME_DAY_INTERVAL':
      return `تکرار هر ${toPersianDigits(r.repeat_interval_minutes)} دقیقه (${countStr})`;
    case 'DAILY':
      return `تکرار روزانه (${countStr})`;
    case 'EVERY_N_DAYS':
      return `هر ${toPersianDigits(r.repeat_interval_minutes)} روز یک‌بار (${countStr})`;
    case 'WEEKLY':
      return `تکرار هفتگی (${countStr})`;
    case 'MONTHLY':
      return `تکرار ماهانه (${countStr})`;
    default:
      return countStr;
  }
}

export function isReminderCurrentlyDue(
  r: UserReminderItem,
  currentShamsiDate: string,
  currentTimeHHMM: string
): boolean {
  if (!r.is_active || r.is_completed) return false;
  if (currentShamsiDate > r.next_trigger_shamsi) return true;
  if (
    currentShamsiDate === r.next_trigger_shamsi &&
    currentTimeHHMM >= r.next_trigger_time.slice(0, 5)
  ) {
    return true;
  }
  return false;
}

interface RemindersSectionProps {
  role: UserRole;
  currentShamsiDate: string;
}

export const RemindersSection: React.FC<RemindersSectionProps> = ({
  role,
  currentShamsiDate,
}) => {
  const [reminders, setReminders] = useState<UserReminderItem[]>([]);
  const [serverNow, setServerNow] = useState(() => {
    const now = getNowInTimezone('Asia/Tehran');
    return {
      shamsiDate: currentShamsiDate || now.shamsiDate,
      timeHHMM: now.timeHHMM,
    };
  });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  // فیلدهای فرم ثبت / ویرایش یادآوری
  const [title, setTitle] = useState('');
  const [messageText, setMessageText] = useState('');
  const [shamsiDate, setShamsiDate] = useState(currentShamsiDate);
  const [reminderTime, setReminderTime] = useState(() => {
    const now = getNowInTimezone('Asia/Tehran');
    return now.timeHHMM || '09:00';
  });
  const [repeatType, setRepeatType] = useState<ReminderRepeatType>('ONCE');
  const [repeatCount, setRepeatCount] = useState<number>(3);
  const [repeatIntervalMinutes, setRepeatIntervalMinutes] = useState<number>(15);
  const [targetScope, setTargetScope] = useState<ReminderTargetScope>('SELF');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (currentShamsiDate && !shamsiDate) {
      setShamsiDate(currentShamsiDate);
    }
  }, [currentShamsiDate, shamsiDate]);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await apiRequest<{
        ok: boolean;
        serverTime: { shamsiDate: string; timeHHMM: string };
        reminders: UserReminderItem[];
      }>('/api/reminders');
      setReminders(res.reminders || []);
      if (res.serverTime) {
        setServerNow(res.serverTime);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReminders();
    const onExternalUpdate = () => fetchReminders();
    window.addEventListener(REMINDERS_UPDATED_EVENT, onExternalUpdate);
    return () => window.removeEventListener(REMINDERS_UPDATED_EVENT, onExternalUpdate);
  }, [fetchReminders]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setMessageText('');
    setShamsiDate(serverNow.shamsiDate || currentShamsiDate);
    setReminderTime(getNowInTimezone('Asia/Tehran').timeHHMM || '09:00');
    setRepeatType('ONCE');
    setRepeatCount(3);
    setRepeatIntervalMinutes(15);
    setTargetScope('SELF');
  };

  const handleStartEdit = (r: UserReminderItem) => {
    setEditingId(r.id);
    setTitle(r.title);
    setMessageText(r.message_text);
    setShamsiDate(r.shamsi_date);
    setReminderTime(r.reminder_time.slice(0, 5));
    setRepeatType(r.repeat_type);
    setRepeatCount(r.repeat_type === 'ONCE' ? 1 : Math.max(2, r.repeat_count));
    setRepeatIntervalMinutes(r.repeat_interval_minutes || 15);
    setTargetScope(r.target_scope || 'SELF');
    setShowForm(true);
    setFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanMessage = messageText.trim() || title.trim();
    const cleanTitle = title.trim() || cleanMessage.slice(0, 60);
    if (!cleanMessage) {
      setFeedback({
        type: 'error',
        text: 'لطفاً متن دلخواه یادآوری را وارد نمایید.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: cleanTitle,
        message_text: cleanMessage,
        shamsi_date: shamsiDate || currentShamsiDate,
        reminder_time: reminderTime || '09:00',
        repeat_type: repeatType,
        repeat_count: repeatType === 'ONCE' ? 1 : Math.max(1, repeatCount),
        repeat_interval_minutes: repeatIntervalMinutes,
        target_scope: role === 'manager' ? targetScope : 'SELF',
      };

      if (editingId) {
        const res = await apiRequest<{ ok: boolean; message: string }>(
          `/api/reminders/${editingId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        setFeedback({ type: 'success', text: res.message });
      } else {
        const res = await apiRequest<{ ok: boolean; message: string }>('/api/reminders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFeedback({ type: 'success', text: res.message });
      }

      resetForm();
      await fetchReminders();
      notifyRemindersUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (
    reminderId: number,
    action: 'ACKNOWLEDGE' | 'SNOOZE_10M' | 'COMPLETE_ALL' | 'REACTIVATE'
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/reminders/${reminderId}/acknowledge`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await fetchReminders();
      notifyRemindersUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    }
  };

  const handleDelete = async (reminderId: number) => {
    try {
      await apiRequest(`/api/reminders/${reminderId}`, { method: 'DELETE' });
      if (editingId === reminderId) {
        resetForm();
      }
      await fetchReminders();
      notifyRemindersUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    }
  };

  const activeReminders = reminders.filter((r) => !r.is_completed);
  const completedReminders = reminders.filter((r) => r.is_completed);

  return (
    <div className="space-y-4" dir="rtl">
      {/* بخش ۱: فرم ثبت یا ویرایش یادآوری زمان‌بندی‌شده */}
      <div className="rounded-2xl bg-white border-2 border-[#C5A059] p-4 sm:p-5 space-y-3.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#0B192C] text-[#C5A059] flex items-center justify-center shrink-0">
              <AlarmClock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                {editingId ? 'ویرایش یادآوری زمان‌بندی‌شده' : 'ثبت یادآوری هوشمند جدید'}
              </h3>
              <p className="text-[11px] text-slate-500">
                تعیین روز و ساعت برای هر تاریخ دلخواه همراه با متن سفارشی و الگوی تکرار
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (editingId) resetForm();
              else setShowForm((s) => !s);
            }}
            className="min-h-[34px] px-3 rounded-xl bg-[#FCF9F2] text-[#0B192C] border border-[#C5A059] text-xs font-bold hover:bg-[#C5A059]/20 cursor-pointer"
          >
            {editingId ? 'لغو ویرایش' : showForm ? 'بستن فرم' : 'افزودن یادآوری جدید'}
          </button>
        </div>

        {feedback && (
          <div
            className={`rounded-xl p-3 text-xs font-bold flex items-center justify-between gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-red-50 text-red-900 border border-red-200'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-[11px] underline shrink-0 cursor-pointer"
            >
              بستن
            </button>
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/60 p-3.5 sm:p-4 space-y-3.5"
          >
            {/* انتخاب تاریخ (هر تاریخی در تقویم) و ساعت دقیق */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ShamsiDatePicker
                label="انتخاب روز و تاریخ یادآوری (هر تاریخی در تقویم)"
                value={shamsiDate}
                onChange={setShamsiDate}
                todayShamsi={serverNow.shamsiDate || currentShamsiDate}
              />
              <TimePickerInput
                label="ساعت و دقیقه یادآوری"
                value={reminderTime}
                onChange={setReminderTime}
              />
            </div>

            {/* عنوان و متن دلخواه یادآوری */}
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-bold text-[#0B192C] mb-1">
                  عنوان کوتاه یادآوری (اختیاری)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثلاً: پیگیری فاکتور، تماس با مشتری، سررسید چک..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:border-[#0B192C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0B192C] mb-1">
                  متن دلخواه یادآوری (الزامی)
                </label>
                <textarea
                  rows={3}
                  required
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="متن کامل یادآوری یا توضیحات مورد نظر خود را اینجا بنویسید..."
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
                />
              </div>
            </div>

            {/* الگوی تکرار و تعداد دفعات تکرار */}
            <div className="rounded-xl bg-white border border-slate-200 p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0B192C]">
                <Repeat className="w-4 h-4 text-[#9A7428]" />
                <span>نحوه و تعداد تکرار یادآوری</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {REPEAT_TYPE_OPTIONS.map((opt) => {
                  const active = repeatType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setRepeatType(opt.value);
                        if (opt.value === 'ONCE') {
                          setRepeatCount(1);
                        } else if (repeatCount <= 1) {
                          setRepeatCount(3);
                        }
                        if (opt.value === 'EVERY_N_DAYS' && repeatIntervalMinutes > 30) {
                          setRepeatIntervalMinutes(2);
                        } else if (opt.value === 'SAME_DAY_INTERVAL' && repeatIntervalMinutes < 5) {
                          setRepeatIntervalMinutes(15);
                        }
                      }}
                      className={`rounded-xl border p-2.5 text-right transition-all cursor-pointer ${
                        active
                          ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059] shadow-2xs'
                          : 'bg-slate-50/70 hover:bg-[#FCF9F2] text-slate-700 border-slate-200'
                      }`}
                    >
                      <div className="text-xs font-extrabold">{opt.label}</div>
                      <div
                        className={`text-[10px] mt-0.5 leading-4 ${
                          active ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* تنظیمات تکمیلی در صورت انتخاب حالت‌های تکراردار */}
              {repeatType !== 'ONCE' && (
                <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  {/* اگر تکرار چندباره در همان روز باشد: انتخاب فاصله زمانی به دقیقه */}
                  {repeatType === 'SAME_DAY_INTERVAL' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        فاصله زمانی بین هر تکرار (دقیقه)
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        {[5, 10, 15, 30, 60, 120].map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => setRepeatIntervalMinutes(mins)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                              repeatIntervalMinutes === mins
                                ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            هر {toPersianDigits(mins)} دقیقه
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={repeatIntervalMinutes}
                        onChange={(e) =>
                          setRepeatIntervalMinutes(Math.max(1, Number(e.target.value) || 15))
                        }
                        className="w-full min-h-[38px] rounded-xl border border-slate-200 px-3 text-xs font-bold text-center"
                      />
                    </div>
                  )}

                  {/* اگر تکرار هر N روز یک‌بار باشد */}
                  {repeatType === 'EVERY_N_DAYS' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        فاصله روزها بین هر تکرار (هر چند روز یک‌بار؟)
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        {[2, 3, 4, 5, 10, 15].map((days) => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => setRepeatIntervalMinutes(days)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                              repeatIntervalMinutes === days
                                ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            هر {toPersianDigits(days)} روز
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={repeatIntervalMinutes}
                        onChange={(e) =>
                          setRepeatIntervalMinutes(Math.max(1, Number(e.target.value) || 2))
                        }
                        className="w-full min-h-[38px] rounded-xl border border-slate-200 px-3 text-xs font-bold text-center"
                      />
                    </div>
                  )}

                  {/* تعداد کل دفعات تکرار */}
                  <div className={repeatType === 'SAME_DAY_INTERVAL' || repeatType === 'EVERY_N_DAYS' ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      تعداد کل دفعات تکرار (چند بار یادآوری شود؟)
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {[2, 3, 5, 7, 10, 15, 30].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setRepeatCount(cnt)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                            repeatCount === cnt
                              ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                              : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {toPersianDigits(cnt)} بار
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={2}
                        max={365}
                        value={repeatCount}
                        onChange={(e) =>
                          setRepeatCount(Math.min(365, Math.max(2, Number(e.target.value) || 2)))
                        }
                        className="w-28 min-h-[38px] rounded-xl border border-slate-200 px-3 text-xs font-bold text-center"
                      />
                      <span className="text-xs text-slate-600 font-medium">
                        مرتبه در مجموع یادآوری شود
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* انتخاب مخاطب یادآوری (ویژه مدیر) */}
            {role === 'manager' && (
              <div className="rounded-xl bg-white border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B192C]">
                  <Users className="w-4 h-4 text-[#9A7428]" />
                  <span>نمایش این یادآوری برای:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'SELF' as const, label: 'فقط خودم (مدیریت)' },
                    { id: 'BOTH' as const, label: 'مدیریت و پرسنل همزمان' },
                    { id: 'WORKER' as const, label: 'ارسال یادآوری برای پرسنل' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTargetScope(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                        targetScope === item.id
                          ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-xl bg-[#0B192C] hover:bg-[#142844] text-[#C5A059] border border-[#C5A059] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'در حال ذخیره...'
                    : editingId
                      ? 'ذخیره تغییرات یادآوری'
                      : 'ثبت و فعال‌سازی یادآوری'}
                </span>
              </button>

              {(title || messageText || editingId) && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="min-h-[44px] px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  پاکسازی فرم
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* بخش ۲: فهرست یادآوری‌های فعال و زمان‌بندی‌شده */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[#9A7428]" />
            <h4 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
              یادآوری‌های فعال و در نوبت اجرا ({toPersianDigits(activeReminders.length)})
            </h4>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
            زمان فعلی سامانه: {toPersianDigits(serverNow.shamsiDate)} ساعت{' '}
            {toPersianDigits(serverNow.timeHHMM)}
          </span>
        </div>

        {loading ? (
          <div className="text-xs text-slate-400 text-center py-4">
            در حال بارگذاری یادآوری‌ها...
          </div>
        ) : activeReminders.length === 0 ? (
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-center text-xs text-slate-500">
            در حال حاضر یادآوری فعالی ثبت نشده است. از فرم بالا می‌توانید برای هر تاریخ و ساعتی یادآوری ثبت کنید.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeReminders.map((r) => {
              const isDue = isReminderCurrentlyDue(
                r,
                serverNow.shamsiDate || currentShamsiDate,
                serverNow.timeHHMM
              );
              const dayName = getShamsiDayOfWeekName(r.next_trigger_shamsi);
              const verboseNextDate = formatShamsiVerbose(r.next_trigger_shamsi);

              return (
                <div
                  key={r.id}
                  className={`rounded-2xl border-2 p-3.5 space-y-2.5 flex flex-col justify-between transition-all ${
                    isDue
                      ? 'bg-amber-50/90 border-amber-500 shadow-sm'
                      : 'bg-[#FCF9F2]/60 border-[#C5A059]/70'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold flex items-center gap-1 ${
                            isDue
                              ? 'bg-amber-600 text-white animate-pulse'
                              : 'bg-[#0B192C] text-[#C5A059]'
                          }`}
                        >
                          <AlarmClock className="w-3 h-3" />
                          <span>{isDue ? 'سررسید شده (در حال اعلان)' : 'زمان‌بندی‌شده'}</span>
                        </span>

                        <span className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-700">
                          {formatReminderRepeatSummary(r)}
                        </span>

                        {r.repeat_count > 1 && (
                          <span className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[10px] font-extrabold text-indigo-900 tabular-nums">
                            نوبت {toPersianDigits(r.triggered_count + 1)} از{' '}
                            {toPersianDigits(r.repeat_count)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(r)}
                          title="ویرایش یادآوری"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#0B192C] hover:bg-white cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          title="حذف یادآوری"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                        {r.title}
                      </div>
                      {r.message_text && r.message_text !== r.title && (
                        <div className="text-xs text-slate-700 leading-6 whitespace-pre-line bg-white/80 rounded-xl p-2.5 border border-slate-200/70">
                          {r.message_text}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl bg-white border border-slate-200/80 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                        <Calendar className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>
                          موعد بعدی: {dayName} {verboseNextDate} (
                          {toPersianDigits(r.next_trigger_shamsi)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1 font-extrabold text-[#0B192C] tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>ساعت {toPersianDigits(r.next_trigger_time.slice(0, 5))}</span>
                      </div>
                    </div>
                  </div>

                  {/* دکمه‌های عملیاتی کارت یادآوری */}
                  <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-end gap-1.5">
                    {isDue && (
                      <button
                        type="button"
                        onClick={() => handleAction(r.id, 'SNOOZE_10M')}
                        className="min-h-[32px] px-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-700 cursor-pointer"
                      >
                        تعویق ۱۰ دقیقه‌ای
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleAction(r.id, 'ACKNOWLEDGE')}
                      className="min-h-[32px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>
                        {r.repeat_count > 1 && r.triggered_count + 1 < r.repeat_count
                          ? `ثبت نوبت ${toPersianDigits(r.triggered_count + 1)} و رفتن به نوبت بعد`
                          : 'انجام شد (انتقال به آرشیو)'}
                      </span>
                    </button>

                    {r.repeat_count > 1 && r.triggered_count + 1 < r.repeat_count && (
                      <button
                        type="button"
                        onClick={() => handleAction(r.id, 'COMPLETE_ALL')}
                        className="min-h-[32px] px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10.5px] font-bold cursor-pointer"
                      >
                        پایان کل تکرارها
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* بخش ۳: آرشیو یادآوری‌های انجام‌شده */}
      {completedReminders.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs sm:text-sm font-bold text-[#0B192C]">
              آرشیو یادآوری‌های پایان‌یافته ({toPersianDigits(completedReminders.length)})
            </h4>
          </div>

          <div className="space-y-1.5">
            {completedReminders.map((r) => (
              <div
                key={r.id}
                className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-600 line-through">{r.title}</div>
                  {r.message_text && r.message_text !== r.title && (
                    <div className="text-[11px] text-slate-500">{r.message_text}</div>
                  )}
                  <div className="text-[10px] text-slate-400 tabular-nums">
                    تاریخ اولیه: {toPersianDigits(r.shamsi_date)} ساعت{' '}
                    {toPersianDigits(r.reminder_time)} · {formatReminderRepeatSummary(r)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAction(r.id, 'REACTIVATE')}
                    className="min-h-[28px] px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10.5px] font-bold text-[#0B192C] flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 text-[#9A7428]" />
                    <span>فعال‌سازی مجدد</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// کامپوننت دکمه هدر + پایشگر خودکار سررسید یادآوری‌ها با پاپ‌آپ هشدار صوتی
// ============================================================================
interface HeaderRemindersManagerProps {
  role: UserRole;
  serverShamsiDate: string;
}

export const HeaderRemindersManager: React.FC<HeaderRemindersManagerProps> = ({
  role,
  serverShamsiDate,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [dueReminders, setDueReminders] = useState<UserReminderItem[]>([]);
  const notifiedKeySetRef = useRef<Set<string>>(new Set());

  const checkDueReminders = useCallback(async () => {
    try {
      const res = await apiRequest<{
        ok: boolean;
        serverTime: { shamsiDate: string; timeHHMM: string };
        reminders: UserReminderItem[];
      }>('/api/reminders');

      const list = res.reminders || [];
      const activeList = list.filter((r) => !r.is_completed && r.is_active);
      setActiveCount(activeList.length);

      const nowDate = res.serverTime?.shamsiDate || serverShamsiDate;
      const nowTime =
        res.serverTime?.timeHHMM || getNowInTimezone('Asia/Tehran').timeHHMM || '09:00';

      const currentlyDue = activeList.filter((r) =>
        isReminderCurrentlyDue(r, nowDate, nowTime)
      );
      setDueReminders(currentlyDue);

      for (const due of currentlyDue) {
        const key = `${due.id}_${due.next_trigger_shamsi}_${due.next_trigger_time}_${due.triggered_count}`;
        if (!notifiedKeySetRef.current.has(key)) {
          notifiedKeySetRef.current.add(key);
          playAlertChimeAndVibrate();
          triggerNativePhoneNotification({
            tag: `reminder-${key}`,
            title: `⏰ یادآوری: ${due.title}`,
            body: due.message_text || due.title,
          });
        }
      }
    } catch {
      // ignore background polling error
    }
  }, [serverShamsiDate]);

  useEffect(() => {
    checkDueReminders();
    const timer = setInterval(checkDueReminders, 20000);
    const onUpdated = () => checkDueReminders();
    window.addEventListener(REMINDERS_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REMINDERS_UPDATED_EVENT, onUpdated);
    };
  }, [checkDueReminders]);

  const handleQuickAcknowledge = async (
    reminderId: number,
    action: 'ACKNOWLEDGE' | 'SNOOZE_10M' | 'COMPLETE_ALL'
  ) => {
    try {
      await apiRequest(`/api/reminders/${reminderId}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await checkDueReminders();
      notifyRemindersUpdated();
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* دکمه باز کردن سریع بخش یادآوری‌ها در نوار بالای برنامه */}
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        title="بخش یادآوری‌های زمان‌بندی‌شده"
        className={`relative min-h-[38px] px-2.5 sm:px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
          dueReminders.length > 0
            ? 'bg-amber-500 text-[#0B192C] border-amber-600 animate-pulse'
            : 'bg-[#FCF9F2] hover:bg-[#C5A059]/20 text-[#0B192C] border-[#C5A059]/60'
        }`}
      >
        <AlarmClock className="w-3.5 h-3.5 text-[#9A7428] shrink-0" />
        <span className="hidden md:inline">یادآوری</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-md bg-[#0B192C] text-[#C5A059] text-[10px] font-extrabold tabular-nums">
            {toPersianDigits(activeCount)}
          </span>
        )}
      </button>

      {/* پاپ‌آپ هشدار سررسید یادآوری (در لحظه رسیدن تاریخ و ساعت تعیین‌شده) - رندر در سطح کل صفحه با Portal */}
      {dueReminders.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
            dir="rtl"
          >
            <div className="w-full max-w-md rounded-3xl bg-white border-2 border-[#C5A059] p-5 shadow-2xl space-y-4 text-[#0B192C]">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-amber-500 text-[#0B192C] flex items-center justify-center animate-bounce shrink-0">
                    <AlarmClock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0B192C]">
                      فرارسیدن زمان یادآوری
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {toPersianDigits(dueReminders[0].next_trigger_shamsi)} — ساعت{' '}
                      {toPersianDigits(dueReminders[0].next_trigger_time.slice(0, 5))}
                    </p>
                  </div>
                </div>

                {dueReminders[0].repeat_count > 1 && (
                  <span className="px-2.5 py-1 rounded-xl bg-[#0B192C] text-[#C5A059] text-[11px] font-extrabold tabular-nums">
                    نوبت {toPersianDigits(dueReminders[0].triggered_count + 1)} از{' '}
                    {toPersianDigits(dueReminders[0].repeat_count)}
                  </span>
                )}
              </div>

              <div className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/60 p-4 space-y-1.5">
                <div className="text-sm font-extrabold text-[#0B192C]">
                  {dueReminders[0].title}
                </div>
                {dueReminders[0].message_text &&
                  dueReminders[0].message_text !== dueReminders[0].title && (
                    <div className="text-xs text-slate-700 leading-6 whitespace-pre-line pt-1">
                      {dueReminders[0].message_text}
                    </div>
                  )}
                <div className="pt-2 text-[11px] font-semibold text-[#9A7428]">
                  الگوی تکرار: {formatReminderRepeatSummary(dueReminders[0])}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickAcknowledge(dueReminders[0].id, 'ACKNOWLEDGE')}
                  className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>
                    {dueReminders[0].repeat_count > 1 &&
                    dueReminders[0].triggered_count + 1 < dueReminders[0].repeat_count
                      ? 'متوجه شدم (تنظیم نوبت بعدی)'
                      : 'متوجه شدم (اتمام یادآوری)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickAcknowledge(dueReminders[0].id, 'SNOOZE_10M')}
                  className="min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B192C] border border-slate-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-[#9A7428]" />
                  <span>یادآوری مجدد ۱۰ دقیقه دیگر</span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* مودال کامل مدیریت یادآوری‌ها با دسترسی سریع از هدر - رندر در سطح کل صفحه با Portal */}
      {isModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
            dir="rtl"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#F9FAFB] border-2 border-[#C5A059] p-4 sm:p-6 shadow-2xl space-y-4 text-[#0B192C]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3 sticky top-0 bg-[#F9FAFB] z-10">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-[#0B192C] text-[#C5A059] flex items-center justify-center">
                    <AlarmClock className="w-4 h-4" />
                  </span>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-[#0B192C]">
                      بخش یادآوری‌های هوشمند و زمان‌بندی‌شده
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      ثبت یادآوری با متن دلخواه برای هر تاریخ و ساعت با قابلیت تعیین الگوی تکرار
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:text-red-600 cursor-pointer"
                  title="بستن پنجره یادآوری"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <RemindersSection role={role} currentShamsiDate={serverShamsiDate} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
