import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttendanceEventType,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
  HistoricalWorkRecord,
  LeaveRequestItem,
  LeaveType,
  SystemSettings,
  UserProfile,
  WorkerLiveState,
  WorkTaskItem,
} from '../shared/types';
import { apiRequest } from '../services/api';
import {
  formatMinutesToDurationPersian,
  formatMinutesToHHMM,
  formatToman,
  toPersianDigits,
} from '../shared/jalali';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { TomanInput } from './TomanInput';
import { HeroBanner } from './HeroBanner';
import { LeaveManagementSection } from './LeaveManagementSection';
import { DailyTasksChecklist } from './DailyTasksChecklist';
import { MonthlyAttendanceCalendar } from './MonthlyAttendanceCalendar';
import { WorkCorrespondenceSection } from './WorkCorrespondenceSection';
import { AccountSettingsPanel } from './AccountSettingsPanel';
import { FilePreviewModal, PreviewFileItem } from './FilePreviewModal';
import { CameraCaptureModal } from './CameraCaptureModal';
import { MonthlyStatementSection } from './MonthlyStatementSection';
import {
  Play,
  Briefcase,
  CornerDownLeft,
  Square,
  Clock,
  FileText,
  Wallet,
  MessageSquare,
  AlertTriangle,
  Plus,
  Paperclip,
  Download,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  Hourglass,
  XCircle,
  Settings,
  Camera,
  Lock,
  Calendar,
  Eye,
  Receipt,
  X,
  Sun,
  Timer,
  TrendingUp,
  BellRing,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Edit3,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import { SHAMSI_MONTH_NAMES } from '../shared/jalali';

interface WorkerPanelProps {
  user: UserProfile;
  initialShamsiDate: string;
  bannerBgUrl?: string | null;
  onUserAvatarChange?: (newAvatarUrl: string | null) => void;
}

interface WorkerSummaryKpis {
  totalWorkDays: number;
  totalNetWorkMinutes: number;
  totalOvertimeMinutes: number;
  approvedTotalToman: number;
  approvedReceivedToman: number;
  approvedPettyCashToman: number;
  earnedRegularWorkToman: number;
  earnedOvertimeToman: number;
  totalEntitlementToman: number;
  accountBalanceToman: number;
}

interface LatestUnreadMessageInfo {
  id: number;
  subject: string | null;
  message_text: string;
  sender_name: string;
  shamsi_date: string;
  recorded_time: string;
}

type WorkerTab = 'attendance' | 'reports' | 'finance' | 'correspondence' | 'settings';

const EVENT_BUTTON_CONFIG: {
  type: AttendanceEventType;
  label: string;
  icon: React.FC<{ className?: string }>;
  enabledClass: string;
  disabledClass: string;
}[] = [
  {
    type: 'WORK_START',
    label: 'شروع به کار',
    icon: Play,
    enabledClass:
      'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-sm',
    disabledClass:
      'bg-emerald-50/70 text-emerald-800/45 border-emerald-200 cursor-not-allowed',
  },
  {
    type: 'WORK_END',
    label: 'پایان کار',
    icon: Square,
    enabledClass:
      'bg-red-600 hover:bg-red-700 text-white border-red-700 shadow-sm',
    disabledClass:
      'bg-red-50/70 text-red-800/45 border-red-200 cursor-not-allowed',
  },
  {
    type: 'MISSION_START',
    label: 'شروع مأموریت',
    icon: Briefcase,
    enabledClass:
      'bg-purple-600 hover:bg-purple-700 text-white border-purple-700 shadow-sm',
    disabledClass:
      'bg-purple-50/70 text-purple-800/45 border-purple-200 cursor-not-allowed',
  },
  {
    type: 'MISSION_END',
    label: 'بازگشت از مأموریت',
    icon: CornerDownLeft,
    enabledClass:
      'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-sm',
    disabledClass:
      'bg-indigo-50/70 text-indigo-800/45 border-indigo-200 cursor-not-allowed',
  },
];

const EVENT_TYPE_LABELS: Record<AttendanceEventType, string> = {
  WORK_START: 'شروع به کار',
  MISSION_START: 'شروع مأموریت',
  MISSION_END: 'بازگشت از مأموریت',
  WORK_END: 'پایان کار',
};

const TX_TYPE_LABELS: Record<FinancialTxType, string> = {
  ADVANCE: 'مساعده',
  ON_ACCOUNT: 'علی‌الحساب',
  SALARY: 'حقوق',
  PETTY_CASH: 'خرید کارگاهی / هزینه تنخواه (طلب پرسنل)',
  OTHER: 'خرید وسیله / اسنپ / هزینه متفرقه (طلب پرسنل)',
};

const STATUS_LABELS: Record<FinancialStatus, string> = {
  PENDING: 'در انتظار تأیید مدیریت',
  APPROVED: 'تأییدشده',
  REJECTED: 'ردشده',
};

async function readAndCompressImageIfNeeded(
  file: File
): Promise<{ base64: string; fileName: string }> {
  const rawBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('خطا در خواندن فایل انتخاب‌شده'));
    reader.readAsDataURL(file);
  });

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    return { base64: rawBase64, fileName: file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf` };
  }

  const isStandardSmallImage =
    /\.(jpg|jpeg|png|webp)$/i.test(file.name) && file.size <= 1.2 * 1024 * 1024;
  if (isStandardSmallImage) {
    return { base64: rawBase64, fileName: file.name };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        let width = img.width || 1200;
        let height = img.height || 1200;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
          resolve({ base64: compressed, fileName: `${baseName}.jpg` });
          return;
        }
      } catch {
        // fallback to raw
      }
      const fallbackName = /\.(jpg|jpeg|png|webp)$/i.test(file.name)
        ? file.name
        : `${file.name || 'photo'}.jpg`;
      resolve({ base64: rawBase64, fileName: fallbackName });
    };
    img.onerror = () => {
      const fallbackName = /\.(jpg|jpeg|png|webp)$/i.test(file.name)
        ? file.name
        : `${file.name || 'photo'}.jpg`;
      resolve({ base64: rawBase64, fileName: fallbackName });
    };
    img.src = rawBase64;
  });
}

export const WorkerPanel: React.FC<WorkerPanelProps> = ({
  user,
  initialShamsiDate,
  bannerBgUrl: initialBannerBgUrl,
  onUserAvatarChange,
}) => {
  const [activeTab, setActiveTab] = useState<WorkerTab>('attendance');
  const [liveState, setLiveState] = useState<WorkerLiveState | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [serverShamsiDate, setServerShamsiDate] = useState<string>(initialShamsiDate);
  const [serverTimeHHMM, setServerTimeHHMM] = useState<string>('');
  const [bannerBgUrl, setBannerBgUrl] = useState<string | null>(
    initialBannerBgUrl || '/assets/media/banner-bg.svg'
  );
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [latestUnreadMessage, setLatestUnreadMessage] = useState<LatestUnreadMessageInfo | null>(
    null
  );
  const [workerKpis, setWorkerKpis] = useState<WorkerSummaryKpis>({
    totalWorkDays: 0,
    totalNetWorkMinutes: 0,
    totalOvertimeMinutes: 0,
    approvedTotalToman: 0,
    approvedReceivedToman: 0,
    approvedPettyCashToman: 0,
    earnedRegularWorkToman: 0,
    earnedOvertimeToman: 0,
    totalEntitlementToman: 0,
    accountBalanceToman: 0,
  });

  const [historySummaries, setHistorySummaries] = useState<DailyAttendanceSummary[]>([]);
  const [historicalRecords, setHistoricalRecords] = useState<HistoricalWorkRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [reports, setReports] = useState<DailyWorkReport[]>([]);
  const [workTasks, setWorkTasks] = useState<WorkTaskItem[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [financeTotals, setFinanceTotals] = useState<{
    approvedTotalToman: number;
    pendingTotalToman: number;
    approvedPettyCashToman: number;
    pendingCount: number;
  }>({
    approvedTotalToman: 0,
    pendingTotalToman: 0,
    approvedPettyCashToman: 0,
    pendingCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [clockNote, setClockNote] = useState('');
  const [externalLeaveRequestType, setExternalLeaveRequestType] = useState<LeaveType | null>(null);

  // ثبت سابقه کارکرد و اضافه‌کاری قبلی توسط پرسنل (در تب تنظیمات)
  const [showPastWorkForm, setShowPastWorkForm] = useState(false);
  const [pastWorkDate, setPastWorkDate] = useState(initialShamsiDate);
  const [pastWorkTitle, setPastWorkTitle] = useState('');
  const [pastWorkDays, setPastWorkDays] = useState('1');
  const [pastWorkHours, setPastWorkHours] = useState('');
  const [pastWorkMins, setPastWorkMins] = useState('0');
  const [pastOtHours, setPastOtHours] = useState('');
  const [pastOtMins, setPastOtMins] = useState('0');
  const [pastWorkNote, setPastWorkNote] = useState('');
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingExcel, setUploadingExcel] = useState(false);

  // فرم گزارش کار روزانه + عکس
  const [reportShamsiDate, setReportShamsiDate] = useState(initialShamsiDate);
  const [reportDesc, setReportDesc] = useState('');
  const [reportDuration, setReportDuration] = useState('');
  const [reportPhotoBase64, setReportPhotoBase64] = useState<string | null>(null);
  const [reportPhotoName, setReportPhotoName] = useState<string>('');
  const reportPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // فرم درخواست مالی یا ثبت هزینه متفرقه / تنخواه / اسنپ + ویرایش
  const [finAmount, setFinAmount] = useState('');
  const [finType, setFinType] = useState<FinancialTxType>('PETTY_CASH');
  const [finShamsiDate, setFinShamsiDate] = useState(initialShamsiDate);
  const [finDesc, setFinDesc] = useState('');
  const [finReceiptBase64, setFinReceiptBase64] = useState<string | null>(null);
  const [finReceiptName, setFinReceiptName] = useState<string>('');
  const finReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const [editingWorkerFinTx, setEditingWorkerFinTx] = useState<FinancialTransaction | null>(null);
  const [editWorkerFinAmount, setEditWorkerFinAmount] = useState('');
  const [editWorkerFinType, setEditWorkerFinType] = useState<FinancialTxType>('PETTY_CASH');
  const [editWorkerFinDate, setEditWorkerFinDate] = useState(initialShamsiDate);
  const [editWorkerFinDesc, setEditWorkerFinDesc] = useState('');

  // فیلتر ماه و حالت باز/بسته (نمایش ۲ روز آخر) برای سوابق ترددهای روزانه
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<string>('');
  const [showAllMonthHistory, setShowAllMonthHistory] = useState(false);

  // پاپ‌آپ پیش‌نمایش فایل‌ها و دوربین
  const [previewFile, setPreviewFile] = useState<PreviewFileItem | null>(null);
  const [cameraTarget, setCameraTarget] = useState<'report' | 'receipt' | null>(null);

  // تنظیمات پرسنل (حساب کاربری، ارسال اکسل سوابق، و اطلاعات قرارداد)
  const [workerSettingsSubTab, setWorkerSettingsSubTab] = useState<
    'profile' | 'excel_history' | 'contract'
  >('profile');

  const loadAllWorkerData = useCallback(async () => {
    try {
      const [liveRes, histRes, leaveRes, repRes, finRes, taskRes] = await Promise.all([
        apiRequest<{
          ok: boolean;
          serverTime: { shamsiDate: string; timeHHMM: string };
          liveState: WorkerLiveState;
          settings: SystemSettings;
          unreadMessagesCount: number;
          latestUnreadMessage?: LatestUnreadMessageInfo | null;
          workerKpis?: WorkerSummaryKpis;
          bannerBgUrl: string;
        }>('/api/attendance/live-status'),
        apiRequest<{
          ok: boolean;
          dailySummaries: DailyAttendanceSummary[];
          historicalRecords: HistoricalWorkRecord[];
        }>('/api/attendance/history'),
        apiRequest<{
          ok: boolean;
          leaveRequests: LeaveRequestItem[];
        }>('/api/leaves'),
        apiRequest<{ ok: boolean; reports: DailyWorkReport[] }>('/api/reports'),
        apiRequest<{
          ok: boolean;
          transactions: FinancialTransaction[];
          summary: {
            approvedTotalToman: number;
            pendingTotalToman: number;
            approvedPettyCashToman?: number;
            pendingCount: number;
          };
        }>('/api/finance'),
        apiRequest<{ ok: boolean; tasks: WorkTaskItem[] }>('/api/tasks'),
      ]);

      setLiveState(liveRes.liveState);
      setSettings(liveRes.settings);
      setServerShamsiDate(liveRes.serverTime.shamsiDate);
      setServerTimeHHMM(liveRes.serverTime.timeHHMM);
      setUnreadMessagesCount(liveRes.unreadMessagesCount);
      setLatestUnreadMessage(liveRes.latestUnreadMessage || null);
      if (liveRes.workerKpis) {
        setWorkerKpis(liveRes.workerKpis);
      }
      setBannerBgUrl(liveRes.bannerBgUrl);
      setHistorySummaries(histRes.dailySummaries);
      setHistoricalRecords(histRes.historicalRecords || []);
      setLeaveRequests(leaveRes.leaveRequests || []);
      setReports(repRes.reports);
      setWorkTasks(taskRes.tasks || []);
      setTransactions(finRes.transactions);
      setFinanceTotals({
        approvedTotalToman: finRes.summary?.approvedTotalToman ?? 0,
        pendingTotalToman: finRes.summary?.pendingTotalToman ?? 0,
        approvedPettyCashToman: finRes.summary?.approvedPettyCashToman ?? 0,
        pendingCount: finRes.summary?.pendingCount ?? 0,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllWorkerData();
  }, [loadAllWorkerData]);

  // بروزرسانی خودکار وضعیت پنل پرسنل (هر ۱۲ ثانیه و هنگام بازگشت به صفحه) برای دریافت آنی تأییدیه‌ها، تسک‌ها و نامه‌های مدیر
  useEffect(() => {
    const interval = window.setInterval(() => {
      loadAllWorkerData();
    }, 12000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        loadAllWorkerData();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [loadAllWorkerData]);

  const pendingWorkTasks = workTasks.filter((t) => !t.is_completed);

  const handleOpenCorrespondences = () => {
    setActiveTab('correspondence');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenTasksAndReports = () => {
    setActiveTab('reports');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClockEvent = async (eventType: AttendanceEventType) => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        message: string;
        liveState: WorkerLiveState;
      }>('/api/attendance/clock', {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          note: clockNote.trim() || null,
        }),
      });
      setLiveState(res.liveState);
      setClockNote('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickLeaveRequest = (type: LeaveType) => {
    setExternalLeaveRequestType(type);
    const el = document.getElementById('leave-management-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handlePastWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);
    try {
      const netMinutes = Number(pastWorkHours || 0) * 60 + Number(pastWorkMins || 0);
      const otMinutes = Number(pastOtHours || 0) * 60 + Number(pastOtMins || 0);
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/historical-work', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: pastWorkDate,
          title: pastWorkTitle,
          work_days_count: Number(pastWorkDays || 1),
          net_work_minutes: netMinutes,
          overtime_minutes: otMinutes,
          note: pastWorkNote,
        }),
      });
      setFeedback({ type: 'success', text: res.message });
      setShowPastWorkForm(false);
      setPastWorkTitle('');
      setPastWorkHours('');
      setPastWorkMins('0');
      setPastOtHours('');
      setPastOtMins('0');
      setPastWorkNote('');
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingExcel(true);
    setFeedback(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('خطا در خواندن فایل اکسل'));
        reader.readAsDataURL(file);
      });

      const res = await apiRequest<{ ok: boolean; message: string }>(
        '/api/historical-work/upload-excel',
        {
          method: 'POST',
          body: JSON.stringify({
            file_name: file.name,
            file_base64: base64,
            title: `فایل اکسل: ${file.name}`,
          }),
        }
      );
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setUploadingExcel(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleReportPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, fileName } = await readAndCompressImageIfNeeded(file);
      setReportPhotoBase64(base64);
      setReportPhotoName(fileName);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      if (reportPhotoInputRef.current) reportPhotoInputRef.current.value = '';
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: reportShamsiDate,
          activity_description: reportDesc,
          duration_minutes: reportDuration ? Number(reportDuration) : null,
          photo_base64: reportPhotoBase64,
          photo_name: reportPhotoName || null,
        }),
      });
      setReportDesc('');
      setReportDuration('');
      setReportPhotoBase64(null);
      setReportPhotoName('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinReceiptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, fileName } = await readAndCompressImageIfNeeded(file);
      setFinReceiptBase64(base64);
      setFinReceiptName(fileName);
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      if (finReceiptInputRef.current) finReceiptInputRef.current.value = '';
    }
  };

  const handleFinanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/finance/worker-request', {
        method: 'POST',
        body: JSON.stringify({
          amount_toman: Number(finAmount),
          tx_type: finType,
          shamsi_date: finShamsiDate,
          description: finDesc,
          receipt_base64: finReceiptBase64,
          receipt_file_name: finReceiptName || null,
          idempotency_key: `wrk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      setFinAmount('');
      setFinDesc('');
      setFinReceiptBase64(null);
      setFinReceiptName('');
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const openWorkerEditFinModal = (tx: FinancialTransaction) => {
    setEditingWorkerFinTx(tx);
    setEditWorkerFinAmount(String(tx.amount_toman));
    setEditWorkerFinType(tx.tx_type);
    setEditWorkerFinDate(tx.shamsi_date);
    setEditWorkerFinDesc(tx.description);
  };

  const handleWorkerUpdateFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkerFinTx) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/finance/${editingWorkerFinTx.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            amount_toman: editWorkerFinAmount,
            tx_type: editWorkerFinType,
            shamsi_date: editWorkerFinDate,
            description: editWorkerFinDesc,
          }),
        }
      );
      setEditingWorkerFinTx(null);
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleWorkerDeleteFinance = async (txId: number) => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/finance/${txId}`, {
        method: 'DELETE',
      });
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const allowedEvents = liveState?.allowed_next_events || ['WORK_START'];
  const isCreditor = workerKpis.accountBalanceToman > 0;
  const isDebtor = workerKpis.accountBalanceToman < 0;

  // استخراج ماه‌های موجود در سوابق تردد برای فیلتر ماهانه
  const availableHistoryMonths = React.useMemo(() => {
    const map = new Map<string, { key: string; year: number; month: number; count: number }>();
    const curPrefix = (serverShamsiDate || initialShamsiDate || '1405/08/01').slice(0, 7);
    const [cy, cm] = curPrefix.split('/').map(Number);
    if (cy && cm) {
      map.set(curPrefix, { key: curPrefix, year: cy, month: cm, count: 0 });
    }
    for (const day of historySummaries) {
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
  }, [historySummaries, serverShamsiDate, initialShamsiDate]);

  // انتخاب پیش‌فرض ماه دارای سابقه (اگر ماه جاری ترددی نداشت، آخرین ماه دارای سابقه نمایش داده شود)
  const effectiveHistoryMonth = React.useMemo(() => {
    if (selectedHistoryMonth) return selectedHistoryMonth;
    const curPrefix = (serverShamsiDate || initialShamsiDate || '1405/08/01').slice(0, 7);
    const curItem = availableHistoryMonths.find((m) => m.key === curPrefix);
    if (curItem && curItem.count > 0) return curPrefix;
    const firstWithData = availableHistoryMonths.find((m) => m.count > 0);
    return firstWithData ? firstWithData.key : curPrefix;
  }, [selectedHistoryMonth, availableHistoryMonths, serverShamsiDate, initialShamsiDate]);

  const monthHistorySummaries = React.useMemo(() => {
    return historySummaries.filter((d) => d.shamsi_date.startsWith(`${effectiveHistoryMonth}/`));
  }, [historySummaries, effectiveHistoryMonth]);

  const visibleHistorySummaries = React.useMemo(() => {
    return showAllMonthHistory ? monthHistorySummaries : monthHistorySummaries.slice(0, 2);
  }, [monthHistorySummaries, showAllMonthHistory]);

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5 pb-24 space-y-3">
      {/* ۱. بنر و کادر وضعیت یکپارچه پرسنل (بدون تکرار چندباره نام امید میثمی) */}
      <HeroBanner
        role="worker"
        shamsiDate={serverShamsiDate}
        timeHHMM={serverTimeHHMM}
        bannerBgUrl={bannerBgUrl}
        userAvatarUrl={liveState?.worker_profile?.avatar_url || user.avatar_url}
        collaborationStartShamsi={
          liveState?.worker_profile?.collaboration_start_shamsi ||
          settings?.collaboration_start_shamsi ||
          user.collaboration_start_shamsi ||
          '1405/06/15'
        }
        liveStatus={liveState?.status || 'FINISHED'}
        statusText={liveState?.status_text || 'خارج از شیفت'}
        statusDetail={liveState?.status_detail || ''}
        isOvertimeActive={Boolean(liveState?.is_overtime_active)}
        onRefresh={loadAllWorkerData}
      />

      {/* ۲. اعلان فوری پیام جدید یا تسک جدید از سمت مدیریت (با دکمه مستقیم مشاهده) */}
      {unreadMessagesCount > 0 && activeTab !== 'correspondence' && (
        <div
          role="alert"
          className="rounded-2xl bg-gradient-to-l from-[#0B192C] via-[#132847] to-[#0B192C] border border-[#C5A059] p-2.5 text-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#C5A059] text-[#0B192C] flex items-center justify-center shrink-0">
              <BellRing className="w-4 h-4 animate-bounce" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-extrabold text-[#C5A059]">
                  {toPersianDigits(unreadMessagesCount)} پیام خوانده‌نشده از مدیریت
                </span>
                {latestUnreadMessage?.shamsi_date && (
                  <span className="text-[10px] text-slate-300 tabular-nums">
                    ({toPersianDigits(latestUnreadMessage.shamsi_date)}{' '}
                    {latestUnreadMessage.recorded_time
                      ? `ساعت ${toPersianDigits(latestUnreadMessage.recorded_time)}`
                      : ''}
                    )
                  </span>
                )}
              </div>
              {latestUnreadMessage && (
                <p className="text-[11px] text-slate-100 truncate">
                  {latestUnreadMessage.subject ? (
                    <strong className="text-[#C5A059] ml-1">
                      {latestUnreadMessage.subject}:
                    </strong>
                  ) : null}
                  {latestUnreadMessage.message_text}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenCorrespondences}
            className="min-h-[34px] px-3 rounded-xl bg-[#C5A059] hover:bg-[#d4b06a] text-[#0B192C] text-[11px] font-extrabold flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
          >
            <span>مشاهده پیام مدیریت</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pendingWorkTasks.length > 0 && activeTab !== 'reports' && (
        <div
          role="alert"
          className="rounded-2xl bg-gradient-to-l from-[#0B192C] via-[#132847] to-[#0B192C] border border-[#C5A059] p-2.5 text-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#C5A059] text-[#0B192C] flex items-center justify-center shrink-0">
              <CheckSquare className="w-4 h-4" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-extrabold text-[#C5A059]">
                  {toPersianDigits(pendingWorkTasks.length)} تسک / وظیفه جدید از سمت مدیریت
                </span>
                <span className="text-[10px] text-slate-300 tabular-nums">
                  ({toPersianDigits(pendingWorkTasks[0].shamsi_date)})
                </span>
              </div>
              <p className="text-[11px] text-slate-100 truncate">
                <strong className="text-[#C5A059] ml-1">{pendingWorkTasks[0].title}</strong>
                {pendingWorkTasks[0].description ? `— ${pendingWorkTasks[0].description}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenTasksAndReports}
            className="min-h-[34px] px-3 rounded-xl bg-[#C5A059] hover:bg-[#d4b06a] text-[#0B192C] text-[11px] font-extrabold flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
          >
            <span>مشاهده تسک‌ها</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* هشدار فراموشی ثبت خروج روز گذشته */}
      {liveState?.forgotten_checkout_warning && liveState.forgotten_checkout_message && (
        <div
          role="alert"
          className="rounded-2xl bg-amber-50/90 border border-amber-300 p-2.5 flex items-start gap-2 text-amber-950 text-[11px]"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-5 font-medium">{liveState.forgotten_checkout_message}</p>
        </div>
      )}

      {/* پیام بازخورد عملیات */}
      {feedback && (
        <div
          role="alert"
          className={`p-2.5 rounded-2xl border text-[11px] flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[10px] underline mr-3 cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-6 text-center text-[11px] text-slate-500 bg-white rounded-2xl border border-slate-200">
          در حال بارگذاری اطلاعات...
        </div>
      ) : (
        <>
          {/* ================= تب ۱: ثبت تردد، مرخصی و خلاصه مالی و کارکرد ================= */}
          {activeTab === 'attendance' && (
            <div className="space-y-3">
              {/* بخش ۱ پس از بنر: دکمه‌های ثبت تردد روزانه (سبز، قرمز، بنفش) + دو کلید مجزای مرخصی روزانه و ساعتی با فونت ظریف‌تر */}
              <div className="rounded-2xl bg-white border border-[#C5A059]/55 p-3 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-extrabold text-[#0B192C]">
                    ثبت تردد روزانه و مرخصی
                  </h2>
                  <span className="text-[10px] text-slate-500 tabular-nums">
                    امروز: {toPersianDigits(serverShamsiDate)}
                  </span>
                </div>

                <div>
                  <input
                    type="text"
                    value={clockNote}
                    onChange={(e) => setClockNote(e.target.value)}
                    placeholder="توضیح تردد (اختیاری — مثلاً مقصد مأموریت)..."
                    className="w-full min-h-[36px] rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-[11px] focus:outline-none focus:bg-white focus:border-[#0B192C]"
                  />
                </div>

                {/* دکمه‌های ۴گانه تردد با اندازه جمع‌وجور و رنگ‌های اختصاصی: شروع به کار (سبز)، پایان کار (قرمز)، شروع مأموریت (بنفش) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {EVENT_BUTTON_CONFIG.map((btn) => {
                    const isAllowed = allowedEvents.includes(btn.type);
                    const Icon = btn.icon;
                    return (
                      <button
                        key={btn.type}
                        type="button"
                        disabled={!isAllowed || actionLoading}
                        onClick={() => handleClockEvent(btn.type)}
                        className={`min-h-[38px] rounded-xl border px-2.5 py-1.5 flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          isAllowed ? btn.enabledClass : btn.disabledClass
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[11px] font-bold">{btn.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* دو کلید مجزا برای درخواست مرخصی روزانه و درخواست مرخصی ساعتی با رنگ‌های متمایز و فونت ظریف‌تر */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleQuickLeaveRequest('DAILY')}
                    className="min-h-[36px] rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Sun className="w-3.5 h-3.5 shrink-0" />
                    <span>درخواست مرخصی روزانه</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLeaveRequest('HOURLY')}
                    className="min-h-[36px] rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Timer className="w-3.5 h-3.5 shrink-0" />
                    <span>درخواست مرخصی ساعتی</span>
                  </button>
                </div>

                {/* خلاصه تردد امروز */}
                {liveState?.today_summary && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1.5 border-t border-slate-100">
                    <div className="rounded-xl bg-slate-50 p-2 border border-slate-200/70">
                      <div className="text-[9.5px] text-slate-500">ورود امروز</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[#0B192C] tabular-nums">
                        {liveState.today_summary.first_in_time
                          ? toPersianDigits(liveState.today_summary.first_in_time)
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2 border border-slate-200/70">
                      <div className="text-[9.5px] text-slate-500">خروج امروز</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[#0B192C] tabular-nums">
                        {liveState.today_summary.last_out_time
                          ? toPersianDigits(liveState.today_summary.last_out_time)
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2 border border-slate-200/70">
                      <div className="text-[9.5px] text-slate-500">کارکرد خالص امروز</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[#0B192C] tabular-nums">
                        {formatMinutesToDurationPersian(
                          liveState.today_summary.provisional_work_minutes
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#FCF9F2] p-2 border border-[#C5A059]/40">
                      <div className="text-[9.5px] text-slate-600">اضافه‌کاری امروز</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[#9A7428] tabular-nums">
                        {formatMinutesToDurationPersian(
                          liveState.today_summary.overtime_minutes
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* بخش ۲ پس از دکمه‌های تردد: خلاصه وضعیت مالی و کل کارکرد تا تاریخ روز */}
              <div className="rounded-2xl bg-white border border-[#C5A059]/55 p-3 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-[#C5A059]" />
                    <h3 className="text-xs font-extrabold text-[#0B192C]">
                      خلاصه وضعیت مالی و کل کارکرد تا امروز
                    </h3>
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums">
                    {toPersianDigits(workerKpis.totalWorkDays)} روز کاری ثبت‌شده
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* ۱. جمع کل دریافتی تا تاریخ روز */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-0.5">
                    <div className="text-[10px] text-slate-500 font-medium">
                      جمع کل دریافتی تا امروز
                    </div>
                    <div className="text-xs sm:text-sm font-extrabold text-[#0B192C] tabular-nums">
                      {formatToman(workerKpis.approvedReceivedToman)}
                    </div>
                    {workerKpis.approvedPettyCashToman > 0 && (
                      <div className="text-[9.5px] text-emerald-700 tabular-nums font-medium">
                        + متفرقه/تنخواه: {formatToman(workerKpis.approvedPettyCashToman)}
                      </div>
                    )}
                  </div>

                  {/* ۲. کل ساعات کاری */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-0.5">
                    <div className="text-[10px] text-slate-500 font-medium">
                      کل ساعات کاری
                    </div>
                    <div className="text-xs sm:text-sm font-extrabold text-[#0B192C] tabular-nums">
                      {formatMinutesToDurationPersian(workerKpis.totalNetWorkMinutes)}
                    </div>
                    <div className="text-[9.5px] text-slate-500 tabular-nums">
                      معادل {formatToman(workerKpis.earnedRegularWorkToman)}
                    </div>
                  </div>

                  {/* ۳. کل ساعات اضافه‌کاری */}
                  <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/50 p-2.5 space-y-0.5">
                    <div className="text-[10px] text-slate-600 font-medium">
                      کل ساعات اضافه‌کاری
                    </div>
                    <div className="text-xs sm:text-sm font-extrabold text-[#9A7428] tabular-nums">
                      {formatMinutesToDurationPersian(workerKpis.totalOvertimeMinutes)}
                    </div>
                    <div className="text-[9.5px] text-slate-600 tabular-nums">
                      معادل {formatToman(workerKpis.earnedOvertimeToman)}
                    </div>
                  </div>

                  {/* ۴. مانده حساب (بدهکار با رنگ قرمز / بستانکار با رنگ سبز) */}
                  <div
                    className={`rounded-xl border-2 p-2.5 space-y-0.5 ${
                      isCreditor
                        ? 'bg-emerald-50/90 border-emerald-500 text-emerald-950'
                        : isDebtor
                          ? 'bg-red-50/90 border-red-500 text-red-950'
                          : 'bg-slate-50 border-slate-300 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold">مانده حساب</span>
                      <span
                        className={`text-[9.5px] px-1.5 py-0.5 rounded-md font-extrabold ${
                          isCreditor
                            ? 'bg-emerald-600 text-white'
                            : isDebtor
                              ? 'bg-red-600 text-white'
                              : 'bg-slate-600 text-white'
                        }`}
                      >
                        {isCreditor ? 'بستانکار' : isDebtor ? 'بدهکار' : 'تسویه'}
                      </span>
                    </div>
                    <div
                      className={`text-xs sm:text-sm font-extrabold tabular-nums ${
                        isCreditor
                          ? 'text-emerald-700'
                          : isDebtor
                            ? 'text-red-700'
                            : 'text-[#0B192C]'
                      }`}
                    >
                      {formatToman(Math.abs(workerKpis.accountBalanceToman))}
                    </div>
                    <div className="text-[9.5px] opacity-85">
                      {isCreditor
                        ? 'طلب کارکرد و تنخواه شما'
                        : isDebtor
                          ? 'دریافتی بیش از کارکرد'
                          : 'حساب تسویه است'}
                    </div>
                  </div>
                </div>
              </div>

              {/* بخش ۳: سهمیه و سوابق مرخصی (بدون تکرار دکمه‌های درخواست مرخصی) */}
              <LeaveManagementSection
                role="worker"
                currentShamsiDate={serverShamsiDate}
                externalRequestType={externalLeaveRequestType}
                onExternalRequestHandled={() => setExternalLeaveRequestType(null)}
                onUpdated={loadAllWorkerData}
                hideTriggerButtons={true}
              />

              {/* بخش ۴: تقویم کارکرد ماهانه با دراپ‌دان انتخاب ماه */}
              <MonthlyAttendanceCalendar
                currentShamsiDate={serverShamsiDate}
                dailySummaries={historySummaries}
                leaveRequests={leaveRequests}
                historicalRecords={historicalRecords}
                onMonthChange={(y, m) => {
                  setSelectedHistoryMonth(`${y}/${String(m).padStart(2, '0')}`);
                  setShowAllMonthHistory(false);
                }}
              />

              {/* بخش ۵: جدول سوابق ترددهای روزانه (فقط ماه انتخاب‌شده + نمایش ۲ روز آخر در حالت بسته) */}
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C5A059]" />
                    <h3 className="text-xs font-bold text-[#0B192C]">
                      سوابق ترددهای روزانه ماه انتخاب‌شده
                    </h3>
                  </div>

                  {availableHistoryMonths.length > 0 && (
                    <select
                      aria-label="فیلتر ماه سوابق تردد"
                      value={effectiveHistoryMonth}
                      onChange={(e) => {
                        setSelectedHistoryMonth(e.target.value);
                        setShowAllMonthHistory(false);
                      }}
                      className="min-h-[28px] rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10.5px] font-bold text-[#0B192C] focus:outline-none cursor-pointer"
                    >
                      {availableHistoryMonths.map((m) => (
                        <option key={m.key} value={m.key}>
                          {SHAMSI_MONTH_NAMES[m.month - 1]} {toPersianDigits(m.year)} (
                          {toPersianDigits(m.count)} روز)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {monthHistorySummaries.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-3 text-center">
                    در این ماه رکورد ترددی ثبت نشده است.
                  </p>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100">
                      {visibleHistorySummaries.map((day) => (
                        <div key={day.work_date} className="py-2 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                            <div className="flex items-center gap-1.5">
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
                                {toPersianDigits(day.status_label)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 tabular-nums text-[10.5px]">
                              <span className="text-slate-700">
                                کارکرد: <strong>{formatMinutesToHHMM(day.net_work_minutes)}</strong>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#9A7428]">
                                اضافه‌کاری: <strong>{formatMinutesToHHMM(day.overtime_minutes)}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-slate-600">
                            {day.logs.length > 0 ? (
                              day.logs.map((l) => (
                                <span key={l.id} className="tabular-nums">
                                  {EVENT_TYPE_LABELS[l.event_type]}:{' '}
                                  <strong className="text-[#0B192C]">
                                    {toPersianDigits(l.recorded_time.slice(0, 5))}
                                  </strong>
                                </span>
                              ))
                            ) : (
                              <>
                                <span className="tabular-nums">
                                  شروع کار:{' '}
                                  <strong className="text-[#0B192C]">
                                    {toPersianDigits(day.first_in_time || '07:00')}
                                  </strong>
                                </span>
                                <span className="tabular-nums">
                                  پایان کار:{' '}
                                  <strong className="text-[#0B192C]">
                                    {toPersianDigits(day.last_out_time || '15:00')}
                                  </strong>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {monthHistorySummaries.length > 2 && (
                      <div className="pt-1.5 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setShowAllMonthHistory((prev) => !prev)}
                          className="w-full min-h-[34px] rounded-xl bg-[#FCF9F2] hover:bg-amber-50 border border-[#C5A059]/50 text-[11px] font-bold text-[#0B192C] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {showAllMonthHistory ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>بستن و نمایش فقط ۲ روز آخر</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>
                                نمایش همه اطلاعات این ماه (
                                {toPersianDigits(monthHistorySummaries.length)} روز)
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

          {/* ================= تب ۲: تسک‌های جدید (بالا) + فرم ارسال گزارش (وسط) + آرشیو تسک‌ها و گزارش‌ها (پایین) ================= */}
          {activeTab === 'reports' && (
            <div className="space-y-4">
              {/* بخش ۱ (بالای صفحه): تسک‌ها و وظایف جدید ارسالی مدیریت و تعیین تکلیف آن‌ها */}
              <DailyTasksChecklist
                role="worker"
                currentShamsiDate={serverShamsiDate}
                sectionMode="pending_only"
                externalTasks={workTasks}
                onTasksUpdated={loadAllWorkerData}
                onAddCompletedToReport={(summaryText) => {
                  setReportDesc((prev) => (prev ? `${prev}\n${summaryText}` : summaryText));
                }}
              />

              {/* بخش ۲ (وسط صفحه): فرم ثبت و ارسال گزارش کار روزانه */}
              <form
                onSubmit={handleReportSubmit}
                className="rounded-2xl bg-white border border-[#C5A059]/45 p-4 space-y-3.5"
              >
                <h3 className="text-sm font-bold text-[#0B192C] border-b border-slate-100 pb-2.5">
                  ارسال و ثبت گزارش کار روزانه
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ShamsiDatePicker
                    label="تاریخ گزارش"
                    value={reportShamsiDate}
                    onChange={setReportShamsiDate}
                    todayShamsi={serverShamsiDate}
                  />
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      مدت زمان فعالیت به دقیقه (اختیاری)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={reportDuration}
                      onChange={(e) => setReportDuration(e.target.value)}
                      placeholder="مثلاً ۱۲۰"
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs tabular-nums focus:outline-none focus:border-[#0B192C]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    شرح فعالیت انجام‌شده
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    placeholder="جزئیات کارهای انجام‌شده..."
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                {/* پیوست عکس از کار انجام‌شده */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={reportPhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleReportPhotoSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setCameraTarget('report')}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-xs font-semibold text-[#0B192C] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>عکس با دوربین از کار انجام‌شده</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => reportPhotoInputRef.current?.click()}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-xs font-semibold text-[#0B192C] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-[#0B192C]" />
                        <span>انتخاب تصویر از گالری</span>
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                    >
                      {actionLoading ? 'در حال ثبت...' : 'ارسال گزارش'}
                    </button>
                  </div>

                  {reportPhotoBase64 && (
                    <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <img
                          src={reportPhotoBase64}
                          alt="پیش‌نمایش"
                          className="w-10 h-10 rounded-lg object-cover border border-[#C5A059]/40"
                        />
                        <span className="text-xs font-bold text-[#0B192C] truncate max-w-[180px]">
                          {reportPhotoName || 'تصویر پیوست‌شده'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReportPhotoBase64(null);
                          setReportPhotoName('');
                        }}
                        className="p-1 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {feedback && activeTab === 'reports' && (
                    <div
                      className={`rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-between ${
                        feedback.type === 'success'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border border-red-200 text-red-900'
                      }`}
                    >
                      <span>{feedback.text}</span>
                      <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-[11px] opacity-75 hover:opacity-100 cursor-pointer"
                      >
                        بستن
                      </button>
                    </div>
                  )}
                </div>
              </form>

              {/* بخش ۳ (پایین صفحه): آرشیو تسک‌های انجام‌شده و سوابق گزارش‌های روزانه */}
              <DailyTasksChecklist
                role="worker"
                currentShamsiDate={serverShamsiDate}
                sectionMode="archived_only"
                externalTasks={workTasks}
                onTasksUpdated={loadAllWorkerData}
                onAddCompletedToReport={(summaryText) => {
                  setReportDesc((prev) => (prev ? `${prev}\n${summaryText}` : summaryText));
                }}
              />

              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
                <h3 className="text-sm font-bold text-[#0B192C]">
                  آرشیو و سوابق گزارش‌های روزانه ({toPersianDigits(reports.length)})
                </h3>
                {reports.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    هنوز گزارش کاری ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {reports.map((rep) => (
                      <div key={rep.id} className="py-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                          <div className="flex items-center gap-2">
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
                                  file_name: rep.photo_name || 'تصویر گزارش کار',
                                  file_url: rep.photo_url!,
                                  mime_type: 'image/jpeg',
                                })
                              }
                              className="inline-flex items-center gap-2 rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-1.5 text-xs font-bold text-[#0B192C] hover:border-[#C5A059] cursor-pointer"
                            >
                              <img
                                src={rep.photo_url}
                                alt="تصویر گزارش"
                                className="w-9 h-9 rounded-lg object-cover"
                              />
                              <Eye className="w-3.5 h-3.5 text-[#9A7428]" />
                              <span>مشاهده تصویر کار انجام‌شده</span>
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

          {/* ================= تب ۳: امور مالی + ثبت مساعده و هزینه‌های متفرقه / اسنپ / تنخواه ================= */}
          {activeTab === 'finance' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white border border-[#C5A059]/45 p-3">
                  <div className="text-[10px] text-slate-500">دریافتی‌ها و تسویه‌های تأییدشده</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-extrabold text-[#0B192C] tabular-nums">
                    {formatToman(financeTotals.approvedTotalToman)}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/50 p-3">
                  <div className="text-[10px] text-slate-600">
                    هزینه‌های متفرقه و تنخواه تأییدشده (اضافه‌شده به طلب)
                  </div>
                  <div className="mt-0.5 text-xs sm:text-sm font-extrabold text-emerald-800 tabular-nums">
                    {formatToman(financeTotals.approvedPettyCashToman)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-3">
                  <div className="text-[10px] text-slate-500">
                    در انتظار تأیید مدیریت ({toPersianDigits(financeTotals.pendingCount)})
                  </div>
                  <div className="mt-0.5 text-xs sm:text-sm font-extrabold text-[#9A7428] tabular-nums">
                    {formatToman(financeTotals.pendingTotalToman)}
                  </div>
                </div>
              </div>

              {/* صورتحساب تفصیلی هر ماه / دوره در تب امور مالی پرسنل */}
              <MonthlyStatementSection
                role="worker"
                currentShamsiDate={serverShamsiDate}
                collaborationStartShamsi={
                  liveState?.worker_profile?.collaboration_start_shamsi ||
                  settings?.collaboration_start_shamsi ||
                  user.collaboration_start_shamsi
                }
                dailySummaries={historySummaries}
                historicalRecords={historicalRecords}
                transactions={transactions}
                settings={settings}
                cumulativeBalanceToman={workerKpis.accountBalanceToman}
              />

              <form
                onSubmit={handleFinanceSubmit}
                className="rounded-2xl bg-white border border-[#C5A059]/45 p-3.5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <h3 className="text-xs font-extrabold text-[#0B192C]">
                      ثبت هزینه متفرقه (اسنپ، خرید وسیله، تنخواه) یا درخواست مساعده
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      در صورت فراموشی ثبت توسط مدیریت، می‌توانید هزینه‌های متفرقه (اسنپ، خرید وسیله یا تنخواه) را ثبت کنید تا پس از تأیید مدیر به حساب مالی شما اضافه شود.
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
                    <button
                      type="button"
                      onClick={() => setFinType('PETTY_CASH')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                        finType === 'PETTY_CASH'
                          ? 'bg-[#0B192C] text-[#C5A059]'
                          : 'text-slate-600'
                      }`}
                    >
                      <Receipt className="w-3 h-3" />
                      <span>هزینه متفرقه / تنخواه</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinType('ADVANCE')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        finType !== 'PETTY_CASH'
                          ? 'bg-[#0B192C] text-[#C5A059]'
                          : 'text-slate-600'
                      }`}
                    >
                      مساعده / دریافتی
                    </button>
                  </div>
                </div>

                {/* تگ‌های انتخاب سریع موضوع خرید کارگاهی، هزینه متفرقه (اسنپ، وسیله، ابزار و...) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 ml-1">انتخاب سریع موضوع:</span>
                  {[
                    { label: 'خرید برای کارگاه / تهیه اقلام', type: 'PETTY_CASH' as FinancialTxType },
                    { label: 'تهیه وسیله / ابزار برای کار', type: 'PETTY_CASH' as FinancialTxType },
                    { label: 'هزینه اسنپ / ایاب‌وذهاب', type: 'PETTY_CASH' as FinancialTxType },
                    {
                      label: 'خرید / هزینه انجام‌شده برای کار (اسنپ / وسیله)',
                      type: 'OTHER' as FinancialTxType,
                    },
                    { label: 'درخواست مساعده', type: 'ADVANCE' as FinancialTxType },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setFinType(preset.type);
                        setFinDesc(preset.label);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 border border-[#C5A059]/50 text-[10px] font-semibold text-[#0B192C] transition-colors cursor-pointer"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-start">
                  <TomanInput
                    label={
                      finType === 'PETTY_CASH'
                        ? 'مبلغ هزینه / فاکتور (تومان)'
                        : 'مبلغ (تومان)'
                    }
                    value={finAmount}
                    onChange={setFinAmount}
                    required
                  />

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      نوع ثبت در حساب مالی
                    </label>
                    <select
                      value={finType}
                      onChange={(e) => setFinType(e.target.value as FinancialTxType)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-2.5 text-[11px] bg-white focus:outline-none focus:border-[#0B192C]"
                    >
                      <option value="PETTY_CASH">
                        هزینه متفرقه / اسنپ / تنخواه (اضافه‌شدن به بستانکاری پس از تأیید مدیر)
                      </option>
                      <option value="OTHER">
                        هزینه انجام‌شده توسط مدیر برای پرسنل (اسنپ، خرید وسیله و...)
                      </option>
                      <option value="ADVANCE">درخواست مساعده</option>
                      <option value="ON_ACCOUNT">درخواست علی‌الحساب</option>
                      <option value="SALARY">دریافتی حقوق</option>
                    </select>
                  </div>

                  <ShamsiDatePicker
                    label="تاریخ"
                    value={finShamsiDate}
                    onChange={setFinShamsiDate}
                    todayShamsi={serverShamsiDate}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    {finType === 'PETTY_CASH'
                      ? 'شرح هزینه متفرقه (اسنپ، خرید وسیله یا اقلام کارگاهی)'
                      : 'شرح و توضیحات'}
                  </label>
                  <input
                    type="text"
                    required
                    value={finDesc}
                    onChange={(e) => setFinDesc(e.target.value)}
                    placeholder={
                      finType === 'PETTY_CASH'
                        ? 'مثلاً هزینه اسنپ مأموریت، خرید وسیله یا اقلام مصرفی کارگاه...'
                        : 'مثلاً هزینه اسنپ پرداخت‌شده توسط مدیر یا درخواست مساعده...'
                    }
                    className="w-full min-h-[38px] rounded-xl border border-slate-200 px-3 text-[11px] focus:outline-none focus:border-[#0B192C]"
                  />
                </div>

                {/* پیوست عکس فاکتور / رسید */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        ref={finReceiptInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFinReceiptSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setCameraTarget('receipt')}
                        className="min-h-[34px] px-2.5 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-[11px] font-semibold text-[#0B192C] flex items-center gap-1 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>عکس از رسید با دوربین</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => finReceiptInputRef.current?.click()}
                        className="min-h-[34px] px-2.5 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-[11px] font-semibold text-[#0B192C] flex items-center gap-1 cursor-pointer"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-[#0B192C]" />
                        <span>پیوست تصویر رسید / فاکتور</span>
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="min-h-[38px] px-5 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-[11px] font-bold cursor-pointer"
                    >
                      {actionLoading
                        ? 'در حال ثبت...'
                        : finType === 'PETTY_CASH'
                          ? 'ثبت هزینه متفرقه جهت تأیید مدیر'
                          : 'ثبت و ارسال برای مدیریت'}
                    </button>
                  </div>

                  {finReceiptBase64 && (
                    <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span className="text-[11px] font-bold text-[#0B192C] truncate max-w-[200px]">
                          {finReceiptName || 'تصویر فاکتور پیوست‌شده'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFinReceiptBase64(null);
                          setFinReceiptName('');
                        }}
                        className="p-1 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {feedback && activeTab === 'finance' && (
                    <div
                      className={`rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-between ${
                        feedback.type === 'success'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border border-red-200 text-red-900'
                      }`}
                    >
                      <span>{feedback.text}</span>
                      <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-[11px] opacity-75 hover:opacity-100 cursor-pointer"
                      >
                        بستن
                      </button>
                    </div>
                  )}
                </div>
              </form>

              <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-2">
                <h3 className="text-xs font-bold text-[#0B192C]">
                  سوابق پرداختی‌ها، هزینه‌های متفرقه و تنخواه
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-3 text-center">
                    هنوز تراکنشی ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="py-2.5 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-[#0B192C] tabular-nums">
                              {formatToman(tx.amount_toman)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                tx.tx_type === 'PETTY_CASH'
                                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                                  : tx.tx_type === 'OTHER'
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
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10.5px] font-bold ${
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
                                  onClick={() => openWorkerEditFinModal(tx)}
                                  title="ویرایش درخواست مالی"
                                  className="min-h-[26px] px-2 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 text-[#0B192C] border border-[#C5A059]/70 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3 text-[#9A7428]" />
                                  <span>ویرایش</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleWorkerDeleteFinance(tx.id)}
                                  title="حذف درخواست"
                                  className="min-h-[26px] px-1.5 rounded-lg bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-700 border border-slate-200 hover:border-red-200 text-[10px] flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-700">{tx.description}</p>
                        {tx.receipt_file_url && (
                          <div className="pt-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewFile({
                                  file_name: tx.receipt_file_name || 'تصویر فاکتور / رسید',
                                  file_url: tx.receipt_file_url!,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 px-2 py-1 text-[10.5px] font-bold text-[#0B192C] hover:border-[#C5A059] cursor-pointer"
                            >
                              <Eye className="w-3 h-3 text-[#9A7428]" />
                              <span>پیش‌نمایش فاکتور / رسید</span>
                            </button>
                          </div>
                        )}
                        {tx.manager_note && (
                          <p className="text-[10px] text-slate-500">
                            یادداشت مدیریت: {tx.manager_note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= تب ۴: مکاتبات کاری، پیام صوتی و پیش‌نمایش پاپ‌آپ فایل‌ها ================= */}
          {activeTab === 'correspondence' && (
            <WorkCorrespondenceSection
              role="worker"
              currentUserRole="worker"
              todayShamsi={serverShamsiDate}
              onUnreadChange={(cnt) => {
                setUnreadMessagesCount(cnt);
                if (cnt === 0) setLatestUnreadMessage(null);
              }}
            />
          )}

          {/* ================= تب ۵: تنظیمات پرسنل (حساب کاربری، ارسال اکسل سوابق، و اطلاعات قرارداد) ================= */}
          {activeTab === 'settings' && (
            <div className="space-y-3.5">
              {/* تب‌های افقی کنار هم در بخش تنظیمات پرسنل */}
              <div className="grid grid-cols-3 gap-1.5 bg-white p-1.5 rounded-2xl border border-[#C5A059]/45">
                <button
                  type="button"
                  onClick={() => setWorkerSettingsSubTab('profile')}
                  className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    workerSettingsSubTab === 'profile'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:text-[#0B192C]'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>حساب و تصویر</span>
                </button>

                <button
                  type="button"
                  onClick={() => setWorkerSettingsSubTab('excel_history')}
                  className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    workerSettingsSubTab === 'excel_history'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:text-[#0B192C]'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>ارسال اکسل سوابق</span>
                </button>

                <button
                  type="button"
                  onClick={() => setWorkerSettingsSubTab('contract')}
                  className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    workerSettingsSubTab === 'contract'
                      ? 'bg-[#0B192C] text-[#C5A059]'
                      : 'text-slate-600 hover:text-[#0B192C]'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>قرارداد و شیفت</span>
                </button>
              </div>

              {/* زیرتب ۱: تصویر پروفایل، تغییر رمز عبور و ورود سریع */}
              {workerSettingsSubTab === 'profile' && (
                <AccountSettingsPanel
                  user={user}
                  currentAvatarUrl={liveState?.worker_profile?.avatar_url || user.avatar_url}
                  onAvatarUpdated={(newUrl) => {
                    onUserAvatarChange?.(newUrl);
                    loadAllWorkerData();
                  }}
                />
              )}

              {/* زیرتب ۲: ارسال و ثبت فایل اکسل سوابق کارکرد ماه‌های قبل */}
              {workerSettingsSubTab === 'excel_history' && (
                <div className="space-y-3.5">
                  <div className="rounded-2xl bg-white border border-[#C5A059]/55 p-4 space-y-3.5">
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-[#0B192C] flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        <span>ارسال فایل اکسل و ثبت سوابق کارکرد ماه‌های قبل</span>
                      </h3>
                      <p className="text-xs text-slate-500 leading-5">
                        می‌توانید فایل اکسل ساعات کاری و اضافه‌کاری ماه‌های گذشته را بارگذاری کنید یا سابقه کارکرد را به‌صورت دستی ثبت نمایید تا پس از تأیید مدیریت در تقویم و محاسبات منظور شود.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <a
                        href="/api/historical-work/excel-template"
                        download="mgammon-work-history-template.xlsx"
                        className="min-h-[40px] px-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-bold flex items-center gap-1.5"
                      >
                        <Download className="w-4 h-4" />
                        <span>دانلود نمونه فایل اکسل</span>
                      </a>

                      <input
                        ref={excelInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleExcelFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={uploadingExcel}
                        onClick={() => excelInputRef.current?.click()}
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        <span>{uploadingExcel ? 'در حال بارگذاری...' : 'انتخاب و ارسال فایل اکسل'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowPastWorkForm((s) => !s)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#FCF9F2] hover:bg-amber-100/70 text-[#0B192C] border border-[#C5A059] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-[#9A7428]" />
                        <span>{showPastWorkForm ? 'بستن فرم دستی' : 'ثبت دستی سابقه قبلی'}</span>
                      </button>
                    </div>

                    {showPastWorkForm && (
                      <form
                        onSubmit={handlePastWorkSubmit}
                        className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059] p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
                          <h4 className="text-xs font-bold text-[#0B192C]">
                            فرم ثبت دستی سابقه کارکرد و اضافه‌کاری قبلی
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
                            label="تاریخ"
                            value={pastWorkDate}
                            onChange={setPastWorkDate}
                            todayShamsi={serverShamsiDate}
                          />
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1.5">
                              عنوان دوره یا روز کاری
                            </label>
                            <input
                              type="text"
                              required
                              value={pastWorkTitle}
                              onChange={(e) => setPastWorkTitle(e.target.value)}
                              placeholder="مثلاً کارکرد نیمه اول مهر"
                              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
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
                              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-xs tabular-nums"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              ساعت کارکرد
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={pastWorkHours}
                              onChange={(e) => setPastWorkHours(e.target.value)}
                              placeholder="0"
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs tabular-nums"
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
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs tabular-nums"
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
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs tabular-nums"
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
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs tabular-nums"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={actionLoading}
                          className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                        >
                          {actionLoading ? 'در حال ارسال...' : 'ارسال جهت تأیید مدیریت'}
                        </button>
                      </form>
                    )}
                  </div>

                  {/* فهرست سوابق کارکرد قبلی ارسالی */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
                    <h4 className="text-sm font-bold text-[#0B192C]">
                      سوابق کارکرد و فایل‌های اکسل ثبت‌شده
                    </h4>
                    {historicalRecords.length === 0 ? (
                      <p className="text-xs text-slate-500 py-3 text-center">
                        هنوز فایل اکسل یا سابقه قبلی ثبت نشده است.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {historicalRecords.map((rec) => (
                          <div
                            key={rec.id}
                            className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
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
                                <strong>{formatMinutesToDurationPersian(rec.net_work_minutes)}</strong>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#9A7428]">
                                اضافه‌کاری:{' '}
                                <strong>{formatMinutesToDurationPersian(rec.overtime_minutes)}</strong>
                              </span>
                              <span aria-hidden="true">·</span>
                              {rec.status === 'APPROVED' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  تأییدشده
                                </span>
                              ) : rec.status === 'REJECTED' ? (
                                <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                                  <XCircle className="w-3.5 h-3.5" />
                                  ردشده
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                                  <Hourglass className="w-3.5 h-3.5" />
                                  در انتظار تأیید
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* زیرتب ۳: اطلاعات شروع قرارداد، ساعات کاری و حقوق پایه */}
              {workerSettingsSubTab === 'contract' && settings && (
                <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
                  <h3 className="text-sm font-bold text-[#0B192C] border-b border-slate-100 pb-2.5">
                    مشخصات قرارداد و ساعات کاری مصوب
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/50 p-3 flex items-center justify-between">
                      <span className="text-slate-600">تاریخ شروع قرارداد:</span>
                      <strong className="text-[#0B192C] tabular-nums">
                        {toPersianDigits(settings.collaboration_start_shamsi || '1405/06/15')}
                      </strong>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                      <span className="text-slate-600">شیفت شنبه تا چهارشنبه:</span>
                      <strong className="text-[#0B192C] tabular-nums">
                        {toPersianDigits(settings.shift_start_time)} تا{' '}
                        {toPersianDigits(settings.shift_end_time)}
                      </strong>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                      <span className="text-slate-600">شیفت پنجشنبه:</span>
                      <strong className="text-[#0B192C] tabular-nums">
                        {toPersianDigits(settings.thursday_shift_start_time || '07:00')} تا{' '}
                        {toPersianDigits(settings.thursday_shift_end_time || '14:00')}
                      </strong>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                      <span className="text-slate-600">حقوق پایه ماهانه:</span>
                      <strong className="text-[#0B192C] tabular-nums">
                        {settings.base_salary_toman
                          ? formatToman(settings.base_salary_toman)
                          : 'تعیین‌نشده'}
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* پاپ‌آپ ویرایش درخواست مالی در پنل پرسنل */}
      {editingWorkerFinTx && (
        <div
          onClick={() => setEditingWorkerFinTx(null)}
          className="fixed inset-0 z-50 bg-[#0B192C]/45 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white border border-[#C5A059] shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-[#9A7428]" />
                <h3 className="text-xs font-bold text-[#0B192C]">
                  ویرایش درخواست مالی / هزینه متفرقه
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingWorkerFinTx(null)}
                aria-label="بستن"
                className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleWorkerUpdateFinance} className="space-y-3">
              <TomanInput
                label="مبلغ (تومان)"
                required
                value={editWorkerFinAmount}
                onChange={setEditWorkerFinAmount}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    نوع درخواست
                  </label>
                  <select
                    value={editWorkerFinType}
                    onChange={(e) => setEditWorkerFinType(e.target.value as FinancialTxType)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 px-2.5 text-[11px] bg-white"
                  >
                    <option value="PETTY_CASH">
                      ثبت هزینه متفرقه / تنخواه / اسنپ (بستانکاری پرسنل)
                    </option>
                    <option value="OTHER">
                      ثبت هزینه متفرقه پرداخت‌شده توسط مدیر برای پرسنل
                    </option>
                    <option value="ADVANCE">درخواست مساعده</option>
                    <option value="ON_ACCOUNT">درخواست علی‌الحساب</option>
                    <option value="SALARY">دریافتی حقوق</option>
                  </select>
                </div>

                <ShamsiDatePicker
                  label="تاریخ"
                  value={editWorkerFinDate}
                  onChange={setEditWorkerFinDate}
                  todayShamsi={serverShamsiDate}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  شرح و توضیحات
                </label>
                <input
                  type="text"
                  required
                  value={editWorkerFinDesc}
                  onChange={(e) => setEditWorkerFinDesc(e.target.value)}
                  className="w-full min-h-[38px] rounded-xl border border-slate-200 px-3 text-[11px]"
                />
              </div>

              <div className="pt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingWorkerFinTx(null)}
                  className="min-h-[36px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="min-h-[36px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-[11px] font-bold cursor-pointer"
                >
                  {actionLoading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* پاپ‌آپ پیش‌نمایش فایل یا تصویر با قابلیت دانلود اختیاری */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* پاپ‌آپ دوربین موبایل برای ثبت عکس گزارش کار یا فاکتور تنخواه */}
      <CameraCaptureModal
        isOpen={Boolean(cameraTarget)}
        title={
          cameraTarget === 'report'
            ? 'ثبت عکس از کار انجام‌شده'
            : 'ثبت عکس فاکتور / رسید تنخواه'
        }
        onClose={() => setCameraTarget(null)}
        onCapture={(fileName, base64Data) => {
          if (cameraTarget === 'report') {
            setReportPhotoBase64(base64Data);
            setReportPhotoName(fileName);
          } else if (cameraTarget === 'receipt') {
            setFinReceiptBase64(base64Data);
            setFinReceiptName(fileName);
          }
          setCameraTarget(null);
        }}
      />

      {/* منوی پایین ثابت موبایل */}
      <nav
        aria-label="منوی اصلی پرسنل"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#0B192C]/95 backdrop-blur-md border-t border-[#C5A059]/50 px-2 py-1.5"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-5 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('attendance')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'attendance'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="text-[10px]">ثبت تردد</span>
          </button>

          <button
            type="button"
            onClick={handleOpenTasksAndReports}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {pendingWorkTasks.length > 0 && (
              <span className="absolute top-1 right-2 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[9px] font-bold">
                {toPersianDigits(pendingWorkTasks.length)}
              </span>
            )}
            <FileText className="w-4 h-4" />
            <span className="text-[10px]">گزارش و کارها</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('finance')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'finance'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span className="text-[10px]">مالی و تنخواه</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCorrespondences}
            className={`relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'correspondence'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {unreadMessagesCount > 0 && (
              <span className="absolute top-1 right-2 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[9px] font-bold">
                {toPersianDigits(unreadMessagesCount)}
              </span>
            )}
            <MessageSquare className="w-4 h-4" />
            <span className="text-[10px]">مکاتبات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#C5A059] text-[#0B192C] font-bold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[10px]">تنظیمات</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
