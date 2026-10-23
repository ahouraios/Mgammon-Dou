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

export type WorkerLiveStatus =
  | 'PRESENT'   // سبز: حاضر در محل کار
  | 'LATE'      // نارنجی: حضور با تأخیر
  | 'MISSION'   // بنفش: مأموریت
  | 'FINISHED'  // خاکستری: پایان کار
  | 'ABSENT';   // قرمز: غیبت بر اساس قواعد تعیین‌شده

export type MissionPolicy = 'PAID_AS_WORK' | 'SEPARATE_EXTRA';
export type FridayHolidayPolicy = 'ALL_OVERTIME' | 'REGULAR_WORK' | 'DISABLED';

export interface UserProfile {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
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
  created_at: string;
}

export interface DailyWorkReport {
  id: number;
  user_id: number;
  report_date: string;
  shamsi_date: string;
  activity_description: string;
  duration_minutes: number | null;
  recorded_time: string;
  created_at: string;
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
  status: FinancialStatus;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  manager_note: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: number;
  shift_start_time: string; // HH:MM
  shift_end_time: string;   // HH:MM
  grace_period_minutes: number;
  break_duration_minutes: number;
  working_days: number[]; // JS getDay(): 6=Sat, 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
  overtime_start_time: string; // HH:MM
  overtime_before_shift: boolean;
  mission_policy: MissionPolicy;
  friday_holiday_policy: FridayHolidayPolicy;
  official_holidays: string[]; // ['1405/01/01', ...]
  timezone: string;
  hourly_rate_toman: number | null;
  overtime_rate_toman: number | null;
  rules_confirmed_by_manager: boolean;
  effective_from_shamsi: string;
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
  is_incomplete: boolean; // True if WORK_START or MISSION_START without closing WORK_END on a finished/past day
  is_late: boolean;
  late_minutes: number;
  gross_presence_minutes: number;
  mission_minutes: number;
  break_deducted_minutes: number;
  net_work_minutes: number;      // 0 if is_incomplete is true on a past day (until resolved)
  provisional_work_minutes: number; // Live elapsed minutes if currently in progress
  overtime_minutes: number;
  status_label: string;
}

export interface WorkerLiveState {
  status: WorkerLiveStatus;
  status_text: string;
  status_detail: string;
  is_overtime_active: boolean;
  last_event: AttendanceLog | null;
  allowed_next_events: AttendanceEventType[];
  today_summary: DailyAttendanceSummary;
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
