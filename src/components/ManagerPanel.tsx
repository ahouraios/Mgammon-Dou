import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttendanceEventType,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
  FridayHolidayPolicy,
  HistoricalWorkRecord,
  LeaveQuotaSummary,
  LeaveRequestItem,
  MissionPolicy,
  OvertimeCalcMode,
  SystemSettings,
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
  formatToman,
  SHAMSI_MONTH_NAMES,
  toPersianDigits,
} from '../shared/jalali';
import { WorkerStatusAvatar } from './WorkerStatusAvatar';
import { HeroBanner } from './HeroBanner';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { TimePickerInput } from './TimePickerInput';
import { TomanInput } from './TomanInput';
import { WorkCorrespondenceSection } from './WorkCorrespondenceSection';
import { AccountSettingsPanel } from './AccountSettingsPanel';
import { MonthlyAttendanceCalendar } from './MonthlyAttendanceCalendar';
import { LeaveManagementSection } from './LeaveManagementSection';
import { DailyTasksChecklist } from './DailyTasksChecklist';
import { FilePreviewModal, PreviewFileItem } from './FilePreviewModal';
import { MonthlyStatementSection } from './MonthlyStatementSection';
import {
  LayoutDashboard,
  Clock,
  FileText,
  Wallet,
  Settings,
  MessageSquare,
  Check,
  X,
  Plus,
  Trash2,
  Edit3,
  History,
  FileSpreadsheet,
  Upload,
  Download,
  Smartphone,
  Eye,
  UserCog,
  CalendarClock,
  Coins,
  AlertTriangle,
  Receipt,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  HelpCircle,
} from 'lucide-react';

type ManagerTab =
  | 'dashboard'
  | 'attendance'
  | 'reports'
  | 'finance'
  | 'correspondence'
  | 'settings';

type SettingsSubTab = 'account' | 'schedule' | 'salary' | 'sms';

interface DashboardResponse {
  ok: boolean;
  serverTime: { shamsiDate: string; timeHHMM: string };
  liveState: WorkerLiveState;
  kpis: {
    approvedPaymentsToman: number;
    pendingPaymentsToman: number;
    pendingPaymentsCount: number;
    totalNetWorkMinutes: number;
    totalOvertimeMinutes: number;
    totalWorkDays: number;
    incompleteDaysCount: number;
    baseSalaryToman: number;
    effectiveHourlyRateToman: number;
    effectiveOvertimeHourlyRateToman: number;
    earnedRegularWorkToman?: number;
    totalOvertimePayToman: number;
    totalSalaryPlusOvertimeToman?: number;
  };
  unseenAlerts: {
    financeAlert: boolean;
    pendingFinanceCount: number;
    reportsAlert: boolean;
    unseenReportsCount: number;
    historicalAlert: boolean;
    pendingHistoricalCount: number;
    correspondenceAlert: boolean;
    unreadCorrespondenceCount: number;
  };
  charts: {
    weekly: {
      shamsiDate: string;
      dayName: string;
      netHours: number;
      overtimeHours: number;
      isIncomplete: boolean;
      statusLabel: string;
    }[];
    monthly: {
      shamsiDate: string;
      dayName: string;
      netHours: number;
      overtimeHours: number;
      isIncomplete: boolean;
      statusLabel: string;
    }[];
  };
  recentSummaries: DailyAttendanceSummary[];
  settings: SystemSettings;
}

const WEEKDAY_CHECKBOXES = [
  { day: 6, label: 'شنبه' },
  { day: 0, label: 'یکشنبه' },
  { day: 1, label: 'دوشنبه' },
  { day: 2, label: 'سه‌شنبه' },
  { day: 3, label: 'چهارشنبه' },
  { day: 4, label: 'پنجشنبه' },
  { day: 5, label: 'جمعه' },
];

const GoldenBlinkDot: React.FC<{ title?: string }> = ({ title }) => (
  <span
    title={title || 'مورد جدید در انتظار بررسی'}
    className="relative inline-flex h-2.5 w-2.5 shrink-0"
  >
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-90" />
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#C5A059] border border-white" />
  </span>
);

interface ManagerPanelProps {
  user: UserProfile;
  initialShamsiDate: string;
  bannerBgUrl: string | null;
  onUserAvatarChange?: (url: string | null) => void;
}

export const ManagerPanel: React.FC<ManagerPanelProps> = ({
  user,
  initialShamsiDate,
  bannerBgUrl,
  onUserAvatarChange,
}) => {
  const [activeTab, setActiveTab] = useState<ManagerTab>('dashboard');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('schedule');
  const [chartPeriod, setChartPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [dashReportFilter, setDashReportFilter] = useState<'today_and_recent' | 'today' | 'previous'>(
    'today_and_recent'
  );
  const [showAllDashReports, setShowAllDashReports] = useState(false);
  const [dashClaimFilter, setDashClaimFilter] = useState<
    'all' | 'pending' | 'leaves' | 'petty_cash' | 'advance'
  >('all');
  const [showAllDashClaims, setShowAllDashClaims] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [attendanceSummaries, setAttendanceSummaries] = useState<DailyAttendanceSummary[]>([]);
  const [historicalRecords, setHistoricalRecords] = useState<HistoricalWorkRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [leaveQuota, setLeaveQuota] = useState<LeaveQuotaSummary | null>(null);
  const [reports, setReports] = useState<DailyWorkReport[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [settingsForm, setSettingsForm] = useState<SystemSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // پیش‌نمایش پاپ‌آپ فایل‌ها / تصاویر (گزارش کار، فاکتور تنخواه و...)
  const [previewFile, setPreviewFile] = useState<PreviewFileItem | null>(null);

  // فیلترهای تردد و نمایش ماهانه جمع‌وجور (۲ روز آخر در حالت بسته)
  const [attFromShamsi, setAttFromShamsi] = useState('');
  const [attToShamsi, setAttToShamsi] = useState('');
  const [selectedMgrHistoryMonth, setSelectedMgrHistoryMonth] = useState<string>('');
  const [showAllMgrMonthHistory, setShowAllMgrMonthHistory] = useState(false);

  // فرم ثبت یا اصلاح دستی تردد توسط مدیر
  const [showAddLogForm, setShowAddLogForm] = useState(false);
  const [manualShamsiDate, setManualShamsiDate] = useState(initialShamsiDate);
  const [manualEventType, setManualEventType] = useState<AttendanceEventType>('WORK_START');
  const [manualTime, setManualTime] = useState('07:00');
  const [manualReason, setManualReason] = useState('');
  const [editingLogId, setEditingLogId] = useState<number | null>(null);

  // فرم افزودن سوابق قبلی کارکرد و اضافه‌کاری + اکسل
  const [showPastWorkForm, setShowPastWorkForm] = useState(false);
  const [pastWorkDate, setPastWorkDate] = useState(initialShamsiDate);
  const [pastWorkTitle, setPastWorkTitle] = useState('');
  const [pastWorkDays, setPastWorkDays] = useState('1');
  const [pastWorkHours, setPastWorkHours] = useState('');
  const [pastWorkMins, setPastWorkMins] = useState('0');
  const [pastOtHours, setPastOtHours] = useState('');
  const [pastOtMins, setPastOtMins] = useState('0');
  const [pastWorkNote, setPastWorkNote] = useState('');
  const [previewExcelRows, setPreviewExcelRows] = useState<HistoricalWorkRecord | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // فیلتر گزارش‌ها
  const [repSearch, setRepSearch] = useState('');
  const [repFromShamsi, setRepFromShamsi] = useState('');
  const [repToShamsi, setRepToShamsi] = useState('');

  // فیلتر و فرم مالی مدیر + ویرایش موارد پرداخت‌شده
  const [finStatusFilter, setFinStatusFilter] = useState('');
  const [finTypeFilter, setFinTypeFilter] = useState('');
  const [finSearch, setFinSearch] = useState('');
  const [mgrAmount, setMgrAmount] = useState('');
  const [mgrTxType, setMgrTxType] = useState<FinancialTxType>('SALARY');
  const [mgrShamsiDate, setMgrShamsiDate] = useState(initialShamsiDate);
  const [mgrDesc, setMgrDesc] = useState('');
  const [mgrNote, setMgrNote] = useState('');
  const [editingFinTx, setEditingFinTx] = useState<FinancialTransaction | null>(null);
  const [editFinAmount, setEditFinAmount] = useState('');
  const [editFinType, setEditFinType] = useState<FinancialTxType>('SALARY');
  const [editFinShamsiDate, setEditFinShamsiDate] = useState(initialShamsiDate);
  const [editFinDesc, setEditFinDesc] = useState('');
  const [editFinNote, setEditFinNote] = useState('');
  const [editFinStatus, setEditFinStatus] = useState<FinancialStatus>('APPROVED');

  // تعطیل رسمی جدید در تنظیمات + پاپ‌آپ راهنمای پیامک
  const [newHolidayShamsi, setNewHolidayShamsi] = useState('');
  const [testingSms, setTestingSms] = useState(false);
  const [showSmsHelpModal, setShowSmsHelpModal] = useState(false);

  const loadDashboardAndSettings = useCallback(async (syncSettings = false) => {
    try {
      const dashRes = await apiRequest<DashboardResponse>('/api/manager/dashboard');
      setDashboard(dashRes);
      setSettingsForm((prev) => (syncSettings || prev === null ? dashRes.settings : prev));
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    }
  }, []);

  const loadAttendanceList = useCallback(async () => {
    const params = new URLSearchParams();
    if (attFromShamsi.trim()) params.set('fromShamsi', attFromShamsi.trim());
    if (attToShamsi.trim()) params.set('toShamsi', attToShamsi.trim());
    const [res, leavesRes] = await Promise.all([
      apiRequest<{
        ok: boolean;
        dailySummaries: DailyAttendanceSummary[];
        historicalRecords: HistoricalWorkRecord[];
      }>(`/api/attendance/history?${params.toString()}`),
      apiRequest<{
        ok: boolean;
        leaveRequests: LeaveRequestItem[];
        quotaSummary: LeaveQuotaSummary;
      }>('/api/leaves'),
    ]);
    setAttendanceSummaries(res.dailySummaries);
    setHistoricalRecords(res.historicalRecords || []);
    setLeaveRequests(leavesRes.leaveRequests || []);
    setLeaveQuota(leavesRes.quotaSummary || null);
  }, [attFromShamsi, attToShamsi]);

  const loadReportsList = useCallback(async () => {
    const params = new URLSearchParams();
    if (repSearch.trim()) params.set('search', repSearch.trim());
    if (repFromShamsi.trim()) params.set('fromShamsi', repFromShamsi.trim());
    if (repToShamsi.trim()) params.set('toShamsi', repToShamsi.trim());
    const res = await apiRequest<{ ok: boolean; reports: DailyWorkReport[] }>(
      `/api/reports?${params.toString()}`
    );
    setReports(res.reports);
  }, [repSearch, repFromShamsi, repToShamsi]);

  const loadFinanceList = useCallback(async () => {
    const params = new URLSearchParams();
    if (finStatusFilter) params.set('status', finStatusFilter);
    if (finTypeFilter) params.set('txType', finTypeFilter);
    if (finSearch.trim()) params.set('search', finSearch.trim());
    const res = await apiRequest<{
      ok: boolean;
      transactions: FinancialTransaction[];
    }>(`/api/finance?${params.toString()}`);
    setTransactions(res.transactions);
  }, [finStatusFilter, finTypeFilter, finSearch]);

  const hasInitialLoadedRef = useRef(false);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadDashboardAndSettings(false),
        loadAttendanceList(),
        loadReportsList(),
        loadFinanceList(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadDashboardAndSettings, loadAttendanceList, loadReportsList, loadFinanceList]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) {
      hasInitialLoadedRef.current = true;
      refreshAll();
    }
  }, [refreshAll]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      loadAttendanceList();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadAttendanceList]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      loadReportsList();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadReportsList]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      loadFinanceList();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadFinanceList]);

  const refreshAllSilent = useCallback(async () => {
    try {
      await Promise.all([
        loadDashboardAndSettings(false),
        loadAttendanceList(),
        loadReportsList(),
        loadFinanceList(),
      ]);
    } catch {
      // ignore background poll errors
    }
  }, [loadDashboardAndSettings, loadAttendanceList, loadReportsList, loadFinanceList]);

  // بروزرسانی خودکار وضعیت لحظه‌ای پرسنل، خریدها، تنخواه، مرخصی‌ها و گزارش‌ها در پنل مدیریت (هر ۱۰ ثانیه و هنگام بازگشت به تب مرورگر)
  useEffect(() => {
    const interval = window.setInterval(() => {
      refreshAllSilent();
    }, 10000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshAllSilent();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [refreshAllSilent]);

  const markSectionSeen = async (section: 'reports' | 'finance' | 'historical' | 'leaves') => {
    try {
      await apiRequest('/api/manager/mark-seen', {
        method: 'POST',
        body: JSON.stringify({ section }),
      });
      await loadDashboardAndSettings(false);
    } catch {
      // ignore
    }
  };

  const handleSelectTab = (tab: ManagerTab) => {
    setActiveTab(tab);
    refreshAllSilent();
    if (tab === 'reports' && dashboard?.unseenAlerts.reportsAlert) {
      markSectionSeen('reports');
    } else if (tab === 'finance' && dashboard?.unseenAlerts.financeAlert) {
      markSectionSeen('finance');
    } else if (tab === 'attendance' && dashboard?.unseenAlerts.historicalAlert) {
      markSectionSeen('historical');
      markSectionSeen('leaves');
    }
  };

  const handleManualAttendanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      if (editingLogId) {
        const res = await apiRequest<{ ok: boolean; message: string }>(
          '/api/attendance/manager-override',
          {
            method: 'POST',
            body: JSON.stringify({
              action: 'UPDATE',
              log_id: editingLogId,
              event_type: manualEventType,
              recorded_time: manualTime,
              reason: manualReason,
            }),
          }
        );
        setFeedback({ type: 'success', text: res.message });
      } else {
        const res = await apiRequest<{ ok: boolean; message: string }>(
          '/api/attendance/manager-override',
          {
            method: 'POST',
            body: JSON.stringify({
              action: 'ADD',
              shamsi_date: manualShamsiDate,
              event_type: manualEventType,
              recorded_time: manualTime,
              reason: manualReason,
            }),
          }
        );
        setFeedback({ type: 'success', text: res.message });
      }
      setEditingLogId(null);
      setShowAddLogForm(false);
      setManualReason('');
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePastWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/historical-work', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: pastWorkDate,
          title: pastWorkTitle,
          work_days_count: pastWorkDays,
          net_work_hours: pastWorkHours || 0,
          net_work_minutes_part: pastWorkMins || 0,
          overtime_hours: pastOtHours || 0,
          overtime_minutes_part: pastOtMins || 0,
          note: pastWorkNote,
        }),
      });
      setPastWorkTitle('');
      setPastWorkHours('');
      setPastOtHours('');
      setPastWorkNote('');
      setShowPastWorkForm(false);
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setActionLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (typeof reader.result === 'string') {
          const res = await apiRequest<{ ok: boolean; message: string }>(
            '/api/historical-work/upload-excel',
            {
              method: 'POST',
              body: JSON.stringify({
                file_name: file.name,
                file_base64: reader.result,
                shamsi_date: dashboard?.serverTime.shamsiDate || initialShamsiDate,
              }),
            }
          );
          setFeedback({ type: 'success', text: res.message });
          await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
        }
      } catch (err) {
        setFeedback({ type: 'error', text: (err as Error).message });
      } finally {
        setActionLoading(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReviewHistoricalWork = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/historical-work/${id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewLeaveRequest = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/leaves/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeletePastWork = async (id: number) => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/historical-work/${id}`, {
        method: 'DELETE',
      });
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteLog = async (logId: number) => {
    const reason = 'حذف رکورد تردد توسط مدیریت (مجید نورایی)';
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
            reason,
          }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadAttendanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManagerAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        '/api/finance/manager-direct',
        {
          method: 'POST',
          body: JSON.stringify({
            amount_toman: mgrAmount,
            tx_type: mgrTxType,
            shamsi_date: mgrShamsiDate,
            description: mgrDesc,
            manager_note: mgrNote,
          }),
        }
      );
      setMgrAmount('');
      setMgrDesc('');
      setMgrNote('');
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewFinancialTx = async (txId: number, decision: FinancialStatus) => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/finance/${txId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const openEditFinanceModal = (tx: FinancialTransaction) => {
    setEditingFinTx(tx);
    setEditFinAmount(String(tx.amount_toman));
    setEditFinType(tx.tx_type);
    setEditFinShamsiDate(tx.shamsi_date);
    setEditFinDesc(tx.description);
    setEditFinNote(tx.manager_note || '');
    setEditFinStatus(tx.status);
  };

  const handleUpdateFinancialTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFinTx) return;
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/finance/${editingFinTx.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            amount_toman: editFinAmount,
            tx_type: editFinType,
            shamsi_date: editFinShamsiDate,
            description: editFinDesc,
            manager_note: editFinNote,
            status: editFinStatus,
          }),
        }
      );
      setEditingFinTx(null);
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteFinancialTx = async (txId: number) => {
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/finance/${txId}`, {
        method: 'DELETE',
      });
      if (editingFinTx?.id === txId) {
        setEditingFinTx(null);
      }
      setFeedback({ type: 'success', text: res.message });
      await Promise.all([loadDashboardAndSettings(), loadFinanceList()]);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsForm) return;
    setFeedback(null);
    setActionLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        message: string;
        settings: SystemSettings;
      }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...settingsForm,
          confirm_rules: true,
        }),
      });
      setSettingsForm(res.settings);
      setFeedback({ type: 'success', text: res.message });
      await loadDashboardAndSettings(true);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestSms = async (customTargetPhone?: string) => {
    setFeedback(null);
    setTestingSms(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        sent?: boolean;
        creditOk?: boolean;
        credit?: number | null;
        message: string;
      }>('/api/settings/test-sms', {
        method: 'POST',
        body: JSON.stringify({
          ...(settingsForm || {}),
          test_phone: customTargetPhone || settingsForm?.worker_phone_number,
        }),
      });
      setFeedback({
        type: res.ok || res.sent ? 'success' : 'error',
        text: res.message,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setTestingSms(false);
    }
  };

  const toggleWorkingDay = (dayNum: number) => {
    if (!settingsForm) return;
    const exists = settingsForm.working_days.includes(dayNum);
    const updated = exists
      ? settingsForm.working_days.filter((d) => d !== dayNum)
      : [...settingsForm.working_days, dayNum];
    setSettingsForm({ ...settingsForm, working_days: updated });
  };

  const addHoliday = () => {
    if (!settingsForm || !newHolidayShamsi.trim()) return;
    const val = newHolidayShamsi.trim();
    if (!settingsForm.official_holidays.includes(val)) {
      setSettingsForm({
        ...settingsForm,
        official_holidays: [...settingsForm.official_holidays, val].sort(),
      });
    }
    setNewHolidayShamsi('');
  };

  const removeHoliday = (shamsi: string) => {
    if (!settingsForm) return;
    setSettingsForm({
      ...settingsForm,
      official_holidays: settingsForm.official_holidays.filter((h) => h !== shamsi),
    });
  };

  // داده‌های ترکیبی نمودار روند کلی فعالیت (هفتگی، ماهانه، سالانه) با تفکیک رنگی
  const activityTrendData = React.useMemo(() => {
    const todayStr = dashboard?.serverTime.shamsiDate || initialShamsiDate || '1405/08/01';
    const currentYear = Number(todayStr.slice(0, 4)) || 1405;

    // نقشه‌های کمکی برای شمارش گزارش‌ها و مرخصی‌ها در هر تاریخ یا ماه
    const reportCountByDate = new Map<string, number>();
    const reportCountByMonth = new Map<string, number>();
    for (const r of reports) {
      reportCountByDate.set(r.shamsi_date, (reportCountByDate.get(r.shamsi_date) || 0) + 1);
      const mKey = r.shamsi_date.slice(0, 7);
      reportCountByMonth.set(mKey, (reportCountByMonth.get(mKey) || 0) + 1);
    }

    const leaveCountByDate = new Map<string, number>();
    const leaveCountByMonth = new Map<string, number>();
    for (const lv of leaveRequests) {
      if (lv.status === 'REJECTED') continue;
      leaveCountByDate.set(lv.shamsi_date, (leaveCountByDate.get(lv.shamsi_date) || 0) + 1);
      const mKey = lv.shamsi_date.slice(0, 7);
      leaveCountByMonth.set(mKey, (leaveCountByMonth.get(mKey) || 0) + 1);
    }

    if (chartPeriod === 'weekly') {
      const raw = dashboard?.charts.weekly || [];
      return raw.map((item) => ({
        key: item.shamsiDate,
        label: toPersianDigits(item.shamsiDate.slice(5)),
        subLabel: item.dayName,
        netHours: Number(item.netHours.toFixed(1)),
        overtimeHours: Number(item.overtimeHours.toFixed(1)),
        reportsCount: reportCountByDate.get(item.shamsiDate) || 0,
        leavesCount: leaveCountByDate.get(item.shamsiDate) || 0,
        statusLabel: item.statusLabel,
      }));
    }

    if (chartPeriod === 'monthly') {
      const raw = dashboard?.charts.monthly || [];
      return raw.map((item) => ({
        key: item.shamsiDate,
        label: toPersianDigits(item.shamsiDate.slice(5)),
        subLabel: item.dayName,
        netHours: Number(item.netHours.toFixed(1)),
        overtimeHours: Number(item.overtimeHours.toFixed(1)),
        reportsCount: reportCountByDate.get(item.shamsiDate) || 0,
        leavesCount: leaveCountByDate.get(item.shamsiDate) || 0,
        statusLabel: item.statusLabel,
      }));
    }

    // حالت سالانه: ۱۲ ماه سال شمسی جاری (یا ماه‌های دارای فعالیت)
    const monthBuckets = new Map<
      string,
      {
        key: string;
        monthNum: number;
        netMinutes: number;
        otMinutes: number;
        workDays: number;
      }
    >();

    for (let m = 1; m <= 12; m++) {
      const key = `${currentYear}/${String(m).padStart(2, '0')}`;
      monthBuckets.set(key, {
        key,
        monthNum: m,
        netMinutes: 0,
        otMinutes: 0,
        workDays: 0,
      });
    }

    for (const day of attendanceSummaries) {
      const mKey = day.shamsi_date.slice(0, 7);
      const [y, m] = mKey.split('/').map(Number);
      if (y === currentYear && m >= 1 && m <= 12) {
        const b = monthBuckets.get(mKey)!;
        b.netMinutes += day.net_work_minutes || 0;
        b.otMinutes += day.overtime_minutes || 0;
        if (day.net_work_minutes > 0 || day.overtime_minutes > 0 || day.logs.length > 0) {
          b.workDays += 1;
        }
      }
    }

    for (const rec of historicalRecords) {
      if (rec.status !== 'APPROVED') continue;
      const mKey = rec.shamsi_date.slice(0, 7);
      const [y, m] = mKey.split('/').map(Number);
      if (y === currentYear && m >= 1 && m <= 12) {
        const b = monthBuckets.get(mKey)!;
        b.netMinutes += rec.net_work_minutes || 0;
        b.otMinutes += rec.overtime_minutes || 0;
        b.workDays += rec.work_days_count || 0;
      }
    }

    return Array.from(monthBuckets.values()).map((b) => ({
      key: b.key,
      label: SHAMSI_MONTH_NAMES[b.monthNum - 1] || toPersianDigits(b.key),
      subLabel: `${toPersianDigits(b.workDays)} روز کاری`,
      netHours: Number((b.netMinutes / 60).toFixed(1)),
      overtimeHours: Number((b.otMinutes / 60).toFixed(1)),
      reportsCount: reportCountByMonth.get(b.key) || 0,
      leavesCount: leaveCountByMonth.get(b.key) || 0,
      statusLabel: b.workDays > 0 ? `${toPersianDigits(b.workDays)} روز فعال` : 'بدون ثبت',
    }));
  }, [
    chartPeriod,
    dashboard?.charts.weekly,
    dashboard?.charts.monthly,
    dashboard?.serverTime.shamsiDate,
    initialShamsiDate,
    attendanceSummaries,
    historicalRecords,
    reports,
    leaveRequests,
  ]);

  const maxActivityValue = React.useMemo(() => {
    return Math.max(
      8,
      ...activityTrendData.map(
        (d) => d.netHours + d.overtimeHours + d.reportsCount * 1.5 + d.leavesCount * 2
      )
    );
  }, [activityTrendData]);

  const periodTotals = React.useMemo(() => {
    return activityTrendData.reduce(
      (acc, cur) => {
        acc.netHours += cur.netHours;
        acc.overtimeHours += cur.overtimeHours;
        acc.reportsCount += cur.reportsCount;
        acc.leavesCount += cur.leavesCount;
        return acc;
      },
      { netHours: 0, overtimeHours: 0, reportsCount: 0, leavesCount: 0 }
    );
  }, [activityTrendData]);

  const unseen = dashboard?.unseenAlerts;
  const hasAnyUnseen =
    unseen?.financeAlert ||
    unseen?.reportsAlert ||
    unseen?.historicalAlert ||
    unseen?.correspondenceAlert;

  const currentShamsi = dashboard?.serverTime.shamsiDate || initialShamsiDate;

  // فیلتر گزارش‌های کار در صفحه اول مدیر (امروز و روزهای قبل)
  const dashboardFilteredReports = React.useMemo(() => {
    if (dashReportFilter === 'today') {
      return reports.filter((r) => r.shamsi_date === currentShamsi);
    }
    if (dashReportFilter === 'previous') {
      return reports.filter((r) => r.shamsi_date !== currentShamsi);
    }
    return reports;
  }, [reports, dashReportFilter, currentShamsi]);

  const visibleDashReports = React.useMemo(() => {
    return showAllDashReports ? dashboardFilteredReports : dashboardFilteredReports.slice(0, 3);
  }, [dashboardFilteredReports, showAllDashReports]);

  // شمارش مطالبات در انتظار تأیید (مرخصی، تنخواه، مساعده، سوابق)
  const pendingLeavesCount = React.useMemo(
    () => leaveRequests.filter((l) => l.status === 'PENDING').length,
    [leaveRequests]
  );
  const pendingFinanceCount = React.useMemo(
    () => transactions.filter((t) => t.status === 'PENDING').length,
    [transactions]
  );
  const pendingHistoricalCount = React.useMemo(
    () => historicalRecords.filter((h) => h.status === 'PENDING').length,
    [historicalRecords]
  );
  const totalPendingClaimsCount =
    pendingLeavesCount + pendingFinanceCount + pendingHistoricalCount;

  // استخراج ماه‌های موجود در جدول تردد برای فیلتر ماهانه در پنل مدیر
  const availableMgrHistoryMonths = React.useMemo(() => {
    const map = new Map<string, { key: string; year: number; month: number; count: number }>();
    const curPrefix = (dashboard?.serverTime.shamsiDate || initialShamsiDate || '1405/08/01').slice(
      0,
      7
    );
    const [cy, cm] = curPrefix.split('/').map(Number);
    if (cy && cm) {
      map.set(curPrefix, { key: curPrefix, year: cy, month: cm, count: 0 });
    }
    for (const day of attendanceSummaries) {
      const prefix = day.shamsi_date.slice(0, 7);
      const [y, m] = prefix.split('/').map(Number);
      if (y && m) {
        const existing = map.get(prefix) || { key: prefix, year: y, month: m, count: 0 };
        existing.count += 1;
        map.set(prefix, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.year !== b.year ? b.year - a.year : b.month - a.month
    );
  }, [attendanceSummaries, dashboard?.serverTime.shamsiDate, initialShamsiDate]);

  const effectiveMgrHistoryMonth = React.useMemo(() => {
    if (selectedMgrHistoryMonth) return selectedMgrHistoryMonth;
    const curPrefix = (dashboard?.serverTime.shamsiDate || initialShamsiDate || '1405/08/01').slice(
      0,
      7
    );
    const curItem = availableMgrHistoryMonths.find((m) => m.key === curPrefix);
    if (curItem && curItem.count > 0) return curPrefix;
    const firstWithData = availableMgrHistoryMonths.find((m) => m.count > 0);
    return firstWithData ? firstWithData.key : curPrefix;
  }, [selectedMgrHistoryMonth, availableMgrHistoryMonths, dashboard?.serverTime.shamsiDate, initialShamsiDate]);

  const mgrMonthFilteredSummaries = React.useMemo(() => {
    if (attFromShamsi.trim() || attToShamsi.trim()) {
      return attendanceSummaries;
    }
    return attendanceSummaries.filter((d) =>
      d.shamsi_date.startsWith(`${effectiveMgrHistoryMonth}/`)
    );
  }, [attendanceSummaries, effectiveMgrHistoryMonth, attFromShamsi, attToShamsi]);

  const visibleMgrSummaries = React.useMemo(() => {
    return showAllMgrMonthHistory
      ? mgrMonthFilteredSummaries
      : mgrMonthFilteredSummaries.slice(0, 2);
  }, [mgrMonthFilteredSummaries, showAllMgrMonthHistory]);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-3 pb-24 space-y-3.5">
      {/* بنر اصلی سرمه‌ای و طلایی */}
      <HeroBanner
        role="manager"
        shamsiDate={dashboard?.serverTime.shamsiDate || initialShamsiDate}
        timeHHMM={dashboard?.serverTime.timeHHMM || ''}
        bannerBgUrl={bannerBgUrl}
        userAvatarUrl={user.avatar_url}
        onRefresh={refreshAll}
        loading={loading}
      />

      {/* هشدار هوشمند در صورت فراموشی ثبت خروج پرسنل */}
      {dashboard?.liveState?.forgotten_checkout_warning &&
        dashboard.liveState.forgotten_checkout_message && (
          <div className="rounded-2xl bg-amber-50 border border-amber-300 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-amber-950 shadow-2xs">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{dashboard.liveState.forgotten_checkout_message}</span>
            </div>
            <button
              type="button"
              onClick={() => handleSelectTab('attendance')}
              className="px-2.5 py-1 rounded-lg bg-[#0B192C] text-[#C5A059] text-[11px] font-bold shrink-0 cursor-pointer"
            >
              بررسی و اصلاح تردد
            </button>
          </div>
        )}

      {/* نوار اعلان جمع‌وجور و شیک در صورت وجود مورد جدید از طرف پرسنل */}
      {hasAnyUnseen && (
        <div className="rounded-2xl bg-white border border-[#C5A059]/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0B192C]">
            <GoldenBlinkDot />
            <span>اعلان جدید از پرسنل (امید میثمی):</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {unseen?.financeAlert && (
              <button
                type="button"
                onClick={() => handleSelectTab('finance')}
                className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <GoldenBlinkDot />
                <span>درخواست مالی / تنخواه ({toPersianDigits(unseen.pendingFinanceCount)})</span>
              </button>
            )}
            {unseen?.reportsAlert && (
              <button
                type="button"
                onClick={() => handleSelectTab('reports')}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <GoldenBlinkDot />
                <span>گزارش کار ({toPersianDigits(unseen.unseenReportsCount)})</span>
              </button>
            )}
            {unseen?.historicalAlert && (
              <button
                type="button"
                onClick={() => handleSelectTab('attendance')}
                className="px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-300 text-sky-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <GoldenBlinkDot />
                <span>مرخصی / سوابق ({toPersianDigits(unseen.pendingHistoricalCount)})</span>
              </button>
            )}
            {unseen?.correspondenceAlert && (
              <button
                type="button"
                onClick={() => handleSelectTab('correspondence')}
                className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-300 text-purple-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <GoldenBlinkDot />
                <span>پیام جدید ({toPersianDigits(unseen.unreadCorrespondenceCount)})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* کادر وضعیت لحظه‌ای پرسنل: امید میثمی + لیست پرداختی‌های تأییدشده در اولین نگاه */}
      {dashboard?.liveState && (
        <WorkerStatusAvatar
          status={dashboard.liveState.status}
          statusText={dashboard.liveState.status_text}
          statusDetail={dashboard.liveState.status_detail}
          isOvertimeActive={dashboard.liveState.is_overtime_active}
          workerAvatarUrl={dashboard.liveState.worker_profile?.avatar_url}
          approvedPaymentsToman={dashboard.kpis.approvedPaymentsToman}
          approvedTransactions={transactions.filter((t) => t.status === 'APPROVED')}
          pendingPaymentsCount={dashboard.kpis.pendingPaymentsCount}
          workerPhone={dashboard.liveState.worker_profile?.phone_number}
          onOpenFinance={() => handleSelectTab('finance')}
        />
      )}

      {feedback && (
        <div
          role="alert"
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs text-[#9A7428] underline shrink-0 cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {loading && !dashboard ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-xs text-slate-500">
          در حال بارگذاری اطلاعات...
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && !dashboard && (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-3 shadow-2xs">
              <p className="text-xs font-bold text-[#0B192C]">
                اطلاعات داشبورد هنوز بارگذاری نشده است.
              </p>
              <button
                type="button"
                onClick={() => loadDashboardAndSettings()}
                className="min-h-[38px] px-5 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
              >
                بارگذاری مجدد داشبورد
              </button>
            </div>
          )}

          {/* ================= تب ۱: صفحه اول مدیریت (مکاتبات ← گزارش کار ← مطالبات ← نمودار روند کلی) ================= */}
          {activeTab === 'dashboard' && dashboard && (
            <div className="space-y-4">
              {/* ۱. بخش مکاتبات کاری با چیدمان حرفه‌ای و دسترسی آسان بلافاصله پس از کادر وضعیت پرسنل */}
              <WorkCorrespondenceSection
                role="manager"
                todayShamsi={currentShamsi}
                onUnreadChange={() => loadDashboardAndSettings()}
              />

              {/* ۲. بخش مشاهده گزارش کار امروز و روزهای قبل */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#C5A059]" />
                    <div>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C] flex items-center gap-1.5">
                        <span>گزارش کار روزانه پرسنل (امروز و روزهای قبل)</span>
                        {dashboard.unseenAlerts.reportsAlert && <GoldenBlinkDot />}
                      </h3>
                      <p className="text-[10.5px] text-slate-500">
                        بررسی سریع گزارش فعالیت‌های ثبت‌شده امروز ({toPersianDigits(currentShamsi)}) و سوابق روزهای گذشته
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setDashReportFilter('today_and_recent')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                          dashReportFilter === 'today_and_recent'
                            ? 'bg-[#0B192C] text-[#C5A059]'
                            : 'text-slate-600 hover:text-[#0B192C]'
                        }`}
                      >
                        همه ({toPersianDigits(reports.length)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashReportFilter('today')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                          dashReportFilter === 'today'
                            ? 'bg-[#0B192C] text-[#C5A059]'
                            : 'text-slate-600 hover:text-[#0B192C]'
                        }`}
                      >
                        امروز (
                        {toPersianDigits(
                          reports.filter((r) => r.shamsi_date === currentShamsi).length
                        )}
                        )
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashReportFilter('previous')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                          dashReportFilter === 'previous'
                            ? 'bg-[#0B192C] text-[#C5A059]'
                            : 'text-slate-600 hover:text-[#0B192C]'
                        }`}
                      >
                        روزهای قبل
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectTab('reports')}
                      className="min-h-[30px] px-2.5 rounded-xl bg-[#FCF9F2] hover:bg-amber-100/70 border border-[#C5A059]/60 text-[11px] font-bold text-[#0B192C] cursor-pointer"
                    >
                      چک‌لیست و آرشیو کامل ←
                    </button>
                  </div>
                </div>

                {dashboardFilteredReports.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-4 text-center space-y-1.5">
                    <p className="text-xs font-semibold text-slate-600">
                      {dashReportFilter === 'today'
                        ? `هنوز برای امروز (${toPersianDigits(currentShamsi)}) گزارش کاری ثبت نشده است.`
                        : 'گزارش کاری در این بخش ثبت نشده است.'}
                    </p>
                    {dashReportFilter === 'today' && reports.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDashReportFilter('today_and_recent')}
                        className="text-[11px] font-bold text-[#9A7428] underline cursor-pointer"
                      >
                        مشاهده گزارش‌های روزهای قبل ({toPersianDigits(reports.length)} مورد)
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="divide-y divide-slate-100">
                      {visibleDashReports.map((rep) => {
                        const isTodayReport = rep.shamsi_date === currentShamsi;
                        return (
                          <div key={rep.id} className="py-2.5 first:pt-1 last:pb-1 space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                              <div className="flex items-center gap-1.5">
                                {!rep.is_seen_by_manager && <GoldenBlinkDot title="گزارش جدید" />}
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                                    isTodayReport
                                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {isTodayReport ? 'امروز' : 'روزهای قبل'}
                                </span>
                                <span className="font-bold text-[#0B192C]">
                                  {toPersianDigits(rep.shamsi_date)}
                                </span>
                                <span aria-hidden="true" className="text-slate-400">
                                  ·
                                </span>
                                <span className="text-slate-500">
                                  ساعت {toPersianDigits(rep.recorded_time.slice(0, 5))}
                                </span>
                              </div>
                              {rep.duration_minutes ? (
                                <span className="text-[#9A7428] font-bold text-[11px]">
                                  مدت فعالیت: {formatMinutesToDurationPersian(rep.duration_minutes)}
                                </span>
                              ) : null}
                            </div>

                            <p className="text-xs text-slate-800 leading-6 whitespace-pre-line">
                              {rep.activity_description}
                            </p>

                            {rep.photo_url && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewFile({
                                      file_url: rep.photo_url!,
                                      file_name:
                                        rep.photo_name || `تصویر گزارش ${rep.shamsi_date}`,
                                      mime_type: 'image/jpeg',
                                    })
                                  }
                                  className="inline-flex items-center gap-2 p-1 pr-2 rounded-xl bg-slate-50 hover:bg-amber-50/60 border border-slate-200 hover:border-[#C5A059] text-[11px] font-semibold text-[#0B192C] transition-colors cursor-pointer"
                                >
                                  <img
                                    src={rep.photo_url}
                                    alt="تصویر کار انجام‌شده"
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200"
                                  />
                                  <ImageIcon className="w-3.5 h-3.5 text-[#9A7428]" />
                                  <span>مشاهده تصویر پیوست گزارش</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {dashboardFilteredReports.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setShowAllDashReports((p) => !p)}
                        className="w-full min-h-[34px] rounded-xl bg-slate-50 hover:bg-amber-50/50 border border-slate-200 text-[11px] font-bold text-[#0B192C] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        {showAllDashReports ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5 text-[#9A7428]" />
                            <span>بستن و نمایش ۳ گزارش آخر</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5 text-[#9A7428]" />
                            <span>
                              نمایش همه گزارش‌های این بخش (
                              {toPersianDigits(dashboardFilteredReports.length)} مورد)
                            </span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ۳. بخش مطالبات پرسنل (مرخصی، درخواست تنخواه، مساعده و سایر موارد) با امکان تعیین تکلیف فوری */}
              <div className="rounded-2xl bg-white border border-[#C5A059]/55 p-4 space-y-3 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-[#C5A059]" />
                    <div>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C] flex items-center gap-1.5">
                        <span>مطالبات و درخواست‌های پرسنل (مرخصی، تنخواه، مساعده و سوابق)</span>
                        {totalPendingClaimsCount > 0 && <GoldenBlinkDot />}
                      </h3>
                      <p className="text-[10.5px] text-slate-500">
                        تعیین تکلیف سریع مرخصی‌ها، درخواست‌های تنخواه، مساعده، هزینه‌های متفرقه و سوابق کاری
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectTab('finance')}
                      className="min-h-[30px] px-2.5 rounded-xl bg-[#0B192C] text-[#C5A059] text-[11px] font-bold cursor-pointer"
                    >
                      + ثبت پرداخت / مساعده / هزینه
                    </button>
                  </div>
                </div>

                {/* فیلتر دسته‌بندی مطالبات */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {[
                    {
                      id: 'all' as const,
                      label: 'همه مطالبات و سوابق اخیر',
                      count:
                        leaveRequests.length + transactions.length + historicalRecords.length,
                    },
                    {
                      id: 'pending' as const,
                      label: 'در انتظار تأیید',
                      count: totalPendingClaimsCount,
                    },
                    {
                      id: 'leaves' as const,
                      label: 'مرخصی روزانه و ساعتی',
                      count: leaveRequests.length,
                    },
                    {
                      id: 'petty_cash' as const,
                      label: 'تنخواه و هزینه متفرقه',
                      count: transactions.filter(
                        (t) => t.tx_type === 'PETTY_CASH' || t.tx_type === 'OTHER'
                      ).length,
                    },
                    {
                      id: 'advance' as const,
                      label: 'مساعده، علی‌الحساب و حقوق',
                      count: transactions.filter(
                        (t) =>
                          t.tx_type === 'ADVANCE' ||
                          t.tx_type === 'ON_ACCOUNT' ||
                          t.tx_type === 'SALARY'
                      ).length,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDashClaimFilter(tab.id)}
                      className={`px-2.5 py-1 rounded-xl font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                        dashClaimFilter === tab.id
                          ? 'bg-[#0B192C] text-[#C5A059]'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                      }`}
                    >
                      {tab.id === 'pending' && tab.count > 0 && <GoldenBlinkDot />}
                      <span>{tab.label}</span>
                      <span className="opacity-80 tabular-nums">
                        ({toPersianDigits(tab.count)})
                      </span>
                    </button>
                  ))}
                </div>

                {/* لیست یکپارچه مطالبات بر اساس فیلتر انتخاب‌شده */}
                {(() => {
                  const filteredLeaves = leaveRequests
                    .filter((lv) => {
                      if (dashClaimFilter === 'pending') return lv.status === 'PENDING';
                      if (dashClaimFilter === 'leaves' || dashClaimFilter === 'all') return true;
                      return false;
                    })
                    .sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1));

                  const filteredTxs = transactions
                    .filter((tx) => {
                      if (dashClaimFilter === 'pending') return tx.status === 'PENDING';
                      if (dashClaimFilter === 'leaves') return false;
                      if (dashClaimFilter === 'petty_cash')
                        return tx.tx_type === 'PETTY_CASH' || tx.tx_type === 'OTHER';
                      if (dashClaimFilter === 'advance')
                        return (
                          tx.tx_type === 'ADVANCE' ||
                          tx.tx_type === 'ON_ACCOUNT' ||
                          tx.tx_type === 'SALARY'
                        );
                      return true;
                    })
                    .sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1));

                  const filteredHistorical = historicalRecords.filter((rec) => {
                    if (dashClaimFilter === 'pending') return rec.status === 'PENDING';
                    if (dashClaimFilter === 'all') return rec.status === 'PENDING';
                    return false;
                  });

                  const totalItems =
                    filteredLeaves.length + filteredTxs.length + filteredHistorical.length;

                  if (totalItems === 0) {
                    return (
                      <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-4 text-center text-xs text-slate-500">
                        موردی در این بخش از مطالبات یافت نشد.
                      </div>
                    );
                  }

                  const displayedLeaves = showAllDashClaims
                    ? filteredLeaves
                    : filteredLeaves.slice(0, 2);
                  const displayedTxs = showAllDashClaims
                    ? filteredTxs
                    : filteredTxs.slice(0, 3);

                  return (
                    <div className="space-y-2.5">
                      {/* الف) درخواست‌های مرخصی */}
                      {displayedLeaves.length > 0 && (
                        <div className="space-y-2">
                          {displayedLeaves.map((lv) => (
                            <div
                              key={`leave-${lv.id}`}
                              className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 text-xs ${
                                lv.status === 'PENDING'
                                  ? 'bg-teal-50/60 border-teal-300'
                                  : 'bg-slate-50/70 border-slate-200'
                              }`}
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {lv.status === 'PENDING' && <GoldenBlinkDot />}
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                                      lv.leave_type === 'DAILY'
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-sky-600 text-white'
                                    }`}
                                  >
                                    {lv.leave_type === 'DAILY' ? 'مرخصی روزانه' : 'مرخصی ساعتی'}
                                  </span>
                                  <span className="font-bold text-[#0B192C] tabular-nums">
                                    تاریخ {toPersianDigits(lv.shamsi_date)}
                                  </span>
                                  {lv.leave_type === 'HOURLY' && (
                                    <span className="text-slate-600 tabular-nums">
                                      ({toPersianDigits(lv.start_time || '')} تا{' '}
                                      {toPersianDigits(lv.end_time || '')} —{' '}
                                      {formatMinutesToDurationPersian(lv.duration_minutes)})
                                    </span>
                                  )}
                                </div>
                                {lv.reason && (
                                  <p className="text-[11px] text-slate-700">توضیحات: {lv.reason}</p>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-[11px] font-bold ${
                                    lv.status === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : lv.status === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-[#9A7428]'
                                  }`}
                                >
                                  {STATUS_LABELS[lv.status]}
                                </span>
                                {lv.status === 'PENDING' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleReviewLeaveRequest(lv.id, 'APPROVED')}
                                      className="min-h-[28px] px-2.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>تأیید مرخصی</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleReviewLeaveRequest(lv.id, 'REJECTED')}
                                      className="min-h-[28px] px-2 rounded-lg bg-red-50 text-red-800 border border-red-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                      <span>رد</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ب) مطالبات مالی: تنخواه، مساعده، علی‌الحساب، هزینه‌های متفرقه و حقوق */}
                      {displayedTxs.length > 0 && (
                        <div className="space-y-2">
                          {displayedTxs.map((tx) => (
                            <div
                              key={`tx-${tx.id}`}
                              className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 text-xs ${
                                tx.status === 'PENDING'
                                  ? 'bg-amber-50/70 border-amber-300'
                                  : 'bg-slate-50/70 border-slate-200'
                              }`}
                            >
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {tx.status === 'PENDING' && <GoldenBlinkDot />}
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                                      tx.tx_type === 'PETTY_CASH'
                                        ? 'bg-amber-600 text-white'
                                        : tx.tx_type === 'ADVANCE'
                                          ? 'bg-purple-600 text-white'
                                          : tx.tx_type === 'OTHER'
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-[#0B192C] text-[#C5A059]'
                                    }`}
                                  >
                                    {TX_TYPE_LABELS[tx.tx_type]}
                                  </span>
                                  <span className="font-extrabold text-[#0B192C] tabular-nums text-xs sm:text-sm">
                                    {formatToman(tx.amount_toman)}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-400">
                                    ·
                                  </span>
                                  <span className="text-slate-500 tabular-nums">
                                    {toPersianDigits(tx.shamsi_date)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-700 truncate">
                                  {tx.description}
                                </p>
                                {tx.receipt_file_url && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewFile({
                                        file_url: tx.receipt_file_url!,
                                        file_name:
                                          tx.receipt_file_name || `فاکتور-${tx.shamsi_date}.jpg`,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-[#C5A059]/60 text-[10.5px] font-bold text-[#0B192C] cursor-pointer"
                                  >
                                    <Receipt className="w-3 h-3 text-[#9A7428]" />
                                    <span>مشاهده فاکتور پیوست</span>
                                  </button>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <span
                                  className={`text-[11px] font-bold ${
                                    tx.status === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : tx.status === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-[#9A7428]'
                                  }`}
                                >
                                  {STATUS_LABELS[tx.status]}
                                </span>
                                {tx.status === 'PENDING' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleReviewFinancialTx(tx.id, 'APPROVED')}
                                      className="min-h-[28px] px-2.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>تأیید</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleReviewFinancialTx(tx.id, 'REJECTED')}
                                      className="min-h-[28px] px-2 rounded-lg bg-red-50 text-red-800 border border-red-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                      <span>رد</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditFinanceModal(tx)}
                                  className="min-h-[28px] px-2 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 border border-[#C5A059]/60 text-[10.5px] font-bold text-[#0B192C] flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3 text-[#9A7428]" />
                                  <span>ویرایش</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ج) سوابق کارکرد قبلی در انتظار تأیید */}
                      {filteredHistorical.length > 0 && (
                        <div className="space-y-2">
                          {filteredHistorical.map((rec) => (
                            <div
                              key={`hist-${rec.id}`}
                              className="rounded-xl border border-sky-300 bg-sky-50/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5 font-bold text-[#0B192C]">
                                  <GoldenBlinkDot />
                                  <span>سابقه کارکرد / اکسل: {rec.title}</span>
                                  <span className="text-slate-500 tabular-nums">
                                    ({toPersianDigits(rec.shamsi_date)})
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 tabular-nums">
                                  کارکرد: {formatMinutesToDurationPersian(rec.net_work_minutes)} |
                                  اضافه‌کاری: {formatMinutesToDurationPersian(rec.overtime_minutes)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewHistoricalWork(rec.id, 'APPROVED')}
                                  className="min-h-[28px] px-2.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>تأیید سابقه</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewHistoricalWork(rec.id, 'REJECTED')}
                                  className="min-h-[28px] px-2 rounded-lg bg-red-50 text-red-800 border border-red-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                  <span>رد</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {totalItems > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAllDashClaims((p) => !p)}
                          className="w-full min-h-[34px] rounded-xl bg-slate-50 hover:bg-amber-50/50 border border-slate-200 text-[11px] font-bold text-[#0B192C] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {showAllDashClaims ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>بستن و نمایش موارد اخیر</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>
                                نمایش همه مطالبات ({toPersianDigits(totalItems)} مورد)
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* ۳-ب. صورتحساب دقیق هر ماه / دوره کاری (حقوق + اضافه‌کاری و جمع پرداختی مدیر به تفکیک ماه) */}
              <MonthlyStatementSection
                role="manager"
                currentShamsiDate={currentShamsi}
                collaborationStartShamsi={dashboard.settings.collaboration_start_shamsi}
                dailySummaries={attendanceSummaries}
                historicalRecords={historicalRecords}
                transactions={transactions}
                settings={dashboard.settings}
              />

              {/* ۴. نمودار زیبای روند کلی فعالیت با حالات هفتگی، ماهانه و سالانه و تفکیک رنگی در یک نگاه */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3.5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                      نمودار روند کلی فعالیت — امید میثمی
                    </h3>
                    <p className="text-[10.5px] text-slate-500">
                      نمای کلی حضور، اضافه‌کاری، گزارش‌های روزانه و مرخصی‌ها در یک نگاه با تفکیک رنگی
                    </p>
                  </div>

                  {/* کلیدهای سه‌حالته هفتگی، ماهانه و سالانه */}
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                    <button
                      type="button"
                      onClick={() => setChartPeriod('weekly')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        chartPeriod === 'weekly'
                          ? 'bg-[#0B192C] text-[#C5A059] shadow-2xs'
                          : 'text-slate-600 hover:text-[#0B192C]'
                      }`}
                    >
                      هفتگی
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartPeriod('monthly')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        chartPeriod === 'monthly'
                          ? 'bg-[#0B192C] text-[#C5A059] shadow-2xs'
                          : 'text-slate-600 hover:text-[#0B192C]'
                      }`}
                    >
                      ماهانه
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartPeriod('yearly')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        chartPeriod === 'yearly'
                          ? 'bg-[#0B192C] text-[#C5A059] shadow-2xs'
                          : 'text-slate-600 hover:text-[#0B192C]'
                      }`}
                    >
                      سالانه
                    </button>
                  </div>
                </div>

                {/* راهنمای رنگ‌ها و خلاصه مجموع دوره انتخاب‌شده + مجموع کارکرد و پرداختی کل تا تاریخ روز */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-emerald-50/80 border border-emerald-200 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                      <span className="text-[11px] font-bold text-emerald-950">کارکرد خالص</span>
                    </div>
                    <strong className="text-emerald-800 font-extrabold tabular-nums">
                      {toPersianDigits(Number(periodTotals.netHours.toFixed(1)))} س
                    </strong>
                  </div>

                  <div className="rounded-xl bg-amber-50/80 border border-amber-200 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-[11px] font-bold text-amber-950">اضافه‌کاری</span>
                    </div>
                    <strong className="text-[#9A7428] font-extrabold tabular-nums">
                      +{toPersianDigits(Number(periodTotals.overtimeHours.toFixed(1)))} س
                    </strong>
                  </div>

                  <div className="rounded-xl bg-sky-50/80 border border-sky-200 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
                      <span className="text-[11px] font-bold text-sky-950">گزارش کار</span>
                    </div>
                    <strong className="text-sky-800 font-extrabold tabular-nums">
                      {toPersianDigits(periodTotals.reportsCount)} مورد
                    </strong>
                  </div>

                  <div className="rounded-xl bg-purple-50/80 border border-purple-200 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-600 shrink-0" />
                      <span className="text-[11px] font-bold text-purple-950">مرخصی ثبت‌شده</span>
                    </div>
                    <strong className="text-purple-800 font-extrabold tabular-nums">
                      {toPersianDigits(periodTotals.leavesCount)} مورد
                    </strong>
                  </div>

                  <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/70 px-3 py-2 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#C5A059] shrink-0" />
                      <span className="text-[11px] font-bold text-[#0B192C] truncate">
                        مجموع کارکرد تا تاریخ روز (حقوق + اضافه‌کاری)
                      </span>
                    </div>
                    <strong className="text-[#0B192C] font-extrabold tabular-nums whitespace-nowrap">
                      {formatToman(
                        dashboard.kpis.totalSalaryPlusOvertimeToman ??
                          (dashboard.kpis.earnedRegularWorkToman ?? 0) +
                            dashboard.kpis.totalOvertimePayToman
                      )}
                    </strong>
                  </div>

                  <div className="rounded-xl bg-teal-50/85 border border-teal-200 px-3 py-2 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-600 shrink-0" />
                      <span className="text-[11px] font-bold text-teal-950 truncate">
                        جمع کل پرداختی تا تاریخ روز
                      </span>
                    </div>
                    <strong className="text-teal-800 font-extrabold tabular-nums whitespace-nowrap">
                      {formatToman(dashboard.kpis.approvedPaymentsToman)}
                    </strong>
                  </div>
                </div>

                {activityTrendData.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    هنوز داده‌ای برای نمایش نمودار ثبت نشده است.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* نمودار ستونی عمودی چندرنگ برای دید سریع در یک نگاه */}
                    <div className="rounded-2xl bg-gradient-to-b from-slate-50/90 to-[#FCF9F2]/60 border border-slate-200/80 p-3.5 overflow-x-auto">
                      <div className="min-w-[500px] h-40 flex items-end justify-between gap-1.5 pt-4 pb-1 px-1">
                        {activityTrendData.map((item) => {
                          const netH = Math.min(
                            100,
                            Math.round((item.netHours / maxActivityValue) * 100)
                          );
                          const otH = Math.min(
                            100 - netH,
                            Math.round((item.overtimeHours / maxActivityValue) * 100)
                          );
                          const repH = Math.min(
                            100 - netH - otH,
                            Math.round(((item.reportsCount * 1.5) / maxActivityValue) * 100)
                          );
                          const lvH = Math.min(
                            100 - netH - otH - repH,
                            Math.round(((item.leavesCount * 2) / maxActivityValue) * 100)
                          );
                          const hasAny =
                            item.netHours > 0 ||
                            item.overtimeHours > 0 ||
                            item.reportsCount > 0 ||
                            item.leavesCount > 0;

                          return (
                            <div
                              key={item.key}
                              title={`${item.label} (${item.subLabel}) — کارکرد: ${toPersianDigits(item.netHours)} ساعت | اضافه‌کاری: ${toPersianDigits(item.overtimeHours)} ساعت | گزارش: ${toPersianDigits(item.reportsCount)} | مرخصی: ${toPersianDigits(item.leavesCount)}`}
                              className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group min-w-[26px]"
                            >
                              <div className="w-full max-w-[28px] h-28 rounded-t-lg bg-slate-200/60 overflow-hidden flex flex-col justify-end p-0.5 gap-0.5">
                                {lvH > 0 && (
                                  <div
                                    style={{ height: `${Math.max(8, lvH)}%` }}
                                    className="w-full rounded-xs bg-purple-600 transition-all"
                                  />
                                )}
                                {repH > 0 && (
                                  <div
                                    style={{ height: `${Math.max(8, repH)}%` }}
                                    className="w-full rounded-xs bg-sky-500 transition-all"
                                  />
                                )}
                                {otH > 0 && (
                                  <div
                                    style={{ height: `${Math.max(8, otH)}%` }}
                                    className="w-full rounded-xs bg-amber-500 transition-all"
                                  />
                                )}
                                {netH > 0 && (
                                  <div
                                    style={{ height: `${Math.max(8, netH)}%` }}
                                    className="w-full rounded-xs bg-emerald-600 transition-all"
                                  />
                                )}
                                {!hasAny && (
                                  <div className="w-full h-1 rounded-xs bg-slate-300/70" />
                                )}
                              </div>
                              <span className="text-[9.5px] font-bold text-[#0B192C] tabular-nums truncate max-w-full">
                                {item.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ردیف‌های تفکیکی با رنگ‌های مشخص برای خوانایی دقیق */}
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {activityTrendData
                        .filter(
                          (it) =>
                            chartPeriod === 'weekly' ||
                            it.netHours > 0 ||
                            it.overtimeHours > 0 ||
                            it.reportsCount > 0 ||
                            it.leavesCount > 0
                        )
                        .map((item) => {
                          const netPct = Math.min(100, (item.netHours / maxActivityValue) * 100);
                          const otPct = Math.min(
                            100 - netPct,
                            (item.overtimeHours / maxActivityValue) * 100
                          );
                          const repPct = Math.min(
                            100 - netPct - otPct,
                            ((item.reportsCount * 1.5) / maxActivityValue) * 100
                          );
                          const lvPct = Math.min(
                            100 - netPct - otPct - repPct,
                            ((item.leavesCount * 2) / maxActivityValue) * 100
                          );

                          return (
                            <div
                              key={`row-${item.key}`}
                              className="grid grid-cols-12 items-center gap-2 text-[11px] py-1 border-b border-slate-100 last:border-b-0"
                            >
                              <div className="col-span-4 sm:col-span-3 flex items-center gap-1 tabular-nums">
                                <span className="font-bold text-[#0B192C]">{item.label}</span>
                                <span className="text-slate-500 text-[10px]">
                                  ({item.subLabel})
                                </span>
                              </div>
                              <div className="col-span-4 sm:col-span-5 h-3 rounded-lg bg-slate-100 overflow-hidden flex gap-0.5 p-0.5">
                                {netPct > 0 && (
                                  <div
                                    style={{ width: `${Math.max(6, netPct)}%` }}
                                    className="bg-emerald-600 h-full rounded-xs"
                                  />
                                )}
                                {otPct > 0 && (
                                  <div
                                    style={{ width: `${Math.max(6, otPct)}%` }}
                                    className="bg-amber-500 h-full rounded-xs"
                                  />
                                )}
                                {repPct > 0 && (
                                  <div
                                    style={{ width: `${Math.max(6, repPct)}%` }}
                                    className="bg-sky-500 h-full rounded-xs"
                                  />
                                )}
                                {lvPct > 0 && (
                                  <div
                                    style={{ width: `${Math.max(6, lvPct)}%` }}
                                    className="bg-purple-600 h-full rounded-xs"
                                  />
                                )}
                              </div>
                              <div className="col-span-4 text-left tabular-nums flex flex-wrap items-center justify-end gap-1 text-[10.5px]">
                                <span className="text-emerald-800 font-bold">
                                  {toPersianDigits(item.netHours)}س
                                </span>
                                {item.overtimeHours > 0 && (
                                  <span className="text-[#9A7428] font-bold">
                                    +{toPersianDigits(item.overtimeHours)}س
                                  </span>
                                )}
                                {item.reportsCount > 0 && (
                                  <span className="px-1.5 py-0.2 rounded bg-sky-50 text-sky-800 font-semibold">
                                    {toPersianDigits(item.reportsCount)} گزارش
                                  </span>
                                )}
                                {item.leavesCount > 0 && (
                                  <span className="px-1.5 py-0.2 rounded bg-purple-50 text-purple-800 font-semibold">
                                    {toPersianDigits(item.leavesCount)} مرخصی
                                  </span>
                                )}
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

          {/* ================= تب ۲: تردد، خلاصه ساعات کاری و اضافه‌کاری، تقویم کارکرد، مرخصی‌ها و اکسل ================= */}
          {activeTab === 'attendance' && (
            <div className="space-y-4">
              {/* خلاصه کل ساعات کاری، اضافه‌کاری، روزهای کاری و جزئیات شیفت و قرارداد (منتقل‌شده از صفحه اول به تب تردد) */}
              {dashboard && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-2xl bg-gradient-to-br from-sky-50 via-white to-cyan-50/70 border border-sky-200 p-3.5 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-semibold text-sky-800">
                        مجموع ساعات کاری خالص
                      </div>
                      <div className="text-sm sm:text-base font-extrabold text-[#0B192C] tabular-nums">
                        {formatMinutesToDurationPersian(dashboard.kpis.totalNetWorkMinutes)}
                      </div>
                      <div className="text-[11px] text-slate-600 pt-1 border-t border-sky-100 tabular-nums">
                        معادل {formatMinutesToHHMM(dashboard.kpis.totalNetWorkMinutes)} ساعت
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-white to-yellow-50/70 border border-amber-300 p-3.5 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-semibold text-amber-900">
                        مجموع اضافه‌کاری تأییدشده
                      </div>
                      <div className="text-sm sm:text-base font-extrabold text-[#9A7428] tabular-nums">
                        {formatMinutesToDurationPersian(dashboard.kpis.totalOvertimeMinutes)}
                      </div>
                      <div className="text-[11px] text-slate-600 pt-1 border-t border-amber-100 tabular-nums truncate">
                        {dashboard.kpis.totalOvertimePayToman > 0
                          ? `مبلغ: ${formatToman(dashboard.kpis.totalOvertimePayToman)}`
                          : `معادل ${formatMinutesToHHMM(dashboard.kpis.totalOvertimeMinutes)}`}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gradient-to-br from-purple-50 via-white to-pink-50/60 border border-purple-200 p-3.5 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-semibold text-purple-900">
                        روزهای کاری ثبت‌شده
                      </div>
                      <div className="text-sm sm:text-base font-extrabold text-[#0B192C] tabular-nums">
                        {toPersianDigits(dashboard.kpis.totalWorkDays)} روز
                      </div>
                      <div className="text-[11px] text-slate-600 pt-1 border-t border-purple-100 tabular-nums">
                        شروع قرارداد: {toPersianDigits(dashboard.settings.collaboration_start_shamsi)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-teal-50/70 border border-emerald-200 p-3.5 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-semibold text-emerald-800">
                        ساعت شیفت و نرخ اضافه‌کاری
                      </div>
                      <div className="text-xs sm:text-sm font-extrabold text-[#0B192C] tabular-nums">
                        {toPersianDigits(dashboard.settings.shift_start_time)} تا{' '}
                        {toPersianDigits(dashboard.settings.shift_end_time)}
                      </div>
                      <div className="text-[11px] text-[#9A7428] font-bold pt-1 border-t border-emerald-100 tabular-nums">
                        نرخ ساعتی:{' '}
                        {dashboard.kpis.effectiveOvertimeHourlyRateToman > 0
                          ? formatToman(dashboard.kpis.effectiveOvertimeHourlyRateToman)
                          : 'تعیین نشده'}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ۱. تقویم تصویری کارکرد ماهانه */}
              <MonthlyAttendanceCalendar
                currentShamsiDate={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                dailySummaries={attendanceSummaries}
                leaveRequests={leaveRequests}
                historicalRecords={historicalRecords}
                onMonthChange={(y, m) => {
                  setSelectedMgrHistoryMonth(`${y}/${String(m).padStart(2, '0')}`);
                  setShowAllMgrMonthHistory(false);
                }}
              />

              {/* ۲. مدیریت مرخصی‌های روزانه و ساعتی + شمارنده مرخصی استحقاقی */}
              <LeaveManagementSection
                role="manager"
                currentShamsiDate={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                onUpdated={() => {
                  loadAttendanceList();
                  loadDashboardAndSettings();
                }}
              />

              {/* ۳. فیلتر و ابزارهای ثبت تردد دستی و اکسل */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-wrap items-end justify-between gap-3">
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2.5 w-full sm:w-auto">
                  <div className="w-full sm:w-44">
                    <ShamsiDatePicker
                      label="از تاریخ"
                      value={attFromShamsi}
                      onChange={setAttFromShamsi}
                      allowClear
                      placeholder="همه تاریخ‌ها"
                      todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                    />
                  </div>
                  <div className="w-full sm:w-44">
                    <ShamsiDatePicker
                      label="تا تاریخ"
                      value={attToShamsi}
                      onChange={setAttToShamsi}
                      allowClear
                      placeholder="همه تاریخ‌ها"
                      todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadAttendanceList}
                    className="col-span-2 sm:col-span-1 min-h-[42px] px-4 rounded-xl bg-[#0B192C] text-white text-xs font-semibold cursor-pointer"
                  >
                    اعمال فیلتر
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => excelInputRef.current?.click()}
                    className="min-h-[40px] px-3 rounded-xl bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>بارگذاری اکسل کارکرد</span>
                  </button>

                  <a
                    href="/api/historical-work/excel-template"
                    download="mgammon-work-hours-template.xlsx"
                    className="min-h-[40px] px-3 rounded-xl border border-emerald-600 text-emerald-800 bg-emerald-50/60 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>فایل نمونه اکسل</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      setShowPastWorkForm((v) => !v);
                      setShowAddLogForm(false);
                    }}
                    className="min-h-[40px] px-3 rounded-xl border border-[#C5A059] text-[#0B192C] bg-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5 text-[#9A7428]" />
                    <span>افزودن سابقه قبلی</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingLogId(null);
                      setShowAddLogForm((v) => !v);
                      setShowPastWorkForm(false);
                    }}
                    className="min-h-[40px] px-3 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>ثبت تردد دستی</span>
                  </button>
                </div>
              </div>

              {/* فرم افزودن سوابق کارکرد و اضافه‌کاری قبلی */}
              {showPastWorkForm && (
                <form
                  onSubmit={handlePastWorkSubmit}
                  className="rounded-2xl bg-white border border-[#C5A059] p-4 space-y-3.5"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-sm font-bold text-[#0B192C]">
                      ثبت سابقه کارکرد و اضافه‌کاری قبلی (امید میثمی)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowPastWorkForm(false)}
                      className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      انصراف
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <ShamsiDatePicker
                      label="تاریخ ثبت"
                      value={pastWorkDate}
                      onChange={setPastWorkDate}
                      todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                    />
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        عنوان دوره کاری
                      </label>
                      <input
                        type="text"
                        required
                        value={pastWorkTitle}
                        onChange={(e) => setPastWorkTitle(e.target.value)}
                        placeholder="مثلاً کارکرد شهریور"
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        تعداد روز کاری
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={pastWorkDays}
                        onChange={(e) => setPastWorkDays(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ساعت کارکرد خالص
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={pastWorkHours}
                        onChange={(e) => setPastWorkHours(e.target.value)}
                        placeholder="0"
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        دقیقه کارکرد
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={pastWorkMins}
                        onChange={(e) => setPastWorkMins(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ساعت اضافه‌کاری
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={pastOtHours}
                        onChange={(e) => setPastOtHours(e.target.value)}
                        placeholder="0"
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        دقیقه اضافه‌کاری
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={pastOtMins}
                        onChange={(e) => setPastOtMins(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                  >
                    {actionLoading ? 'در حال ثبت...' : 'ذخیره در سوابق کارکرد'}
                  </button>
                </form>
              )}

              {/* فرم ثبت یا ویرایش دستی تردد با انتخابگر ساعت و تقویم */}
              {showAddLogForm && (
                <form
                  onSubmit={handleManualAttendanceSubmit}
                  className="rounded-2xl bg-white border border-[#C5A059] p-4 space-y-3.5"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-sm font-bold text-[#0B192C]">
                      {editingLogId
                        ? `ویرایش رکورد تردد #${toPersianDigits(editingLogId)}`
                        : 'ثبت دستی تردد توسط مدیریت'}
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddLogForm(false);
                        setEditingLogId(null);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      انصراف
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {!editingLogId && (
                      <ShamsiDatePicker
                        label="تاریخ"
                        value={manualShamsiDate}
                        onChange={setManualShamsiDate}
                        todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                      />
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        نوع تردد
                      </label>
                      <select
                        value={manualEventType}
                        onChange={(e) => setManualEventType(e.target.value as AttendanceEventType)}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs bg-white"
                      >
                        <option value="WORK_START">شروع کار</option>
                        <option value="MISSION_START">شروع مأموریت</option>
                        <option value="MISSION_END">پایان مأموریت و بازگشت</option>
                        <option value="WORK_END">پایان کار</option>
                      </select>
                    </div>
                    <TimePickerInput
                      label="ساعت"
                      value={manualTime}
                      onChange={setManualTime}
                    />
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        علت ثبت یا اصلاح (الزامی)
                      </label>
                      <input
                        type="text"
                        required
                        value={manualReason}
                        onChange={(e) => setManualReason(e.target.value)}
                        placeholder="توضیح کوتاه..."
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                  >
                    {actionLoading ? 'در حال ذخیره...' : 'ثبت نهایی'}
                  </button>
                </form>
              )}

              {/* فهرست سوابق قبلی کارکرد و فایل‌های اکسل بارگذاری‌شده */}
              {historicalRecords.length > 0 && (
                <div className="rounded-2xl bg-white border border-[#C5A059]/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#0B192C] flex items-center gap-2">
                      {dashboard?.unseenAlerts.historicalAlert && <GoldenBlinkDot />}
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                      <span>سوابق کارکرد قبلی و فایل‌های اکسل ارسالی</span>
                    </h3>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {historicalRecords.map((rec) => (
                      <div key={rec.id} className="py-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {rec.status === 'PENDING' && <GoldenBlinkDot />}
                            <span className="font-bold text-[#0B192C]">{rec.title}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums text-slate-500">
                              {toPersianDigits(rec.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums text-slate-600">
                              {toPersianDigits(rec.work_days_count)} روز کاری
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 tabular-nums">
                            <span>
                              کارکرد:{' '}
                              <strong>
                                {formatMinutesToDurationPersian(rec.net_work_minutes)}
                              </strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#9A7428]">
                              اضافه‌کاری:{' '}
                              <strong>
                                {formatMinutesToDurationPersian(rec.overtime_minutes)}
                              </strong>
                            </span>
                            <span
                              className={`font-bold ${
                                rec.status === 'APPROVED'
                                  ? 'text-emerald-700'
                                  : rec.status === 'REJECTED'
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              ({STATUS_LABELS[rec.status]})
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {rec.excel_file_url && (
                              <a
                                href={rec.excel_file_url}
                                download={rec.excel_file_name || 'work-history.xlsx'}
                                className="min-h-[30px] px-2.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 text-[11px] font-semibold inline-flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                <span>دانلود فایل ({rec.excel_file_name})</span>
                              </a>
                            )}
                            {rec.parsed_rows && rec.parsed_rows.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewExcelRows(
                                    previewExcelRows?.id === rec.id ? null : rec
                                  )
                                }
                                className="min-h-[30px] px-2.5 rounded-lg border border-slate-200 hover:border-[#C5A059] text-[11px] font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3 h-3 text-[#9A7428]" />
                                <span>
                                  مشاهده ردیف‌ها ({toPersianDigits(rec.parsed_rows.length)})
                                </span>
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {rec.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewHistoricalWork(rec.id, 'APPROVED')}
                                  className="min-h-[32px] px-3 rounded-lg bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>تأیید و افزودن به کل کارکرد</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewHistoricalWork(rec.id, 'REJECTED')}
                                  className="min-h-[32px] px-2.5 rounded-lg bg-red-50 text-red-800 border border-red-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>رد</span>
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeletePastWork(rec.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                              title="حذف سابقه"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {previewExcelRows?.id === rec.id && (
                          <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 p-3 overflow-x-auto">
                            <table className="w-full text-[11px] text-right">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-500">
                                  <th className="pb-1.5">تاریخ</th>
                                  <th className="pb-1.5">عنوان</th>
                                  <th className="pb-1.5">روز</th>
                                  <th className="pb-1.5">کارکرد خالص</th>
                                  <th className="pb-1.5">اضافه‌کاری</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200/60 tabular-nums">
                                {rec.parsed_rows.map((r, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 font-semibold">
                                      {toPersianDigits(r.shamsi_date)}
                                    </td>
                                    <td className="py-1.5">{r.title}</td>
                                    <td className="py-1.5">
                                      {toPersianDigits(r.work_days_count)}
                                    </td>
                                    <td className="py-1.5">
                                      {formatMinutesToDurationPersian(r.net_work_minutes)}
                                    </td>
                                    <td className="py-1.5 text-[#9A7428] font-semibold">
                                      {formatMinutesToDurationPersian(r.overtime_minutes)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* لیست ترددهای روزانه (فقط ماه انتخاب‌شده + نمایش ۲ روز آخر در حالت بسته) */}
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C5A059]" />
                    <h3 className="text-xs font-bold text-[#0B192C]">
                      جدول ترددهای روزانه ماه انتخاب‌شده — امید میثمی
                    </h3>
                  </div>

                  {availableMgrHistoryMonths.length > 0 && !attFromShamsi.trim() && !attToShamsi.trim() && (
                    <select
                      aria-label="فیلتر ماه جدول تردد"
                      value={effectiveMgrHistoryMonth}
                      onChange={(e) => {
                        setSelectedMgrHistoryMonth(e.target.value);
                        setShowAllMgrMonthHistory(false);
                      }}
                      className="min-h-[28px] rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10.5px] font-bold text-[#0B192C] focus:outline-none cursor-pointer"
                    >
                      {availableMgrHistoryMonths.map((m) => (
                        <option key={m.key} value={m.key}>
                          {SHAMSI_MONTH_NAMES[m.month - 1]} {toPersianDigits(m.year)} (
                          {toPersianDigits(m.count)} روز)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {mgrMonthFilteredSummaries.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-4 text-center">
                    رکوردی در این ماه یافت نشد.
                  </p>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100">
                      {visibleMgrSummaries.map((day) => (
                        <div key={day.work_date} className="py-2 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex flex-wrap items-center gap-1.5">
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
                                    : day.is_late
                                      ? 'text-orange-700 font-semibold'
                                      : 'text-emerald-700 font-medium'
                                }
                              >
                                {day.status_label}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 tabular-nums text-[10.5px]">
                              <span>
                                کارکرد: <strong>{formatMinutesToHHMM(day.net_work_minutes)}</strong>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#9A7428]">
                                اضافه‌کاری: <strong>{formatMinutesToHHMM(day.overtime_minutes)}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {day.logs.length > 0 ? (
                              day.logs.map((log) => (
                                <div
                                  key={log.id}
                                  className="rounded-lg bg-slate-50 border border-slate-200/80 px-2 py-1 text-[10.5px] flex items-center gap-1"
                                >
                                  <span className="text-slate-600">
                                    {EVENT_TYPE_LABELS[log.event_type]}:
                                  </span>
                                  <strong className="text-[#0B192C] tabular-nums">
                                    {toPersianDigits(log.recorded_time.slice(0, 5))}
                                  </strong>
                                  <button
                                    type="button"
                                    title="ویرایش ساعت"
                                    onClick={() => {
                                      setEditingLogId(log.id);
                                      setManualEventType(log.event_type);
                                      setManualTime(log.recorded_time.slice(0, 5));
                                      setManualReason(log.modification_reason || '');
                                      setShowAddLogForm(true);
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-[#0B192C] cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="حذف تردد"
                                    onClick={() => handleDeleteLog(log.id)}
                                    className="p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-600">
                                <span className="rounded-lg bg-slate-50 border border-slate-200/80 px-2 py-0.5 tabular-nums">
                                  شروع کار:{' '}
                                  <strong className="text-[#0B192C]">
                                    {toPersianDigits(day.first_in_time || '07:00')}
                                  </strong>
                                </span>
                                <span className="rounded-lg bg-slate-50 border border-slate-200/80 px-2 py-0.5 tabular-nums">
                                  پایان کار:{' '}
                                  <strong className="text-[#0B192C]">
                                    {toPersianDigits(day.last_out_time || '15:00')}
                                  </strong>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {mgrMonthFilteredSummaries.length > 2 && (
                      <div className="pt-1.5 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setShowAllMgrMonthHistory((prev) => !prev)}
                          className="w-full min-h-[34px] rounded-xl bg-[#FCF9F2] hover:bg-amber-50 border border-[#C5A059]/50 text-[11px] font-bold text-[#0B192C] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {showAllMgrMonthHistory ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>بستن و نمایش فقط ۲ روز آخر</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>
                                نمایش همه اطلاعات این ماه (
                                {toPersianDigits(mgrMonthFilteredSummaries.length)} روز)
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ================= تب ۳: چک‌لیست کارها و گزارش‌های روزانه ================= */}
          {activeTab === 'reports' && (
            <div className="space-y-4">
              {/* ۱. چک‌لیست کارهای روزانه (وظایف محول‌شده از طرف مدیر به پرسنل) */}
              <DailyTasksChecklist
                role="manager"
                currentShamsiDate={dashboard?.serverTime.shamsiDate || initialShamsiDate}
              />

              {/* ۲. فیلتر و جست‌وجو در گزارش‌های روزانه */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    جست‌وجو در متن گزارش
                  </label>
                  <input
                    type="text"
                    value={repSearch}
                    onChange={(e) => setRepSearch(e.target.value)}
                    placeholder="عبارت مورد نظر..."
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs"
                  />
                </div>
                <ShamsiDatePicker
                  label="از تاریخ"
                  value={repFromShamsi}
                  onChange={setRepFromShamsi}
                  allowClear
                  placeholder="همه تاریخ‌ها"
                  todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                />
                <ShamsiDatePicker
                  label="تا تاریخ"
                  value={repToShamsi}
                  onChange={setRepToShamsi}
                  allowClear
                  placeholder="همه تاریخ‌ها"
                  todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                />
                <button
                  type="button"
                  onClick={loadReportsList}
                  className="col-span-2 sm:col-span-1 min-h-[42px] rounded-xl bg-[#0B192C] text-white text-xs font-semibold cursor-pointer"
                >
                  جست‌وجو
                </button>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C] flex items-center gap-2">
                  {dashboard?.unseenAlerts.reportsAlert && <GoldenBlinkDot />}
                  <span>گزارش‌های روزانه پرسنل — امید میثمی</span>
                </h3>
                {reports.length === 0 ? (
                  <p className="text-xs text-slate-500 py-5 text-center">گزارشی یافت نشد.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {reports.map((rep) => (
                      <div key={rep.id} className="py-3 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <div className="flex items-center gap-2">
                            {!rep.is_seen_by_manager && <GoldenBlinkDot title="گزارش جدید" />}
                            <span className="font-bold text-[#0B192C]">
                              {toPersianDigits(rep.shamsi_date)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>ساعت {toPersianDigits(rep.recorded_time.slice(0, 5))}</span>
                          </div>
                          {rep.duration_minutes && (
                            <span className="text-[#9A7428] font-medium">
                              مدت: {formatMinutesToDurationPersian(rep.duration_minutes)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-800 leading-6 whitespace-pre-line">
                          {rep.activity_description}
                        </p>
                        {rep.photo_url && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewFile({
                                  file_url: rep.photo_url!,
                                  file_name: rep.photo_name || `تصویر گزارش ${rep.shamsi_date}`,
                                  mime_type: 'image/jpeg',
                                })
                              }
                              className="inline-flex items-center gap-2 p-1.5 pr-2.5 rounded-xl bg-slate-50 hover:bg-amber-50/50 border border-slate-200 hover:border-[#C5A059] text-xs font-semibold text-[#0B192C] transition-colors cursor-pointer"
                            >
                              <img
                                src={rep.photo_url}
                                alt="تصویر کار انجام‌شده"
                                className="w-10 h-10 rounded-lg object-cover border border-slate-200"
                              />
                              <ImageIcon className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>پیش‌نمایش تصویر کار انجام‌شده</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= تب ۴: امور مالی، مساعده، هزینه‌های متفرقه (اسنپ/وسیله) و تنخواه ================= */}
          {activeTab === 'finance' && (
            <div className="space-y-4">
              {/* صورتحساب تفصیلی هر ماه / دوره کاری (مبلغ حقوق + اضافه‌کاری، تنخواه و جمع کل پرداختی مدیر در هر ماه) */}
              <MonthlyStatementSection
                role="manager"
                currentShamsiDate={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                collaborationStartShamsi={dashboard?.settings.collaboration_start_shamsi}
                dailySummaries={attendanceSummaries}
                historicalRecords={historicalRecords}
                transactions={transactions}
                settings={dashboard?.settings || null}
              />

              <form
                onSubmit={handleManagerAddPayment}
                className="rounded-2xl bg-white border border-[#C5A059]/50 p-4 space-y-3"
              >
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-xs sm:text-sm font-bold text-[#0B192C]">
                    ثبت پرداخت مستقیم یا هزینه انجام‌شده برای پرسنل (امید میثمی)
                  </h3>
                  <p className="text-[10.5px] text-slate-500 mt-0.5">
                    می‌توانید علاوه بر حقوق و مساعده، هزینه‌های جانبی انجام‌شده برای پرسنل (مانند اسنپ، تهیه وسیله و...) یا بستانکاری تنخواه را در لیست پرداختی‌ها ثبت نمایید.
                  </p>
                </div>

                {/* تگ‌های انتخاب سریع موضوع پرداخت یا هزینه جانبی برای پرسنل */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 ml-1">انتخاب سریع:</span>
                  {[
                    {
                      label: 'هزینه اسنپ پرسنل',
                      type: 'OTHER' as FinancialTxType,
                    },
                    {
                      label: 'تهیه وسیله / ابزار برای پرسنل',
                      type: 'OTHER' as FinancialTxType,
                    },
                    {
                      label: 'هزینه ایاب‌وذهاب پرسنل',
                      type: 'OTHER' as FinancialTxType,
                    },
                    {
                      label: 'ثبت بستانکاری هزینه متفرقه / تنخواه پرسنل',
                      type: 'PETTY_CASH' as FinancialTxType,
                    },
                    {
                      label: 'پرداخت مساعده',
                      type: 'ADVANCE' as FinancialTxType,
                    },
                    {
                      label: 'پرداخت حقوق ماهانه',
                      type: 'SALARY' as FinancialTxType,
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setMgrTxType(preset.type);
                        setMgrDesc(preset.label);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 border border-[#C5A059]/50 text-[10px] font-semibold text-[#0B192C] transition-colors cursor-pointer"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <TomanInput
                    label="مبلغ پرداختی یا هزینه (تومان)"
                    value={mgrAmount}
                    onChange={setMgrAmount}
                    required
                  />
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      نوع پرداخت / هزینه
                    </label>
                    <select
                      value={mgrTxType}
                      onChange={(e) => setMgrTxType(e.target.value as FinancialTxType)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs bg-white"
                    >
                      <option value="SALARY">حقوق</option>
                      <option value="ADVANCE">مساعده</option>
                      <option value="ON_ACCOUNT">علی‌الحساب</option>
                      <option value="OTHER">
                        هزینه متفرقه انجام‌شده برای پرسنل (اسنپ، تهیه وسیله و...)
                      </option>
                      <option value="PETTY_CASH">
                        ثبت بستانکاری تنخواه / هزینه متفرقه به حساب پرسنل
                      </option>
                    </select>
                  </div>
                  <ShamsiDatePicker
                    label="تاریخ پرداخت"
                    value={mgrShamsiDate}
                    onChange={setMgrShamsiDate}
                    todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      شرح پرداخت یا هزینه انجام‌شده برای پرسنل
                    </label>
                    <input
                      type="text"
                      required
                      value={mgrDesc}
                      onChange={(e) => setMgrDesc(e.target.value)}
                      placeholder="مثلاً هزینه اسنپ پرسنل، تهیه وسیله، واریز حقوق یا تسویه تنخواه..."
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      یادداشت مدیریت (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={mgrNote}
                      onChange={(e) => setMgrNote(e.target.value)}
                      placeholder="شماره پیگیری یا توضیحات..."
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="min-h-[40px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                >
                  {actionLoading ? 'در حال ثبت...' : 'ثبت قطعی در لیست پرداختی‌ها'}
                </button>
              </form>

              {/* فیلتر تراکنش‌ها */}
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">وضعیت</label>
                  <select
                    value={finStatusFilter}
                    onChange={(e) => setFinStatusFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 px-2.5 text-xs bg-white"
                  >
                    <option value="">همه</option>
                    <option value="PENDING">در انتظار تأیید</option>
                    <option value="APPROVED">تأییدشده</option>
                    <option value="REJECTED">ردشده</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">نوع</label>
                  <select
                    value={finTypeFilter}
                    onChange={(e) => setFinTypeFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 px-2.5 text-xs bg-white"
                  >
                    <option value="">همه</option>
                    <option value="SALARY">حقوق</option>
                    <option value="ADVANCE">مساعده</option>
                    <option value="ON_ACCOUNT">علی‌الحساب</option>
                    <option value="PETTY_CASH">هزینه متفرقه / تنخواه (طلب پرسنل)</option>
                    <option value="OTHER">هزینه متفرقه برای پرسنل (اسنپ، وسیله و...)</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">جست‌وجو</label>
                  <input
                    type="text"
                    value={finSearch}
                    onChange={(e) => setFinSearch(e.target.value)}
                    placeholder="مثلاً اسنپ، وسیله، حقوق..."
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadFinanceList}
                  className="col-span-2 sm:col-span-1 min-h-[40px] rounded-xl bg-[#0B192C] text-white text-xs font-semibold cursor-pointer"
                >
                  اعمال فیلتر
                </button>
              </div>

              {/* لیست تراکنش‌ها و هزینه‌های تنخواه */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#0B192C] flex items-center gap-2">
                  {dashboard?.unseenAlerts.financeAlert && <GoldenBlinkDot />}
                  <span>درخواست‌های مالی، تنخواه کارگاهی و سوابق پرداخت</span>
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-5 text-center">موردی یافت نشد.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="py-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {(tx.status === 'PENDING' || !tx.is_seen_by_manager) && (
                              <GoldenBlinkDot />
                            )}
                            <span className="font-bold text-[#0B192C] tabular-nums text-sm">
                              {formatToman(tx.amount_toman)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`font-semibold px-2 py-0.5 rounded-lg text-[11px] ${
                                tx.tx_type === 'PETTY_CASH'
                                  ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {TX_TYPE_LABELS[tx.tx_type]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-500 tabular-nums">
                              {toPersianDigits(tx.shamsi_date)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-xs font-bold ml-1 ${
                                tx.status === 'APPROVED'
                                  ? 'text-emerald-700'
                                  : tx.status === 'REJECTED'
                                    ? 'text-red-700'
                                    : 'text-[#9A7428]'
                              }`}
                            >
                              {STATUS_LABELS[tx.status]}
                            </span>

                            {tx.status === 'PENDING' && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewFinancialTx(tx.id, 'APPROVED')}
                                  className="min-h-[30px] px-2.5 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>تأیید</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleReviewFinancialTx(tx.id, 'REJECTED')}
                                  className="min-h-[30px] px-2.5 rounded-lg bg-red-50 text-red-800 border border-red-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>رد</span>
                                </button>
                              </div>
                            )}

                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => openEditFinanceModal(tx)}
                              title="ویرایش و اصلاح این مورد مالی"
                              className="min-h-[30px] px-2.5 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 text-[#0B192C] border border-[#C5A059]/70 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3 text-[#9A7428]" />
                              <span>ویرایش</span>
                            </button>

                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleDeleteFinancialTx(tx.id)}
                              title="حذف این مورد مالی"
                              className="min-h-[30px] px-2 rounded-lg bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-700 border border-slate-200 hover:border-red-200 text-[11px] flex items-center justify-center transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-700">{tx.description}</p>
                        {tx.receipt_file_url && (
                          <div className="pt-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewFile({
                                  file_url: tx.receipt_file_url!,
                                  file_name: tx.receipt_file_name || `فاکتور-${tx.shamsi_date}.jpg`,
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50/70 hover:bg-amber-100/70 border border-[#C5A059]/60 text-[11px] font-bold text-[#0B192C] transition-colors cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>پیش‌نمایش فاکتور / رسید پیوست</span>
                            </button>
                          </div>
                        )}
                        {tx.manager_note && (
                          <p className="text-[11px] text-slate-500">یادداشت: {tx.manager_note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= تب ۵: مکاتبات کاری، پیام صوتی و ارسال فایل ================= */}
          {activeTab === 'correspondence' && (
            <WorkCorrespondenceSection
              role="manager"
              todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
              onUnreadChange={() => loadDashboardAndSettings()}
            />
          )}

          {/* ================= تب ۶: تنظیمات (تب‌های افقی کنار هم) ================= */}
          {activeTab === 'settings' && settingsForm && (
            <div className="space-y-4">
              {/* تب‌های افقی کنار هم برای بخش‌های مختلف تنظیمات */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('schedule')}
                  className={`min-h-[42px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    settingsSubTab === 'schedule'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                  <span>ساعات کاری و قرارداد</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('salary')}
                  className={`min-h-[42px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    settingsSubTab === 'salary'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5 shrink-0" />
                  <span>حقوق و اضافه‌کاری</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('sms')}
                  className={`min-h-[42px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    settingsSubTab === 'sms'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span>تنظیمات پیامک</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('account')}
                  className={`min-h-[42px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    settingsSubTab === 'account'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <UserCog className="w-3.5 h-3.5 shrink-0" />
                  <span>حساب و پشتیبان‌گیری</span>
                </button>
              </div>

              {/* زیرتب حساب کاربری مدیر (تغییر تصویر، رمز عبور، اثر انگشت و پشتیبان‌گیری) */}
              {settingsSubTab === 'account' && (
                <AccountSettingsPanel
                  user={user}
                  currentAvatarUrl={user.avatar_url}
                  onAvatarUpdated={(newUrl) => {
                    if (onUserAvatarChange) onUserAvatarChange(newUrl);
                  }}
                />
              )}

              {/* زیرتب‌های ساعات کاری، حقوق و پیامک */}
              {settingsSubTab !== 'account' && (
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  {/* ۱. ساعات کاری، پنجشنبه‌ها، سهمیه مرخصی و تاریخ شروع قرارداد */}
                  {settingsSubTab === 'schedule' && (
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-100">
                        <ShamsiDatePicker
                          label="تاریخ شروع قرارداد پرسنل (امید میثمی)"
                          value={settingsForm.collaboration_start_shamsi}
                          onChange={(val) =>
                            setSettingsForm({
                              ...settingsForm,
                              collaboration_start_shamsi: val,
                            })
                          }
                          todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                        />
                        <ShamsiDatePicker
                          label="تاریخ اعمال تغییرات"
                          value={settingsForm.effective_from_shamsi}
                          onChange={(val) =>
                            setSettingsForm({
                              ...settingsForm,
                              effective_from_shamsi: val,
                            })
                          }
                          todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                        />
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1.5">
                            سقف مرخصی استحقاقی ماهانه (روز)
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min={0}
                            max={30}
                            value={settingsForm.monthly_leave_quota_days ?? 2.5}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                monthly_leave_quota_days: Number(e.target.value),
                              })
                            }
                            className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs font-bold tabular-nums"
                          />
                        </div>
                      </div>

                      {/* ساعات کاری شنبه تا چهارشنبه (پیش‌فرض ۰۷:۰۰ تا ۱۵:۰۰) */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-extrabold text-[#0B192C]">
                          ساعات کاری روزهای عادی (شنبه تا چهارشنبه)
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <TimePickerInput
                            label="ساعت شروع به کار"
                            value={settingsForm.shift_start_time}
                            onChange={(val) =>
                              setSettingsForm({ ...settingsForm, shift_start_time: val })
                            }
                          />
                          <TimePickerInput
                            label="ساعت پایان کار"
                            value={settingsForm.shift_end_time}
                            onChange={(val) =>
                              setSettingsForm({
                                ...settingsForm,
                                shift_end_time: val,
                                overtime_start_time: val,
                              })
                            }
                          />
                          <div className="col-span-2 sm:col-span-1">
                            <TimePickerInput
                              label="شروع محاسبه اضافه‌کاری"
                              value={settingsForm.overtime_start_time}
                              onChange={(val) =>
                                setSettingsForm({ ...settingsForm, overtime_start_time: val })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* ساعات کاری روز پنجشنبه (پیش‌فرض ۰۷:۰۰ تا ۱۴:۰۰) */}
                      <div className="rounded-xl bg-emerald-50/40 border border-emerald-200 p-3.5 space-y-3">
                        <h4 className="text-xs font-extrabold text-emerald-950">
                          ساعات کاری روز پنجشنبه
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <TimePickerInput
                            label="شروع کار پنجشنبه"
                            value={settingsForm.thursday_shift_start_time}
                            onChange={(val) =>
                              setSettingsForm({
                                ...settingsForm,
                                thursday_shift_start_time: val,
                              })
                            }
                          />
                          <TimePickerInput
                            label="پایان کار پنجشنبه"
                            value={settingsForm.thursday_shift_end_time}
                            onChange={(val) =>
                              setSettingsForm({
                                ...settingsForm,
                                thursday_shift_end_time: val,
                                thursday_overtime_start_time: val,
                              })
                            }
                          />
                          <div className="col-span-2 sm:col-span-1">
                            <TimePickerInput
                              label="شروع اضافه‌کاری پنجشنبه"
                              value={settingsForm.thursday_overtime_start_time}
                              onChange={(val) =>
                                setSettingsForm({
                                  ...settingsForm,
                                  thursday_overtime_start_time: val,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* فرجه تأخیر، استراحت و روزهای کاری */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            فرجه تأخیر (دقیقه)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={180}
                            value={settingsForm.grace_period_minutes}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                grace_period_minutes: Number(e.target.value),
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            استراحت روزانه (دقیقه)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={240}
                            value={settingsForm.break_duration_minutes}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                break_duration_minutes: Number(e.target.value),
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            نحوه محاسبه مأموریت
                          </label>
                          <select
                            value={settingsForm.mission_policy}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                mission_policy: e.target.value as MissionPolicy,
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-2.5 text-xs bg-white"
                          >
                            <option value="PAID_AS_WORK">جزء ساعات کاری</option>
                            <option value="SEPARATE_EXTRA">ثبت جداگانه</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            کار در روز تعطیل
                          </label>
                          <select
                            value={settingsForm.friday_holiday_policy}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                friday_holiday_policy: e.target.value as FridayHolidayPolicy,
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-2.5 text-xs bg-white"
                          >
                            <option value="ALL_OVERTIME">تماماً اضافه‌کاری</option>
                            <option value="REGULAR_WORK">کارکرد عادی</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-2">
                          روزهای کاری هفته
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_CHECKBOXES.map((w) => {
                            const active = settingsForm.working_days.includes(w.day);
                            return (
                              <button
                                key={w.day}
                                type="button"
                                onClick={() => toggleWorkingDay(w.day)}
                                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                                    : 'bg-white text-slate-500 border-slate-200'
                                }`}
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="w-56">
                            <ShamsiDatePicker
                              label="افزودن تعطیل رسمی"
                              value={newHolidayShamsi}
                              onChange={setNewHolidayShamsi}
                              placeholder="انتخاب تاریخ"
                              todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={addHoliday}
                            className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-[#0B192C] cursor-pointer"
                          >
                            افزودن به تعطیلات
                          </button>
                        </div>

                        {settingsForm.official_holidays.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {settingsForm.official_holidays.map((h) => (
                              <span
                                key={h}
                                className="inline-flex items-center gap-1.5 text-xs text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg tabular-nums"
                              >
                                {toPersianDigits(h)}
                                <button
                                  type="button"
                                  onClick={() => removeHoliday(h)}
                                  className="text-red-600 hover:text-red-800 cursor-pointer"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ۲. حقوق پایه و نحوه محاسبه اضافه‌کاری */}
                  {settingsSubTab === 'salary' && (
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
                      <h4 className="text-sm font-bold text-[#0B192C] border-b border-slate-100 pb-2.5">
                        تعیین حقوق پایه و ضریب یا مبلغ اضافه‌کاری
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                        <TomanInput
                          label="مبلغ حقوق پایه ماهانه (تومان)"
                          value={
                            settingsForm.base_salary_toman !== null &&
                            settingsForm.base_salary_toman !== undefined &&
                            settingsForm.base_salary_toman > 0
                              ? String(settingsForm.base_salary_toman)
                              : ''
                          }
                          onChange={(val) =>
                            setSettingsForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    base_salary_toman: val ? Number(val) : null,
                                  }
                                : prev
                            )
                          }
                          placeholder="مثلاً 18,000,000"
                        />

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1.5">
                            روش محاسبه نرخ اضافه‌کاری
                          </label>
                          <select
                            value={settingsForm.overtime_calc_mode}
                            onChange={(e) =>
                              setSettingsForm((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      overtime_calc_mode: e.target.value as OvertimeCalcMode,
                                    }
                                  : prev
                              )
                            }
                            className="w-full min-h-[44px] rounded-xl border border-[#C5A059]/70 px-3 text-xs bg-white font-semibold text-[#0B192C]"
                          >
                            <option value="PERCENTAGE">
                              درصدی از نرخ ساعتی حقوق پایه (مثلاً ۱۴۰٪)
                            </option>
                            <option value="FIXED_RATE">
                              مبلغ ثابت به ازای هر ساعت اضافه‌کاری (تومان)
                            </option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                        {settingsForm.overtime_calc_mode === 'PERCENTAGE' ? (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1.5">
                              درصد ضریب هر ساعت اضافه‌کاری
                            </label>
                            <input
                              type="number"
                              min={100}
                              max={400}
                              step={5}
                              value={settingsForm.overtime_percentage}
                              onChange={(e) =>
                                setSettingsForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        overtime_percentage: Number(e.target.value),
                                      }
                                    : prev
                                )
                              }
                              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-xs font-bold tabular-nums bg-white"
                            />
                          </div>
                        ) : (
                          <TomanInput
                            label="مبلغ ثابت هر ساعت اضافه‌کاری (تومان)"
                            value={
                              settingsForm.overtime_rate_toman !== null &&
                              settingsForm.overtime_rate_toman !== undefined &&
                              settingsForm.overtime_rate_toman > 0
                                ? String(settingsForm.overtime_rate_toman)
                                : ''
                            }
                            onChange={(val) =>
                              setSettingsForm((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      overtime_rate_toman: val ? Number(val) : null,
                                    }
                                  : prev
                              )
                            }
                            placeholder="مثلاً 120,000"
                          />
                        )}

                        <TomanInput
                          label="نرخ پایه هر ساعت کاری عادی (تومان - اختیاری)"
                          value={
                            settingsForm.hourly_rate_toman !== null &&
                            settingsForm.hourly_rate_toman !== undefined &&
                            settingsForm.hourly_rate_toman > 0
                              ? String(settingsForm.hourly_rate_toman)
                              : ''
                          }
                          onChange={(val) =>
                            setSettingsForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    hourly_rate_toman: val ? Number(val) : null,
                                  }
                                : prev
                            )
                          }
                          placeholder="محاسبه خودکار از روی حقوق ماهانه"
                        />
                      </div>
                    </div>
                  )}

                  {/* ۳. تنظیمات ارسال پیامک */}
                  {settingsSubTab === 'sms' && (
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold text-[#0B192C]">
                            تنظیمات ارسال پیامک به پرسنل
                          </h4>
                          <button
                            type="button"
                            onClick={() => setShowSmsHelpModal(true)}
                            title="راهنمای رفع خطای ارسال پیامک"
                            aria-label="راهنمای رفع خطای ارسال پیامک"
                            className="w-6 h-6 rounded-full bg-[#FCF9F2] hover:bg-amber-100/80 border border-[#C5A059]/65 text-[#9A7428] flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <label className="inline-flex items-center gap-2 text-xs font-bold text-[#0B192C] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsForm.sms_enabled}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                sms_enabled: e.target.checked,
                              })
                            }
                            className="w-4 h-4 accent-[#0B192C]"
                          />
                          <span>فعال‌سازی ارسال پیامک</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            شماره همراه پرسنل (امید میثمی)
                          </label>
                          <input
                            type="tel"
                            dir="ltr"
                            value={settingsForm.worker_phone_number}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                worker_phone_number: e.target.value,
                              })
                            }
                            placeholder="0912..."
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs text-right tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            شماره خط ارسال‌کننده (یا کد پترن خدماتی)
                          </label>
                          <input
                            type="text"
                            dir="ltr"
                            value={settingsForm.melipayamak_from_number}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                melipayamak_from_number: e.target.value,
                              })
                            }
                            placeholder="5000..."
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs text-right tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            نام کاربری پنل پیامک
                          </label>
                          <input
                            type="text"
                            dir="ltr"
                            value={settingsForm.melipayamak_username}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                melipayamak_username: e.target.value,
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs text-right"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            رمز وب‌سرویس (API Key / توکن ۳۶ رقمی)
                          </label>
                          <input
                            type="password"
                            dir="ltr"
                            value={settingsForm.melipayamak_password}
                            onChange={(e) =>
                              setSettingsForm({
                                ...settingsForm,
                                melipayamak_password: e.target.value,
                              })
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs text-right"
                          />
                        </div>
                      </div>

                      <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={testingSms}
                          onClick={() => handleTestSms()}
                          className="min-h-[38px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B192C] text-xs font-semibold cursor-pointer"
                        >
                          {testingSms ? 'در حال ارسال...' : 'تست ارسال به شماره پرسنل'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="w-full sm:w-auto min-h-[46px] px-8 rounded-xl bg-[#0B192C] text-[#ffffff] border border-[#C5A059] text-xs font-bold hover:bg-[#152944] transition-colors cursor-pointer"
                    >
                      {actionLoading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {/* پاپ‌آپ ویرایش و اصلاح موارد پرداخت‌شده / تراکنش‌های مالی */}
      {editingFinTx && (
        <div
          onClick={() => setEditingFinTx(null)}
          className="fixed inset-0 z-50 bg-[#0B192C]/45 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white border border-[#C5A059] shadow-2xl p-4 sm:p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#9A7428]" />
                <h3 className="text-sm font-bold text-[#0B192C]">
                  ویرایش و اصلاح مورد مالی / پرداخت‌شده
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingFinTx(null)}
                aria-label="بستن"
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateFinancialTx} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TomanInput
                  label="مبلغ (تومان)"
                  required
                  value={editFinAmount}
                  onChange={setEditFinAmount}
                />

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    نوع پرداخت / تراکنش
                  </label>
                  <select
                    value={editFinType}
                    onChange={(e) => setEditFinType(e.target.value as FinancialTxType)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs bg-white"
                  >
                    <option value="SALARY">حقوق</option>
                    <option value="ADVANCE">مساعده</option>
                    <option value="ON_ACCOUNT">علی‌الحساب</option>
                    <option value="OTHER">
                      هزینه متفرقه انجام‌شده برای پرسنل (اسنپ، تهیه وسیله و...)
                    </option>
                    <option value="PETTY_CASH">
                      هزینه متفرقه / تنخواه کارگاهی (بستانکاری پرسنل)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ShamsiDatePicker
                  label="تاریخ"
                  value={editFinShamsiDate}
                  onChange={setEditFinShamsiDate}
                  todayShamsi={dashboard?.serverTime.shamsiDate || initialShamsiDate}
                />

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    وضعیت تراکنش
                  </label>
                  <select
                    value={editFinStatus}
                    onChange={(e) => setEditFinStatus(e.target.value as FinancialStatus)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs bg-white"
                  >
                    <option value="APPROVED">تأییدشده (پرداخت قطعی)</option>
                    <option value="PENDING">در انتظار تأیید</option>
                    <option value="REJECTED">ردشده</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  شرح پرداخت یا هزینه
                </label>
                <input
                  type="text"
                  required
                  value={editFinDesc}
                  onChange={(e) => setEditFinDesc(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  یادداشت مدیریت (اختیاری)
                </label>
                <input
                  type="text"
                  value={editFinNote}
                  onChange={(e) => setEditFinNote(e.target.value)}
                  placeholder="شماره پیگیری یا توضیحات اصلاح..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs"
                />
              </div>

              <div className="pt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingFinTx(null)}
                  className="min-h-[38px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="min-h-[38px] px-5 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                >
                  {actionLoading ? 'در حال ذخیره...' : 'ذخیره اصلاحات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* پاپ‌آپ راهنمای رفع خطای پنل پیامکی (با پس‌زمینه بلور و بستن با کلیک بیرون یا ضربدر) */}
      {showSmsHelpModal && (
        <div
          onClick={() => setShowSmsHelpModal(false)}
          className="fixed inset-0 z-50 bg-[#0B192C]/45 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white border border-[#C5A059] shadow-2xl p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-[#9A7428] shrink-0" />
                <h4 className="text-xs sm:text-sm font-bold text-[#0B192C]">
                  راهنمای رفع خطای ارسال پیامک (بلک‌لیست مخابرات)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowSmsHelpModal(false)}
                aria-label="بستن راهنما"
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-700 space-y-2.5 leading-6">
              <p>
                ۱. اتصال وب‌سرویس شما با نام کاربری{' '}
                <code className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px]">
                  989387124781
                </code>{' '}
                و کلید وب‌سرویس کاملاً برقرار است و به شماره‌های ایرانسل (مانند{' '}
                <code className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px]">
                  09387124781
                </code>
                ) بلافاصله ارسال می‌شود.
              </p>
              <p>
                ۲. اگر شماره همراه اول گیرنده (
                <code className="px-1 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px]">
                  0915...
                </code>
                ) دریافت پیامک‌های تبلیغاتی را بسته باشد (خطای کد ۱۱ در خطوط ۵۰۰۰)، گیرنده می‌تواند کد دستوری{' '}
                <strong className="text-[#0B192C]" dir="ltr">
                  *8999#
                </strong>{' '}
                را شماره‌گیری کرده و دریافت پیامک را فعال نماید؛ و یا در پنل ملی‌پیامک یک کد پترن خدماتی ثبت کرده و کد پترن را در کادر «شماره خط ارسال‌کننده» قرار دهید.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* پاپ‌آپ پیش‌نمایش فایل یا تصویر با قابلیت دانلود اختیاری */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* منوی پایین ثابت (مخصوص استفاده راحت در موبایل و دسکتاپ) */}
      <nav
        aria-label="منوی اصلی مدیریت"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#0B192C]/95 backdrop-blur-md border-t border-[#C5A059]/50 px-2 py-1.5"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-6 gap-1">
          <button
            type="button"
            onClick={() => handleSelectTab('dashboard')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">داشبورد</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('attendance')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'attendance'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {unseen?.historicalAlert && (
              <span className="absolute top-1.5 right-2">
                <GoldenBlinkDot />
              </span>
            )}
            <Clock className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">تردد و مرخصی</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('reports')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {unseen?.reportsAlert && (
              <span className="absolute top-1.5 right-2">
                <GoldenBlinkDot />
              </span>
            )}
            <FileText className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">گزارش و کارها</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('finance')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'finance'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {unseen?.financeAlert && (
              <span className="absolute top-1.5 right-2">
                <GoldenBlinkDot />
              </span>
            )}
            <Wallet className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">مالی و تنخواه</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('correspondence')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'correspondence'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {unseen?.correspondenceAlert && (
              <span className="absolute top-1.5 right-2">
                <GoldenBlinkDot />
              </span>
            )}
            <MessageSquare className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">مکاتبات</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('settings')}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[10px] whitespace-nowrap">تنظیمات</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
