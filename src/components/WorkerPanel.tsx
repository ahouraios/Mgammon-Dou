import React, { useCallback, useEffect, useState } from 'react';
import {
  AttendanceEventType,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialTransaction,
  FinancialTxType,
  UserProfile,
  WorkerLiveState,
} from '../shared/types';
import {
  apiRequest,
  EVENT_TYPE_LABELS,
  STATUS_LABELS,
  TX_TYPE_LABELS,
} from '../services/api';
import {
  formatMinutesToDurationPersian,
  formatMinutesToHHMM,
  formatShamsiVerbose,
  formatToman,
  toPersianDigits,
} from '../shared/jalali';
import { WorkerStatusAvatar } from './WorkerStatusAvatar';
import {
  Clock,
  FileText,
  Wallet,
  Briefcase,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';

interface WorkerPanelProps {
  user: UserProfile;
  initialShamsiDate: string;
}

type WorkerTab = 'attendance' | 'reports' | 'finance';

export const WorkerPanel: React.FC<WorkerPanelProps> = ({ initialShamsiDate }) => {
  const [activeTab, setActiveTab] = useState<WorkerTab>('attendance');
  const [liveState, setLiveState] = useState<WorkerLiveState | null>(null);
  const [serverShamsiDate, setServerShamsiDate] = useState(initialShamsiDate);
  const [serverTimeHHMM, setServerTimeHHMM] = useState('');
  const [historySummaries, setHistorySummaries] = useState<DailyAttendanceSummary[]>([]);
  const [reports, setReports] = useState<DailyWorkReport[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [financeTotals, setFinanceTotals] = useState({
    approvedTotalToman: 0,
    pendingTotalToman: 0,
    pendingCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // فرم ثبت تردد
  const [attendanceNote, setAttendanceNote] = useState('');

  // فرم گزارش روزانه
  const [reportDesc, setReportDesc] = useState('');
  const [reportDuration, setReportDuration] = useState('');
  const [reportShamsiDate, setReportShamsiDate] = useState(initialShamsiDate);

  // فرم درخواست مالی
  const [finAmount, setFinAmount] = useState('');
  const [finType, setFinType] = useState<FinancialTxType>('ADVANCE');
  const [finDate, setFinDate] = useState(initialShamsiDate);
  const [finDesc, setFinDesc] = useState('');

  const loadAllWorkerData = useCallback(async () => {
    try {
      const [liveRes, histRes, repRes, finRes] = await Promise.all([
        apiRequest<{
          ok: boolean;
          serverTime: { shamsiDate: string; timeHHMM: string };
          liveState: WorkerLiveState;
        }>('/api/attendance/live-status'),
        apiRequest<{ ok: boolean; dailySummaries: DailyAttendanceSummary[] }>(
          '/api/attendance/history'
        ),
        apiRequest<{ ok: boolean; reports: DailyWorkReport[] }>('/api/reports'),
        apiRequest<{
          ok: boolean;
          transactions: FinancialTransaction[];
          summary: {
            approvedTotalToman: number;
            pendingTotalToman: number;
            pendingCount: number;
          };
        }>('/api/finance'),
      ]);

      setLiveState(liveRes.liveState);
      setServerShamsiDate(liveRes.serverTime.shamsiDate);
      setServerTimeHHMM(liveRes.serverTime.timeHHMM);
      setHistorySummaries(histRes.dailySummaries);
      setReports(repRes.reports);
      setTransactions(finRes.transactions);
      setFinanceTotals(finRes.summary);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllWorkerData();
  }, [loadAllWorkerData]);

  const handleClockEvent = async (eventType: AttendanceEventType) => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        message: string;
        liveState: WorkerLiveState;
      }>('/api/attendance/clock', {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          note: attendanceNote.trim() || undefined,
        }),
      });
      setLiveState(res.liveState);
      setAttendanceNote('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          activity_description: reportDesc,
          duration_minutes: reportDuration ? reportDuration : null,
          shamsi_date: reportShamsiDate,
        }),
      });
      setReportDesc('');
      setReportDuration('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/finance/worker-request', {
        method: 'POST',
        body: JSON.stringify({
          amount_toman: finAmount,
          tx_type: finType,
          shamsi_date: finDate,
          description: finDesc,
        }),
      });
      setFinAmount('');
      setFinDesc('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const allowedEvents = liveState?.allowed_next_events || [];

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-20 sm:pb-10 space-y-5">
      {/* نوار اطلاعات تاریخ شمسی و بروزرسانی */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border border-[#C5A059]/35 px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-bold text-[#0B192C]">
            {serverShamsiDate ? formatShamsiVerbose(serverShamsiDate) : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{toPersianDigits(serverShamsiDate)}</span>
          {serverTimeHHMM && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">ساعت سرور: {toPersianDigits(serverTimeHHMM)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={loadAllWorkerData}
          className="min-h-[38px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] text-xs font-medium text-[#0B192C] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#C5A059]" />
          <span>بروزرسانی اطلاعات</span>
        </button>
      </div>

      {/* نمایش وضعیت فعلی نیرو */}
      {liveState && (
        <WorkerStatusAvatar
          status={liveState.status}
          statusText={liveState.status_text}
          statusDetail={liveState.status_detail}
          isOvertimeActive={liveState.is_overtime_active}
        />
      )}

      {/* پیام تأیید یا خطای سرور */}
      {feedback && (
        <div
          role="alert"
          className={`rounded-2xl border p-4 text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline shrink-0 cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {/* تب‌های ناوبری پنل نیروی کاری */}
      <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-[#0B192C] border border-[#C5A059]/40">
        <button
          type="button"
          onClick={() => setActiveTab('attendance')}
          className={`min-h-[44px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'attendance'
              ? 'bg-[#C5A059] text-[#0B192C] shadow-xs'
              : 'text-slate-200 hover:text-white'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span>ثبت تردد و کارکرد</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className={`min-h-[44px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'reports'
              ? 'bg-[#C5A059] text-[#0B192C] shadow-xs'
              : 'text-slate-200 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span>گزارش روزانه</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('finance')}
          className={`min-h-[44px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'finance'
              ? 'bg-[#C5A059] text-[#0B192C] shadow-xs'
              : 'text-slate-200 hover:text-white'
          }`}
        >
          <Wallet className="w-4 h-4 shrink-0" />
          <span>دریافتی و مالی</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-xs text-slate-500">
          در حال دریافت اطلاعات از پایگاه داده MySQL...
        </div>
      ) : (
        <>
          {/* بخش ۱: ثبت تردد و سوابق کارکرد */}
          {activeTab === 'attendance' && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-white border border-[#C5A059]/45 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-[#0B192C]">ثبت عملیات تردد لحظه‌ای</h3>
                  <span className="text-xs text-slate-500">
                    ثبت مستقیم و اعتبارسنجی‌شده در سرور
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    توضیح اختیاری تردد (مثلاً مقصد مأموریت یا توضیح ورود)
                  </label>
                  <input
                    type="text"
                    value={attendanceNote}
                    onChange={(e) => setAttendanceNote(e.target.value)}
                    placeholder="در صورت نیاز توضیح کوتاهی بنویسید..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                {/* چهار دکمه اصلی عملیات تردد با لمس راحت موبایل */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    disabled={actionLoading || !allowedEvents.includes('WORK_START')}
                    onClick={() => handleClockEvent('WORK_START')}
                    className="min-h-[52px] rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 px-4 py-3 text-xs font-bold flex items-center justify-between disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[#142844] transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Play className="w-4 h-4 text-emerald-400" />
                      <span>شروع کار</span>
                    </span>
                    <span className="text-[11px] font-normal text-slate-300">
                      {allowedEvents.includes('WORK_START') ? 'آماده ثبت' : 'غیرفعال در این وضعیت'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading || !allowedEvents.includes('MISSION_START')}
                    onClick={() => handleClockEvent('MISSION_START')}
                    className="min-h-[52px] rounded-xl bg-white text-[#0B192C] border border-[#0B192C]/30 hover:border-[#C5A059] px-4 py-3 text-xs font-bold flex items-center justify-between disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-purple-600" />
                      <span>شروع مأموریت</span>
                    </span>
                    <span className="text-[11px] font-normal text-slate-500">
                      {allowedEvents.includes('MISSION_START') ? 'آماده ثبت' : 'نیازمند شروع کار'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading || !allowedEvents.includes('MISSION_END')}
                    onClick={() => handleClockEvent('MISSION_END')}
                    className="min-h-[52px] rounded-xl bg-white text-[#0B192C] border border-[#0B192C]/30 hover:border-[#C5A059] px-4 py-3 text-xs font-bold flex items-center justify-between disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-amber-600" />
                      <span>پایان مأموریت و بازگشت به محل کار</span>
                    </span>
                    <span className="text-[11px] font-normal text-slate-500">
                      {allowedEvents.includes('MISSION_END') ? 'آماده ثبت' : 'غیرفعال'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading || !allowedEvents.includes('WORK_END')}
                    onClick={() => handleClockEvent('WORK_END')}
                    className="min-h-[52px] rounded-xl bg-slate-900 text-white border border-slate-700 px-4 py-3 text-xs font-bold flex items-center justify-between disabled:opacity-35 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Square className="w-4 h-4 text-rose-400" />
                      <span>پایان کار</span>
                    </span>
                    <span className="text-[11px] font-normal text-slate-300">
                      {allowedEvents.includes('WORK_END') ? 'آماده ثبت' : 'غیرفعال'}
                    </span>
                  </button>
                </div>

                {/* خلاصه کارکرد امروز */}
                {liveState?.today_summary && (
                  <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">اولین ورود امروز</div>
                      <div className="mt-1 font-bold text-[#0B192C] tabular-nums">
                        {liveState.today_summary.first_in_time
                          ? toPersianDigits(liveState.today_summary.first_in_time)
                          : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">پایان کار</div>
                      <div className="mt-1 font-bold text-[#0B192C] tabular-nums">
                        {liveState.today_summary.last_out_time
                          ? toPersianDigits(liveState.today_summary.last_out_time)
                          : 'در جریان'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">کارکرد خالص امروز</div>
                      <div className="mt-1 font-bold text-[#0B192C] tabular-nums">
                        {formatMinutesToDurationPersian(
                          liveState.today_summary.provisional_work_minutes
                        )}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">اضافه‌کاری امروز</div>
                      <div className="mt-1 font-bold text-[#9A7428] tabular-nums">
                        {formatMinutesToDurationPersian(liveState.today_summary.overtime_minutes)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* جدول سوابق تردد اخیر */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C]">سوابق ترددهای ثبت‌شده</h3>
                {historySummaries.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    هنوز رکورد ترددی در سامانه ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {historySummaries.map((day) => (
                      <div key={day.work_date} className="py-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-[#0B192C] tabular-nums">
                              {toPersianDigits(day.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-600">{day.day_name}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                day.is_incomplete
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-600'
                              }
                            >
                              {day.status_label}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs tabular-nums">
                            <span className="text-slate-700">
                              کارکرد قطعی:{' '}
                              <strong>{formatMinutesToHHMM(day.net_work_minutes)}</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#9A7428]">
                              اضافه‌کاری: <strong>{formatMinutesToHHMM(day.overtime_minutes)}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                          {day.logs.map((l) => (
                            <span key={l.id} className="tabular-nums">
                              {EVENT_TYPE_LABELS[l.event_type]}:{' '}
                              <strong className="text-[#0B192C]">
                                {toPersianDigits(l.recorded_time.slice(0, 5))}
                              </strong>
                              {l.note ? ` (${l.note})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* بخش ۲: ثبت و مشاهده گزارش کار روزانه */}
          {activeTab === 'reports' && (
            <div className="space-y-5">
              <form
                onSubmit={handleReportSubmit}
                className="rounded-2xl bg-white border border-[#C5A059]/45 p-5 shadow-xs space-y-4"
              >
                <h3 className="text-sm font-bold text-[#0B192C] border-b border-slate-100 pb-3">
                  ثبت گزارش فعالیت روزانه
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      تاریخ گزارش (شمسی YYYY/MM/DD)
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={reportShamsiDate}
                      onChange={(e) => setReportShamsiDate(e.target.value)}
                      placeholder="1405/07/30"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs text-right tabular-nums focus:outline-none focus:border-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      مدت زمان صرف‌شده به دقیقه (اختیاری)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={reportDuration}
                      onChange={(e) => setReportDuration(e.target.value)}
                      placeholder="مثلاً ۱۲۰"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs tabular-nums focus:outline-none focus:border-[#0B192C]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    شرح کامل فعالیت انجام‌شده
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    placeholder="جزئیات امور انجام‌شده در این روز را بنویسید..."
                    className="w-full rounded-xl border border-slate-300 p-3.5 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full sm:w-auto min-h-[44px] px-6 rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 text-xs font-semibold hover:bg-[#152944] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {actionLoading ? 'در حال ذخیره...' : 'ثبت گزارش روزانه'}
                </button>
              </form>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C]">سوابق گزارش‌های روزانه</h3>
                {reports.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    هنوز گزارش کاری ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {reports.map((rep) => (
                      <div key={rep.id} className="py-3.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#0B192C]">
                              {toPersianDigits(rep.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>ساعت ثبت: {toPersianDigits(rep.recorded_time.slice(0, 5))}</span>
                          </div>
                          {rep.duration_minutes && (
                            <span className="text-[#9A7428] font-medium">
                              مدت فعالیت: {formatMinutesToDurationPersian(rep.duration_minutes)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-800 leading-6 whitespace-pre-line">
                          {rep.activity_description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* بخش ۳: ثبت دریافتی و درخواست پرداخت */}
          {activeTab === 'finance' && (
            <div className="space-y-5">
              {/* خلاصه وضعیت مالی نیرو */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white border border-[#C5A059]/45 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">مجموع دریافتی‌های قطعی (تأییدشده)</div>
                  <div className="mt-1.5 text-lg font-bold text-[#0B192C] tabular-nums">
                    {formatToman(financeTotals.approvedTotalToman)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">
                    درخواست‌های در انتظار تأیید مدیر ({toPersianDigits(financeTotals.pendingCount)}{' '}
                    مورد)
                  </div>
                  <div className="mt-1.5 text-lg font-bold text-amber-700 tabular-nums">
                    {formatToman(financeTotals.pendingTotalToman)}
                  </div>
                </div>
              </div>

              <form
                onSubmit={handleFinanceSubmit}
                className="rounded-2xl bg-white border border-[#C5A059]/45 p-5 shadow-xs space-y-4"
              >
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-[#0B192C]">
                    ثبت دریافتی یا درخواست پرداخت جدید
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    موارد ثبت‌شده تا زمان بررسی و تأیید مدیر در وضعیت «در انتظار تأیید» قرار می‌گیرند.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      مبلغ (به تومان)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      required
                      value={finAmount}
                      onChange={(e) => setFinAmount(e.target.value)}
                      placeholder="مثلاً 2500000"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs tabular-nums focus:outline-none focus:border-[#0B192C]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      نوع درخواست / دریافتی
                    </label>
                    <select
                      value={finType}
                      onChange={(e) => setFinType(e.target.value as FinancialTxType)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-xs bg-white focus:outline-none focus:border-[#0B192C]"
                    >
                      <option value="ADVANCE">مساعده</option>
                      <option value="ON_ACCOUNT">علی‌الحساب</option>
                      <option value="SALARY">حقوق</option>
                      <option value="PETTY_CASH">تنخواه</option>
                      <option value="OTHER">سایر موارد</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      تاریخ (شمسی YYYY/MM/DD)
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={finDate}
                      onChange={(e) => setFinDate(e.target.value)}
                      placeholder="1405/07/30"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs text-right tabular-nums focus:outline-none focus:border-[#0B192C]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    توضیحات درخواست
                  </label>
                  <input
                    type="text"
                    required
                    value={finDesc}
                    onChange={(e) => setFinDesc(e.target.value)}
                    placeholder="علت درخواست یا شماره پیگیری واریزی..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-xs focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full sm:w-auto min-h-[44px] px-6 rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 text-xs font-semibold hover:bg-[#152944] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {actionLoading ? 'در حال ثبت...' : 'ثبت درخواست مالی'}
                </button>
              </form>

              {/* فهرست سوابق مالی و وضعیت بررسی مدیر */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C]">
                  سوابق درخواست‌ها و دریافتی‌ها
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    هنوز تراکنش یا درخواست مالی ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="py-3.5 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-[#0B192C] tabular-nums">
                              {formatToman(tx.amount_toman)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-700 font-medium">
                              {TX_TYPE_LABELS[tx.tx_type]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-500 tabular-nums">
                              {toPersianDigits(tx.shamsi_date)}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-semibold ${
                              tx.status === 'APPROVED'
                                ? 'text-emerald-700'
                                : tx.status === 'REJECTED'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {STATUS_LABELS[tx.status]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">{tx.description}</p>
                        {tx.manager_note && (
                          <p className="text-[11px] text-slate-500">
                            یادداشت مدیر: {tx.manager_note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
