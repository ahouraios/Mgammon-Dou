import React, { useCallback, useEffect, useState } from 'react';
import {
  AttendanceEventType,
  AuditLogItem,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialTransaction,
  FinancialTxType,
  FridayHolidayPolicy,
  MissionPolicy,
  SystemSettings,
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
  LayoutDashboard,
  Clock,
  Wallet,
  FileText,
  Settings,
  ShieldCheck,
  RefreshCw,
  Check,
  X,
  Plus,
  Edit3,
  Trash2,
} from 'lucide-react';

interface ManagerPanelProps {
  initialShamsiDate: string;
}

type ManagerTab = 'overview' | 'attendance' | 'finance' | 'reports' | 'settings' | 'audit';

interface ChartPoint {
  shamsiDate: string;
  dayName: string;
  netHours: number;
  overtimeHours: number;
  isIncomplete: boolean;
  statusLabel: string;
}

const WEEKDAY_ITEMS = [
  { id: 6, label: 'شنبه' },
  { id: 0, label: 'یکشنبه' },
  { id: 1, label: 'دوشنبه' },
  { id: 2, label: 'سه‌شنبه' },
  { id: 3, label: 'چهارشنبه' },
  { id: 4, label: 'پنجشنبه' },
  { id: 5, label: 'جمعه' },
];

export const ManagerPanel: React.FC<ManagerPanelProps> = ({ initialShamsiDate }) => {
  const [activeTab, setActiveTab] = useState<ManagerTab>('overview');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // داده‌های داشبورد مدیر
  const [serverTime, setServerTime] = useState({ shamsiDate: initialShamsiDate, timeHHMM: '' });
  const [liveState, setLiveState] = useState<WorkerLiveState | null>(null);
  const [kpis, setKpis] = useState({
    approvedPaymentsToman: 0,
    pendingPaymentsToman: 0,
    pendingPaymentsCount: 0,
    totalNetWorkMinutes: 0,
    totalOvertimeMinutes: 0,
    totalWorkDays: 0,
    incompleteDaysCount: 0,
  });
  const [charts, setCharts] = useState<{ weekly: ChartPoint[]; monthly: ChartPoint[] }>({
    weekly: [],
    monthly: [],
  });
  const [chartRange, setChartRange] = useState<'weekly' | 'monthly'>('weekly');

  // داده‌های تردد
  const [attendanceSummaries, setAttendanceSummaries] = useState<DailyAttendanceSummary[]>([]);
  const [attFromShamsi, setAttFromShamsi] = useState('');
  const [attToShamsi, setAttToShamsi] = useState('');

  // فرم افزودن/اصلاح تردد توسط مدیر
  const [overrideMode, setOverrideMode] = useState<'ADD' | 'UPDATE' | null>(null);
  const [overrideLogId, setOverrideLogId] = useState<number | null>(null);
  const [overrideShamsiDate, setOverrideShamsiDate] = useState(initialShamsiDate);
  const [overrideEventType, setOverrideEventType] = useState<AttendanceEventType>('WORK_START');
  const [overrideTime, setOverrideTime] = useState('08:30');
  const [overrideNote, setOverrideNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // داده‌های کارتابل مالی
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [finStatusFilter, setFinStatusFilter] = useState('');
  const [finTypeFilter, setFinTypeFilter] = useState('');
  const [finFromShamsi, setFinFromShamsi] = useState('');
  const [finToShamsi, setFinToShamsi] = useState('');
  const [finSearch, setFinSearch] = useState('');
  const [reviewNoteMap, setReviewNoteMap] = useState<Record<number, string>>({});

  // فرم ثبت مستقیم پرداخت توسط مدیر
  const [directAmount, setDirectAmount] = useState('');
  const [directType, setDirectType] = useState<FinancialTxType>('SALARY');
  const [directDate, setDirectDate] = useState(initialShamsiDate);
  const [directDesc, setDirectDesc] = useState('');

  // داده‌های گزارش‌های کاری
  const [reports, setReports] = useState<DailyWorkReport[]>([]);
  const [repSearch, setRepSearch] = useState('');
  const [repFromShamsi, setRepFromShamsi] = useState('');
  const [repToShamsi, setRepToShamsi] = useState('');

  // تنظیمات سامانه
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [holidaysText, setHolidaysText] = useState('');
  const [applyRetroactively, setApplyRetroactively] = useState(false);

  // لاگ ممیزی
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  const loadDashboardAndSettings = useCallback(async () => {
    try {
      const dashRes = await apiRequest<{
        ok: boolean;
        serverTime: { shamsiDate: string; timeHHMM: string };
        liveState: WorkerLiveState;
        kpis: typeof kpis;
        charts: { weekly: ChartPoint[]; monthly: ChartPoint[] };
        recentSummaries: DailyAttendanceSummary[];
        settings: SystemSettings;
      }>('/api/manager/dashboard');

      setServerTime(dashRes.serverTime);
      setLiveState(dashRes.liveState);
      setKpis(dashRes.kpis);
      setCharts(dashRes.charts);
      setSettings(dashRes.settings);
      setHolidaysText((dashRes.settings.official_holidays || []).join('، '));
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    }
  }, []);

  const loadAttendance = useCallback(async () => {
    const params = new URLSearchParams();
    if (attFromShamsi.trim()) params.set('fromShamsi', attFromShamsi.trim());
    if (attToShamsi.trim()) params.set('toShamsi', attToShamsi.trim());
    const res = await apiRequest<{ ok: boolean; dailySummaries: DailyAttendanceSummary[] }>(
      `/api/attendance/history?${params.toString()}`
    );
    setAttendanceSummaries(res.dailySummaries);
  }, [attFromShamsi, attToShamsi]);

  const loadFinance = useCallback(async () => {
    const params = new URLSearchParams();
    if (finStatusFilter) params.set('status', finStatusFilter);
    if (finTypeFilter) params.set('txType', finTypeFilter);
    if (finFromShamsi.trim()) params.set('fromShamsi', finFromShamsi.trim());
    if (finToShamsi.trim()) params.set('toShamsi', finToShamsi.trim());
    if (finSearch.trim()) params.set('search', finSearch.trim());
    const res = await apiRequest<{ ok: boolean; transactions: FinancialTransaction[] }>(
      `/api/finance?${params.toString()}`
    );
    setTransactions(res.transactions);
  }, [finStatusFilter, finTypeFilter, finFromShamsi, finToShamsi, finSearch]);

  const loadReports = useCallback(async () => {
    const params = new URLSearchParams();
    if (repSearch.trim()) params.set('search', repSearch.trim());
    if (repFromShamsi.trim()) params.set('fromShamsi', repFromShamsi.trim());
    if (repToShamsi.trim()) params.set('toShamsi', repToShamsi.trim());
    const res = await apiRequest<{ ok: boolean; reports: DailyWorkReport[] }>(
      `/api/reports?${params.toString()}`
    );
    setReports(res.reports);
  }, [repSearch, repFromShamsi, repToShamsi]);

  const loadAuditLogs = useCallback(async () => {
    const res = await apiRequest<{ ok: boolean; logs: AuditLogItem[] }>('/api/audit-logs');
    setAuditLogs(res.logs);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadDashboardAndSettings(),
        loadAttendance(),
        loadFinance(),
        loadReports(),
        loadAuditLogs(),
      ]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [loadDashboardAndSettings, loadAttendance, loadFinance, loadReports, loadAuditLogs]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleAttendanceOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideMode) return;
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        '/api/attendance/manager-override',
        {
          method: 'POST',
          body: JSON.stringify({
            action: overrideMode,
            log_id: overrideLogId,
            shamsi_date: overrideShamsiDate,
            event_type: overrideEventType,
            recorded_time: overrideTime,
            note: overrideNote,
            reason: overrideReason,
          }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      setOverrideMode(null);
      setOverrideReason('');
      setOverrideNote('');
      await Promise.all([loadDashboardAndSettings(), loadAttendance(), loadAuditLogs()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAttendanceLog = async (logId: number) => {
    if (!overrideReason.trim() || overrideReason.trim().length < 3) {
      setFeedback({
        type: 'error',
        text: 'برای حذف رکورد تردد، ابتدا در کادر «علت اصلاح/حذف» دلیل را وارد کنید.',
      });
      return;
    }
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        '/api/attendance/manager-override',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'DELETE',
            log_id: logId,
            reason: overrideReason.trim(),
          }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      setOverrideReason('');
      await Promise.all([loadDashboardAndSettings(), loadAttendance(), loadAuditLogs()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewFinance = async (txId: number, decision: 'APPROVED' | 'REJECTED') => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/finance/${txId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            manager_note: reviewNoteMap[txId] || undefined,
          }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinance(), loadAuditLogs()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDirectPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        '/api/finance/manager-direct',
        {
          method: 'POST',
          body: JSON.stringify({
            amount_toman: directAmount,
            tx_type: directType,
            shamsi_date: directDate,
            description: directDesc,
          }),
        }
      );
      setDirectAmount('');
      setDirectDesc('');
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinance(), loadAuditLogs()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setFeedback(null);
    setActionLoading(true);
    try {
      const holidaysArray = holidaysText
        .split(/[,،\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiRequest<{
        ok: boolean;
        settings: SystemSettings;
        message: string;
      }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...settings,
          official_holidays: holidaysArray,
          apply_retroactively: applyRetroactively,
        }),
      });
      setSettings(res.settings);
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendance(), loadAuditLogs()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const activeChartPoints = chartRange === 'weekly' ? charts.weekly : charts.monthly;
  const maxChartHours = Math.max(
    10,
    ...activeChartPoints.map((p) => Math.max(p.netHours, p.overtimeHours))
  );

  return (
    <div className="max-w-6xl mx-auto px-4 pt-4 pb-20 sm:pb-10 space-y-5">
      {/* نوار بالای پنل مدیر */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border border-[#C5A059]/35 px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-bold text-[#0B192C]">
            {serverTime.shamsiDate ? formatShamsiVerbose(serverTime.shamsiDate) : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{toPersianDigits(serverTime.shamsiDate)}</span>
          {serverTime.timeHHMM && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">ساعت سرور: {toPersianDigits(serverTime.timeHHMM)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="min-h-[38px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] text-xs font-medium text-[#0B192C] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#C5A059]" />
          <span>بروزرسانی اطلاعات دیتابیس</span>
        </button>
      </div>

      {/* نشانگر آدمک وضعیت فعلی نیرو */}
      {liveState && (
        <WorkerStatusAvatar
          status={liveState.status}
          statusText={liveState.status_text}
          statusDetail={liveState.status_detail}
          isOvertimeActive={liveState.is_overtime_active}
        />
      )}

      {/* پیام بازخورد عملیات */}
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

      {/* منوی ناوبری پنل مدیر */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 p-1.5 rounded-2xl bg-[#0B192C] border border-[#C5A059]/40">
        {[
          { id: 'overview', label: 'شاخص‌ها و نمودار', icon: LayoutDashboard },
          { id: 'attendance', label: 'مدیریت تردد', icon: Clock },
          {
            id: 'finance',
            label:
              kpis.pendingPaymentsCount > 0
                ? `کارتابل مالی (${toPersianDigits(kpis.pendingPaymentsCount)})`
                : 'کارتابل مالی',
            icon: Wallet,
          },
          { id: 'reports', label: 'گزارش‌های کاری', icon: FileText },
          { id: 'settings', label: 'تنظیمات قواعد', icon: Settings },
          { id: 'audit', label: 'لاگ تغییرات', icon: ShieldCheck },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as ManagerTab)}
              className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-[#C5A059] text-[#0B192C] shadow-xs'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-xs text-slate-500">
          در حال استخراج و محاسبه اطلاعات از دیتابیس MySQL...
        </div>
      ) : (
        <>
          {/* تب ۱: شاخص‌های اصلی و نمودارهای روند */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* ۵ شاخص اصلی محاسبه‌شده از دیتابیس */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-white border border-[#C5A059]/45 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">مجموع پرداخت‌های تأییدشده</div>
                  <div className="mt-2 text-base sm:text-lg font-bold text-[#0B192C] tabular-nums">
                    {formatToman(kpis.approvedPaymentsToman)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    در انتظار بررسی: {toPersianDigits(kpis.pendingPaymentsCount)} مورد
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">مجموع ساعات کاری خالص</div>
                  <div className="mt-2 text-base sm:text-lg font-bold text-[#0B192C] tabular-nums">
                    {formatMinutesToDurationPersian(kpis.totalNetWorkMinutes)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    معادل {formatMinutesToHHMM(kpis.totalNetWorkMinutes)} ساعت
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">مجموع ساعات اضافه‌کاری</div>
                  <div className="mt-2 text-base sm:text-lg font-bold text-[#9A7428] tabular-nums">
                    {formatMinutesToDurationPersian(kpis.totalOvertimeMinutes)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    بر اساس قواعد شیفت مصوب
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="text-xs text-slate-500">تعداد روزهای کاری ثبت‌شده</div>
                  <div className="mt-2 text-base sm:text-lg font-bold text-[#0B192C] tabular-nums">
                    {toPersianDigits(kpis.totalWorkDays)} روز قطعی
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    {kpis.incompleteDaysCount > 0
                      ? `${toPersianDigits(kpis.incompleteDaysCount)} روز ناقص (نیازمند تعیین تکلیف)`
                      : 'بدون رکورد ناقص'}
                  </div>
                </div>
              </div>

              {/* هشدار تأیید اولیه قواعد کارکرد در صورت عدم تأیید مدیر */}
              {settings && !settings.rules_confirmed_by_manager && (
                <div className="rounded-2xl bg-amber-50/90 border border-amber-300 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-amber-950 leading-6">
                    <strong>توجه مدیر:</strong> لطفاً در بخش «تنظیمات قواعد»، ساعت شروع/پایان شیفت،
                    ساعت شروع اضافه‌کاری و نحوه محاسبه مأموریت و تعطیلات را بررسی و تأیید نهایی
                    فرمایید.
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="min-h-[40px] px-4 rounded-xl bg-[#0B192C] text-white text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    بررسی و تأیید قواعد
                  </button>
                </div>
              )}

              {/* نمودار روند ساعات کاری و اضافه‌کاری (فقط از اطلاعات واقعی ثبت‌شده) */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#0B192C]">
                      نمودار روند ساعات کاری خالص و اضافه‌کاری
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      تولیدشده صرفاً از روزهای دارای تردد واقعی در دیتابیس
                    </p>
                  </div>
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                    <button
                      type="button"
                      onClick={() => setChartRange('weekly')}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        chartRange === 'weekly'
                          ? 'bg-[#0B192C] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      ۷ روز کاری اخیر
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartRange('monthly')}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        chartRange === 'monthly'
                          ? 'bg-[#0B192C] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      ۳۰ روز کاری اخیر
                    </button>
                  </div>
                </div>

                {activeChartPoints.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    هنوز روز کاری ثبت‌شده‌ای برای رسم نمودار وجود ندارد.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-xs bg-[#0B192C] inline-block" />
                        <span>ساعات کاری خالص</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-xs bg-[#C5A059] inline-block" />
                        <span>ساعات اضافه‌کاری</span>
                      </span>
                    </div>

                    <div className="space-y-2.5 pt-2">
                      {activeChartPoints.map((pt) => {
                        const netPercent = Math.min(100, Math.round((pt.netHours / maxChartHours) * 100));
                        const otPercent = Math.min(
                          100,
                          Math.round((pt.overtimeHours / maxChartHours) * 100)
                        );
                        return (
                          <div key={pt.shamsiDate} className="space-y-1">
                            <div className="flex items-center justify-between text-xs tabular-nums">
                              <span className="font-medium text-[#0B192C]">
                                {toPersianDigits(pt.shamsiDate)} ({pt.dayName})
                              </span>
                              <span className="text-slate-600">
                                {pt.isIncomplete ? (
                                  <span className="text-amber-700 font-medium">
                                    {pt.statusLabel}
                                  </span>
                                ) : (
                                  <>
                                    کارکرد: <strong>{toPersianDigits(pt.netHours)}</strong> ساعت ·
                                    اضافه‌کاری: <strong>{toPersianDigits(pt.overtimeHours)}</strong>{' '}
                                    ساعت
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="w-full h-3 rounded-lg bg-slate-100 overflow-hidden flex gap-0.5">
                              <div
                                style={{ width: `${netPercent}%` }}
                                className="h-full bg-[#0B192C] transition-all"
                                title={`کارکرد خالص: ${pt.netHours} ساعت`}
                              />
                              <div
                                style={{ width: `${otPercent}%` }}
                                className="h-full bg-[#C5A059] transition-all"
                                title={`اضافه‌کاری: ${pt.overtimeHours} ساعت`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* تب ۲: مدیریت و اصلاح سوابق تردد */}
          {activeTab === 'attendance' && (
            <div className="space-y-5">
              {/* فیلتر بازه تاریخ شمسی و دکمه ثبت دستی تردد */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      از تاریخ شمسی
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={attFromShamsi}
                      onChange={(e) => setAttFromShamsi(e.target.value)}
                      placeholder="1405/01/01"
                      className="min-h-[40px] w-36 rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      تا تاریخ شمسی
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={attToShamsi}
                      onChange={(e) => setAttToShamsi(e.target.value)}
                      placeholder="1405/12/29"
                      className="min-h-[40px] w-36 rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadAttendance}
                    className="min-h-[40px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    اعمال فیلتر
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOverrideMode('ADD');
                    setOverrideLogId(null);
                    setOverrideShamsiDate(serverTime.shamsiDate || initialShamsiDate);
                    setOverrideEventType('WORK_END');
                    setOverrideTime('17:00');
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#C5A059]" />
                  <span>ثبت دستی رکورد تردد (با درج علت)</span>
                </button>
              </div>

              {/* فرم اصلاح یا افزودن تردد توسط مدیر */}
              {overrideMode && (
                <form
                  onSubmit={handleAttendanceOverrideSubmit}
                  className="rounded-2xl bg-white border-2 border-[#C5A059] p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="text-sm font-bold text-[#0B192C]">
                      {overrideMode === 'ADD'
                        ? 'افزودن رکورد تردد توسط مدیر'
                        : `اصلاح رکورد تردد شماره #${toPersianDigits(overrideLogId)}`}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setOverrideMode(null)}
                      className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      انصراف
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {overrideMode === 'ADD' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          تاریخ شمسی (YYYY/MM/DD)
                        </label>
                        <input
                          type="text"
                          required
                          dir="ltr"
                          value={overrideShamsiDate}
                          onChange={(e) => setOverrideShamsiDate(e.target.value)}
                          className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        نوع رویداد تردد
                      </label>
                      <select
                        value={overrideEventType}
                        onChange={(e) =>
                          setOverrideEventType(e.target.value as AttendanceEventType)
                        }
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs bg-white"
                      >
                        <option value="WORK_START">شروع کار</option>
                        <option value="MISSION_START">شروع مأموریت</option>
                        <option value="MISSION_END">پایان مأموریت و بازگشت</option>
                        <option value="WORK_END">پایان کار</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ساعت دقیق (HH:MM)
                      </label>
                      <input
                        type="text"
                        required
                        dir="ltr"
                        value={overrideTime}
                        onChange={(e) => setOverrideTime(e.target.value)}
                        placeholder="17:00"
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        علت اصلاح تردد (الزامی جهت ثبت در Audit Log)
                      </label>
                      <input
                        type="text"
                        required
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="مثلاً فراموشی ثبت خروج توسط نیرو در پایان شیفت"
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        توضیح تکمیلی (اختیاری)
                      </label>
                      <input
                        type="text"
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-white text-xs font-semibold cursor-pointer"
                  >
                    {actionLoading ? 'در حال بررسی و ثبت...' : 'ذخیره اصلاحات با ثبت سابقه'}
                  </button>
                </form>
              )}

              {/* کادر علت حذف برای دکمه‌های حذف رکورد */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-[#0B192C]">
                    سوابق روزانه تردد و جزئیات محاسبه
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="علت اصلاح/حذف را اینجا بنویسید..."
                      className="min-h-[36px] w-60 rounded-xl border border-slate-300 px-3 text-xs"
                    />
                  </div>
                </div>

                {attendanceSummaries.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    رکورد ترددی در این بازه یافت نشد.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {attendanceSummaries.map((day) => (
                      <div key={day.work_date} className="py-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-[#0B192C] tabular-nums">
                              {toPersianDigits(day.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-700">{day.day_name}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`font-semibold ${
                                day.is_incomplete
                                  ? 'text-amber-700'
                                  : day.is_late
                                    ? 'text-orange-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {day.status_label}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                            <span>
                              کارکرد خالص قطعی:{' '}
                              <strong>{formatMinutesToHHMM(day.net_work_minutes)}</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              مأموریت: <strong>{formatMinutesToHHMM(day.mission_minutes)}</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#9A7428]">
                              اضافه‌کاری: <strong>{formatMinutesToHHMM(day.overtime_minutes)}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {day.logs.map((l) => (
                            <div
                              key={l.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-[#0B192C]">
                                  {EVENT_TYPE_LABELS[l.event_type]}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums font-bold">
                                  ساعت {toPersianDigits(l.recorded_time.slice(0, 5))}
                                </span>
                                {l.note && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-slate-600">{l.note}</span>
                                  </>
                                )}
                                {l.is_manual_override && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-800">
                                      اصلاح‌شده توسط مدیر ({l.modification_reason})
                                    </span>
                                  </>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOverrideMode('UPDATE');
                                    setOverrideLogId(l.id);
                                    setOverrideEventType(l.event_type);
                                    setOverrideTime(l.recorded_time.slice(0, 5));
                                    setOverrideReason(l.modification_reason || '');
                                  }}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-slate-300 hover:border-[#0B192C] text-xs flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>اصلاح</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAttendanceLog(l.id)}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* تب ۳: کارتابل پرداخت‌ها و امور مالی */}
          {activeTab === 'finance' && (
            <div className="space-y-5">
              {/* ثبت مستقیم پرداخت توسط مدیر */}
              <form
                onSubmit={handleDirectPaymentSubmit}
                className="rounded-2xl bg-white border border-[#C5A059]/45 p-5 shadow-xs space-y-4"
              >
                <h3 className="text-sm font-bold text-[#0B192C] border-b border-slate-100 pb-3">
                  ثبت مستقیم پرداخت قطعی توسط مدیر
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      مبلغ پرداخت (تومان)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      required
                      value={directAmount}
                      onChange={(e) => setDirectAmount(e.target.value)}
                      placeholder="مثلاً 15000000"
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      نوع پرداخت
                    </label>
                    <select
                      value={directType}
                      onChange={(e) => setDirectType(e.target.value as FinancialTxType)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs bg-white"
                    >
                      <option value="SALARY">حقوق</option>
                      <option value="ADVANCE">مساعده</option>
                      <option value="ON_ACCOUNT">علی‌الحساب</option>
                      <option value="PETTY_CASH">تنخواه</option>
                      <option value="OTHER">سایر موارد</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      تاریخ شمسی
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={directDate}
                      onChange={(e) => setDirectDate(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      شرح پرداخت / شماره پیگیری
                    </label>
                    <input
                      type="text"
                      required
                      value={directDesc}
                      onChange={(e) => setDirectDesc(e.target.value)}
                      placeholder="واریز حقوق ماهانه..."
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 text-xs font-semibold cursor-pointer"
                >
                  ثبت مستقیم در سوابق پرداخت قطعی
                </button>
              </form>

              {/* فیلتر و جست‌وجوی سوابق مالی */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">وضعیت</label>
                  <select
                    value={finStatusFilter}
                    onChange={(e) => setFinStatusFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs bg-white"
                  >
                    <option value="">همه وضعیت‌ها</option>
                    <option value="PENDING">در انتظار تأیید</option>
                    <option value="APPROVED">تأییدشده</option>
                    <option value="REJECTED">ردشده</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">نوع تراکنش</label>
                  <select
                    value={finTypeFilter}
                    onChange={(e) => setFinTypeFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs bg-white"
                  >
                    <option value="">همه انواع</option>
                    <option value="ADVANCE">مساعده</option>
                    <option value="ON_ACCOUNT">علی‌الحساب</option>
                    <option value="SALARY">حقوق</option>
                    <option value="PETTY_CASH">تنخواه</option>
                    <option value="OTHER">سایر موارد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">از تاریخ</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={finFromShamsi}
                    onChange={(e) => setFinFromShamsi(e.target.value)}
                    placeholder="1405/01/01"
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">تا تاریخ</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={finToShamsi}
                    onChange={(e) => setFinToShamsi(e.target.value)}
                    placeholder="1405/12/29"
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">جست‌وجو</label>
                  <input
                    type="text"
                    value={finSearch}
                    onChange={(e) => setFinSearch(e.target.value)}
                    placeholder="شرح یا یادداشت..."
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadFinance}
                  className="min-h-[40px] rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                >
                  جست‌وجو و فیلتر
                </button>
              </div>

              {/* فهرست کارتابل پرداخت‌ها */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C]">
                  کارتابل درخواست‌های مالی و سوابق پرداخت
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    موردی مطابق فیلتر انتخابی یافت نشد.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="py-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-sm font-bold text-[#0B192C] tabular-nums">
                              {formatToman(tx.amount_toman)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-slate-700">
                              {TX_TYPE_LABELS[tx.tx_type]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums text-slate-500">
                              تاریخ: {toPersianDigits(tx.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-500">
                              ثبت‌کننده: {tx.creator_role === 'manager' ? 'مدیر' : 'نیروی کاری'}
                            </span>
                          </div>

                          <span
                            className={`text-xs font-bold ${
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

                        <p className="text-xs text-slate-700">{tx.description}</p>

                        {tx.status === 'PENDING' ? (
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={reviewNoteMap[tx.id] || ''}
                              onChange={(e) =>
                                setReviewNoteMap((prev) => ({
                                  ...prev,
                                  [tx.id]: e.target.value,
                                }))
                              }
                              placeholder="یادداشت مدیر (اختیاری)..."
                              className="min-h-[38px] flex-1 min-w-[200px] rounded-xl border border-slate-300 px-3 text-xs"
                            />
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleReviewFinance(tx.id, 'APPROVED')}
                              className="min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>تأیید و ثبت قطعی</span>
                            </button>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleReviewFinance(tx.id, 'REJECTED')}
                              className="min-h-[38px] px-4 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>رد درخواست</span>
                            </button>
                          </div>
                        ) : (
                          tx.manager_note && (
                            <p className="text-[11px] text-slate-500">
                              یادداشت بررسی مدیر: {tx.manager_note}
                            </p>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* تب ۴: گزارش‌های کاری نیرو */}
          {activeTab === 'reports' && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    جست‌وجو در متن گزارش
                  </label>
                  <input
                    type="text"
                    value={repSearch}
                    onChange={(e) => setRepSearch(e.target.value)}
                    placeholder="کلیدواژه فعالیت..."
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    از تاریخ شمسی
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={repFromShamsi}
                    onChange={(e) => setRepFromShamsi(e.target.value)}
                    placeholder="1405/01/01"
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    تا تاریخ شمسی
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={repToShamsi}
                    onChange={(e) => setRepToShamsi(e.target.value)}
                    placeholder="1405/12/29"
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadReports}
                  className="min-h-[40px] rounded-xl bg-[#0B192C] text-white text-xs font-semibold cursor-pointer"
                >
                  جست‌وجو و فیلتر گزارش‌ها
                </button>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C]">گزارش‌های روزانه ثبت‌شده</h3>
                {reports.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    گزارش کاری مطابق فیلتر یافت نشد.
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
                            <span className="text-[#9A7428] font-semibold">
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

          {/* تب ۵: تنظیمات قواعد کارکرد و اضافه‌کاری */}
          {activeTab === 'settings' && settings && (
            <form
              onSubmit={handleSaveSettings}
              className="rounded-2xl bg-white border border-[#C5A059]/45 p-5 shadow-xs space-y-5"
            >
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-[#0B192C]">
                  تنظیمات قواعد محاسبه کارکرد، شیفت و اضافه‌کاری
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  هیچ قاعده یا نرخی بدون تأیید شما اعمال نمی‌شود. تغییر تنظیمات جدید به‌صورت پیش‌فرض
                  سوابق ماه‌های گذشته را تغییر نمی‌دهد.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ساعت شروع شیفت (HH:MM)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={settings.shift_start_time}
                    onChange={(e) =>
                      setSettings({ ...settings, shift_start_time: e.target.value })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ساعت پایان شیفت (HH:MM)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={settings.shift_end_time}
                    onChange={(e) =>
                      setSettings({ ...settings, shift_end_time: e.target.value })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ساعت شروع اضافه‌کاری (HH:MM)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={settings.overtime_start_time}
                    onChange={(e) =>
                      setSettings({ ...settings, overtime_start_time: e.target.value })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    زمان استراحت روزانه (دقیقه)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    value={settings.break_duration_minutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        break_duration_minutes: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    فرجه مجاز تأخیر ورود (دقیقه)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={settings.grace_period_minutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        grace_period_minutes: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    منطقه زمانی سامانه
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={settings.timezone}
                    onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right"
                  />
                </div>
              </div>

              {/* انتخاب روزهای کاری هفته */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  روزهای کاری هفته
                </label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_ITEMS.map((day) => {
                    const checked = settings.working_days.includes(day.id);
                    return (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => {
                          const next = checked
                            ? settings.working_days.filter((d) => d !== day.id)
                            : [...settings.working_days, day.id];
                          setSettings({ ...settings, working_days: next });
                        }}
                        className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                          checked
                            ? 'bg-[#0B192C] text-white border-[#C5A059]'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    نحوه محاسبه مأموریت
                  </label>
                  <select
                    value={settings.mission_policy}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        mission_policy: e.target.value as MissionPolicy,
                      })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs bg-white"
                  >
                    <option value="PAID_AS_WORK">
                      محاسبه مأموریت جزو ساعات کاری خالص (همراه با اضافه‌کاری)
                    </option>
                    <option value="SEPARATE_EXTRA">
                      ثبت و نمایش مجزای زمان مأموریت از حضور در محل کار
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    نحوه محاسبه کار در روز جمعه و تعطیلات رسمی
                  </label>
                  <select
                    value={settings.friday_holiday_policy}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        friday_holiday_policy: e.target.value as FridayHolidayPolicy,
                      })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs bg-white"
                  >
                    <option value="ALL_OVERTIME">محاسبه تمام ساعات کار تعطیلات به عنوان اضافه‌کاری</option>
                    <option value="REGULAR_WORK">محاسبه به عنوان ساعت کار عادی</option>
                    <option value="DISABLED">عدم محاسبه اضافه‌کاری خودکار در تعطیلات</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  تاریخ‌های تعطیل رسمی شمسی (جداشده با ویرگول، مثلاً 1405/01/01، 1405/01/02)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={holidaysText}
                  onChange={(e) => setHolidaysText(e.target.value)}
                  placeholder="1405/01/01, 1405/01/13"
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs text-right tabular-nums"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.overtime_before_shift}
                    onChange={(e) =>
                      setSettings({ ...settings, overtime_before_shift: e.target.checked })
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span>محاسبه حضور زودتر از ساعت شروع شیفت به عنوان اضافه‌کاری صبحگاهی</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyRetroactively}
                    onChange={(e) => setApplyRetroactively(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span>
                    اعمال این تغییرات بر محاسبات ماه‌های گذشته (در صورت عدم انتخاب، سوابق گذشته با
                    قواعد قبلی محفوظ می‌مانند)
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="min-h-[44px] px-6 rounded-xl bg-[#0B192C] text-white border border-[#C5A059]/60 text-xs font-semibold cursor-pointer"
              >
                {actionLoading ? 'در حال ذخیره...' : 'تأیید و ذخیره تنظیمات قواعد کارکرد'}
              </button>
            </form>
          )}

          {/* تب ۶: لاگ ممیزی (Audit Logs) */}
          {activeTab === 'audit' && (
            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
              <h3 className="text-sm font-bold text-[#0B192C]">
                سابقه ممیزی و تغییرات حساس سامانه (Audit Logs)
              </h3>
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  هنوز رویداد ممیزی ثبت نشده است.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="py-3 text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#0B192C]">{log.action_type}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600">توسط: {log.actor_name}</span>
                          {log.target_id && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums text-slate-500">
                                شناسه رکورد: #{toPersianDigits(log.target_id)}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="tabular-nums text-slate-400">
                          {new Date(log.created_at).toLocaleString('fa-IR')}
                        </span>
                      </div>
                      {log.reason && (
                        <p className="text-slate-700">علت ثبت‌شده: {log.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
