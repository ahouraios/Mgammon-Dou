import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttendanceEventType,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
  FlexibleClockEntryMode,
  HistoricalWorkRecord,
  LeaveRequestItem,
  LeaveType,
  MediaSourceType,
  SystemSettings,
  UserProfile,
  WorkerLiveState,
  WorkTaskItem,
} from '../shared/types';
import { apiRequest, isConnectionErrorMessage } from '../services/api';
import {
  formatMinutesToDurationPersian,
  formatMinutesToHHMM,
  formatToman,
  parseTimeToMinutes,
  shamsiToGregorian,
  toPersianDigits,
} from '../shared/jalali';
import { calculateDailyAttendance, getDayShiftSchedule } from '../shared/calculationEngine';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { TimePickerInput } from './TimePickerInput';
import { TomanInput } from './TomanInput';
import { HeroBanner } from './HeroBanner';
import { updateAppNotificationBadge } from './BrandLogo';
import { LeaveManagementSection } from './LeaveManagementSection';
import { DailyTasksChecklist } from './DailyTasksChecklist';
import { MonthlyAttendanceCalendar } from './MonthlyAttendanceCalendar';
import { WorkCorrespondenceSection } from './WorkCorrespondenceSection';
import { AccountSettingsPanel } from './AccountSettingsPanel';
import { FilePreviewModal, PreviewFileItem } from './FilePreviewModal';
import { CameraCaptureModal } from './CameraCaptureModal';
import { MonthlyStatementSection } from './MonthlyStatementSection';
import {
  NotificationSettingsGuideSection,
  triggerNativePhoneNotification,
} from './MobileNotificationHelper';
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
  HardDrive,
} from 'lucide-react';
import { SHAMSI_MONTH_NAMES } from '../shared/jalali';
import { MediaStorageCleanupPanel } from './MediaStorageCleanupPanel';

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
  lateAndAbsenceDeductionToman?: number;
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

const LATE_STATUS_BADGE_INFO: Record<
  string,
  { label: string; className: string }
> = {
  PENDING: {
    label: 'در انتظار بررسی و تأیید تأخیر توسط مدیر',
    className: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  EXCUSED: {
    label: 'ثبت بدون تأخیر (بخشش تأخیر توسط مدیر)',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  APPROVED_DELAY: {
    label: 'ثبت با تأخیر (کسر مبلغ تأخیر طبق تعرفه)',
    className: 'bg-orange-100 text-orange-900 border-orange-300',
  },
  ABSENCE: {
    label: 'ثبت غیبت روزانه (با تصمیم مدیر)',
    className: 'bg-red-100 text-red-900 border-red-300',
  },
  DEDUCT_LEAVE: {
    label: 'کسر مدت تأخیر از سهمیه مرخصی',
    className: 'bg-sky-100 text-sky-900 border-sky-300',
  },
  CUSTOM: {
    label: 'تعیین تکلیف سفارشی توسط مدیر',
    className: 'bg-purple-100 text-purple-900 border-purple-300',
  },
};

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
  const [showLateReasonModal, setShowLateReasonModal] = useState(false);
  const [lateReasonInput, setLateReasonInput] = useState('');
  const [pendingLateMinutesPreview, setPendingLateMinutesPreview] = useState(0);
  const [unseenLateDecisions, setUnseenLateDecisions] = useState<DailyAttendanceSummary[]>([]);
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const isFirstPollDoneRef = useRef(false);
  const [externalLeaveRequestType, setExternalLeaveRequestType] = useState<LeaveType | null>(null);

  // ثبت بازنگری ساعت آغاز یا خاتمه شیفت امروز در هر ساعت از شبانه‌روز (بدون الزام به تکمیل هم‌زمان ساعت پایان)
  const [showTodayFlexibleForm, setShowTodayFlexibleForm] = useState(false);
  const [todayFlexMode, setTodayFlexMode] = useState<FlexibleClockEntryMode>('START_ONLY');
  const [todayFlexCheckIn, setTodayFlexCheckIn] = useState('07:00');
  const [todayFlexCheckOut, setTodayFlexCheckOut] = useState('17:00');
  const [todayFlexNote, setTodayFlexNote] = useState('');

  // ثبت سابقه کارکرد و اضافه‌کاری قبلی توسط پرسنل (با ورود ساعت ورود و خروج و محاسبه خودکار)
  const [showPastWorkForm, setShowPastWorkForm] = useState(true);
  const [pastWorkDate, setPastWorkDate] = useState(initialShamsiDate);
  const [pastEntryType, setPastEntryType] = useState<
    'WORK' | 'MISSION' | 'DAILY_LEAVE' | 'HOURLY_LEAVE'
  >('WORK');
  const [pastWorkEntryMode, setPastWorkEntryMode] = useState<FlexibleClockEntryMode>('FULL_SHIFT');
  const [pastCheckIn, setPastCheckIn] = useState('07:00');
  const [pastCheckOut, setPastCheckOut] = useState('15:00');
  const [pastLeaveStartTime, setPastLeaveStartTime] = useState('10:00');
  const [pastLeaveEndTime, setPastLeaveEndTime] = useState('12:00');
  const [pastWorkTitle, setPastWorkTitle] = useState('');
  const [pastWorkNote, setPastWorkNote] = useState('');
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingExcel, setUploadingExcel] = useState(false);

  // کارت‌های انتخابی برای جلوگیری از اسکرول طولانی در تب‌های پرسنل
  const [workerAttendanceCard, setWorkerAttendanceCard] = useState<
    'today_clock' | 'calendar_history' | 'past_work' | 'leaves'
  >('today_clock');
  const [workerReportsCard, setWorkerReportsCard] = useState<
    'new_report' | 'pending_tasks' | 'archive'
  >('new_report');
  const [workerFinanceCard, setWorkerFinanceCard] = useState<
    'statement' | 'new_expense' | 'history'
  >('statement');

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

  // تنظیمات پرسنل (حساب کاربری، ارسال اکسل سوابق، اطلاعات قرارداد، مدیریت فضای هاست، و راهنما و اعلان‌ها)
  const [workerSettingsSubTab, setWorkerSettingsSubTab] = useState<
    'profile' | 'excel_history' | 'contract' | 'storage_cleanup' | 'guide'
  >('profile');

  const loadAllWorkerData = useCallback(async (silentOrEvent?: boolean | unknown) => {
    const isSilent = silentOrEvent === true;
    try {
      const [liveRes, histRes, leaveRes, repRes, finRes, taskRes] = await Promise.all([
        apiRequest<{
          ok: boolean;
          serverTime: { shamsiDate: string; timeHHMM: string };
          liveState: WorkerLiveState;
          settings: SystemSettings;
          unreadMessagesCount: number;
          latestUnreadMessage?: LatestUnreadMessageInfo | null;
          latestPendingTask?: {
            id: number;
            title: string;
            description: string | null;
            shamsi_date: string;
          } | null;
          unseenLateDecisions?: DailyAttendanceSummary[];
          recentLateDecisions?: DailyAttendanceSummary[];
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
      setUnseenLateDecisions(liveRes.unseenLateDecisions || []);
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

      // ارسال نوتیفیکیشن گوشی (اندروید / شیائومی) هنگام دریافت تسک جدید، پیام جدید یا تعیین تکلیف تأخیر از سمت مدیر
      const msgKey = liveRes.latestUnreadMessage ? `msg_${liveRes.latestUnreadMessage.id}` : null;
      const taskKey = liveRes.latestPendingTask ? `task_${liveRes.latestPendingTask.id}` : null;
      const lateDecisionItem = (liveRes.unseenLateDecisions || [])[0];
      const lateKey = lateDecisionItem
        ? `late_${lateDecisionItem.work_date}_${lateDecisionItem.late_status}`
        : null;

      if (!isFirstPollDoneRef.current) {
        isFirstPollDoneRef.current = true;
        if (msgKey) notifiedKeysRef.current.add(msgKey);
        for (const t of taskRes.tasks || []) {
          if (!t.is_completed) notifiedKeysRef.current.add(`task_${t.id}`);
        }
        for (const d of liveRes.unseenLateDecisions || []) {
          notifiedKeysRef.current.add(`late_${d.work_date}_${d.late_status}`);
        }
      } else {
        if (msgKey && !notifiedKeysRef.current.has(msgKey) && liveRes.latestUnreadMessage) {
          notifiedKeysRef.current.add(msgKey);
          triggerNativePhoneNotification({
            tag: msgKey,
            title: `پیام جدید از مدیریت (${liveRes.latestUnreadMessage.sender_name})`,
            body: liveRes.latestUnreadMessage.subject
              ? `${liveRes.latestUnreadMessage.subject}: ${liveRes.latestUnreadMessage.message_text}`
              : liveRes.latestUnreadMessage.message_text,
            tab: 'correspondence',
          });
        }

        if (taskKey && !notifiedKeysRef.current.has(taskKey) && liveRes.latestPendingTask) {
          notifiedKeysRef.current.add(taskKey);
          triggerNativePhoneNotification({
            tag: taskKey,
            title: 'برنامه کاری جدید از طرف مدیر',
            body: `${liveRes.latestPendingTask.title}${
              liveRes.latestPendingTask.description
                ? ` — ${liveRes.latestPendingTask.description}`
                : ''
            }`,
            tab: 'reports',
          });
        }

        if (lateKey && !notifiedKeysRef.current.has(lateKey) && lateDecisionItem) {
          notifiedKeysRef.current.add(lateKey);
          const badge =
            LATE_STATUS_BADGE_INFO[lateDecisionItem.late_status || '']?.label ||
            'تعیین تکلیف تأخیر';
          triggerNativePhoneNotification({
            tag: lateKey,
            title: `نتیجه بررسی تأخیر تاریخ ${toPersianDigits(lateDecisionItem.shamsi_date)}`,
            body: `${badge}${
              lateDecisionItem.manager_late_note
                ? ` — یادداشت مدیر: ${lateDecisionItem.manager_late_note}`
                : ''
            }`,
            tab: 'attendance',
          });
        }
      }
      setFeedback((prev) =>
        prev?.type === 'error' && isConnectionErrorMessage(prev.text) ? null : prev
      );
    } catch (err) {
      if (!isSilent) {
        setFeedback({ type: 'error', text: (err as Error).message });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllWorkerData(false);
  }, [loadAllWorkerData]);

  // بروزرسانی خودکار وضعیت پنل پرسنل (هر ۱۰ ثانیه و هنگام بازگشت به صفحه) برای دریافت آنی تأییدیه‌ها، تسک‌ها و نامه‌های مدیر
  useEffect(() => {
    const interval = window.setInterval(() => {
      loadAllWorkerData(true);
    }, 10000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        loadAllWorkerData(true);
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

  // بروزرسانی نشان عددی روی لوگوی برنامه و آیکون PWA موبایل برای پرسنل
  const workerBadgeCount =
    unreadMessagesCount + pendingWorkTasks.length + unseenLateDecisions.length;
  useEffect(() => {
    updateAppNotificationBadge(workerBadgeCount);
  }, [workerBadgeCount]);

  // محاسبه خودکار کارکرد خالص، تأخیر و اضافه‌کاری بر اساس ساعت ورود و خروج روزهای قبل
  const pastWorkAutoCalc = React.useMemo(() => {
    const targetShamsi = pastWorkDate || serverShamsiDate || initialShamsiDate;
    let workDateIso = '2026-10-01';
    try {
      workDateIso = shamsiToGregorian(targetShamsi);
    } catch {
      // fallback
    }
    const fallbackSettings: SystemSettings = settings || {
      id: 1,
      shift_start_time: '07:00',
      shift_end_time: '15:00',
      thursday_shift_start_time: '07:00',
      thursday_shift_end_time: '14:00',
      thursday_overtime_start_time: '14:00',
      grace_period_minutes: 15,
      break_duration_minutes: 0,
      working_days: [6, 0, 1, 2, 3, 4],
      overtime_start_time: '15:00',
      overtime_before_shift: false,
      mission_policy: 'PAID_AS_WORK',
      friday_holiday_policy: 'ALL_OVERTIME',
      official_holidays: [],
      timezone: 'Asia/Tehran',
      collaboration_start_shamsi: '1405/06/15',
      base_salary_toman: null,
      hourly_rate_toman: null,
      overtime_calc_mode: 'FIXED_RATE',
      overtime_percentage: 140,
      overtime_rate_toman: null,
      late_deduction_unit: 'MINUTE',
      late_deduction_rate_toman: null,
      absence_deduction_unit: 'DAY',
      absence_deduction_rate_toman: null,
      monthly_leave_quota_days: 2.5,
      sms_enabled: false,
      sms_on_task_and_message: true,
      melipayamak_username: '',
      melipayamak_password: '',
      melipayamak_from_number: '',
      melipayamak_is_flash: false,
      worker_phone_number: '',
      rules_confirmed_by_manager: true,
      effective_from_shamsi: '1405/06/15',
      banner_bg_url: null,
    };
    const inTime = pastCheckIn || '07:00';
    const outTime = pastCheckOut || '15:00';
    return calculateDailyAttendance(
      workDateIso,
      targetShamsi,
      [
        {
          id: -1,
          user_id: user.id,
          event_type: pastEntryType === 'MISSION' ? 'MISSION_START' : 'WORK_START',
          work_date: workDateIso,
          shamsi_date: targetShamsi,
          recorded_at: '',
          recorded_time: inTime,
          is_manual_override: true,
          modified_by_user_id: user.id,
          modification_reason: null,
          is_deleted: false,
          note: null,
          created_at: '',
        },
        {
          id: -2,
          user_id: user.id,
          event_type: pastEntryType === 'MISSION' ? 'MISSION_END' : 'WORK_END',
          work_date: workDateIso,
          shamsi_date: targetShamsi,
          recorded_at: '',
          recorded_time: outTime,
          is_manual_override: true,
          modified_by_user_id: user.id,
          modification_reason: null,
          is_deleted: false,
          note: null,
          created_at: '',
        },
      ],
      fallbackSettings,
      { isToday: false }
    );
  }, [pastWorkDate, serverShamsiDate, initialShamsiDate, settings, pastCheckIn, pastCheckOut, pastEntryType, user.id]);

  const handleOpenCorrespondences = () => {
    setActiveTab('correspondence');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenTasksAndReports = () => {
    setActiveTab('reports');
    setWorkerReportsCard('pending_tasks');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const executeClockRequest = async (
    eventType: AttendanceEventType,
    explicitLateReason?: string
  ) => {
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
          note: (explicitLateReason || clockNote).trim() || null,
          late_reason: explicitLateReason ? explicitLateReason.trim() : clockNote.trim() || null,
        }),
      });
      setLiveState(res.liveState);
      setClockNote('');
      setLateReasonInput('');
      setShowLateReasonModal(false);
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockEvent = async (eventType: AttendanceEventType) => {
    // اگر شروع کار در روز کاری دیرتر از ساعت شروع شیفت + حد مجاز تأخیر باشد، ابتدا علت تأخیر را از پرسنل می‌پرسیم تا به تأیید مدیر برسد
    if (
      eventType === 'WORK_START' &&
      settings &&
      (!liveState?.today_summary?.logs || liveState.today_summary.logs.length === 0) &&
      liveState?.today_summary?.is_working_day &&
      serverTimeHHMM
    ) {
      const todayDow = new Date().getDay();
      const { shiftStartMin } = getDayShiftSchedule(todayDow, settings);
      const nowMin = parseTimeToMinutes(serverTimeHHMM);
      const graceMin = settings.grace_period_minutes ?? 15;
      if (nowMin > shiftStartMin + graceMin) {
        const calcLate = nowMin - shiftStartMin;
        setPendingLateMinutesPreview(calcLate);
        setLateReasonInput(clockNote.trim());
        setShowLateReasonModal(true);
        return;
      }
    }
    await executeClockRequest(eventType);
  };

  const handleAckLateDecision = async (logId?: number | null) => {
    try {
      await apiRequest('/api/attendance/ack-late-decision', {
        method: 'POST',
        body: JSON.stringify({ log_id: logId || null }),
      });
      await loadAllWorkerData();
    } catch {
      // ignore
    }
  };

  const handleQuickLeaveRequest = (type: LeaveType) => {
    setWorkerAttendanceCard('leaves');
    setExternalLeaveRequestType(type);
    setTimeout(() => {
      const el = document.getElementById('leave-management-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  };

  const handleTodayFlexibleClockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        message: string;
        liveState: WorkerLiveState;
      }>('/api/attendance/flexible-clock', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: serverShamsiDate,
          entry_mode: todayFlexMode,
          shift_category: 'WORK',
          check_in_time: todayFlexCheckIn,
          check_out_time: todayFlexMode === 'START_ONLY' ? '' : todayFlexCheckOut,
          note: todayFlexNote.trim() || clockNote.trim() || null,
          late_reason: todayFlexNote.trim() || clockNote.trim() || null,
        }),
      });
      if (res.liveState) {
        setLiveState(res.liveState);
      }
      setTodayFlexNote('');
      setShowTodayFlexibleForm(false);
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleWorkerDeleteMediaItem = async (
    sourceType: MediaSourceType,
    recordId: number,
    fileUrl: string
  ) => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/media/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ source_type: sourceType, record_id: recordId, file_url: fileUrl }],
        }),
      });
      setFeedback({ type: 'success', text: res.message });
      await loadAllWorkerData();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePastWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);
    try {
      if (pastEntryType === 'DAILY_LEAVE' || pastEntryType === 'HOURLY_LEAVE') {
        const res = await apiRequest<{ ok: boolean; message: string }>('/api/leaves', {
          method: 'POST',
          body: JSON.stringify({
            leave_type: pastEntryType === 'DAILY_LEAVE' ? 'DAILY' : 'HOURLY',
            shamsi_date: pastWorkDate,
            start_time: pastEntryType === 'HOURLY_LEAVE' ? pastLeaveStartTime : null,
            end_time: pastEntryType === 'HOURLY_LEAVE' ? pastLeaveEndTime : null,
            reason: pastWorkNote.trim() || pastWorkTitle.trim() || 'ثبت مرخصی روزهای قبل',
          }),
        });
        setFeedback({ type: 'success', text: res.message });
        setPastWorkTitle('');
        setPastWorkNote('');
        await loadAllWorkerData();
        return;
      }

      // در صورتی که حالت ثبت «صرفاً ساعت آغاز به کار (شیفت در جریان)» یا «ثبت تکمیلی ساعت خاتمه کار» باشد، یا تاریخ امروز انتخاب شده باشد:
      if (
        pastWorkEntryMode === 'START_ONLY' ||
        pastWorkEntryMode === 'END_ONLY' ||
        pastWorkDate === serverShamsiDate
      ) {
        const res = await apiRequest<{
          ok: boolean;
          message: string;
          liveState?: WorkerLiveState;
        }>('/api/attendance/flexible-clock', {
          method: 'POST',
          body: JSON.stringify({
            shamsi_date: pastWorkDate,
            entry_mode: pastWorkEntryMode,
            shift_category: pastEntryType === 'MISSION' ? 'MISSION' : 'WORK',
            check_in_time: pastCheckIn,
            check_out_time: pastWorkEntryMode === 'START_ONLY' ? '' : pastCheckOut,
            note: pastWorkNote.trim() || pastWorkTitle.trim() || null,
            late_reason: pastWorkNote.trim() || pastWorkTitle.trim() || null,
          }),
        });
        if (res.liveState) {
          setLiveState(res.liveState);
        }
        setFeedback({ type: 'success', text: res.message });
        setPastWorkTitle('');
        setPastWorkNote('');
        await loadAllWorkerData();
        return;
      }

      const defaultTitle =
        pastEntryType === 'MISSION'
          ? `مأموریت مورخ ${pastWorkDate} (${pastCheckIn} تا ${pastCheckOut})`
          : `کارکرد روز ${pastWorkDate} (ورود ${pastCheckIn} - خروج ${pastCheckOut})`;

      const res = await apiRequest<{ ok: boolean; message: string }>('/api/historical-work', {
        method: 'POST',
        body: JSON.stringify({
          shamsi_date: pastWorkDate,
          title: pastWorkTitle.trim() || defaultTitle,
          entry_type: pastEntryType,
          check_in: pastCheckIn,
          check_out: pastCheckOut,
          work_days_count: 1,
          net_work_minutes: pastWorkAutoCalc.net_work_minutes,
          overtime_minutes: pastWorkAutoCalc.overtime_minutes,
          note:
            pastWorkNote.trim() ||
            `ساعت ورود: ${pastCheckIn} | ساعت خروج: ${pastCheckOut}${
              pastWorkAutoCalc.late_minutes > 0
                ? ` | تأخیر: ${pastWorkAutoCalc.late_minutes} دقیقه`
                : ''
            }`,
        }),
      });
      setFeedback({ type: 'success', text: res.message });
      setPastWorkTitle('');
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
                  {toPersianDigits(pendingWorkTasks.length)} برنامه کاری جدید از سمت مدیریت
                </span>
                <span className="text-[10px] text-slate-300 tabular-nums">
                  (تاریخ تحویل: {toPersianDigits(pendingWorkTasks[0].shamsi_date)})
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
            <span>مشاهده برنامه کاری</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ۲-ب. نمایش تصمیم و یادداشت مدیر درباره تأخیر در ورود پرسنل */}
      {unseenLateDecisions.length > 0 && (
        <div className="space-y-2">
          {unseenLateDecisions.map((dec) => {
            const badge = LATE_STATUS_BADGE_INFO[dec.late_status || ''] || {
              label: dec.status_label,
              className: 'bg-slate-100 text-slate-800 border-slate-300',
            };
            return (
              <div
                key={dec.work_date}
                role="alert"
                className="rounded-2xl bg-[#FCF9F2] border-2 border-[#C5A059] p-3 space-y-2 shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#9A7428] shrink-0" />
                    <span className="text-xs font-extrabold text-[#0B192C]">
                      نتیجه تصمیم مدیریت درباره تأخیر ورود تاریخ {toPersianDigits(dec.shamsi_date)}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-lg border text-[10.5px] font-extrabold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-700 bg-white rounded-xl p-2.5 border border-slate-200/80">
                  <div>
                    <span className="text-slate-500">ساعت ورود و میزان تأخیر: </span>
                    <strong className="text-[#0B192C] tabular-nums">
                      ساعت {toPersianDigits(dec.first_in_time || '—')} (
                      {toPersianDigits(dec.raw_late_minutes || dec.late_minutes || 0)} دقیقه تأخیر)
                    </strong>
                  </div>
                  {dec.late_deduction_toman && dec.late_deduction_toman > 0 ? (
                    <div>
                      <span className="text-slate-500">مبلغ کسرشده از حقوق: </span>
                      <strong className="text-red-700 tabular-nums">
                        {formatToman(dec.late_deduction_toman)}
                      </strong>
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500">کسر مالی: </span>
                      <strong className="text-emerald-700">بدون کسر مالی (۰ تومان)</strong>
                    </div>
                  )}
                  {dec.late_reason && (
                    <div className="sm:col-span-2">
                      <span className="text-slate-500">علت ثبت‌شده توسط شما: </span>
                      <span className="font-medium text-slate-800">{dec.late_reason}</span>
                    </div>
                  )}
                  {dec.manager_late_note && (
                    <div className="sm:col-span-2 pt-1 border-t border-slate-100">
                      <span className="font-bold text-[#9A7428]">یادداشت مدیریت (مجید نورایی): </span>
                      <strong className="text-[#0B192C]">{dec.manager_late_note}</strong>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleAckLateDecision(dec.first_in_log_id)}
                    className="min-h-[32px] px-3 rounded-xl bg-[#0B192C] hover:bg-[#162a45] text-[#C5A059] text-[11px] font-bold cursor-pointer"
                  >
                    متوجه شدم (ثبت رؤیت تصمیم مدیر)
                  </button>
                </div>
              </div>
            );
          })}
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
              {/* کارت‌های کوچک و رنگی بخش تردد پرسنل برای دسترسی سریع بدون اسکرول طولانی */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    id: 'today_clock' as const,
                    title: 'ثبت تردد و کارکرد امروز',
                    subtitle: `امروز ${toPersianDigits(serverShamsiDate)}`,
                    icon: Play,
                    activeBg: 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-emerald-600 shadow-sm',
                    idleBg: 'bg-emerald-50/90 hover:bg-emerald-100/80 text-emerald-950 border-emerald-200',
                    iconClass: 'bg-emerald-600/15 text-emerald-700',
                  },
                  {
                    id: 'calendar_history' as const,
                    title: 'تقویم و سوابق ماهانه',
                    subtitle: 'تقویم و جدول تردد',
                    icon: Calendar,
                    activeBg: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 shadow-sm',
                    idleBg: 'bg-blue-50/90 hover:bg-blue-100/80 text-blue-950 border-blue-200',
                    iconClass: 'bg-blue-600/15 text-blue-700',
                  },
                  {
                    id: 'past_work' as const,
                    title: 'ثبت کارکرد روزهای قبل',
                    subtitle: 'ورود و خروج با محاسبه خودکار',
                    icon: Clock,
                    activeBg: 'bg-gradient-to-br from-[#0B192C] to-[#1b3556] text-[#C5A059] border-[#C5A059] shadow-sm',
                    idleBg: 'bg-[#FCF9F2] hover:bg-amber-100/60 text-[#0B192C] border-[#C5A059]/60',
                    iconClass: 'bg-[#C5A059]/20 text-[#9A7428]',
                  },
                  {
                    id: 'leaves' as const,
                    title: 'مرخصی روزانه و ساعتی',
                    subtitle: `${toPersianDigits(leaveRequests.length)} سابقه مرخصی`,
                    icon: Sun,
                    activeBg: 'bg-gradient-to-br from-purple-600 to-violet-700 text-white border-purple-600 shadow-sm',
                    idleBg: 'bg-purple-50/90 hover:bg-purple-100/80 text-purple-950 border-purple-200',
                    iconClass: 'bg-purple-600/15 text-purple-700',
                  },
                ].map((card) => {
                  const Icon = card.icon;
                  const isSelected = workerAttendanceCard === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setWorkerAttendanceCard(card.id)}
                      className={`rounded-2xl border p-2.5 text-right transition-all cursor-pointer flex flex-col justify-between gap-1.5 min-h-[74px] ${
                        isSelected ? card.activeBg : card.idleBg
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : card.iconClass
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span
                          className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-md ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-white/80 text-slate-600'
                          }`}
                        >
                          {isSelected ? 'فعال' : 'انتخاب'}
                        </span>
                      </div>
                      <div>
                        <div className="text-[11px] font-extrabold leading-tight">{card.title}</div>
                        <div
                          className={`text-[9.5px] mt-0.5 truncate ${
                            isSelected ? 'text-white/85' : ' opacity-75'
                          }`}
                        >
                          {card.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* کارت ۱: ثبت تردد روزانه + خلاصه مالی و کل کارکرد تا امروز */}
              {workerAttendanceCard === 'today_clock' && (
                <>
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

                    {/* دکمه‌های ۴گانه تردد */}
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

                    {/* دو کلید مجزا برای درخواست مرخصی روزانه و درخواست مرخصی ساعتی + ثبت کارکرد روزهای قبل */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-100">
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

                      <button
                        type="button"
                        onClick={() => setWorkerAttendanceCard('past_work')}
                        className="min-h-[36px] rounded-xl bg-[#0B192C] hover:bg-[#152944] text-[#C5A059] border border-[#C5A059] text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>ثبت ساعت کاری روزهای قبل</span>
                      </button>
                    </div>

                    {/* بخش ویژه: ثبت بازنگری ساعت آغاز یا خاتمه شیفت امروز در هر ساعت از شبانه‌روز (بدون الزام به تکمیل هم‌زمان ساعت پایان) */}
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          if (!showTodayFlexibleForm) {
                            const hasActiveStart =
                              allowedEvents.includes('WORK_END') &&
                              !allowedEvents.includes('WORK_START');
                            setTodayFlexMode(hasActiveStart ? 'END_ONLY' : 'START_ONLY');
                          }
                          setShowTodayFlexibleForm((prev) => !prev);
                        }}
                        className="w-full min-h-[38px] rounded-xl bg-gradient-to-r from-[#FCF9F2] via-amber-50/70 to-[#FCF9F2] hover:bg-amber-100/60 border border-[#C5A059] px-3 py-2 flex items-center justify-between gap-2 text-right transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-[#9A7428] shrink-0" />
                          <div>
                            <div className="text-[11px] font-extrabold text-[#0B192C]">
                              ثبت بازنگری ساعت آغاز یا خاتمه شیفت امروز (با انتخاب ساعت دلخواه)
                            </div>
                            <div className="text-[9.5px] text-slate-600">
                              در صورت عدم ثبت به‌موقع ورود صبح، ساعت شروع را اکنون ثبت و شیفت را فعال نمایید (بدون الزام به درج هم‌زمان ساعت پایان)
                            </div>
                          </div>
                        </div>
                        {showTodayFlexibleForm ? (
                          <ChevronUp className="w-4 h-4 text-[#9A7428] shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#9A7428] shrink-0" />
                        )}
                      </button>

                      {showTodayFlexibleForm && (
                        <form
                          onSubmit={handleTodayFlexibleClockSubmit}
                          className="mt-2 rounded-2xl bg-[#FCF9F2] border border-[#C5A059] p-3.5 space-y-3"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            {[
                              {
                                id: 'START_ONLY' as FlexibleClockEntryMode,
                                title: 'ثبت صرفاً ساعت آغاز شیفت (فعال‌سازی حضور در جریان)',
                              },
                              {
                                id: 'END_ONLY' as FlexibleClockEntryMode,
                                title: 'ثبت تکمیلی ساعت خاتمه کار (بستن شیفت فعال)',
                              },
                              {
                                id: 'FULL_SHIFT' as FlexibleClockEntryMode,
                                title: 'ثبت یکپارچه ساعت آغاز و خاتمه نوبت کاری',
                              },
                            ].map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setTodayFlexMode(m.id)}
                                className={`min-h-[36px] rounded-xl border px-2.5 py-1.5 text-[10.5px] font-bold transition cursor-pointer ${
                                  todayFlexMode === m.id
                                    ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059] shadow-2xs'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {m.title}
                              </button>
                            ))}
                          </div>

                          <div className="rounded-xl bg-white/90 border border-[#C5A059]/45 px-3 py-2 text-[10.5px] text-slate-700 leading-5">
                            {todayFlexMode === 'START_ONLY' && (
                              <span>
                                <strong>نحوه عملکرد:</strong> با ثبت ساعت آغاز شیفت برای امروز (بدون نیاز به وارد کردن ساعت پایان)، نوبت کاری شما در داشبورد <strong>«فعال و در جریان»</strong> می‌شود و پس از اتمام کار می‌توانید دکمه <strong>«پایان کار»</strong> داشبورد را بزنید یا ساعت خروج را دستی ثبت نمایید.
                              </span>
                            )}
                            {todayFlexMode === 'END_ONLY' && (
                              <span>
                                <strong>نحوه عملکرد:</strong> ساعت خاتمه کار برای نوبت کاری فعال امروز ثبت شده و شیفت کاری بسته و محاسبه می‌گردد.
                              </span>
                            )}
                            {todayFlexMode === 'FULL_SHIFT' && (
                              <span>
                                <strong>نحوه عملکرد:</strong> ساعت آغاز و خاتمه نوبت کاری امروز به‌طور کامل در کارکرد روزانه ثبت می‌گردد.
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-start">
                            {(todayFlexMode === 'START_ONLY' || todayFlexMode === 'FULL_SHIFT') && (
                              <TimePickerInput
                                label="ساعت آغاز به کار (ورود)"
                                value={todayFlexCheckIn}
                                onChange={setTodayFlexCheckIn}
                              />
                            )}

                            {(todayFlexMode === 'END_ONLY' || todayFlexMode === 'FULL_SHIFT') && (
                              <TimePickerInput
                                label="ساعت خاتمه کار (خروج)"
                                value={todayFlexCheckOut}
                                onChange={setTodayFlexCheckOut}
                              />
                            )}

                            <div className={todayFlexMode === 'FULL_SHIFT' ? '' : 'sm:col-span-2'}>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                توضیحات تردد یا علت تأخیر (اختیاری)
                              </label>
                              <input
                                type="text"
                                value={todayFlexNote}
                                onChange={(e) => setTodayFlexNote(e.target.value)}
                                placeholder="توضیح تکمیلی..."
                                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setShowTodayFlexibleForm(false)}
                              className="min-h-[36px] px-3.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-[11px] font-bold cursor-pointer"
                            >
                              بستن
                            </button>
                            <button
                              type="submit"
                              disabled={actionLoading}
                              className="min-h-[36px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-[11px] font-bold cursor-pointer"
                            >
                              {actionLoading
                                ? 'در حال ثبت...'
                                : todayFlexMode === 'START_ONLY'
                                  ? 'ثبت ساعت آغاز و فعال‌سازی شیفت در جریان'
                                  : todayFlexMode === 'END_ONLY'
                                    ? 'ثبت ساعت خاتمه و بستن شیفت کاری'
                                    : 'ثبت کامل نوبت کاری امروز'}
                            </button>
                          </div>
                        </form>
                      )}
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

                  {/* خلاصه وضعیت مالی و کل کارکرد تا تاریخ روز */}
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
                </>
              )}

              {/* کارت ۲: تقویم کارکرد ماهانه و جدول سوابق ترددهای روزانه */}
              {workerAttendanceCard === 'calendar_history' && (
                <>
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
                              {SHAMSI_MONTH_NAMES[m.month - 1]} {toPersianDigits(m.year)}
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

                              {day.late_status && day.late_status !== 'NONE' && (
                                <div className="mt-1 rounded-xl bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 text-[10px] space-y-0.5">
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <span className="font-bold text-[#0B192C]">
                                      وضعیت تأخیر ورود ({toPersianDigits(day.raw_late_minutes || day.late_minutes || 0)} دقیقه):
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded border font-bold ${
                                        LATE_STATUS_BADGE_INFO[day.late_status]?.className ||
                                        'bg-slate-100 text-slate-700'
                                      }`}
                                    >
                                      {LATE_STATUS_BADGE_INFO[day.late_status]?.label || day.status_label}
                                    </span>
                                  </div>
                                  {day.late_reason && (
                                    <div className="text-slate-600">
                                      علت اعلام‌شده: <span className="font-semibold">{day.late_reason}</span>
                                    </div>
                                  )}
                                  {day.manager_late_note && (
                                    <div className="text-[#9A7428] font-bold">
                                      یادداشت مدیر: <span className="text-[#0B192C]">{day.manager_late_note}</span>
                                    </div>
                                  )}
                                  {day.late_deduction_toman && day.late_deduction_toman > 0 ? (
                                    <div className="text-red-700 font-bold tabular-nums">
                                      مبلغ کسرشده بابت این روز: {formatToman(day.late_deduction_toman)}
                                    </div>
                                  ) : null}
                                </div>
                              )}
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
                </>
              )}

              {/* کارت ۳: ثبت ساعت کاری روزهای قبل (با ورود ساعت ورود و خروج و محاسبه هوشمند کارکرد، تأخیر و اضافه‌کاری) */}
              {workerAttendanceCard === 'past_work' && (
                <div className="rounded-2xl bg-white border border-[#C5A059]/60 p-4 space-y-3.5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C] flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-[#C5A059]" />
                        <span>ثبت ساعت کاری، مأموریت یا مرخصی روزهای قبل</span>
                      </h3>
                      <p className="text-[10.5px] text-slate-500 mt-0.5">
                        کافی است تاریخ و ساعت ورود و خروج را انتخاب کنید تا کارکرد خالص، تأخیر و اضافه‌کاری به‌صورت خودکار محاسبه و برای تأیید مدیریت ارسال شود.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handlePastWorkSubmit} className="space-y-3.5">
                    {/* انتخاب نوع ثبت روزهای قبل */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'WORK' as const, label: 'کارکرد عادی (ورود و خروج)', color: 'border-emerald-500 bg-emerald-50 text-emerald-950' },
                        { id: 'MISSION' as const, label: 'مأموریت روزهای قبل', color: 'border-purple-500 bg-purple-50 text-purple-950' },
                        { id: 'DAILY_LEAVE' as const, label: 'مرخصی روزانه', color: 'border-teal-500 bg-teal-50 text-teal-950' },
                        { id: 'HOURLY_LEAVE' as const, label: 'مرخصی ساعتی', color: 'border-sky-500 bg-sky-50 text-sky-950' },
                      ].map((item) => {
                        const active = pastEntryType === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setPastEntryType(item.id)}
                            className={`min-h-[38px] rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-all cursor-pointer ${
                              active
                                ? `${item.color} border-2 shadow-2xs`
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    {(pastEntryType === 'WORK' || pastEntryType === 'MISSION') && (
                      <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-2.5 space-y-2">
                        <div className="text-[11px] font-bold text-[#0B192C]">
                          شیوه ثبت تردد (امکان ثبت ساعت آغاز به کار بدون الزام به تکمیل هم‌زمان ساعت پایان):
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                          {[
                            {
                              id: 'FULL_SHIFT' as FlexibleClockEntryMode,
                              label: 'ثبت کامل نوبت کاری (ورود و خروج)',
                            },
                            {
                              id: 'START_ONLY' as FlexibleClockEntryMode,
                              label: 'ثبت صرفاً ساعت آغاز شیفت (فعال و در جریان)',
                            },
                            {
                              id: 'END_ONLY' as FlexibleClockEntryMode,
                              label: 'ثبت تکمیلی ساعت خاتمه کار (بستن شیفت باز)',
                            },
                          ].map((modeItem) => (
                            <button
                              key={modeItem.id}
                              type="button"
                              onClick={() => setPastWorkEntryMode(modeItem.id)}
                              className={`min-h-[34px] rounded-lg border px-2 py-1 text-[10.5px] font-bold transition cursor-pointer ${
                                pastWorkEntryMode === modeItem.id
                                  ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {modeItem.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                      <ShamsiDatePicker
                        label="تاریخ روز مورد نظر (امروز یا روزهای قبل)"
                        value={pastWorkDate}
                        onChange={setPastWorkDate}
                        todayShamsi={serverShamsiDate}
                      />

                      {pastEntryType === 'WORK' || pastEntryType === 'MISSION' ? (
                        <>
                          {(pastWorkEntryMode === 'FULL_SHIFT' ||
                            pastWorkEntryMode === 'START_ONLY') && (
                            <TimePickerInput
                              label={
                                pastEntryType === 'MISSION'
                                  ? 'ساعت شروع مأموریت'
                                  : 'ساعت آغاز به کار (ورود)'
                              }
                              value={pastCheckIn}
                              onChange={setPastCheckIn}
                            />
                          )}
                          {(pastWorkEntryMode === 'FULL_SHIFT' ||
                            pastWorkEntryMode === 'END_ONLY') && (
                            <TimePickerInput
                              label={
                                pastEntryType === 'MISSION'
                                  ? 'ساعت پایان مأموریت'
                                  : 'ساعت خاتمه کار (خروج)'
                              }
                              value={pastCheckOut}
                              onChange={setPastCheckOut}
                            />
                          )}
                          {pastWorkEntryMode === 'START_ONLY' && (
                            <div className="rounded-xl bg-emerald-50/80 border border-emerald-200 p-2.5 text-[10.5px] text-emerald-950 leading-5">
                              نوبت کاری با ساعت ورود انتخابی <strong>فعال</strong> می‌شود و نیازی به درج هم‌زمان ساعت پایان نیست. پایان کار را می‌توانید بعداً از داشبورد یا به‌صورت دستی ثبت کنید.
                            </div>
                          )}
                        </>
                      ) : pastEntryType === 'HOURLY_LEAVE' ? (
                        <>
                          <TimePickerInput
                            label="ساعت شروع مرخصی"
                            value={pastLeaveStartTime}
                            onChange={setPastLeaveStartTime}
                          />
                          <TimePickerInput
                            label="ساعت پایان مرخصی"
                            value={pastLeaveEndTime}
                            onChange={setPastLeaveEndTime}
                          />
                        </>
                      ) : (
                        <div className="sm:col-span-2 rounded-xl bg-teal-50/70 border border-teal-200 p-3 text-xs text-teal-950">
                          این روز به‌عنوان <strong>مرخصی روزانه کامل</strong> برای تاریخ{' '}
                          <strong className="tabular-nums">{toPersianDigits(pastWorkDate)}</strong> ثبت و جهت تأیید مدیر ارسال می‌شود.
                        </div>
                      )}
                    </div>

                    {/* پیش‌نمایش زنده محاسبه خودکار کارکرد، اضافه‌کاری و تأخیر */}
                    {(pastEntryType === 'WORK' || pastEntryType === 'MISSION') && (
                      <div className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/60 p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="rounded-xl bg-white border border-slate-200/80 p-2.5 flex items-center justify-between">
                          <span className="text-slate-500">کارکرد خالص (محاسبه خودکار):</span>
                          <strong className="text-emerald-700 font-extrabold tabular-nums">
                            {formatMinutesToDurationPersian(pastWorkAutoCalc.net_work_minutes)}
                          </strong>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200/80 p-2.5 flex items-center justify-between">
                          <span className="text-slate-500">اضافه‌کاری (محاسبه خودکار):</span>
                          <strong className="text-[#9A7428] font-extrabold tabular-nums">
                            {formatMinutesToDurationPersian(pastWorkAutoCalc.overtime_minutes)}
                          </strong>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200/80 p-2.5 flex items-center justify-between">
                          <span className="text-slate-500">وضعیت تأخیر ورود:</span>
                          <strong
                            className={`font-extrabold tabular-nums ${
                              pastWorkAutoCalc.late_minutes > 0 ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {pastWorkAutoCalc.late_minutes > 0
                              ? `${toPersianDigits(pastWorkAutoCalc.late_minutes)} دقیقه تأخیر`
                              : 'بدون تأخیر'}
                          </strong>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          عنوان یا موضوع (اختیاری)
                        </label>
                        <input
                          type="text"
                          value={pastWorkTitle}
                          onChange={(e) => setPastWorkTitle(e.target.value)}
                          placeholder="مثلاً کارکرد روزهای قبل یا مأموریت کارگاه..."
                          className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          توضیحات تکمیلی برای مدیر (اختیاری)
                        </label>
                        <input
                          type="text"
                          value={pastWorkNote}
                          onChange={(e) => setPastWorkNote(e.target.value)}
                          placeholder="توضیح کوتاه..."
                          className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={actionLoading}
                        className="min-h-[42px] px-6 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
                      >
                        {actionLoading ? 'در حال ارسال...' : 'ثبت و ارسال جهت تأیید مدیریت'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* کارت ۴: سهمیه و سوابق مرخصی */}
              {workerAttendanceCard === 'leaves' && (
                <LeaveManagementSection
                  role="worker"
                  currentShamsiDate={serverShamsiDate}
                  externalRequestType={externalLeaveRequestType}
                  onExternalRequestHandled={() => setExternalLeaveRequestType(null)}
                  onUpdated={loadAllWorkerData}
                  hideTriggerButtons={false}
                />
              )}
            </div>
          )}

          {/* ================= تب ۲: برنامه‌های کاری و گزارش کار روزانه با کارت‌های کوچک و رنگی ================= */}
          {activeTab === 'reports' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'new_report' as const,
                    title: 'ثبت گزارش کار روزانه',
                    subtitle: 'ارسال شرح کار و عکس',
                    icon: FileText,
                    activeBg: 'bg-gradient-to-br from-[#0B192C] to-[#1b3556] text-[#C5A059] border-[#C5A059] shadow-sm',
                    idleBg: 'bg-[#FCF9F2] hover:bg-amber-100/60 text-[#0B192C] border-[#C5A059]/60',
                    iconClass: 'bg-[#C5A059]/20 text-[#9A7428]',
                  },
                  {
                    id: 'pending_tasks' as const,
                    title: 'برنامه‌های کاری جدید',
                    subtitle: `${toPersianDigits(pendingWorkTasks.length)} برنامه در انتظار`,
                    icon: CheckSquare,
                    activeBg: 'bg-gradient-to-br from-rose-600 to-orange-600 text-white border-rose-600 shadow-sm',
                    idleBg: 'bg-rose-50/90 hover:bg-rose-100/80 text-rose-950 border-rose-200',
                    iconClass: 'bg-rose-600/15 text-rose-700',
                  },
                  {
                    id: 'archive' as const,
                    title: 'آرشیو گزارش‌ها و برنامه‌ها',
                    subtitle: `${toPersianDigits(reports.length)} گزارش ثبت‌شده`,
                    icon: Eye,
                    activeBg: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 shadow-sm',
                    idleBg: 'bg-blue-50/90 hover:bg-blue-100/80 text-blue-950 border-blue-200',
                    iconClass: 'bg-blue-600/15 text-blue-700',
                  },
                ].map((card) => {
                  const Icon = card.icon;
                  const isSelected = workerReportsCard === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setWorkerReportsCard(card.id)}
                      className={`rounded-2xl border p-2.5 text-right transition-all cursor-pointer flex flex-col justify-between gap-1.5 min-h-[72px] ${
                        isSelected ? card.activeBg : card.idleBg
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : card.iconClass
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span
                          className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-md ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-white/80 text-slate-600'
                          }`}
                        >
                          {isSelected ? 'فعال' : 'انتخاب'}
                        </span>
                      </div>
                      <div>
                        <div className="text-[11px] font-extrabold leading-tight">{card.title}</div>
                        <div
                          className={`text-[9.5px] mt-0.5 truncate ${
                            isSelected ? 'text-white/85' : 'opacity-75'
                          }`}
                        >
                          {card.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {workerReportsCard === 'pending_tasks' && (
                <DailyTasksChecklist
                  role="worker"
                  currentShamsiDate={serverShamsiDate}
                  sectionMode="pending_only"
                  externalTasks={workTasks}
                  onTasksUpdated={loadAllWorkerData}
                  onAddCompletedToReport={(summaryText) => {
                    setReportDesc((prev) => (prev ? `${prev}\n${summaryText}` : summaryText));
                    setWorkerReportsCard('new_report');
                  }}
                />
              )}

              {workerReportsCard === 'new_report' && (
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
                  </div>
                </form>
              )}

              {workerReportsCard === 'archive' && (
                <>
                  <DailyTasksChecklist
                    role="worker"
                    currentShamsiDate={serverShamsiDate}
                    sectionMode="archived_only"
                    externalTasks={workTasks}
                    onTasksUpdated={loadAllWorkerData}
                    onAddCompletedToReport={(summaryText) => {
                      setReportDesc((prev) => (prev ? `${prev}\n${summaryText}` : summaryText));
                      setWorkerReportsCard('new_report');
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
                              <div className="pt-1 flex flex-wrap items-center gap-2">
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
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() =>
                                    handleWorkerDeleteMediaItem('REPORT_PHOTO', rep.id, rep.photo_url!)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[10.5px] font-bold cursor-pointer"
                                  title="حذف تصویر جهت آزادسازی فضای هاست (متن گزارش حفظ می‌شود)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف تصویر پیوست</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
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

              {/* کارت‌های کوچک و رنگی بخش امور مالی پرسنل */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'statement' as const,
                    title: 'صورتحساب ماهانه',
                    subtitle: 'ریز کارکرد و حقوق ماه',
                    icon: FileSpreadsheet,
                    activeBg: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 shadow-sm',
                    idleBg: 'bg-blue-50/90 hover:bg-blue-100/80 text-blue-950 border-blue-200',
                    iconClass: 'bg-blue-600/15 text-blue-700',
                  },
                  {
                    id: 'new_expense' as const,
                    title: 'ثبت تنخواه / مساعده',
                    subtitle: 'ارسال فاکتور و درخواست',
                    icon: Receipt,
                    activeBg: 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-emerald-600 shadow-sm',
                    idleBg: 'bg-emerald-50/90 hover:bg-emerald-100/80 text-emerald-950 border-emerald-200',
                    iconClass: 'bg-emerald-600/15 text-emerald-700',
                  },
                  {
                    id: 'history' as const,
                    title: 'سوابق تراکنش‌های مالی',
                    subtitle: `${toPersianDigits(transactions.length)} مورد ثبت‌شده`,
                    icon: Wallet,
                    activeBg: 'bg-gradient-to-br from-[#0B192C] to-[#1b3556] text-[#C5A059] border-[#C5A059] shadow-sm',
                    idleBg: 'bg-[#FCF9F2] hover:bg-amber-100/60 text-[#0B192C] border-[#C5A059]/60',
                    iconClass: 'bg-[#C5A059]/20 text-[#9A7428]',
                  },
                ].map((card) => {
                  const Icon = card.icon;
                  const isSelected = workerFinanceCard === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setWorkerFinanceCard(card.id)}
                      className={`rounded-2xl border p-2.5 text-right transition-all cursor-pointer flex flex-col justify-between gap-1.5 min-h-[72px] ${
                        isSelected ? card.activeBg : card.idleBg
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : card.iconClass
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span
                          className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-md ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-white/80 text-slate-600'
                          }`}
                        >
                          {isSelected ? 'فعال' : 'انتخاب'}
                        </span>
                      </div>
                      <div>
                        <div className="text-[11px] font-extrabold leading-tight">{card.title}</div>
                        <div
                          className={`text-[9.5px] mt-0.5 truncate ${
                            isSelected ? 'text-white/85' : 'opacity-75'
                          }`}
                        >
                          {card.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* صورتحساب تفصیلی هر ماه / دوره در تب امور مالی پرسنل */}
              {workerFinanceCard === 'statement' && (
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
              )}

              {workerFinanceCard === 'new_expense' && (
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
                  </div>
                </form>
              )}

              {workerFinanceCard === 'history' && (
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
                          {tx.settlement_mode === 'INSTALLMENT' &&
                            tx.monthly_deduction_toman &&
                            tx.monthly_deduction_toman > 0 && (
                              <div className="rounded-lg bg-indigo-50/90 border border-indigo-200 px-2.5 py-1.5 text-[10.5px] font-bold text-indigo-950 tabular-nums">
                                سیاست تسویه: استهلاک تدریجی و کسر خودکار ماهانه — سهم هر دوره:{' '}
                                {formatToman(tx.monthly_deduction_toman)} (طی{' '}
                                {toPersianDigits(
                                  tx.installment_count ||
                                    Math.ceil(tx.amount_toman / tx.monthly_deduction_toman)
                                )}{' '}
                                دوره ماهانه)
                              </div>
                            )}
                          {tx.receipt_file_url && (
                            <div className="pt-0.5 flex flex-wrap items-center gap-2">
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
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                  handleWorkerDeleteMediaItem(
                                    'FINANCE_RECEIPT',
                                    tx.id,
                                    tx.receipt_file_url!
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-1 text-[10.5px] font-bold text-rose-700 cursor-pointer"
                                title="حذف فایل رسید جهت آزادسازی فضای هاست (مبلغ و شرح مالی حفظ می‌شود)"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>حذف فایل رسید</span>
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
              )}
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

          {/* ================= تب ۵: تنظیمات پرسنل (حساب کاربری، ارسال اکسل و ثبت ساعت کاری روزهای قبل، قرارداد و راهنما) ================= */}
          {activeTab === 'settings' && (
            <div className="space-y-3.5">
              {/* کارت‌های کوچک و رنگی در بخش تنظیمات پرسنل */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  {
                    id: 'profile' as const,
                    title: 'حساب و تصویر',
                    subtitle: 'رمز عبور و آواتار',
                    icon: Lock,
                  },
                  {
                    id: 'excel_history' as const,
                    title: 'کارکرد روزهای قبل',
                    subtitle: 'ثبت با ورود/خروج و اکسل',
                    icon: FileSpreadsheet,
                  },
                  {
                    id: 'storage_cleanup' as const,
                    title: 'فضای هاست و فایل‌ها',
                    subtitle: 'پاکسازی صوت و تصاویر',
                    icon: HardDrive,
                  },
                  {
                    id: 'contract' as const,
                    title: 'قرارداد و شیفت',
                    subtitle: 'ساعات کاری و حقوق',
                    icon: Calendar,
                  },
                  {
                    id: 'guide' as const,
                    title: 'راهنما و اعلان',
                    subtitle: 'تنظیم نوتیفیکیشن',
                    icon: BellRing,
                  },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = workerSettingsSubTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setWorkerSettingsSubTab(tab.id)}
                      className={`rounded-2xl border p-2.5 text-right transition-all cursor-pointer flex flex-col justify-between gap-1 min-h-[68px] ${
                        active
                          ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059] shadow-sm'
                          : 'bg-white hover:bg-[#FCF9F2] text-slate-700 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Icon className="w-4 h-4" />
                        <span className="text-[9.5px] font-bold opacity-80">
                          {active ? 'فعال' : 'انتخاب'}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-extrabold">{tab.title}</div>
                        <div className="text-[9.5px] opacity-75 truncate">{tab.subtitle}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* زیرتب مدیریت فضای ذخیره‌سازی هاست و پاکسازی فایل‌های چندرسانه‌ای */}
              {workerSettingsSubTab === 'storage_cleanup' && (
                <MediaStorageCleanupPanel role="worker" onDataChanged={loadAllWorkerData} />
              )}

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

              {/* زیرتب ۲: ثبت ساعت کاری روزهای قبل (با ورود ساعت ورود و خروج و محاسبه خودکار) + ارسال فایل اکسل */}
              {workerSettingsSubTab === 'excel_history' && (
                <div className="space-y-3.5">
                  <div className="rounded-2xl bg-white border border-[#C5A059]/55 p-4 space-y-3.5">
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-[#0B192C] flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        <span>ثبت ساعت کاری روزهای قبل (با محاسبه خودکار) و ارسال فایل اکسل</span>
                      </h3>
                      <p className="text-xs text-slate-500 leading-5">
                        با انتخاب تاریخ و ساعت ورود و خروج، کارکرد خالص، تأخیر و اضافه‌کاری به‌صورت خودکار محاسبه شده و جهت تأیید مدیر ارسال می‌گردد. همچنین می‌توانید فایل اکسل ماه‌های قبل را بارگذاری کنید.
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
                        <span>{showPastWorkForm ? 'بستن فرم ثبت ساعت کاری' : 'ثبت ساعت کاری روزهای قبل'}</span>
                      </button>
                    </div>

                    {showPastWorkForm && (
                      <form
                        onSubmit={handlePastWorkSubmit}
                        className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059] p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
                          <h4 className="text-xs font-bold text-[#0B192C]">
                            ثبت هوشمند کارکرد، مأموریت یا مرخصی روزهای قبل (محاسبه خودکار ساعت کاری و اضافه‌کاری)
                          </h4>
                          <button
                            type="button"
                            onClick={() => setShowPastWorkForm(false)}
                            className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            بستن
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { id: 'WORK' as const, label: 'کارکرد عادی (ورود و خروج)' },
                            { id: 'MISSION' as const, label: 'مأموریت روزهای قبل' },
                            { id: 'DAILY_LEAVE' as const, label: 'مرخصی روزانه' },
                            { id: 'HOURLY_LEAVE' as const, label: 'مرخصی ساعتی' },
                          ].map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setPastEntryType(item.id)}
                              className={`min-h-[36px] rounded-xl border px-2 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                                pastEntryType === item.id
                                  ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                                  : 'bg-white border-slate-200 text-slate-600'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                          <ShamsiDatePicker
                            label="تاریخ"
                            value={pastWorkDate}
                            onChange={setPastWorkDate}
                            todayShamsi={serverShamsiDate}
                          />

                          {pastEntryType === 'WORK' || pastEntryType === 'MISSION' ? (
                            <>
                              <TimePickerInput
                                label={pastEntryType === 'MISSION' ? 'ساعت شروع مأموریت' : 'ساعت ورود'}
                                value={pastCheckIn}
                                onChange={setPastCheckIn}
                              />
                              <TimePickerInput
                                label={pastEntryType === 'MISSION' ? 'ساعت پایان مأموریت' : 'ساعت خروج'}
                                value={pastCheckOut}
                                onChange={setPastCheckOut}
                              />
                            </>
                          ) : pastEntryType === 'HOURLY_LEAVE' ? (
                            <>
                              <TimePickerInput
                                label="ساعت شروع مرخصی"
                                value={pastLeaveStartTime}
                                onChange={setPastLeaveStartTime}
                              />
                              <TimePickerInput
                                label="ساعت پایان مرخصی"
                                value={pastLeaveEndTime}
                                onChange={setPastLeaveEndTime}
                              />
                            </>
                          ) : (
                            <div className="sm:col-span-2 rounded-xl bg-white border border-teal-200 p-3 text-xs text-teal-950">
                              ثبت <strong>مرخصی روزانه کامل</strong> در تاریخ{' '}
                              <strong className="tabular-nums">{toPersianDigits(pastWorkDate)}</strong>
                            </div>
                          )}
                        </div>

                        {(pastEntryType === 'WORK' || pastEntryType === 'MISSION') && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            <div className="rounded-xl bg-white border border-slate-200 p-2.5 flex items-center justify-between">
                              <span className="text-slate-500">کارکرد خالص:</span>
                              <strong className="text-emerald-700 font-extrabold tabular-nums">
                                {formatMinutesToDurationPersian(pastWorkAutoCalc.net_work_minutes)}
                              </strong>
                            </div>
                            <div className="rounded-xl bg-white border border-slate-200 p-2.5 flex items-center justify-between">
                              <span className="text-slate-500">اضافه‌کاری:</span>
                              <strong className="text-[#9A7428] font-extrabold tabular-nums">
                                {formatMinutesToDurationPersian(pastWorkAutoCalc.overtime_minutes)}
                              </strong>
                            </div>
                            <div className="rounded-xl bg-white border border-slate-200 p-2.5 flex items-center justify-between">
                              <span className="text-slate-500">تأخیر ورود:</span>
                              <strong
                                className={`font-extrabold tabular-nums ${
                                  pastWorkAutoCalc.late_minutes > 0 ? 'text-red-600' : 'text-emerald-700'
                                }`}
                              >
                                {pastWorkAutoCalc.late_minutes > 0
                                  ? `${toPersianDigits(pastWorkAutoCalc.late_minutes)} دقیقه`
                                  : 'بدون تأخیر'}
                              </strong>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              عنوان (اختیاری)
                            </label>
                            <input
                              type="text"
                              value={pastWorkTitle}
                              onChange={(e) => setPastWorkTitle(e.target.value)}
                              placeholder="مثلاً کارکرد روزهای قبل..."
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              توضیح برای مدیر (اختیاری)
                            </label>
                            <input
                              type="text"
                              value={pastWorkNote}
                              onChange={(e) => setPastWorkNote(e.target.value)}
                              placeholder="توضیح..."
                              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs"
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

              {/* زیرتب ۴: راهنما و تنظیمات نوتیفیکیشن */}
              {workerSettingsSubTab === 'guide' && (
                <NotificationSettingsGuideSection role="worker" />
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

      {/* پاپ‌آپ ثبت علت تأخیر ورود پیش از ثبت ساعت ورود (در صورت ورود دیرتر از حد مجاز) */}
      {showLateReasonModal && (
        <div
          onClick={() => setShowLateReasonModal(false)}
          className="fixed inset-0 z-50 bg-[#0B192C]/55 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white border-2 border-[#C5A059] shadow-2xl p-4 sm:p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                  ورود دیرتر از ساعت مقرر — ثبت علت تأخیر جهت تأیید مدیر
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLateReasonModal(false)}
                aria-label="بستن"
                className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 space-y-1">
              <div className="font-bold">
                میزان تأخیر ورود شما امروز ({toPersianDigits(serverShamsiDate)}):{' '}
                <span className="text-red-700 font-extrabold tabular-nums">
                  {toPersianDigits(pendingLateMinutesPreview)} دقیقه
                </span>
              </div>
              <p className="text-[11px] text-amber-900 leading-5">
                با توجه به ورود پس از ساعت مقرر و فرجه مجاز، پیش از قطعی‌شدن سابقه ورود و خروج، علت تأخیر شما برای مدیریت ارسال می‌شود تا مدیر درباره نحوه ثبت آن (بخشش تأخیر، ثبت با تأخیر، کسر از مرخصی یا ثبت غیبت) تصمیم‌گیری نماید.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#0B192C]">
                علت تأخیر خود را بنویسید (الزامی):
              </label>
              <div className="flex flex-wrap gap-1.5 pb-1">
                {[
                  'ترافیک سنگین مسیر',
                  'مأموریت / خرید وسایل کارگاه در مسیر',
                  'مشکل خودرو / سرویس حمل‌ونقل',
                  'کار اداری / بانکی با اطلاع قبلی',
                  'کسالت / مراجعه درمانی',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setLateReasonInput(preset)}
                    className="px-2 py-0.5 rounded-lg bg-[#FCF9F2] hover:bg-amber-100/70 border border-[#C5A059]/60 text-[10px] font-semibold text-[#0B192C] cursor-pointer"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                value={lateReasonInput}
                onChange={(e) => setLateReasonInput(e.target.value)}
                placeholder="توضیح کوتاه درباره علت تأخیر امروز..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
              />
            </div>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLateReasonModal(false)}
                className="min-h-[38px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  const reasonToSend =
                    lateReasonInput.trim() || 'ورود با تأخیر (در انتظار بررسی و تعیین تکلیف مدیریت)';
                  executeClockRequest('WORK_START', reasonToSend);
                }}
                className="min-h-[38px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
              >
                {actionLoading ? 'در حال ثبت...' : 'ثبت شروع کار و ارسال علت تأخیر برای مدیر'}
              </button>
            </div>
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
            <span className="text-[10px]">پیام و برنامه</span>
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
