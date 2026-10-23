import React, { useEffect, useState } from 'react';
import { LeaveQuotaSummary, LeaveRequestItem, LeaveType, UserRole } from '../shared/types';
import { apiRequest } from '../services/api';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { TimePickerInput } from './TimePickerInput';
import { formatDurationPersian, toPersianDigits } from '../shared/jalali';
import { CalendarOff, CheckCircle2, XCircle, Clock, Sun, Timer } from 'lucide-react';

interface LeaveManagementSectionProps {
  role: UserRole;
  currentShamsiDate: string;
  externalRequestType?: LeaveType | null;
  onExternalRequestHandled?: () => void;
  onUpdated?: () => void;
  hideTriggerButtons?: boolean;
}

export const LeaveManagementSection: React.FC<LeaveManagementSectionProps> = ({
  role,
  currentShamsiDate,
  externalRequestType,
  onExternalRequestHandled,
  onUpdated,
  hideTriggerButtons = false,
}) => {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [quota, setQuota] = useState<LeaveQuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [shamsiDate, setShamsiDate] = useState(currentShamsiDate);
  const [leaveType, setLeaveType] = useState<LeaveType>('DAILY');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchLeaves = async () => {
    try {
      const res = await apiRequest<{
        ok: boolean;
        leaveRequests: LeaveRequestItem[];
        quotaSummary: LeaveQuotaSummary;
      }>('/api/leaves');
      setLeaveRequests(res.leaveRequests);
      setQuota(res.quotaSummary);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaves();
  }, []);

  useEffect(() => {
    if (externalRequestType) {
      setLeaveType(externalRequestType);
      setShowForm(true);
      onExternalRequestHandled?.();
    }
  }, [externalRequestType, onExternalRequestHandled]);

  const handleOpenType = (type: LeaveType) => {
    if (showForm && leaveType === type) {
      setShowForm(false);
    } else {
      setLeaveType(type);
      setShowForm(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/leaves', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: shamsiDate,
          leave_type: leaveType,
          start_time: leaveType === 'HOURLY' ? startTime : null,
          end_time: leaveType === 'HOURLY' ? endTime : null,
          reason,
        }),
      });
      setFeedback({ type: 'success', text: res.message });
      setReason('');
      setShowForm(false);
      await fetchLeaves();
      onUpdated?.();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/leaves/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setFeedback({ type: 'success', text: res.message });
      await fetchLeaves();
      onUpdated?.();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    }
  };

  return (
    <div id="leave-management-section" className="rounded-2xl bg-white border border-[#C5A059]/45 p-3.5 space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarOff className="w-3.5 h-3.5 text-[#C5A059]" />
          <h3 className="text-xs font-bold text-[#0B192C]">
            وضعیت سهمیه و سوابق مرخصی
          </h3>
        </div>

        {/* فقط پرسنل درخواست مرخصی ثبت می‌کند و مدیر صرفاً تأیید یا رد می‌نماید */}
        {role === 'worker' && !hideTriggerButtons && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => handleOpenType('DAILY')}
              className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs ${
                showForm && leaveType === 'DAILY'
                  ? 'bg-teal-800 text-white ring-2 ring-teal-400'
                  : 'bg-teal-600 hover:bg-teal-700 text-white'
              }`}
            >
              <Sun className="w-3 h-3" />
              <span>درخواست مرخصی روزانه</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenType('HOURLY')}
              className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs ${
                showForm && leaveType === 'HOURLY'
                  ? 'bg-sky-800 text-white ring-2 ring-sky-400'
                  : 'bg-sky-600 hover:bg-sky-700 text-white'
              }`}
            >
              <Timer className="w-3 h-3" />
              <span>درخواست مرخصی ساعتی</span>
            </button>
          </div>
        )}
      </div>

      {/* شمارنده سهمیه مرخصی استحقاقی ماهانه */}
      {quota && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/40 p-2 text-center">
            <div className="text-[10px] text-slate-500">سقف مجاز ماهانه</div>
            <div className="text-[11px] font-extrabold text-[#0B192C] mt-0.5">
              {toPersianDigits(quota.monthlyQuotaDays)} روز
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center">
            <div className="text-[10px] text-slate-500">استفاده‌شده این ماه</div>
            <div className="text-[11px] font-extrabold text-amber-800 mt-0.5">
              {quota.usedCurrentMonthDaysFormatted}
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-2 text-center">
            <div className="text-[10px] text-emerald-800">مانده مرخصی ماه</div>
            <div className="text-[11px] font-extrabold text-emerald-900 mt-0.5">
              {quota.remainingMonthDaysFormatted}
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] underline mr-2 cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {/* فرم ثبت درخواست مرخصی */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className={`rounded-2xl border p-3.5 space-y-3 ${
            leaveType === 'DAILY'
              ? 'bg-teal-50/50 border-teal-300'
              : 'bg-sky-50/50 border-sky-300'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
            <span className="text-xs font-extrabold text-[#0B192C]">
              {leaveType === 'DAILY' ? 'فرم درخواست مرخصی روزانه' : 'فرم درخواست مرخصی ساعتی'}
            </span>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              بستن فرم
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ShamsiDatePicker
              label="تاریخ مرخصی"
              value={shamsiDate}
              onChange={setShamsiDate}
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                نوع مرخصی انتخاب‌شده
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setLeaveType('DAILY')}
                  className={`min-h-[36px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    leaveType === 'DAILY'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 hover:text-[#0B192C]'
                  }`}
                >
                  روزانه کامل
                </button>
                <button
                  type="button"
                  onClick={() => setLeaveType('HOURLY')}
                  className={`min-h-[36px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    leaveType === 'HOURLY'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 hover:text-[#0B192C]'
                  }`}
                >
                  ساعتی
                </button>
              </div>
            </div>
          </div>

          {leaveType === 'HOURLY' && (
            <div className="grid grid-cols-2 gap-3">
              <TimePickerInput
                label="از ساعت"
                value={startTime}
                onChange={setStartTime}
              />
              <TimePickerInput
                label="تا ساعت"
                value={endTime}
                onChange={setEndTime}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              علت یا توضیحات مرخصی
            </label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثلاً: مراجعه به پزشک یا کار اداری..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full min-h-[42px] rounded-xl text-white text-xs font-bold disabled:opacity-50 cursor-pointer ${
              leaveType === 'DAILY'
                ? 'bg-teal-600 hover:bg-teal-700'
                : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            {submitting
              ? 'در حال ثبت...'
              : leaveType === 'DAILY'
                ? 'ثبت درخواست مرخصی روزانه'
                : 'ثبت درخواست مرخصی ساعتی'}
          </button>
        </form>
      )}

      {/* لیست مرخصی‌ها */}
      {loading ? (
        <div className="text-xs text-slate-400 text-center py-3">در حال بارگذاری مرخصی‌ها...</div>
      ) : leaveRequests.length === 0 ? (
        <div className="text-xs text-slate-500 text-center py-3">
          تاکنون مرخصی ثبت نشده است.
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {leaveRequests.map((lv) => (
            <div
              key={lv.id}
              className={`rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                lv.status === 'PENDING'
                  ? 'bg-[#FCF9F2] border-[#C5A059]'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#0B192C]">
                  {lv.status === 'PENDING' && (
                    <span className="w-2 h-2 rounded-full bg-[#C5A059] animate-ping inline-block" />
                  )}
                  <span>{toPersianDigits(lv.shamsi_date)}</span>
                  <span>·</span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] ${
                      lv.leave_type === 'HOURLY'
                        ? 'bg-sky-100 text-sky-900'
                        : 'bg-teal-100 text-teal-900'
                    }`}
                  >
                    {lv.leave_type === 'HOURLY'
                      ? `مرخصی ساعتی (${toPersianDigits(lv.start_time || '')} تا ${toPersianDigits(lv.end_time || '')})`
                      : 'مرخصی روزانه'}
                  </span>
                  <span>·</span>
                  <span className="text-slate-600 font-normal">
                    ({formatDurationPersian(lv.duration_minutes)})
                  </span>
                </div>
                <div className="text-xs text-slate-700">{lv.reason}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {lv.status === 'PENDING' && role === 'manager' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleReview(lv.id, 'APPROVED')}
                      className="min-h-[34px] px-3 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>تأیید</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReview(lv.id, 'REJECTED')}
                      className="min-h-[34px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>رد</span>
                    </button>
                  </>
                ) : (
                  <span
                    className={`text-[11px] font-bold flex items-center gap-1 ${
                      lv.status === 'APPROVED'
                        ? 'text-emerald-700'
                        : lv.status === 'REJECTED'
                          ? 'text-red-600'
                          : 'text-amber-700'
                    }`}
                  >
                    {lv.status === 'APPROVED' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تأییدشده</span>
                      </>
                    ) : lv.status === 'REJECTED' ? (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        <span>ردشده</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        <span>در انتظار تأیید مدیریت</span>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
