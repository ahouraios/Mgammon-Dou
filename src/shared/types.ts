export type UserRole = 'manager' | 'worker';

export type AttendanceEventType =
  | 'WORK_START'
  | 'MISSION_START'
  | 'MISSION_END'
  | 'WORK_END';

export type FinancialTxType =
  | 'ADVANCE'
  | 'ON_ACCOUNT'
  | 'SALARY'
  | 'PETTY_CASH'
  | 'OTHER';

export type FinancialStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type LeaveType = 'DAILY' | 'HOURLY';

export type WorkerLiveStatus =
  | 'PRESENT'   // سبز: حاضر در محل کار
  | 'LATE'      // نارنجی: حضور با تأخیر
  | 'MISSION'   // بنفش: مأموریت
  | 'FINISHED'  // خاکستری: پایان کار
  | 'ABSENT';   // قرمز: غیبت بر اساس قواعد تعیین‌شده

export type MissionPolicy = 'PAID_AS_WORK' | 'SEPARATE_EXTRA';
export type FridayHolidayPolicy = 'ALL_OVERTIME' | 'REGULAR_WORK' | 'DISABLED';
export type OvertimeCalcMode = 'FIXED_RATE' | 'PERCENTAGE';
export type DeliveryChannel = 'IN_APP' | 'SMS' | 'BOTH';
export type LateArrivalDisposition =
  | 'NONE'
  | 'PENDING'
  | 'EXCUSED'
  | 'APPROVED_DELAY'
  | 'ABSENCE'
  | 'DEDUCT_LEAVE'
  | 'CUSTOM';
export type LateDeductionUnit = 'MINUTE' | 'HOUR';
export type AbsenceDeductionUnit = 'DAY' | 'HOUR';

export interface UserProfile {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  collaboration_start_shamsi: string | null;
  phone_number: string | null;
  biometric_enabled?: boolean;
  must_change_password?: boolean;
  last_login_at: string | null;
}

export interface AttendanceLog {
  id: number;
  user_id: number;
  work_date: string; // YYYY-MM-DD
  shamsi_date: string; // YYYY/MM/DD
  event_type: AttendanceEventType;
  recorded_at: string;
  recorded_time: string; // HH:MM:SS
  note: string | null;
  is_manual_override: boolean;
  modified_by_user_id: number | null;
  modification_reason: string | null;
  is_deleted: boolean;
  late_status?: LateArrivalDisposition;
  late_reason?: string | null;
  manager_late_note?: string | null;
  custom_deduction_toman?: number | null;
  late_reviewed_by_user_id?: number | null;
  late_reviewed_at?: string | null;
  is_late_seen_by_worker?: boolean;
  created_at: string;
}

export type SettlementMode = 'LUMP_SUM' | 'INSTALLMENT';

export interface HistoricalWorkRowItem {
  shamsi_date: string;
  title: string;
  work_days_count: number;
  net_work_minutes: number;
  overtime_minutes: number;
  check_in?: string;
  check_out?: string;
  note?: string;
  late_status?: LateArrivalDisposition;
  manager_late_note?: string | null;
  custom_deduction_toman?: number | null;
  late_deduction_toman?: number;
}

export interface HistoricalWorkRecord {
  id: number;
  user_id: number;
  shamsi_date: string;
  work_date: string;
  title: string;
  work_days_count: number;
  net_work_minutes: number;
  overtime_minutes: number;
  note: string | null;
  status: FinancialStatus; // PENDING | APPROVED | REJECTED
  excel_file_url: string | null;
  excel_file_name: string | null;
  parsed_rows: HistoricalWorkRowItem[];
  is_seen_by_manager: boolean;
  created_by_user_id: number;
  creator_role?: UserRole;
  reviewed_by_user_id?: number | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface DailyWorkReport {
  id: number;
  user_id: number;
  report_date: string;
  shamsi_date: string;
  activity_description: string;
  duration_minutes: number | null;
  photo_url?: string | null;
  photo_name?: string | null;
  recorded_time: string;
  is_seen_by_manager: boolean;
  created_at: string;
}

export interface WorkTaskItem {
  id: number;
  user_id: number;
  created_by_user_id: number;
  shamsi_date: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  added_to_report: boolean;
  created_at: string;
}

export interface LeaveRequestItem {
  id: number;
  user_id: number;
  shamsi_date: string;
  work_date: string;
  leave_type: LeaveType;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  reason: string;
  status: FinancialStatus;
  is_seen_by_manager: boolean;
  manager_note: string | null;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface LeaveQuotaSummary {
  monthlyQuotaDays: number;
  monthlyQuotaMinutes: number;
  usedCurrentMonthMinutes: number;
  usedCurrentMonthDaysFormatted: string;
  remainingMonthMinutes: number;
  remainingMonthDaysFormatted: string;
  usedYearMinutes: number;
  pendingCount: number;
}

export interface FinancialTransaction {
  id: number;
  user_id: number;
  created_by_user_id: number;
  creator_role?: UserRole;
  creator_name?: string;
  amount_toman: number; // Stored in DB as DECIMAL(15,0)
  tx_type: FinancialTxType;
  tx_date: string;
  shamsi_date: string;
  description: string;
  receipt_file_url?: string | null;
  receipt_file_name?: string | null;
  status: FinancialStatus;
  is_seen_by_manager: boolean;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  manager_note: string | null;
  settlement_mode?: SettlementMode; // LUMP_SUM (یکجا) | INSTALLMENT (تقسیط خودکار ماهانه)
  monthly_deduction_toman?: number | null; // مبلغ کسر خودکار در هر دوره ماهانه
  installment_count?: number | null; // تعداد کل اقساط / دوره‌های ماهانه
  installment_start_shamsi?: string | null; // تاریخ / دوره شروع استهلاک
  idempotency_key: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: number;
  shift_start_time: string; // HH:MM
  shift_end_time: string;   // HH:MM
  thursday_shift_start_time: string; // HH:MM (ساعت شروع پنجشنبه)
  thursday_shift_end_time: string;   // HH:MM (ساعت پایان پنجشنبه)
  thursday_overtime_start_time: string; // HH:MM (ساعت شروع اضافه‌کاری پنجشنبه)
  grace_period_minutes: number;
  break_duration_minutes: number;
  working_days: number[]; // JS getDay(): 6=Sat, 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
  overtime_start_time: string; // HH:MM
  overtime_before_shift: boolean;
  mission_policy: MissionPolicy;
  friday_holiday_policy: FridayHolidayPolicy;
  official_holidays: string[]; // ['1405/01/01', ...]
  timezone: string;
  base_salary_toman: number | null; // مبلغ حقوق پایه ماهانه به تومان
  hourly_rate_toman: number | null; // نرخ ساعتی پایه به تومان
  overtime_calc_mode: OvertimeCalcMode; // FIXED_RATE | PERCENTAGE
  overtime_percentage: number; // درصد اضافه‌کاری (مثلاً ۱۴۰٪)
  overtime_rate_toman: number | null; // مبلغ ثابت هر ساعت اضافه‌کاری به تومان
  late_deduction_unit?: LateDeductionUnit; // MINUTE | HOUR
  late_deduction_rate_toman?: number | null; // نرخ کسر تأخیر (در صورت خالی بودن: پیش‌فرض قانون کار)
  absence_deduction_unit?: AbsenceDeductionUnit; // DAY | HOUR
  absence_deduction_rate_toman?: number | null; // نرخ کسر غیبت (در صورت خالی بودن: پیش‌فرض قانون کار)
  collaboration_start_shamsi: string; // تاریخ شروع همکاری امید میثمی
  monthly_leave_quota_days?: number; // سقف مرخصی ماهانه به روز (پیش‌فرض ۲.۵ روز)
  sms_enabled: boolean;
  sms_on_task_and_message?: boolean;
  melipayamak_username: string;
  melipayamak_password: string;
  melipayamak_from_number: string;
  melipayamak_is_flash: boolean;
  worker_phone_number: string;
  rules_confirmed_by_manager: boolean;
  effective_from_shamsi: string;
  banner_bg_url: string | null;
  updated_at?: string;
}

export interface DailyAttendanceSummary {
  work_date: string;
  shamsi_date: string;
  day_name: string;
  is_holiday_or_friday: boolean;
  is_working_day: boolean;
  logs: AttendanceLog[];
  first_in_time: string | null;
  last_out_time: string | null;
  is_incomplete: boolean;
  is_late: boolean;
  raw_late_minutes?: number;
  late_minutes: number;
  late_status?: LateArrivalDisposition;
  late_reason?: string | null;
  manager_late_note?: string | null;
  late_deduction_toman?: number;
  custom_deduction_toman?: number | null;
  late_reviewed_at?: string | null;
  is_late_seen_by_worker?: boolean;
  first_in_log_id?: number | null;
  gross_presence_minutes: number;
  mission_minutes: number;
  break_deducted_minutes: number;
  net_work_minutes: number;
  provisional_work_minutes: number;
  overtime_minutes: number;
  status_label: string;
}

export interface WorkerLiveState {
  status: WorkerLiveStatus;
  status_text: string;
  status_detail: string;
  is_overtime_active: boolean;
  forgotten_checkout_warning?: boolean;
  forgotten_checkout_message?: string | null;
  last_event: AttendanceLog | null;
  allowed_next_events: AttendanceEventType[];
  today_summary: DailyAttendanceSummary;
  worker_profile?: {
    full_name: string;
    avatar_url: string | null;
    collaboration_start_shamsi: string;
    phone_number: string | null;
  };
}

export interface CorrespondenceAttachment {
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
}

export interface WorkCorrespondence {
  id: number;
  sender_user_id: number;
  sender_role: UserRole;
  sender_name: string;
  sender_avatar_url: string | null;
  receiver_user_id: number;
  parent_id: number | null;
  parent_preview: string | null;
  subject: string | null;
  message_text: string;
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
  attachments: CorrespondenceAttachment[];
  delivery_channel: DeliveryChannel;
  sms_sent: boolean;
  sms_status_text: string | null;
  shamsi_date: string;
  recorded_time: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface AuditLogItem {
  id: number;
  actor_user_id: number | null;
  actor_name?: string;
  action_type: string;
  target_entity: string;
  target_id: number | null;
  before_state: unknown;
  after_state: unknown;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface SystemSettingsSnapshot {
  id?: number;
  effective_from_shamsi: string;
  settings: SystemSettings;
  changed_by_user_id?: number | null;
  change_reason?: string | null;
  created_at?: string;
}

export type MediaSourceType =
  | 'CORRESPONDENCE_AUDIO'
  | 'CORRESPONDENCE_ATTACHMENT'
  | 'REPORT_PHOTO'
  | 'FINANCE_RECEIPT'
  | 'HISTORICAL_EXCEL'
  | 'ORPHAN_FILE';

export interface MediaStorageItem {
  id: string;
  source_type: MediaSourceType;
  category: 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  record_id: number | null;
  file_url: string;
  file_name: string;
  size_bytes: number;
  shamsi_date: string;
  recorded_time?: string;
  title_or_context: string;
  sender_or_creator: string;
  exists_on_disk: boolean;
  created_at: string;
}

export interface MediaStorageSummary {
  total_files_count: number;
  total_size_bytes: number;
  audio_files_count: number;
  audio_size_bytes: number;
  image_files_count: number;
  image_size_bytes: number;
  document_files_count: number;
  document_size_bytes: number;
  items: MediaStorageItem[];
}

export type FlexibleClockEntryMode = 'START_ONLY' | 'END_ONLY' | 'FULL_SHIFT';
