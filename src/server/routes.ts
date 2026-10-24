import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {
  checkDatabaseConnection,
  FORBIDDEN_DEFAULT_PASSWORDS,
  getPool,
  getSystemSettingsFromDb,
  mapRowToSystemSettings,
} from './db';
import {
  AuthenticatedRequest,
  checkLoginRateLimit,
  clearLoginAttempts,
  clearSessionCookie,
  createServerSession,
  generateCsrfToken,
  getSessionUser,
  handleServerError,
  hashSessionToken,
  recordAuditLog,
  recordFailedLoginAttempt,
  requireAuth,
  requireRole,
  setSessionCookie,
} from './auth';
import {
  AttendanceEventType,
  AttendanceLog,
  CorrespondenceAttachment,
  DailyAttendanceSummary,
  DailyWorkReport,
  DeliveryChannel,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
  HistoricalWorkRecord,
  HistoricalWorkRowItem,
  LeaveQuotaSummary,
  LeaveRequestItem,
  LeaveType,
  OvertimeCalcMode,
  SystemSettings,
  UserRole,
  WorkCorrespondence,
  WorkTaskItem,
} from '../shared/types';
import {
  formatDurationPersian,
  getNowInTimezone,
  getShamsiDayOfWeekName,
  gregorianToShamsi,
  isValidShamsiDate,
  normalizeShamsiDate,
  parseTimeToMinutes,
  shamsiToGregorian,
  toEnglishDigits,
  toPersianDigits,
} from '../shared/jalali';
import {
  calculateDailyAttendance,
  calculateSalaryAndOvertimeRates,
  evaluateWorkerLiveState,
  validateAttendanceSequence,
  validateFullDayLogSequence,
} from '../shared/calculationEngine';
import { checkMelipayamakCredit, sendMelipayamakSms } from './melipayamak';

export const apiRouter = Router();

class ValidationError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, message: string, code = 'INVALID_FILE') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sanitizeSettingsForRole(
  settings: SystemSettings,
  role: UserRole
): SystemSettings {
  if (role !== 'manager') {
    return {
      ...settings,
      melipayamak_username: '',
      melipayamak_password: '',
      melipayamak_from_number: '',
    };
  }
  return {
    ...settings,
    melipayamak_password: settings.melipayamak_password ? '••••••••' : '',
  };
}

function detectFileSignature(
  buf: Buffer
): 'png' | 'jpg' | 'webp' | 'pdf' | 'xlsx' | 'xls' | 'audio' | 'unknown' | 'dangerous' {
  if (buf.length < 4) return 'unknown';

  // بررسی فایل‌های اجرایی و اسکریپتی خطرناک (PE/MZ, ELF, PHP, HTML/Script)
  if (
    (buf[0] === 0x4d && buf[1] === 0x5a) || // MZ (.exe/.dll)
    (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) // ELF
  ) {
    return 'dangerous';
  }
  const headText = buf.subarray(0, Math.min(256, buf.length)).toString('utf8').toLowerCase();
  if (
    headText.includes('<script') ||
    headText.includes('<?php') ||
    headText.startsWith('#!/') ||
    headText.includes('<html')
  ) {
    return 'dangerous';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  // PDF: %PDF
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'pdf';
  }

  // XLSX / ZIP: 50 4B 03 04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'xlsx';
  }

  // XLS (OLE2): D0 CF 11 E0
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return 'xls';
  }

  // Audio: WebM (1A 45 DF A3), OGG (OggS), WAV (RIFF....WAVE), MP4/M4A (....ftyp), MP3 (ID3 / FF FB)
  if (
    (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) ||
    buf.subarray(0, 4).toString('ascii') === 'OggS' ||
    (buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WAVE') ||
    (buf.length >= 8 && buf.subarray(4, 8).toString('ascii') === 'ftyp') ||
    buf.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return 'audio';
  }

  return 'unknown';
}

function saveBase64MediaFile(
  subFolder: 'avatars' | 'attachments' | 'excel' | 'audio' | 'receipts' | 'reports',
  originalName: string,
  base64Data: string
): { publicUrl: string; sizeBytes: number } {
  const rawName = String(originalName || '').trim();
  if (!rawName || rawName.includes('\0') || rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
    throw new ValidationError(400, 'نام فایل نامعتبر یا حاوی کاراکترهای غیرمجاز است.');
  }

  const cleanBase64 = (base64Data.includes(',') ? base64Data.split(',')[1] : base64Data).trim();
  if (!cleanBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
    throw new ValidationError(400, 'محتوای فایل ارسالی معتبر نیست.');
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length < 8) {
    throw new ValidationError(400, 'فایل ارسالی خالی یا خراب است.');
  }

  const maxBytesByFolder: Record<typeof subFolder, number> = {
    avatars: Math.floor(2.5 * 1024 * 1024),
    excel: 2 * 1024 * 1024,
    reports: 5 * 1024 * 1024,
    receipts: 5 * 1024 * 1024,
    attachments: 5 * 1024 * 1024,
    audio: 5 * 1024 * 1024,
  };

  if (buffer.length > maxBytesByFolder[subFolder]) {
    throw new ValidationError(413, 'حجم فایل ارسالی بیش از سقف مجاز است.', 'FILE_TOO_LARGE');
  }

  const ext = path.extname(rawName).toLowerCase();
  const allowedExtsByFolder: Record<typeof subFolder, string[]> = {
    avatars: ['.png', '.jpg', '.jpeg', '.webp'],
    reports: ['.png', '.jpg', '.jpeg', '.webp'],
    receipts: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'],
    attachments: ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.xlsx', '.xls'],
    excel: ['.xlsx', '.xls'],
    audio: ['.webm', '.ogg', '.mp4', '.wav', '.mp3', '.m4a'],
  };

  if (!ext || !allowedExtsByFolder[subFolder].includes(ext)) {
    throw new ValidationError(400, `پسوند فایل (${ext || 'بدون پسوند'}) برای این بخش مجاز نیست.`);
  }

  const detectedSig = detectFileSignature(buffer);
  if (detectedSig === 'dangerous' || detectedSig === 'unknown') {
    throw new ValidationError(400, 'نوع واقعی فایل نامعتبر یا غیرمجاز است.');
  }

  const sigToExts: Record<string, string[]> = {
    png: ['.png'],
    jpg: ['.jpg', '.jpeg'],
    webp: ['.webp'],
    pdf: ['.pdf'],
    xlsx: ['.xlsx'],
    xls: ['.xls'],
    audio: ['.webm', '.ogg', '.mp4', '.wav', '.mp3', '.m4a'],
  };

  if (!sigToExts[detectedSig]?.includes(ext)) {
    throw new ValidationError(400, 'محتوای باینری واقعی فایل با پسوند اعلام‌شده مطابقت ندارد.');
  }

  const safeBase = path
    .basename(rawName, path.extname(rawName))
    .replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_')
    .slice(0, 40) || 'file';
  const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`;
  const targetDir = path.resolve(process.cwd(), '.data/private_media', subFolder);
  fs.mkdirSync(targetDir, { recursive: true });
  const fullPath = path.join(targetDir, fileName);
  fs.writeFileSync(fullPath, buffer);
  return {
    publicUrl: `/assets/media/${subFolder}/${fileName}`,
    sizeBytes: buffer.length,
  };
}

function extractSqlDateString(val: unknown, fallbackShamsi?: unknown): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val.trim())) {
    return val.trim().slice(0, 10);
  }
  if (typeof fallbackShamsi === 'string' && isValidShamsiDate(fallbackShamsi.trim())) {
    return shamsiToGregorian(normalizeShamsiDate(fallbackShamsi.trim()));
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const tehranMs = val.getTime() + (3 * 60 + 30) * 60 * 1000;
    return new Date(tehranMs).toISOString().slice(0, 10);
  }
  return String(val || '').slice(0, 10);
}

function mapRowToAttendanceLog(row: mysql.RowDataPacket): AttendanceLog {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    work_date: workDate,
    shamsi_date: String(row.shamsi_date),
    event_type: row.event_type as AttendanceEventType,
    recorded_at: row.recorded_at ? new Date(row.recorded_at).toISOString() : '',
    recorded_time: String(row.recorded_time),
    note: row.note ? String(row.note) : null,
    is_manual_override: Boolean(row.is_manual_override),
    modified_by_user_id: row.modified_by_user_id ? Number(row.modified_by_user_id) : null,
    modification_reason: row.modification_reason ? String(row.modification_reason) : null,
    is_deleted: Boolean(row.is_deleted),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

function mapRowToFinancialTx(row: mysql.RowDataPacket): FinancialTransaction {
  const txDate = extractSqlDateString(row.tx_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    created_by_user_id: Number(row.created_by_user_id),
    creator_role: row.creator_role,
    creator_name: row.creator_name,
    amount_toman: Number(row.amount_toman),
    tx_type: row.tx_type as FinancialTxType,
    tx_date: txDate,
    shamsi_date: String(row.shamsi_date),
    description: String(row.description),
    receipt_file_url: row.receipt_file_url ? String(row.receipt_file_url) : null,
    receipt_file_name: row.receipt_file_name ? String(row.receipt_file_name) : null,
    status: row.status as FinancialStatus,
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    manager_note: row.manager_note ? String(row.manager_note) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

function mapRowToHistoricalWork(row: mysql.RowDataPacket): HistoricalWorkRecord {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  let parsedRows: HistoricalWorkRowItem[] = [];
  if (row.parsed_rows_json) {
    try {
      parsedRows =
        typeof row.parsed_rows_json === 'string'
          ? JSON.parse(row.parsed_rows_json)
          : row.parsed_rows_json;
    } catch {
      parsedRows = [];
    }
  }
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    shamsi_date: String(row.shamsi_date),
    work_date: workDate,
    title: String(row.title),
    work_days_count: Number(row.work_days_count),
    net_work_minutes: Number(row.net_work_minutes),
    overtime_minutes: Number(row.overtime_minutes),
    note: row.note ? String(row.note) : null,
    status: (row.status as FinancialStatus) || 'APPROVED',
    excel_file_url: row.excel_file_url ? String(row.excel_file_url) : null,
    excel_file_name: row.excel_file_name ? String(row.excel_file_name) : null,
    parsed_rows: parsedRows,
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    created_by_user_id: Number(row.created_by_user_id),
    creator_role: row.creator_role,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

function inferHistoricalCheckInOut(
  netMins: number,
  otMins: number,
  note?: string | null,
  explicitIn?: string,
  explicitOut?: string
): { firstIn: string; lastOut: string } {
  if (explicitIn && explicitOut) {
    return { firstIn: explicitIn, lastOut: explicitOut };
  }
  const noteStr = note || '';
  if (noteStr.includes('۰۸:۰۰') && noteStr.includes('۱۴:۳۰')) {
    return { firstIn: '08:00', lastOut: '14:30' };
  }
  const startMinutes =
    netMins > 0 && netMins <= 480 ? 7 * 60 + (480 - netMins) : 7 * 60;
  const inH = Math.floor(startMinutes / 60);
  const inM = startMinutes % 60;
  const firstIn =
    explicitIn ||
    `${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}`;

  const endMinutes = 15 * 60 + Math.max(0, otMins);
  const outH = Math.floor(endMinutes / 60);
  const outM = endMinutes % 60;
  const lastOut =
    explicitOut ||
    `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;

  return { firstIn, lastOut };
}

function mergeApprovedHistoricalIntoDailySummaries(
  dailySummaries: DailyAttendanceSummary[],
  historicalRecords: HistoricalWorkRecord[],
  fromShamsi: string | null = null,
  toShamsi: string | null = null
): DailyAttendanceSummary[] {
  const byShamsi = new Map<string, DailyAttendanceSummary>();
  for (const s of dailySummaries) {
    byShamsi.set(normalizeShamsiDate(s.shamsi_date), s);
  }

  for (const rec of historicalRecords) {
    if (rec.status !== 'APPROVED') continue;
    if (rec.parsed_rows && rec.parsed_rows.length > 0) {
      for (const row of rec.parsed_rows) {
        if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
        const normShamsi = normalizeShamsiDate(row.shamsi_date);
        if (fromShamsi && normShamsi < fromShamsi) continue;
        if (toShamsi && normShamsi > toShamsi) continue;
        if (byShamsi.has(normShamsi)) continue;

        const workDate = shamsiToGregorian(normShamsi);
        const dayName = getShamsiDayOfWeekName(normShamsi);
        const isMission = Boolean(row.note && row.note.includes('مأموریت'));
        const { firstIn, lastOut } = inferHistoricalCheckInOut(
          row.net_work_minutes,
          row.overtime_minutes,
          row.note,
          row.check_in,
          row.check_out
        );

        byShamsi.set(normShamsi, {
          work_date: workDate,
          shamsi_date: normShamsi,
          day_name: dayName,
          is_holiday_or_friday: dayName === 'جمعه',
          is_working_day: dayName !== 'جمعه',
          logs: [],
          first_in_time: firstIn,
          last_out_time: lastOut,
          is_incomplete: false,
          is_late: row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== 'جمعه',
          late_minutes:
            row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== 'جمعه'
              ? 480 - row.net_work_minutes
              : 0,
          gross_presence_minutes: row.net_work_minutes + row.overtime_minutes,
          mission_minutes: isMission ? 60 : 0,
          break_deducted_minutes: 0,
          net_work_minutes: row.net_work_minutes,
          provisional_work_minutes: row.net_work_minutes,
          overtime_minutes: row.overtime_minutes,
          status_label: row.note || row.title || 'ثبت‌شده در سوابق کارکرد',
        });
      }
    } else if (rec.work_days_count === 1 && isValidShamsiDate(rec.shamsi_date)) {
      const normShamsi = normalizeShamsiDate(rec.shamsi_date);
      if (fromShamsi && normShamsi < fromShamsi) continue;
      if (toShamsi && normShamsi > toShamsi) continue;
      if (byShamsi.has(normShamsi)) continue;

      const workDate = shamsiToGregorian(normShamsi);
      const dayName = getShamsiDayOfWeekName(normShamsi);
      const { firstIn, lastOut } = inferHistoricalCheckInOut(
        rec.net_work_minutes,
        rec.overtime_minutes,
        rec.note
      );
      byShamsi.set(normShamsi, {
        work_date: workDate,
        shamsi_date: normShamsi,
        day_name: dayName,
        is_holiday_or_friday: dayName === 'جمعه',
        is_working_day: dayName !== 'جمعه',
        logs: [],
        first_in_time: firstIn,
        last_out_time: lastOut,
        is_incomplete: false,
        is_late: false,
        late_minutes: 0,
        gross_presence_minutes: rec.net_work_minutes + rec.overtime_minutes,
        mission_minutes: 0,
        break_deducted_minutes: 0,
        net_work_minutes: rec.net_work_minutes,
        provisional_work_minutes: rec.net_work_minutes,
        overtime_minutes: rec.overtime_minutes,
        status_label: rec.note || rec.title,
      });
    }
  }

  return Array.from(byShamsi.values()).sort((a, b) =>
    b.work_date.localeCompare(a.work_date)
  );
}

function mapRowToLeaveRequest(row: mysql.RowDataPacket): LeaveRequestItem {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    shamsi_date: String(row.shamsi_date),
    work_date: workDate,
    leave_type: (row.leave_type as LeaveType) || 'DAILY',
    start_time: row.start_time ? String(row.start_time) : null,
    end_time: row.end_time ? String(row.end_time) : null,
    duration_minutes: Number(row.duration_minutes || 480),
    reason: String(row.reason || ''),
    status: (row.status as FinancialStatus) || 'PENDING',
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    manager_note: row.manager_note ? String(row.manager_note) : null,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

function mapRowToWorkTask(row: mysql.RowDataPacket): WorkTaskItem {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    created_by_user_id: Number(row.created_by_user_id),
    shamsi_date: String(row.shamsi_date),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    is_completed: Boolean(row.is_completed),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    added_to_report: Boolean(row.added_to_report),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

async function getWorkerInfo(pool: mysql.Pool): Promise<{
  id: number;
  full_name: string;
  avatar_url: string | null;
  collaboration_start_shamsi: string;
  phone_number: string | null;
}> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    "SELECT id, full_name, avatar_url, collaboration_start_shamsi, phone_number FROM users WHERE role = 'worker' LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error('حساب پرسنل یافت نشد');
  }
  const r = rows[0];
  return {
    id: Number(r.id),
    full_name: String(r.full_name || 'امید میثمی'),
    avatar_url: r.avatar_url ? String(r.avatar_url) : null,
    collaboration_start_shamsi: r.collaboration_start_shamsi
      ? String(r.collaboration_start_shamsi)
      : '1405/06/15',
    phone_number: r.phone_number ? String(r.phone_number) : null,
  };
}

async function getWorkerUserId(pool: mysql.Pool): Promise<number> {
  const info = await getWorkerInfo(pool);
  return info.id;
}

/**
 * جلوگیری از IDOR و دسترسی عرضی کارمند به اطلاعات کاربر دیگر از طریق پارامترهای userId / user_id
 */
async function resolveTargetWorkerId(
  pool: mysql.Pool,
  req: AuthenticatedRequest,
  res: Response
): Promise<number | null> {
  const rawTarget =
    req.query?.userId ?? req.query?.user_id ?? req.body?.userId ?? req.body?.user_id;

  if (req.user!.role !== 'manager') {
    if (
      rawTarget !== undefined &&
      rawTarget !== null &&
      String(rawTarget).trim() !== '' &&
      Number(rawTarget) !== req.user!.id
    ) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_USER_ACCESS',
        message: 'شما مجوز دسترسی یا تغییر اطلاعات کاربر دیگر را ندارید.',
      });
      return null;
    }
    return req.user!.id;
  }

  if (rawTarget !== undefined && rawTarget !== null && String(rawTarget).trim() !== '') {
    const parsedId = Number(rawTarget);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      res.status(400).json({ ok: false, message: 'شناسه کاربر معتبر نیست.' });
      return null;
    }
    return parsedId;
  }

  return getWorkerUserId(pool);
}

// ============================================================================
// ۱. بررسی وضعیت سلامت سرویس
// ============================================================================
apiRouter.get('/health', async (_req, res) => {
  const status = await checkDatabaseConnection();
  if (!status.connected) {
    res.status(503).json({
      ok: false,
      dbConnected: false,
      message: status.message,
    });
    return;
  }
  try {
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    res.json({
      ok: true,
      dbConnected: true,
      serverTime: nowInfo,
      bannerBgUrl: settings.banner_bg_url || '/assets/media/banner-bg.svg',
    });
  } catch {
    const nowInfo = getNowInTimezone('Asia/Tehran');
    res.json({
      ok: true,
      dbConnected: true,
      serverTime: nowInfo,
      bannerBgUrl: '/assets/media/banner-bg.svg',
    });
  }
});

// ============================================================================
// ۲. احراز هویت، ورود بیومتریک (اثر انگشت / تشخیص چهره)، پروفایل و رمز عبور
// ============================================================================
apiRouter.post('/auth/login', async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || '')).trim().toLowerCase();
    const password = String(req.body?.password || '');
    const clientIp = req.ip || 'unknown';

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        message: 'نام کاربری و رمز عبور الزامی است.',
      });
      return;
    }

    const rateCheck = checkLoginRateLimit(clientIp, username);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: `تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً ${rateCheck.retryAfterSeconds} ثانیه دیگر مجدداً تلاش کنید.`,
      });
      return;
    }

    if (process.env.NODE_ENV === 'production' && FORBIDDEN_DEFAULT_PASSWORDS.has(password)) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(403).json({
        ok: false,
        code: 'DEFAULT_PASSWORD_FORBIDDEN',
        message: 'ورود با رمز عبور پیش‌فرض در محیط عملیاتی (Production) ممنوع است.',
      });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_token_hash, password_hash, must_change_password, is_active, last_login_at FROM users WHERE LOWER(username) = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      const failState = await recordFailedLoginAttempt(clientIp, username);
      if (failState.locked) {
        res.status(429).json({
          ok: false,
          code: 'TOO_MANY_ATTEMPTS',
          message: 'حساب موقتاً به دلیل تلاش‌های ناموفق متوالی قفل شد. لطفاً ۱۵ دقیقه دیگر تلاش کنید.',
        });
        return;
      }
      res.status(401).json({
        ok: false,
        message: 'نام کاربری یا رمز عبور اشتباه است.',
      });
      return;
    }

    const userRow = rows[0];
    let match = await bcrypt.compare(password, String(userRow.password_hash));
    if (!match) {
      const normalizedPassword = toEnglishDigits(password).trim();
      if (normalizedPassword !== password) {
        match = await bcrypt.compare(normalizedPassword, String(userRow.password_hash));
      }
    }
    if (!match) {
      const failState = await recordFailedLoginAttempt(clientIp, username);
      await recordAuditLog({
        actorUserId: Number(userRow.id),
        actionType: 'LOGIN_FAILED',
        targetEntity: 'users',
        targetId: Number(userRow.id),
        ipAddress: req.ip || null,
      });
      if (failState.locked) {
        res.status(429).json({
          ok: false,
          code: 'TOO_MANY_ATTEMPTS',
          message: 'حساب موقتاً به دلیل تلاش‌های ناموفق متوالی قفل شد. لطفاً ۱۵ دقیقه دیگر تلاش کنید.',
        });
        return;
      }
      res.status(401).json({
        ok: false,
        message: 'نام کاربری یا رمز عبور اشتباه است.',
      });
      return;
    }

    clearLoginAttempts(clientIp, username);
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userRow.id]);

    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      Number(userRow.id),
      req.ip || null,
      req.headers['user-agent'] || null
    );
    setSessionCookie(res, rawToken, expiresAt);

    await recordAuditLog({
      actorUserId: Number(userRow.id),
      actionType: 'LOGIN_SUCCESS',
      targetEntity: 'users',
      targetId: Number(userRow.id),
      ipAddress: req.ip || null,
    });

    const mustChangePassword =
      Boolean(userRow.must_change_password) || FORBIDDEN_DEFAULT_PASSWORDS.has(password);

    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      requirePasswordChange: mustChangePassword,
      user: {
        id: Number(userRow.id),
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi
          ? String(userRow.collaboration_start_shamsi)
          : '1405/06/15',
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: Boolean(userRow.biometric_token_hash),
        must_change_password: mustChangePassword,
        last_login_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * فعال‌سازی ورود بیومتریک (اثر انگشت / تشخیص چهره) برای حساب کاربری جاری
 */
apiRouter.post('/auth/biometric/register', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const credentialId = String(req.body?.credential_id || '').trim();
    if (!credentialId) {
      res.status(400).json({ ok: false, message: 'شناسه بیومتریک دستگاه معتبر نیست.' });
      return;
    }

    const rawBioToken = crypto.randomBytes(32).toString('hex');
    const bioTokenHash = hashSessionToken(rawBioToken);

    const pool = getPool();
    await pool.execute(
      'UPDATE users SET biometric_credential_id = ?, biometric_token_hash = ? WHERE id = ?',
      [credentialId, bioTokenHash, req.user!.id]
    );

    res.json({
      ok: true,
      biometric_token: rawBioToken,
      credential_id: credentialId,
      username: req.user!.username,
      full_name: req.user!.full_name,
      role: req.user!.role,
      message: 'ورود سریع با اثر انگشت / تشخیص چهره برای این دستگاه فعال شد.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.delete('/auth/biometric', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    await pool.execute(
      'UPDATE users SET biometric_credential_id = NULL, biometric_token_hash = NULL WHERE id = ?',
      [req.user!.id]
    );
    res.json({
      ok: true,
      message: 'ورود با اثر انگشت / تشخیص چهره غیرفعال شد.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/auth/biometric/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const credentialId = String(req.body?.credential_id || '').trim();
    const biometricToken = String(req.body?.biometric_token || '').trim();
    const clientIp = req.ip || 'unknown';

    if (!username || !credentialId || !biometricToken) {
      res.status(400).json({ ok: false, message: 'اطلاعات ورود بیومتریک ناقص است.' });
      return;
    }

    const rateCheck = checkLoginRateLimit(clientIp, username);
    if (!rateCheck.allowed) {
      res.status(429).json({
        ok: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً بعداً تلاش کنید.',
      });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_credential_id, biometric_token_hash, must_change_password, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(401).json({ ok: false, message: 'حساب کاربری معتبر نیست.' });
      return;
    }

    const userRow = rows[0];
    const expectedHash = hashSessionToken(biometricToken);
    if (
      !userRow.biometric_token_hash ||
      String(userRow.biometric_credential_id) !== credentialId ||
      String(userRow.biometric_token_hash) !== expectedHash
    ) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(401).json({
        ok: false,
        message: 'کلید اثر انگشت منقضی شده است. لطفاً یک بار با رمز عبور وارد شوید و مجدداً فعال کنید.',
      });
      return;
    }

    clearLoginAttempts(clientIp, username);
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userRow.id]);

    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      Number(userRow.id),
      req.ip || null,
      req.headers['user-agent'] || null
    );
    setSessionCookie(res, rawToken, expiresAt);

    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      user: {
        id: Number(userRow.id),
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi
          ? String(userRow.collaboration_start_shamsi)
          : '1405/06/15',
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: true,
        must_change_password: Boolean(userRow.must_change_password),
        last_login_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/auth/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const session = await getSessionUser(req);
    if (session) {
      const pool = getPool();
      await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [session.tokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true, message: 'خروج با موفقیت انجام شد.' });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.get('/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const csrfToken = req.rawSessionToken ? generateCsrfToken(req.rawSessionToken) : undefined;
    res.json({
      ok: true,
      user: req.user,
      csrfToken,
      serverTime: nowInfo,
      settings: sanitizeSettingsForRole(settings, req.user!.role),
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * بارگذاری یا تغییر تصویر پروفایل (هر کاربر فقط تصویر حساب کاربری خودش را تغییر می‌دهد)
 */
apiRouter.put('/auth/avatar', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetRole = req.user!.role;

    const avatarBase64 = req.body?.avatar_base64 ? String(req.body.avatar_base64) : null;
    const fileName = req.body?.file_name ? String(req.body.file_name) : 'avatar.png';

    const pool = getPool();
    let newAvatarUrl: string | null = null;

    if (avatarBase64 && avatarBase64.trim() !== '') {
      if (avatarBase64.length > 4_000_000) {
        res.status(400).json({
          ok: false,
          message: 'حجم تصویر پروفایل نباید بیشتر از ۲.۵ مگابایت باشد.',
        });
        return;
      }
      const saved = saveBase64MediaFile('avatars', fileName, avatarBase64);
      newAvatarUrl = saved.publicUrl;
    }

    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [newAvatarUrl, req.user!.id]);

    res.json({
      ok: true,
      avatar_url: newAvatarUrl,
      target_role: targetRole,
      message: newAvatarUrl
        ? 'تصویر پروفایل شما با موفقیت ذخیره شد.'
        : 'تصویر پروفایل به حالت پیش‌فرض بازگردانی شد.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentPassword = String(req.body?.currentPassword || req.body?.current_password || '');
    const newPassword = String(req.body?.newPassword || req.body?.new_password || '');

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        ok: false,
        message: 'وارد کردن رمز عبور فعلی و رمز عبور جدید الزامی است.',
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        message: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.',
      });
      return;
    }

    if (FORBIDDEN_DEFAULT_PASSWORDS.has(newPassword) || newPassword === currentPassword) {
      res.status(400).json({
        ok: false,
        message: 'رمز عبور جدید نباید با رمز فعلی یا رمزهای پیش‌فرض یکسان باشد.',
      });
      return;
    }

    const pool = getPool();
    const userId = req.user!.id;
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      res.status(404).json({ ok: false, message: 'کاربر یافت نشد.' });
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, String(rows[0].password_hash));
    if (!isMatch) {
      res.status(400).json({
        ok: false,
        message: 'رمز عبور فعلی نادرست است.',
      });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
      [newHash, userId]
    );

    // بی‌اعتبارسازی تمام نشست‌های قبلی کاربر و صدور نشست جدید (Session Rotation)
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);

    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      userId,
      req.ip || null,
      req.headers['user-agent'] || null
    );
    setSessionCookie(res, rawToken, expiresAt);

    await recordAuditLog({
      actorUserId: userId,
      actionType: 'PASSWORD_CHANGE',
      targetEntity: 'users',
      targetId: userId,
      ipAddress: req.ip || null,
    });

    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      message: 'رمز عبور با موفقیت تغییر یافت و نشست‌های قبلی بی‌اعتبار شدند.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

// ============================================================================
// ۲-ب. فراموشی رمز عبور با کد پیامکی (ملی‌پیامک) + بازنشانی رمز پرسنل توسط مدیر
// ============================================================================
interface PasswordResetOtpEntry {
  codeHash: string;
  expiresAtMs: number;
  attempts: number;
  lastSentAtMs: number;
}

const passwordResetOtpStore = new Map<string, PasswordResetOtpEntry>();

function normalizeIranMobile(raw: string | null | undefined): string {
  const clean = toEnglishDigits(String(raw || '')).replace(/\s+/g, '').trim();
  if (/^\+989\d{9}$/.test(clean)) return `0${clean.slice(3)}`;
  if (/^989\d{9}$/.test(clean)) return `0${clean.slice(2)}`;
  if (/^9\d{9}$/.test(clean)) return `0${clean}`;
  if (/^09\d{9}$/.test(clean)) return clean;
  return '';
}

function maskMobileNumber(phone: string): string {
  if (phone.length < 10) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

/**
 * به‌روزرسانی شماره موبایل کاربر جاری برای بازیابی رمز عبور و پیامک‌ها
 */
apiRouter.put('/auth/phone', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawPhone = String(req.body?.phone_number || '').trim();
    const normalized = rawPhone ? normalizeIranMobile(rawPhone) : '';
    if (rawPhone && !normalized) {
      res.status(400).json({
        ok: false,
        message: 'فرمت شماره موبایل معتبر نیست (مثال: 09123456789).',
      });
      return;
    }

    const pool = getPool();
    await pool.execute('UPDATE users SET phone_number = ? WHERE id = ?', [
      normalized || null,
      req.user!.id,
    ]);

    if (req.user!.role === 'worker') {
      await pool.execute('UPDATE system_settings SET worker_phone_number = ?', [normalized]);
    }

    res.json({
      ok: true,
      phone_number: normalized || null,
      message: normalized
        ? 'شماره موبایل شما برای دریافت کد بازیابی رمز عبور ذخیره شد.'
        : 'شماره موبایل حذف شد.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * درخواست ارسال کد یک‌بارمصرف (OTP) فراموشی رمز عبور از طریق ملی‌پیامک
 */
apiRouter.post('/auth/forgot-password/request-otp', async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || ''))
      .trim()
      .toLowerCase();

    if (!username) {
      res.status(400).json({
        ok: false,
        message: 'لطفاً ابتدا نام کاربری (مدیریت یا پرسنل) را انتخاب یا وارد کنید.',
      });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, username, full_name, role, phone_number, is_active FROM users WHERE LOWER(username) = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      res.status(404).json({
        ok: false,
        message: 'حساب کاربری مورد نظر یافت نشد.',
      });
      return;
    }

    const userRow = rows[0];
    const userKey = String(userRow.username).toLowerCase();
    const existingOtp = passwordResetOtpStore.get(userKey);
    const nowMs = Date.now();

    if (existingOtp && nowMs - existingOtp.lastSentAtMs < 60_000) {
      const waitSec = Math.ceil((60_000 - (nowMs - existingOtp.lastSentAtMs)) / 1000);
      res.status(429).json({
        ok: false,
        message: `کد بازیابی به تازگی ارسال شده است. لطفاً ${toPersianDigits(waitSec)} ثانیه دیگر مجدداً تلاش کنید.`,
      });
      return;
    }

    const settings = await getSystemSettingsFromDb();
    let targetPhone = normalizeIranMobile(userRow.phone_number);

    if (!targetPhone) {
      if (userRow.role === 'worker') {
        targetPhone = normalizeIranMobile(settings.worker_phone_number);
      } else if (userRow.role === 'manager') {
        targetPhone = normalizeIranMobile(settings.melipayamak_username);
      }
    }

    if (!targetPhone) {
      res.status(400).json({
        ok: false,
        message:
          userRow.role === 'worker'
            ? 'شماره موبایل پرسنل در سامانه ثبت نشده است. لطفاً از مدیر مجموعه (مجید نورایی) بخواهید از بخش تنظیمات حساب، رمز عبور شما را بازنشانی کند.'
            : 'شماره موبایل مدیریت در سامانه ثبت نشده است. لطفاً پس از ورود در بخش تنظیمات حساب، شماره موبایل خود را ثبت نمایید.',
      });
      return;
    }

    if (!settings.melipayamak_username || !settings.melipayamak_password) {
      res.status(400).json({
        ok: false,
        message:
          userRow.role === 'worker'
            ? 'تنظیمات وب‌سرویس پیامک (ملی‌پیامک) هنوز تکمیل نشده است. مدیر مجموعه (مجید نورایی) می‌تواند از پنل مدیریت رمز عبور شما را مستقیماً بازنشانی کند.'
            : 'اطلاعات وب‌سرویس ملی‌پیامک در تنظیمات سامانه ثبت نشده است.',
      });
      return;
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const smsText = `سامانه Mgammon\nکد بازیابی رمز عبور حساب ${userRow.full_name}: ${otpCode}\nاعتبار: ۲ دقیقه`;

    const smsResult = await sendMelipayamakSms(settings, targetPhone, smsText);
    if (!smsResult.sent) {
      res.status(502).json({
        ok: false,
        message: `خطا در ارسال پیامک کد بازیابی: ${smsResult.statusMessage}`,
      });
      return;
    }

    passwordResetOtpStore.set(userKey, {
      codeHash: hashSessionToken(otpCode),
      expiresAtMs: nowMs + 2 * 60 * 1000,
      attempts: 0,
      lastSentAtMs: nowMs,
    });

    await recordAuditLog({
      actorUserId: Number(userRow.id),
      actionType: 'PASSWORD_RESET_OTP_SENT',
      targetEntity: 'users',
      targetId: Number(userRow.id),
      ipAddress: req.ip || null,
    });

    res.json({
      ok: true,
      maskedPhone: toPersianDigits(maskMobileNumber(targetPhone)),
      expiresInSeconds: 120,
      message: `کد تایید ۶ رقمی به شماره موبایل ${toPersianDigits(maskMobileNumber(targetPhone))} پیامک شد.`,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * تایید کد پیامکی (OTP) و ثبت رمز عبور جدید
 */
apiRouter.post('/auth/forgot-password/reset', async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || ''))
      .trim()
      .toLowerCase();
    const otpCode = toEnglishDigits(String(req.body?.otpCode || req.body?.otp_code || ''))
      .replace(/\D/g, '')
      .trim();
    const newPassword = String(req.body?.newPassword || req.body?.new_password || '');

    if (!username || !otpCode || !newPassword) {
      res.status(400).json({
        ok: false,
        message: 'نام کاربری، کد تایید ۶ رقمی و رمز عبور جدید الزامی است.',
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        message: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.',
      });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_token_hash, is_active FROM users WHERE LOWER(username) = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      res.status(404).json({ ok: false, message: 'حساب کاربری معتبر نیست.' });
      return;
    }

    const userRow = rows[0];
    const userKey = String(userRow.username).toLowerCase();
    const otpEntry = passwordResetOtpStore.get(userKey);

    if (!otpEntry || Date.now() > otpEntry.expiresAtMs) {
      passwordResetOtpStore.delete(userKey);
      res.status(400).json({
        ok: false,
        message: 'کد بازیابی منقضی شده یا وجود ندارد. لطفاً مجدداً درخواست ارسال کد بدهید.',
      });
      return;
    }

    if (otpEntry.attempts >= 5) {
      passwordResetOtpStore.delete(userKey);
      res.status(429).json({
        ok: false,
        message: 'تعداد تلاش‌های اشتباه بیش از حد مجاز بود. لطفاً کد جدید دریافت کنید.',
      });
      return;
    }

    if (hashSessionToken(otpCode) !== otpEntry.codeHash) {
      otpEntry.attempts += 1;
      res.status(400).json({
        ok: false,
        message: 'کد تایید واردشده صحیح نیست.',
      });
      return;
    }

    passwordResetOtpStore.delete(userKey);

    const newHash = await bcrypt.hash(newPassword, 10);
    const userId = Number(userRow.id);
    await pool.execute(
      'UPDATE users SET password_hash = ?, must_change_password = 0, last_login_at = NOW() WHERE id = ?',
      [newHash, userId]
    );
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    clearLoginAttempts(req.ip || 'unknown', userKey);

    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      userId,
      req.ip || null,
      req.headers['user-agent'] || null
    );
    setSessionCookie(res, rawToken, expiresAt);

    await recordAuditLog({
      actorUserId: userId,
      actionType: 'PASSWORD_RESET_OTP_SUCCESS',
      targetEntity: 'users',
      targetId: userId,
      ipAddress: req.ip || null,
    });

    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      message: 'رمز عبور شما با موفقیت بازنشانی شد.',
      user: {
        id: userId,
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi
          ? String(userRow.collaboration_start_shamsi)
          : '1405/06/15',
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: Boolean(userRow.biometric_token_hash),
        must_change_password: false,
        last_login_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * بازنشانی مستقیم رمز عبور پرسنل (امید میثمی) توسط مدیر (مجید نورایی)
 */
apiRouter.post(
  '/auth/manager-reset-worker-password',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const newPassword = String(req.body?.newPassword || req.body?.new_password || '').trim();
      const sendSmsToWorker = Boolean(req.body?.sendSms);

      if (!newPassword || newPassword.length < 8) {
        res.status(400).json({
          ok: false,
          message: 'رمز عبور جدید پرسنل باید حداقل ۸ کاراکتر باشد.',
        });
        return;
      }

      const pool = getPool();
      const [workerRows] = await pool.execute<mysql.RowDataPacket[]>(
        "SELECT id, username, full_name, phone_number FROM users WHERE role = 'worker' LIMIT 1"
      );

      if (workerRows.length === 0) {
        res.status(404).json({ ok: false, message: 'حساب پرسنل یافت نشد.' });
        return;
      }

      const worker = workerRows[0];
      const workerId = Number(worker.id);
      const newHash = await bcrypt.hash(newPassword, 10);

      await pool.execute(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [newHash, workerId]
      );
      await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [workerId]);

      await recordAuditLog({
        actorUserId: req.user!.id,
        actionType: 'MANAGER_RESET_WORKER_PASSWORD',
        targetEntity: 'users',
        targetId: workerId,
        ipAddress: req.ip || null,
      });

      let smsStatusNote = '';
      if (sendSmsToWorker) {
        const settings = await getSystemSettingsFromDb();
        const targetPhone =
          normalizeIranMobile(worker.phone_number) ||
          normalizeIranMobile(settings.worker_phone_number);
        if (targetPhone && settings.melipayamak_username && settings.melipayamak_password) {
          const smsRes = await sendMelipayamakSms(
            settings,
            targetPhone,
            `سامانه Mgammon\nهمکار گرامی ${worker.full_name}، رمز عبور جدید شما توسط مدیریت تنظیم شد:\nنام کاربری: ${worker.username}\nرمز عبور: ${newPassword}`
          );
          smsStatusNote = smsRes.sent
            ? ' و از طریق پیامک برای ایشان ارسال شد.'
            : ` (ارسال پیامک انجام نشد: ${smsRes.statusMessage})`;
        } else {
          smsStatusNote = ' (شماره موبایل یا تنظیمات پیامک برای ارسال پیامک ثبت نشده است).';
        }
      }

      res.json({
        ok: true,
        message: `رمز عبور حساب پرسنل (${worker.full_name}) با موفقیت بازنشانی شد${smsStatusNote}`,
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۳. عملیات تردد پرسنل (امید میثمی) + وضعیت زنده و یادآور هوشمند فراموشی ثبت خروج
// ============================================================================
async function attachForgottenCheckoutWarning(
  pool: mysql.Pool,
  workerId: number,
  liveState: ReturnType<typeof evaluateWorkerLiveState>,
  settings: Awaited<ReturnType<typeof getSystemSettingsFromDb>>,
  nowInfo: ReturnType<typeof getNowInTimezone>
): Promise<void> {
  const isThursday = nowInfo.dayOfWeek === 4;
  const shiftEndTime = isThursday
    ? settings.thursday_shift_end_time || '14:00'
    : settings.shift_end_time || '15:00';

  const nowMins = parseTimeToMinutes(nowInfo.timeHHMM);
  const endMins = parseTimeToMinutes(shiftEndTime);

  // ۱. اگر امروز ورود ثبت شده اما ساعت از پایان شیفت گذشته و هنوز خروج ثبت نشده
  if (
    liveState.today_summary.logs.length > 0 &&
    liveState.today_summary.is_incomplete &&
    nowMins >= endMins + 15
  ) {
    liveState.forgotten_checkout_warning = true;
    liveState.forgotten_checkout_message = `یادآور: ساعت کاری امروز (${toPersianDigits(shiftEndTime)}) به پایان رسیده اما هنوز «پایان کار (خروج)» ثبت نشده است.`;
    return;
  }

  // ۲. بررسی روزهای کاری اخیر که ورود داشته‌اند اما خروج ثبت نشده است
  const [recentRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT work_date, shamsi_date, event_type
     FROM attendance_logs
     WHERE user_id = ? AND work_date < ? AND is_deleted = 0
     ORDER BY work_date DESC, recorded_time ASC, id ASC
     LIMIT 60`,
    [workerId, nowInfo.workDate]
  );

  const byDate = new Map<string, { shamsi: string; lastType: string }>();
  for (const r of recentRows) {
    const d = extractSqlDateString(r.work_date, r.shamsi_date);
    byDate.set(d, { shamsi: String(r.shamsi_date), lastType: String(r.event_type) });
  }

  for (const [, info] of byDate.entries()) {
    if (info.lastType !== 'WORK_END') {
      liveState.forgotten_checkout_warning = true;
      liveState.forgotten_checkout_message = `یادآور: در تاریخ ${toPersianDigits(info.shamsi)} تردد ورود ثبت شده اما «خروج» ثبت نگردیده است.`;
      return;
    }
  }
}

apiRouter.get('/attendance/live-status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerInfo = await getWorkerInfo(pool);
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM attendance_logs
       WHERE user_id = ? AND work_date = ? AND is_deleted = 0
       ORDER BY recorded_time ASC, id ASC`,
      [workerInfo.id, nowInfo.workDate]
    );

    const todayLogs = rows.map(mapRowToAttendanceLog);
    const liveState = evaluateWorkerLiveState(todayLogs, settings);
    liveState.worker_profile = {
      full_name: workerInfo.full_name,
      avatar_url: workerInfo.avatar_url,
      collaboration_start_shamsi:
        settings.collaboration_start_shamsi || workerInfo.collaboration_start_shamsi || '1405/06/15',
      phone_number: settings.worker_phone_number || workerInfo.phone_number,
    };

    await attachForgottenCheckoutWarning(pool, workerInfo.id, liveState, settings, nowInfo);

    const [unreadRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0',
      [req.user!.id]
    );
    const unreadMessagesCount = Number(unreadRows[0]?.cnt || 0);

    let latestUnreadMessage: {
      id: number;
      subject: string | null;
      message_text: string;
      sender_name: string;
      shamsi_date: string;
      recorded_time: string;
    } | null = null;

    if (unreadMessagesCount > 0) {
      const [latestMsgRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT c.id, c.subject, c.message_text, c.shamsi_date, c.recorded_time, u.full_name AS sender_name
         FROM work_correspondences c
         INNER JOIN users u ON u.id = c.sender_user_id
         WHERE c.receiver_user_id = ? AND c.is_read = 0
         ORDER BY c.id DESC
         LIMIT 1`,
        [req.user!.id]
      );
      if (latestMsgRows.length > 0) {
        const m = latestMsgRows[0];
        latestUnreadMessage = {
          id: Number(m.id),
          subject: m.subject ? String(m.subject) : null,
          message_text: String(m.message_text || ''),
          sender_name: String(m.sender_name || 'مدیریت'),
          shamsi_date: String(m.shamsi_date || ''),
          recorded_time: String(m.recorded_time || '').slice(0, 5),
        };
      }
    }

    // محاسبه خلاصه کارکرد و وضعیت مالی کل پرسنل تا امروز (بدهکار / بستانکار)
    const [allLogRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM attendance_logs
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY work_date DESC, recorded_time ASC, id ASC`,
      [workerInfo.id]
    );
    const allLogs = allLogRows.map(mapRowToAttendanceLog);
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of allLogs) {
      const list = byDate.get(log.work_date) || [];
      list.push(log);
      byDate.set(log.work_date, list);
    }

    let totalConfirmedNetWorkMinutes = 0;
    let totalConfirmedOvertimeMinutes = 0;
    let totalRecordedWorkDays = 0;

    for (const [workDate, dayLogs] of byDate.entries()) {
      const shamsiDate = dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate);
      const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
      const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
        isToday: workDate === nowInfo.workDate,
        currentTimeHHMM: nowInfo.timeHHMM,
      });
      if (!summary.is_incomplete && summary.logs.length > 0) {
        totalRecordedWorkDays += 1;
        totalConfirmedNetWorkMinutes += summary.net_work_minutes;
        totalConfirmedOvertimeMinutes += summary.overtime_minutes;
      }
    }

    const [histTotals] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN work_days_count ELSE 0 END), 0) AS hist_days,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN net_work_minutes ELSE 0 END), 0) AS hist_net_minutes,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN overtime_minutes ELSE 0 END), 0) AS hist_ot_minutes
       FROM historical_work_records
       WHERE user_id = ?`,
      [workerInfo.id]
    );

    totalRecordedWorkDays += Number(histTotals[0]?.hist_days || 0);
    totalConfirmedNetWorkMinutes += Number(histTotals[0]?.hist_net_minutes || 0);
    totalConfirmedOvertimeMinutes += Number(histTotals[0]?.hist_ot_minutes || 0);

    const [finTotals] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type != 'PETTY_CASH' THEN amount_toman ELSE 0 END), 0) AS approved_received_salary_advance,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type = 'PETTY_CASH' THEN amount_toman ELSE 0 END), 0) AS approved_petty_cash
       FROM financial_transactions
       WHERE user_id = ?`,
      [workerInfo.id]
    );

    const salaryCalc = calculateSalaryAndOvertimeRates(
      settings,
      totalConfirmedOvertimeMinutes
    );

    const approvedTotalToman = Number(finTotals[0]?.approved_total || 0);
    const approvedReceivedToman = Number(finTotals[0]?.approved_received_salary_advance || 0);
    const approvedPettyCashToman = Number(finTotals[0]?.approved_petty_cash || 0);
    const earnedRegularWorkToman = Math.round(
      (totalConfirmedNetWorkMinutes / 60) * salaryCalc.effectiveHourlyRateToman
    );
    const earnedOvertimeToman = salaryCalc.totalOvertimePayToman;
    const totalEntitlementToman =
      earnedRegularWorkToman + earnedOvertimeToman + approvedPettyCashToman;
    const accountBalanceToman = totalEntitlementToman - approvedReceivedToman;

    res.json({
      ok: true,
      serverTime: nowInfo,
      liveState,
      settings: sanitizeSettingsForRole(settings, req.user!.role),
      unreadMessagesCount,
      latestUnreadMessage,
      workerKpis: {
        totalWorkDays: totalRecordedWorkDays,
        totalNetWorkMinutes: totalConfirmedNetWorkMinutes,
        totalOvertimeMinutes: totalConfirmedOvertimeMinutes,
        approvedTotalToman,
        approvedReceivedToman,
        approvedPettyCashToman,
        earnedRegularWorkToman,
        earnedOvertimeToman,
        totalEntitlementToman,
        accountBalanceToman,
      },
      bannerBgUrl: settings.banner_bg_url || '/assets/media/banner-bg.svg',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post(
  '/attendance/clock',
  requireAuth,
  requireRole('worker'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const eventType = String(req.body?.event_type || '').trim() as AttendanceEventType;
      const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
      const validEvents: AttendanceEventType[] = [
        'WORK_START',
        'MISSION_START',
        'MISSION_END',
        'WORK_END',
      ];

      if (!validEvents.includes(eventType)) {
        res.status(400).json({
          ok: false,
          message: 'نوع عملیات تردد نامعتبر است.',
        });
        return;
      }

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const workerInfo = await getWorkerInfo(pool);
      const workerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [existingRows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND work_date = ? AND is_deleted = 0
         ORDER BY recorded_time ASC, id ASC
         FOR UPDATE`,
        [workerId, nowInfo.workDate]
      );

      const existingLogs = existingRows.map(mapRowToAttendanceLog);
      const validation = validateAttendanceSequence(existingLogs, eventType, nowInfo.timeHHMMSS);

      if (!validation.valid) {
        await conn.rollback();
        res.status(400).json({
          ok: false,
          code: 'INVALID_ATTENDANCE_TRANSITION',
          message: validation.error,
        });
        return;
      }

      const [insertResult] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO attendance_logs
          (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, is_deleted)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, 0, 0)`,
        [workerId, nowInfo.workDate, nowInfo.shamsiDate, eventType, nowInfo.timeHHMMSS, note]
      );

      await conn.commit();

      const [updatedRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND work_date = ? AND is_deleted = 0
         ORDER BY recorded_time ASC, id ASC`,
        [workerId, nowInfo.workDate]
      );

      const updatedLogs = updatedRows.map(mapRowToAttendanceLog);
      const liveState = evaluateWorkerLiveState(updatedLogs, settings);
      liveState.worker_profile = {
        full_name: workerInfo.full_name,
        avatar_url: workerInfo.avatar_url,
        collaboration_start_shamsi:
          settings.collaboration_start_shamsi || workerInfo.collaboration_start_shamsi,
        phone_number: settings.worker_phone_number || workerInfo.phone_number,
      };

      await attachForgottenCheckoutWarning(pool, workerInfo.id, liveState, settings, nowInfo);

      res.status(201).json({
        ok: true,
        logId: insertResult.insertId,
        message: 'عملیات تردد با موفقیت ثبت و تأیید شد.',
        liveState,
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

// ============================================================================
// ۴. مشاهده سوابق تردد + مرخصی‌ها + بارگذاری اکسل سوابق کاری قبلی
// ============================================================================
apiRouter.get('/attendance/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;
    const currentSettings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(currentSettings.timezone);

    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : null;
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : null;

    let sql = `SELECT * FROM attendance_logs WHERE user_id = ? AND is_deleted = 0`;
    const params: (string | number)[] = [workerId];

    if (fromShamsi) {
      sql += ` AND shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND shamsi_date <= ?`;
      params.push(toShamsi);
    }

    sql += ` ORDER BY work_date DESC, recorded_time ASC, id ASC LIMIT 600`;

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);
    const logs = rows.map(mapRowToAttendanceLog);

    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const list = byDate.get(log.work_date) || [];
      list.push(log);
      byDate.set(log.work_date, list);
    }

    const dailySummaries: DailyAttendanceSummary[] = [];
    for (const [workDate, dayLogs] of byDate.entries()) {
      const shamsiDate = dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate);
      const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
      const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
        isToday: workDate === nowInfo.workDate,
        currentTimeHHMM: nowInfo.timeHHMM,
      });
      dailySummaries.push(summary);
    }

    const [histRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT h.*, u.role AS creator_role
       FROM historical_work_records h
       LEFT JOIN users u ON u.id = h.created_by_user_id
       WHERE h.user_id = ?
       ORDER BY h.work_date DESC, h.id DESC`,
      [workerId]
    );
    const historicalRecords = histRows.map(mapRowToHistoricalWork);
    const mergedSummaries = mergeApprovedHistoricalIntoDailySummaries(
      dailySummaries,
      historicalRecords,
      fromShamsi,
      toShamsi
    );

    res.json({
      ok: true,
      dailySummaries: mergedSummaries,
      historicalRecords,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

// ============================================================================
// ۴-الف. مدیریت مرخصی‌های روزانه و ساعتی پرسنل + سقف و شمارنده مرخصی استحقاقی
// ============================================================================
async function computeLeaveQuotaSummary(
  pool: mysql.Pool,
  workerId: number,
  currentShamsiDate: string,
  monthlyQuotaDays = 2.5
): Promise<LeaveQuotaSummary> {
  const currentMonthPrefix = currentShamsiDate.slice(0, 7); // YYYY/MM
  const currentYearPrefix = currentShamsiDate.slice(0, 4); // YYYY

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT shamsi_date, duration_minutes, status
     FROM leave_requests
     WHERE user_id = ?`,
    [workerId]
  );

  let usedCurrentMonthMinutes = 0;
  let usedYearMinutes = 0;
  let pendingCount = 0;

  for (const r of rows) {
    const st = String(r.status);
    const sh = String(r.shamsi_date || '');
    const mins = Number(r.duration_minutes || 0);
    if (st === 'PENDING') {
      pendingCount += 1;
    } else if (st === 'APPROVED') {
      if (sh.startsWith(currentMonthPrefix)) {
        usedCurrentMonthMinutes += mins;
      }
      if (sh.startsWith(currentYearPrefix)) {
        usedYearMinutes += mins;
      }
    }
  }

  const monthlyQuotaMinutes = Math.round(monthlyQuotaDays * 480); // هر روز کاری معادل ۸ ساعت (۴۸۰ دقیقه)
  const remainingMonthMinutes = Math.max(0, monthlyQuotaMinutes - usedCurrentMonthMinutes);

  const formatDaysAndHours = (totalMins: number): string => {
    const days = Math.floor(totalMins / 480);
    const remMins = totalMins % 480;
    const hours = Math.floor(remMins / 60);
    const mins = remMins % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${toPersianDigits(days)} روز`);
    if (hours > 0) parts.push(`${toPersianDigits(hours)} ساعت`);
    if (mins > 0) parts.push(`${toPersianDigits(mins)} دقیقه`);
    return parts.length > 0 ? parts.join(' و ') : '۰ ساعت';
  };

  return {
    monthlyQuotaDays,
    monthlyQuotaMinutes,
    usedCurrentMonthMinutes,
    usedCurrentMonthDaysFormatted: formatDaysAndHours(usedCurrentMonthMinutes),
    remainingMonthMinutes,
    remainingMonthDaysFormatted: formatDaysAndHours(remainingMonthMinutes),
    usedYearMinutes,
    pendingCount,
  };
}

apiRouter.get('/leaves', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM leave_requests WHERE user_id = ? ORDER BY work_date DESC, id DESC LIMIT 200`,
      [workerId]
    );

    const leaveRequests = rows.map(mapRowToLeaveRequest);
    const quotaSummary = await computeLeaveQuotaSummary(
      pool,
      workerId,
      nowInfo.shamsiDate,
      settings.monthly_leave_quota_days || 2.5
    );

    res.json({
      ok: true,
      leaveRequests,
      quotaSummary,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/leaves', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;

    const shamsiRaw = String(req.body?.shamsi_date || '').trim();
    if (!isValidShamsiDate(shamsiRaw)) {
      res.status(400).json({ ok: false, message: 'تاریخ انتخاب‌شده معتبر نیست.' });
      return;
    }
    const shamsiDate = normalizeShamsiDate(shamsiRaw);
    const workDate = shamsiToGregorian(shamsiDate);
    const leaveType: LeaveType = req.body?.leave_type === 'HOURLY' ? 'HOURLY' : 'DAILY';
    const reason = String(req.body?.reason || '').trim();

    if (!reason || reason.length < 2) {
      res.status(400).json({ ok: false, message: 'لطفاً علت یا توضیح مرخصی را وارد کنید.' });
      return;
    }

    let startTime: string | null = null;
    let endTime: string | null = null;
    let durationMinutes = 480; // ۱ روز کاری کامل (۸ ساعت)

    if (leaveType === 'HOURLY') {
      startTime = toEnglishDigits(String(req.body?.start_time || '')).trim();
      endTime = toEnglishDigits(String(req.body?.end_time || '')).trim();
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        res.status(400).json({ ok: false, message: 'ساعت شروع و پایان مرخصی ساعتی را انتخاب کنید.' });
        return;
      }
      const sMins = parseTimeToMinutes(startTime);
      const eMins = parseTimeToMinutes(endTime);
      if (eMins <= sMins) {
        res.status(400).json({ ok: false, message: 'ساعت پایان مرخصی باید بعد از ساعت شروع باشد.' });
        return;
      }
      durationMinutes = eMins - sMins;
    }

    const isManager = req.user!.role === 'manager';
    const initialStatus: FinancialStatus = isManager ? 'APPROVED' : 'PENDING';
    const seenByManager = isManager ? 1 : 0;

    const [ins] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO leave_requests
        (user_id, shamsi_date, work_date, leave_type, start_time, end_time, duration_minutes, reason, status, is_seen_by_manager, reviewed_by_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        shamsiDate,
        workDate,
        leaveType,
        startTime,
        endTime,
        durationMinutes,
        reason,
        initialStatus,
        seenByManager,
        isManager ? req.user!.id : null,
        isManager ? new Date() : null,
      ]
    );

    res.status(201).json({
      ok: true,
      id: ins.insertId,
      message: isManager
        ? 'مرخصی با موفقیت ثبت و تأیید شد.'
        : 'درخواست مرخصی ثبت شد و برای تأیید مدیریت ارسال گردید.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post(
  '/leaves/:id/review',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leaveId = Number(req.params.id);
      const decision = String(req.body?.decision || '') as 'APPROVED' | 'REJECTED';
      const managerNote = req.body?.manager_note
        ? String(req.body.manager_note).trim().slice(0, 500)
        : null;

      if (!leaveId || !['APPROVED', 'REJECTED'].includes(decision)) {
        res.status(400).json({ ok: false, message: 'مشخصات بررسی درخواست مرخصی معتبر نیست.' });
        return;
      }

      const pool = getPool();
      await pool.execute(
        `UPDATE leave_requests
         SET status = ?, is_seen_by_manager = 1, manager_note = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [decision, managerNote, req.user!.id, leaveId]
      );

      res.json({
        ok: true,
        message:
          decision === 'APPROVED'
            ? 'درخواست مرخصی پرسنل تأیید شد و در سهمیه مرخصی محاسبه گردید.'
            : 'درخواست مرخصی رد شد.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

/**
 * دانلود فایل نمونه اکسل (.xlsx) برای وارد کردن ساعات کاری و اضافه‌کاری قبلی
 */
apiRouter.get('/historical-work/excel-template', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sampleData = [
      {
        'تاریخ': '1405/06/31',
        'عنوان دوره یا روز': 'کارکرد شهریور ۱۴۰۵',
        'تعداد روز کاری': 24,
        'ساعت کارکرد خالص': 176,
        'دقیقه کارکرد خالص': 0,
        'ساعت اضافه کاری': 18,
        'دقیقه اضافه کاری': 30,
        'توضیحات': 'ثبت تجمیعی شهریور ماه',
      },
      {
        'تاریخ': '1405/07/15',
        'عنوان دوره یا روز': 'نیمه اول مهر ۱۴۰۵',
        'تعداد روز کاری': 12,
        'ساعت کارکرد خالص': 88,
        'دقیقه کارکرد خالص': 15,
        'ساعت اضافه کاری': 9,
        'دقیقه اضافه کاری': 45,
        'توضیحات': 'پروژه اجرایی مهر',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'سوابق کارکرد');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="mgammon-work-history-template.xlsx"'
    );
    res.send(buffer);
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/historical-work/upload-excel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const pool = getPool();
  let conn: mysql.PoolConnection | null = null;
  try {
    const fileName = String(req.body?.file_name || 'work-history.xlsx').trim();
    const fileBase64 = String(req.body?.file_base64 || '').trim();
    const fallbackTitle = String(req.body?.title || '').trim() || `فایل اکسل: ${fileName}`;
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

    if (!fileBase64) {
      res.status(400).json({ ok: false, message: 'فایل اکسل انتخاب نشده است.' });
      return;
    }

    if (
      fileName.includes('..') ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      fileName.includes('\0') ||
      !/\.(xlsx|xls)$/i.test(fileName)
    ) {
      res.status(400).json({ ok: false, message: 'نام یا پسوند فایل اکسل معتبر نیست (فقط .xlsx یا .xls مجاز است).' });
      return;
    }

    const cleanBase64 = (fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64).trim();
    if (!cleanBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
      res.status(400).json({ ok: false, message: 'محتوای فایل اکسل نامعتبر است.' });
      return;
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length > 2 * 1024 * 1024) {
      res.status(413).json({
        ok: false,
        code: 'FILE_TOO_LARGE',
        message: 'حجم فایل اکسل نباید بیشتر از ۲ مگابایت باشد.',
      });
      return;
    }

    const sig = detectFileSignature(buffer);
    if (sig !== 'xlsx' && sig !== 'xls') {
      res.status(400).json({
        ok: false,
        code: 'INVALID_EXCEL_SIGNATURE',
        message: 'فایل بارگذاری‌شده یک فایل اکسل واقعی و معتبر نیست.',
      });
      return;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellFormula: false,
        cellHTML: false,
      });
    } catch {
      res.status(400).json({ ok: false, message: 'فایل اکسل خراب یا غیرقابل خواندن است.' });
      return;
    }

    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) {
      res.status(400).json({ ok: false, message: 'فایل اکسل معتبر نیست یا برگه (Sheet) ندارد.' });
      return;
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    if (rawRows.length === 0) {
      res.status(400).json({ ok: false, message: 'فایل اکسل خالی است و هیچ ردیف داده‌ای ندارد.' });
      return;
    }

    if (rawRows.length > 500) {
      res.status(400).json({
        ok: false,
        message: 'تعداد ردیف‌های فایل اکسل بیش از حد مجاز (حداکثر ۵۰۰ ردیف) است.',
      });
      return;
    }

    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);

    const parsedRows: HistoricalWorkRowItem[] = [];
    let totalDays = 0;
    let totalNetMinutes = 0;
    let totalOtMinutes = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const rawDate = toEnglishDigits(
        String(
          r['تاریخ شمسی'] ||
            r['تاریخ'] ||
            r['jalali_date'] ||
            r['date'] ||
            r['shamsi_date'] ||
            nowInfo.shamsiDate
        )
      ).trim();
      const rowShamsi = isValidShamsiDate(rawDate)
        ? normalizeShamsiDate(rawDate)
        : nowInfo.shamsiDate;

      const checkInRaw = toEnglishDigits(
        String(r['ساعت ورود'] || r['ورود'] || r['check_in'] || '')
      ).trim();
      const checkOutRaw = toEnglishDigits(
        String(r['ساعت خروج'] || r['خروج'] || r['check_out'] || '')
      ).trim();
      const checkIn = /^\d{1,2}:\d{2}$/.test(checkInRaw)
        ? checkInRaw.padStart(5, '0')
        : undefined;
      const checkOut = /^\d{1,2}:\d{2}$/.test(checkOutRaw)
        ? checkOutRaw.padStart(5, '0')
        : undefined;

      const rowTitle = String(
        r['عنوان دوره یا روز'] ||
          r['عنوان'] ||
          r['شرح'] ||
          r['title'] ||
          `کارکرد روزانه ${rowShamsi}`
      ).trim();

      const days = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r['تعداد روز کاری'] ?? r['روز کاری'] ?? r['روز'] ?? r['days'] ?? 1)
          )
        ) || 0
      );

      const netH = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(
              r['ساعت کارکرد خالص'] ??
                r['ساعت کارکرد'] ??
                r['ساعت کاری'] ??
                r['work_hours'] ??
                r['hours'] ??
                0
            )
          )
        ) || 0
      );
      const netM = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(
              r['دقیقه کارکرد خالص'] ?? r['دقیقه کارکرد'] ?? r['دقیقه کاری'] ?? r['work_minutes'] ?? 0
            )
          )
        ) || 0
      );

      const otH = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r['ساعت اضافه کاری'] ?? r['ساعت اضافه‌کاری'] ?? r['اضافه کاری'] ?? r['overtime_hours'] ?? 0)
          )
        ) || 0
      );
      const otM = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r['دقیقه اضافه کاری'] ?? r['دقیقه اضافه‌کاری'] ?? r['overtime_minutes'] ?? 0)
          )
        ) || 0
      );

      let rowNetMins = Math.round(netH * 60 + netM);
      const rowOtMins = Math.round(otH * 60 + otM);

      // اگر فایل اکسل دارای ستون ساعت ورود و خروج (check_in / check_out) باشد و ساعت کارکرد خالص مستقیماً درج نشده باشد:
      if (rowNetMins === 0 && checkIn && checkOut) {
        const inM = parseTimeToMinutes(checkIn);
        const outM = parseTimeToMinutes(checkOut);
        if (outM > inM) {
          const totalPresence = outM - inM;
          rowNetMins = Math.max(0, totalPresence - rowOtMins);
        }
      }

      const rowNote = String(r['توضیحات'] || r['notes'] || r['note'] || '').trim() || undefined;

      if (rowNetMins > 0 || rowOtMins > 0 || days > 0) {
        parsedRows.push({
          shamsi_date: rowShamsi,
          title: rowTitle,
          work_days_count: days,
          net_work_minutes: rowNetMins,
          overtime_minutes: rowOtMins,
          check_in: checkIn,
          check_out: checkOut,
          note: rowNote,
        });
        totalDays += days;
        totalNetMinutes += rowNetMins;
        totalOtMinutes += rowOtMins;
      }
    }

    if (parsedRows.length === 0 || (totalNetMinutes === 0 && totalOtMinutes === 0)) {
      res.status(400).json({
        ok: false,
        message:
          'مقادیر ساعت کارکرد یا اضافه‌کاری در فایل اکسل یافت نشد. لطفاً از عناوین ستون‌های استاندارد یا فایل نمونه استفاده کنید.',
      });
      return;
    }

    const savedFile = saveBase64MediaFile('excel', fileName, fileBase64);
    const shamsiDate = parsedRows[0]?.shamsi_date || nowInfo.shamsiDate;
    const workDate = shamsiToGregorian(shamsiDate);
    const workerId = await getWorkerUserId(pool);

    const isManager = req.user!.role === 'manager';
    const initialStatus: FinancialStatus = isManager ? 'APPROVED' : 'PENDING';
    const seenByManager = isManager ? 1 : 0;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // جلوگیری از ثبت تکراری در صورت بارگذاری مجدد همان بازه زمانی اکسل
    const [existingDup] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, status FROM historical_work_records
       WHERE user_id = ? AND shamsi_date = ? AND work_days_count = ? AND parsed_rows_json IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [workerId, shamsiDate, totalDays]
    );

    let recordId = 0;
    if (existingDup.length > 0) {
      recordId = Number(existingDup[0].id);
      const effectiveStatus: FinancialStatus =
        isManager || existingDup[0].status === 'APPROVED' ? 'APPROVED' : initialStatus;
      await conn.execute(
        `UPDATE historical_work_records
         SET title = ?, net_work_minutes = ?, overtime_minutes = ?, note = ?, status = ?,
             excel_file_url = ?, excel_file_name = ?, parsed_rows_json = ?, is_seen_by_manager = ?
         WHERE id = ?`,
        [
          fallbackTitle,
          totalNetMinutes,
          totalOtMinutes,
          note,
          effectiveStatus,
          savedFile.publicUrl,
          fileName,
          JSON.stringify(parsedRows),
          seenByManager,
          recordId,
        ]
      );
    } else {
      const [ins] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO historical_work_records
          (user_id, shamsi_date, work_date, title, work_days_count, net_work_minutes, overtime_minutes, note, status, excel_file_url, excel_file_name, parsed_rows_json, is_seen_by_manager, created_by_user_id, reviewed_by_user_id, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workerId,
          shamsiDate,
          workDate,
          fallbackTitle,
          totalDays,
          totalNetMinutes,
          totalOtMinutes,
          note,
          initialStatus,
          savedFile.publicUrl,
          fileName,
          JSON.stringify(parsedRows),
          seenByManager,
          req.user!.id,
          isManager ? req.user!.id : null,
          isManager ? new Date() : null,
        ]
      );
      recordId = ins.insertId;
    }

    await conn.commit();

    res.status(201).json({
      ok: true,
      id: recordId,
      parsedCount: parsedRows.length,
      message: isManager
        ? `فایل اکسل (${parsedRows.length} روز کاری) با موفقیت ثبت و در تقویم کارکرد و کل محاسبات لحاظ شد.`
        : `فایل اکسل (${parsedRows.length} روز کاری) بارگذاری شد و پس از تأیید مدیریت به کل محاسبات اضافه خواهد شد.`,
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    handleServerError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

apiRouter.post('/historical-work', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const pool = getPool();
  let conn: mysql.PoolConnection | null = null;
  try {
    const shamsiRaw = String(req.body?.shamsi_date || '').trim();
    if (!isValidShamsiDate(shamsiRaw)) {
      res.status(400).json({ ok: false, message: 'تاریخ انتخاب‌شده معتبر نیست.' });
      return;
    }
    const shamsiDate = normalizeShamsiDate(shamsiRaw);
    const workDate = shamsiToGregorian(shamsiDate);
    const title = String(req.body?.title || '').trim();
    const workDaysCount = Math.max(0, Number(toEnglishDigits(String(req.body?.work_days_count ?? 1))));
    const netWorkHours = Math.max(0, Number(toEnglishDigits(String(req.body?.net_work_hours ?? 0))));
    const netWorkExtraMins = Math.max(0, Number(toEnglishDigits(String(req.body?.net_work_minutes_part ?? 0))));
    const overtimeHours = Math.max(0, Number(toEnglishDigits(String(req.body?.overtime_hours ?? 0))));
    const overtimeExtraMins = Math.max(0, Number(toEnglishDigits(String(req.body?.overtime_minutes_part ?? 0))));
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

    if (!title) {
      res.status(400).json({ ok: false, message: 'عنوان سابقه کاری قبلی الزامی است.' });
      return;
    }

    const totalNetWorkMinutes = Math.round(netWorkHours * 60 + netWorkExtraMins);
    const totalOvertimeMinutes = Math.round(overtimeHours * 60 + overtimeExtraMins);

    if (totalNetWorkMinutes === 0 && totalOvertimeMinutes === 0) {
      res.status(400).json({
        ok: false,
        message: 'حداقل یکی از مقادیر ساعات کاری یا اضافه‌کاری باید بیشتر از صفر باشد.',
      });
      return;
    }

    const workerId = await getWorkerUserId(pool);
    const isManager = req.user!.role === 'manager';
    const initialStatus: FinancialStatus = isManager ? 'APPROVED' : 'PENDING';
    const seenByManager = isManager ? 1 : 0;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [ins] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO historical_work_records
        (user_id, shamsi_date, work_date, title, work_days_count, net_work_minutes, overtime_minutes, note, status, is_seen_by_manager, created_by_user_id, reviewed_by_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        shamsiDate,
        workDate,
        title,
        workDaysCount,
        totalNetWorkMinutes,
        totalOvertimeMinutes,
        note,
        initialStatus,
        seenByManager,
        req.user!.id,
        isManager ? req.user!.id : null,
        isManager ? new Date() : null,
      ]
    );

    await conn.commit();
    res.status(201).json({
      ok: true,
      id: ins.insertId,
      status: initialStatus,
      message: isManager
        ? 'سابقه کارکرد و اضافه‌کاری قبلی با موفقیت ثبت و به مجموع کل اضافه شد.'
        : 'سابقه کارکرد قبلی ثبت شد و پس از تأیید مدیریت به کل محاسبات اضافه می‌گردد.',
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    handleServerError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

apiRouter.post(
  '/historical-work/:id/review',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const recordId = Number(req.params.id);
      const decision = String(req.body?.decision || '') as 'APPROVED' | 'REJECTED';
      if (!recordId || !['APPROVED', 'REJECTED'].includes(decision)) {
        res.status(400).json({ ok: false, message: 'پارامترهای بررسی معتبر نیستند.' });
        return;
      }

      const pool = getPool();
      await pool.execute(
        `UPDATE historical_work_records
         SET status = ?, is_seen_by_manager = 1, reviewed_by_user_id = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [decision, req.user!.id, recordId]
      );

      res.json({
        ok: true,
        message:
          decision === 'APPROVED'
            ? 'سابقه کارکرد / فایل اکسل تأیید شد و به کل محاسبات کارکرد و اضافه‌کاری اضافه گردید.'
            : 'سابقه کارکرد رد شد.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

apiRouter.delete(
  '/historical-work/:id',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    try {
      const recordId = Number(req.params.id);
      if (!recordId) {
        res.status(400).json({ ok: false, message: 'شناسه رکورد نامعتبر است.' });
        return;
      }
      await pool.execute('DELETE FROM historical_work_records WHERE id = ?', [recordId]);
      res.json({ ok: true, message: 'سابقه کارکرد قبلی حذف شد.' });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

apiRouter.post(
  '/attendance/manager-override',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const action = String(req.body?.action || '');
      const reason = String(req.body?.reason || '').trim() || 'اصلاح توسط مدیریت';

      const workerId = await getWorkerUserId(pool);
      const managerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      if (action === 'ADD') {
        const shamsiDateRaw = String(req.body?.shamsi_date || '');
        if (!isValidShamsiDate(shamsiDateRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: 'تاریخ واردشده معتبر نیست.' });
          return;
        }
        const shamsiDate = normalizeShamsiDate(shamsiDateRaw);
        const workDate = shamsiToGregorian(shamsiDate);
        const eventType = String(req.body?.event_type || '') as AttendanceEventType;
        const recordedTimeRaw = toEnglishDigits(String(req.body?.recorded_time || '')).trim();
        const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(recordedTimeRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: 'فرمت ساعت باید HH:MM باشد.' });
          return;
        }
        const recordedTime = recordedTimeRaw.length === 5 ? `${recordedTimeRaw}:00` : recordedTimeRaw;

        const [dayRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [workerId, workDate]
        );

        const simulatedLogs = [
          ...dayRows.map((r) => ({
            event_type: r.event_type as AttendanceEventType,
            recorded_time: String(r.recorded_time),
          })),
          { event_type: eventType, recorded_time: recordedTime },
        ];

        const seqCheck = validateFullDayLogSequence(simulatedLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: seqCheck.error,
          });
          return;
        }

        const recordedAt = `${workDate} ${recordedTime}`;
        const [insLog] = await conn.execute<mysql.ResultSetHeader>(
          `INSERT INTO attendance_logs
            (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, modified_by_user_id, modification_reason, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
          [workerId, workDate, shamsiDate, eventType, recordedAt, recordedTime, note, managerId, reason]
        );

        await recordAuditLog({
          actorUserId: managerId,
          actionType: 'ATTENDANCE_OVERRIDE',
          targetEntity: 'attendance_logs',
          targetId: insLog.insertId,
          afterState: { action: 'ADD', shamsi_date: shamsiDate, event_type: eventType, recorded_time: recordedTime },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.status(201).json({
          ok: true,
          message: 'رکورد تردد با موفقیت اضافه شد.',
        });
        return;
      }

      if (action === 'UPDATE') {
        const logId = Number(req.body?.log_id);
        const newTimeRaw = toEnglishDigits(String(req.body?.recorded_time || '')).trim();
        const newEventType = String(req.body?.event_type || '') as AttendanceEventType;

        if (!logId || !/^\d{2}:\d{2}(:\d{2})?$/.test(newTimeRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: 'شناسه رکورد و ساعت معتبر الزامی است.' });
          return;
        }
        const recordedTime = newTimeRaw.length === 5 ? `${newTimeRaw}:00` : newTimeRaw;

        const [targetRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT * FROM attendance_logs WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
          [logId]
        );
        if (targetRows.length === 0) {
          await conn.rollback();
          res.status(404).json({ ok: false, message: 'رکورد تردد یافت نشد.' });
          return;
        }

        const targetLog = mapRowToAttendanceLog(targetRows[0]);
        const [dayRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [targetLog.user_id, targetLog.work_date]
        );

        const simulatedLogs = dayRows.map((r) =>
          Number(r.id) === logId
            ? { event_type: newEventType, recorded_time: recordedTime }
            : { event_type: r.event_type as AttendanceEventType, recorded_time: String(r.recorded_time) }
        );

        const seqCheck = validateFullDayLogSequence(simulatedLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: seqCheck.error });
          return;
        }

        const recordedAt = `${targetLog.work_date} ${recordedTime}`;
        await conn.execute(
          `UPDATE attendance_logs
           SET event_type = ?, recorded_time = ?, recorded_at = ?, is_manual_override = 1, modified_by_user_id = ?, modification_reason = ?
           WHERE id = ?`,
          [newEventType, recordedTime, recordedAt, managerId, reason, logId]
        );

        await recordAuditLog({
          actorUserId: managerId,
          actionType: 'ATTENDANCE_OVERRIDE',
          targetEntity: 'attendance_logs',
          targetId: logId,
          beforeState: { event_type: targetLog.event_type, recorded_time: targetLog.recorded_time },
          afterState: { event_type: newEventType, recorded_time: recordedTime },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.json({
          ok: true,
          message: 'اصلاح تردد با موفقیت انجام شد.',
        });
        return;
      }

      if (action === 'DELETE') {
        const logId = Number(req.body?.log_id);
        const [targetRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT * FROM attendance_logs WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
          [logId]
        );
        if (targetRows.length === 0) {
          await conn.rollback();
          res.status(404).json({ ok: false, message: 'رکورد تردد یافت نشد.' });
          return;
        }

        const targetLog = mapRowToAttendanceLog(targetRows[0]);
        const [dayRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [targetLog.user_id, targetLog.work_date]
        );

        const remainingLogs = dayRows
          .filter((r) => Number(r.id) !== logId)
          .map((r) => ({
            event_type: r.event_type as AttendanceEventType,
            recorded_time: String(r.recorded_time),
          }));

        const seqCheck = validateFullDayLogSequence(remainingLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: `حذف این رکورد موجب ناسازگاری توالی ترددهای روز می‌شود: ${seqCheck.error}`,
          });
          return;
        }

        await conn.execute(
          `UPDATE attendance_logs
           SET is_deleted = 1, is_manual_override = 1, modified_by_user_id = ?, modification_reason = ?
           WHERE id = ?`,
          [managerId, reason, logId]
        );

        await recordAuditLog({
          actorUserId: managerId,
          actionType: 'ATTENDANCE_OVERRIDE',
          targetEntity: 'attendance_logs',
          targetId: logId,
          beforeState: { event_type: targetLog.event_type, recorded_time: targetLog.recorded_time },
          afterState: { is_deleted: true },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.json({
          ok: true,
          message: 'رکورد تردد حذف شد.',
        });
        return;
      }

      await conn.rollback();
      res.status(400).json({ ok: false, message: 'نوع عملیات اصلاح نامعتبر است.' });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

// ============================================================================
// ۵. گزارش‌های کار روزانه (همراه با تصویر کار انجام‌شده) + چک‌لیست وظایف روزانه
// ============================================================================
apiRouter.get('/reports', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;

    const search = req.query.search ? String(req.query.search).trim() : '';
    const shamsiDate = req.query.shamsiDate ? normalizeShamsiDate(String(req.query.shamsiDate)) : '';
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : '';
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : '';

    let sql = `SELECT * FROM daily_work_reports WHERE user_id = ?`;
    const params: (string | number)[] = [workerId];

    if (shamsiDate) {
      sql += ` AND shamsi_date = ?`;
      params.push(shamsiDate);
    }
    if (fromShamsi) {
      sql += ` AND shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (search) {
      sql += ` AND activity_description LIKE ?`;
      params.push(`%${search}%`);
    }

    sql += ` ORDER BY report_date DESC, id DESC LIMIT 300`;

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);
    const reports: DailyWorkReport[] = rows.map((r) => ({
      id: Number(r.id),
      user_id: Number(r.user_id),
      report_date: extractSqlDateString(r.report_date, r.shamsi_date),
      shamsi_date: String(r.shamsi_date),
      activity_description: String(r.activity_description),
      duration_minutes: r.duration_minutes !== null ? Number(r.duration_minutes) : null,
      photo_url: r.photo_url ? String(r.photo_url) : null,
      photo_name: r.photo_name ? String(r.photo_name) : null,
      recorded_time: String(r.recorded_time),
      is_seen_by_manager: Boolean(r.is_seen_by_manager),
      created_at: r.created_at ? rowCreatedAt(r) : '',
    }));

    res.json({ ok: true, reports });
  } catch (err) {
    handleServerError(res, err);
  }
});

function rowCreatedAt(r: mysql.RowDataPacket): string {
  return r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString();
}

apiRouter.post(
  '/reports',
  requireAuth,
  requireRole('worker'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const description = String(req.body?.activity_description || '').trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : '';
      const durationRaw = req.body?.duration_minutes;
      const photoBase64 = req.body?.photo_base64 ? String(req.body.photo_base64) : null;
      const photoName = req.body?.photo_name ? String(req.body.photo_name) : 'work-photo.jpg';

      if (!description || description.length < 3) {
        res.status(400).json({
          ok: false,
          message: 'شرح فعالیت گزارش روزانه الزامی است.',
        });
        return;
      }

      let durationMinutes: number | null = null;
      if (durationRaw !== undefined && durationRaw !== null && String(durationRaw).trim() !== '') {
        const parsed = Number(toEnglishDigits(String(durationRaw)));
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 1440) {
          res.status(400).json({
            ok: false,
            message: 'مدت زمان صرف‌شده باید عددی بین ۱ تا ۱۴۴۰ دقیقه باشد.',
          });
          return;
        }
        durationMinutes = Math.round(parsed);
      }

      let savedPhotoUrl: string | null = null;
      if (photoBase64 && photoBase64.trim() !== '') {
        const saved = saveBase64MediaFile('reports', photoName, photoBase64);
        savedPhotoUrl = saved.publicUrl;
      }

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);

      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const reportDate = shamsiToGregorian(shamsiDate);

      const pool = getPool();
      const [result] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO daily_work_reports
          (user_id, report_date, shamsi_date, activity_description, duration_minutes, photo_url, photo_name, recorded_time, is_seen_by_manager)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          req.user!.id,
          reportDate,
          shamsiDate,
          description,
          durationMinutes,
          savedPhotoUrl,
          savedPhotoUrl ? photoName : null,
          nowInfo.timeHHMMSS,
        ]
      );

      res.status(201).json({
        ok: true,
        reportId: result.insertId,
        message: 'گزارش کار روزانه با موفقیت ثبت و برای مدیریت ارسال شد.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۵-الف. چک‌لیست کارهای روزانه (وظایف محول‌شده از طرف مدیر)
// ============================================================================
apiRouter.get('/tasks', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;
    const shamsiDate = req.query.shamsiDate ? normalizeShamsiDate(String(req.query.shamsiDate)) : '';

    let sql = 'SELECT * FROM work_tasks WHERE user_id = ?';
    const params: (string | number)[] = [workerId];

    if (shamsiDate) {
      sql += ' AND shamsi_date = ?';
      params.push(shamsiDate);
    }

    sql += ' ORDER BY is_completed ASC, id DESC LIMIT 150';

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);
    res.json({
      ok: true,
      tasks: rows.map(mapRowToWorkTask),
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/tasks', requireAuth, requireRole('manager'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const title = String(req.body?.title || '').trim();
    const description = req.body?.description ? String(req.body.description).trim().slice(0, 500) : null;
    const shamsiRaw = String(req.body?.shamsi_date || '').trim();

    if (!title) {
      res.status(400).json({ ok: false, message: 'عنوان وظیفه / کار الزامی است.' });
      return;
    }

    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const shamsiDate = shamsiRaw && isValidShamsiDate(shamsiRaw) ? normalizeShamsiDate(shamsiRaw) : nowInfo.shamsiDate;

    const pool = getPool();
    const workerId = await getWorkerUserId(pool);

    const [ins] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO work_tasks (user_id, created_by_user_id, shamsi_date, title, description, is_completed, added_to_report)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [workerId, req.user!.id, shamsiDate, title, description]
    );

    res.status(201).json({
      ok: true,
      id: ins.insertId,
      message: 'وظیفه کاری جدید به چک‌لیست پرسنل اضافه شد.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.patch('/tasks/:id/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) {
      res.status(400).json({ ok: false, message: 'شناسه کار معتبر نیست.' });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT * FROM work_tasks WHERE id = ? LIMIT 1',
      [taskId]
    );
    if (rows.length === 0) {
      res.status(404).json({ ok: false, message: 'مورد کاری یافت نشد.' });
      return;
    }

    if (req.user!.role !== 'manager' && Number(rows[0].user_id) !== req.user!.id) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'شما مجوز تغییر وظیفه کاربر دیگر را ندارید.',
      });
      return;
    }

    const currentCompleted = Boolean(rows[0].is_completed);
    const nextCompleted = req.body?.is_completed !== undefined ? Boolean(req.body.is_completed) : !currentCompleted;
    const addedToReport = req.body?.added_to_report !== undefined ? Boolean(req.body.added_to_report) : Boolean(rows[0].added_to_report);

    await pool.execute(
      `UPDATE work_tasks
       SET is_completed = ?, completed_at = ?, added_to_report = ?
       WHERE id = ?`,
      [nextCompleted ? 1 : 0, nextCompleted ? new Date() : null, addedToReport ? 1 : 0, taskId]
    );

    res.json({
      ok: true,
      is_completed: nextCompleted,
      message: nextCompleted ? 'انجام کار ثبت شد.' : 'وضعیت کار به حالت در انتظار تغییر یافت.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.delete('/tasks/:id', requireAuth, requireRole('manager'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const taskId = Number(req.params.id);
    const pool = getPool();
    await pool.execute('DELETE FROM work_tasks WHERE id = ?', [taskId]);
    res.json({ ok: true, message: 'مورد کاری از چک‌لیست حذف شد.' });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * ثبت رؤیت گزارش‌ها یا درخواست‌ها توسط مدیر
 */
apiRouter.post(
  '/manager/mark-seen',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const section = String(req.body?.section || '');
      const pool = getPool();
      if (section === 'reports') {
        await pool.execute('UPDATE daily_work_reports SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0');
      } else if (section === 'finance') {
        await pool.execute('UPDATE financial_transactions SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0');
      } else if (section === 'historical') {
        await pool.execute('UPDATE historical_work_records SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0');
      } else if (section === 'leaves') {
        await pool.execute('UPDATE leave_requests SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0');
      }
      res.json({ ok: true });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۶. امور مالی، مساعده، و هزینه‌های تنخواه / خریدهای کارگاهی توسط پرسنل
// ============================================================================
apiRouter.get('/finance', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await resolveTargetWorkerId(pool, req, res);
    if (workerId === null) return;

    const statusFilter = req.query.status ? String(req.query.status).trim() : '';
    const typeFilter = req.query.txType ? String(req.query.txType).trim() : '';
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : '';
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : '';
    const search = req.query.search ? String(req.query.search).trim() : '';

    let sql = `
      SELECT f.*, u.role AS creator_role, u.full_name AS creator_name
      FROM financial_transactions f
      INNER JOIN users u ON u.id = f.created_by_user_id
      WHERE f.user_id = ?
    `;
    const params: (string | number)[] = [workerId];

    if (statusFilter && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter)) {
      sql += ` AND f.status = ?`;
      params.push(statusFilter);
    }
    if (typeFilter && ['ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER'].includes(typeFilter)) {
      sql += ` AND f.tx_type = ?`;
      params.push(typeFilter);
    }
    if (fromShamsi) {
      sql += ` AND f.shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND f.shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (search) {
      sql += ` AND (f.description LIKE ? OR f.manager_note LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY f.tx_date DESC, f.id DESC LIMIT 400`;

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);
    const transactions = rows.map(mapRowToFinancialTx);

    const [totalsRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type = 'PETTY_CASH' THEN amount_toman ELSE 0 END), 0) AS approved_petty_cash_total,
         COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count
       FROM financial_transactions
       WHERE user_id = ?`,
      [workerId]
    );

    res.json({
      ok: true,
      transactions,
      summary: {
        approvedTotalToman: Number(totalsRows[0]?.approved_total || 0),
        pendingTotalToman: Number(totalsRows[0]?.pending_total || 0),
        approvedPettyCashToman: Number(totalsRows[0]?.approved_petty_cash_total || 0),
        pendingCount: Number(totalsRows[0]?.pending_count || 0),
      },
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post(
  '/finance/worker-request',
  requireAuth,
  requireRole('worker'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || '')).replace(/,/g, '').trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || '') as FinancialTxType;
      const description = String(req.body?.description || '').trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : '';
      const receiptBase64 = req.body?.receipt_base64 ? String(req.body.receipt_base64) : null;
      const receiptFileName = req.body?.receipt_file_name ? String(req.body.receipt_file_name) : 'receipt.jpg';
      const idempotencyKey = req.body?.idempotency_key
        ? String(req.body.idempotency_key).trim().slice(0, 64)
        : null;

      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({
          ok: false,
          message: 'مبلغ باید یک عدد صحیح مثبت به تومان باشد.',
        });
        return;
      }

      const validTypes: FinancialTxType[] = ['ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER'];
      if (!validTypes.includes(txType)) {
        res.status(400).json({
          ok: false,
          message: 'نوع درخواست مالی نامعتبر است.',
        });
        return;
      }

      if (!description || description.length < 2) {
        res.status(400).json({
          ok: false,
          message: 'ثبت شرح و جزئیات الزامی است.',
        });
        return;
      }

      let savedReceiptUrl: string | null = null;
      if (receiptBase64 && receiptBase64.trim() !== '') {
        const saved = saveBase64MediaFile('receipts', receiptFileName, receiptBase64);
        savedReceiptUrl = saved.publicUrl;
      }

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);

      const pool = getPool();
      const workerId = req.user!.id;

      const [result] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, receipt_file_url, receipt_file_name, status, is_seen_by_manager, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
        [
          workerId,
          workerId,
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          savedReceiptUrl,
          savedReceiptUrl ? receiptFileName : null,
          idempotencyKey,
        ]
      );

      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message:
          txType === 'PETTY_CASH'
            ? 'هزینه تنخواه / خرید کارگاهی ثبت شد و برای تأیید مدیریت ارسال گردید.'
            : 'درخواست مالی ثبت شد و در انتظار تأیید مدیریت قرار گرفت.',
      });
    } catch (err) {
      const errObj = err as { code?: string };
      if (errObj?.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          ok: false,
          message: 'این درخواست قبلاً ثبت شده است.',
        });
        return;
      }
      handleServerError(res, err);
    }
  }
);

apiRouter.post(
  '/finance/manager-direct',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || '')).replace(/,/g, '').trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || '') as FinancialTxType;
      const description = String(req.body?.description || '').trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : '';
      const receiptBase64 = req.body?.receipt_base64 ? String(req.body.receipt_base64) : null;
      const receiptFileName = req.body?.receipt_file_name ? String(req.body.receipt_file_name) : 'receipt.jpg';
      const idempotencyKey = req.body?.idempotency_key
        ? String(req.body.idempotency_key).trim().slice(0, 64)
        : null;

      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({ ok: false, message: 'مبلغ پرداخت باید یک عدد صحیح مثبت به تومان باشد.' });
        return;
      }

      const validTypes: FinancialTxType[] = ['ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER'];
      if (!validTypes.includes(txType)) {
        res.status(400).json({ ok: false, message: 'نوع پرداخت معتبر نیست.' });
        return;
      }

      if (!description) {
        res.status(400).json({ ok: false, message: 'ثبت شرح پرداخت الزامی است.' });
        return;
      }

      let savedReceiptUrl: string | null = null;
      if (receiptBase64 && receiptBase64.trim() !== '') {
        const saved = saveBase64MediaFile('receipts', receiptFileName, receiptBase64);
        savedReceiptUrl = saved.publicUrl;
      }

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);

      const workerId = await getWorkerUserId(pool);
      const managerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const managerNoteInput = req.body?.manager_note
        ? String(req.body.manager_note).trim().slice(0, 500)
        : 'ثبت مستقیم توسط مدیریت';

      const [result] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, receipt_file_url, receipt_file_name, status, is_seen_by_manager, reviewed_by_user_id, reviewed_at, manager_note, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 1, ?, NOW(), ?, ?)`,
        [
          workerId,
          managerId,
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          savedReceiptUrl,
          savedReceiptUrl ? receiptFileName : null,
          managerId,
          managerNoteInput || 'ثبت مستقیم توسط مدیریت',
          idempotencyKey,
        ]
      );

      await conn.commit();

      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message: 'پرداخت / سابقه مالی با موفقیت ثبت و به مجموع پرداخت‌های قطعی اضافه شد.',
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      const errObj = err as { code?: string };
      if (errObj?.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          ok: false,
          message: 'این پرداخت قبلاً ثبت شده است.',
        });
        return;
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

apiRouter.post(
  '/finance/:id/review',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const txId = Number(req.params.id);
      const decision = String(req.body?.decision || '') as 'APPROVED' | 'REJECTED';
      const managerNote = req.body?.manager_note
        ? String(req.body.manager_note).trim().slice(0, 500)
        : null;

      if (!txId || !['APPROVED', 'REJECTED'].includes(decision)) {
        res.status(400).json({ ok: false, message: 'شناسه تراکنش یا وضعیت تصمیم نامعتبر است.' });
        return;
      }

      const managerId = req.user!.id;
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM financial_transactions WHERE id = ? FOR UPDATE`,
        [txId]
      );

      if (rows.length === 0) {
        await conn.rollback();
        res.status(404).json({ ok: false, message: 'درخواست مالی یافت نشد.' });
        return;
      }

      const tx = mapRowToFinancialTx(rows[0]);

      if (tx.status !== 'PENDING') {
        await conn.rollback();
        res.status(409).json({
          ok: false,
          code: 'ALREADY_REVIEWED',
          message: `این درخواست قبلاً بررسی شده و در وضعیت «${tx.status === 'APPROVED' ? 'تأییدشده' : 'ردشده'}» قرار دارد.`,
        });
        return;
      }

      await conn.execute(
        `UPDATE financial_transactions
         SET status = ?, is_seen_by_manager = 1, reviewed_by_user_id = ?, reviewed_at = NOW(), manager_note = ?
         WHERE id = ? AND status = 'PENDING'`,
        [decision, managerId, managerNote, txId]
      );

      await conn.commit();

      res.json({
        ok: true,
        message:
          decision === 'APPROVED'
            ? 'درخواست مالی / هزینه تنخواه تأیید شد و در حساب پرسنل منظور گردید.'
            : 'درخواست مالی رد شد.',
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

/**
 * ویرایش / اصلاح موارد پرداخت‌شده یا درخواست‌های مالی (توسط مدیر برای همه موارد و توسط پرسنل برای موارد در انتظار)
 */
apiRouter.put(
  '/finance/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const txId = Number(req.params.id);
      if (!txId) {
        res.status(400).json({ ok: false, message: 'شناسه تراکنش مالی معتبر نیست.' });
        return;
      }

      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || '')).replace(/,/g, '').trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || '') as FinancialTxType;
      const description = String(req.body?.description || '').trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : '';
      const managerNote =
        req.body?.manager_note !== undefined && req.body?.manager_note !== null
          ? String(req.body.manager_note).trim().slice(0, 500)
          : null;
      const statusInput = req.body?.status ? String(req.body.status).trim() : '';

      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({ ok: false, message: 'مبلغ باید یک عدد صحیح مثبت به تومان باشد.' });
        return;
      }

      const validTypes: FinancialTxType[] = ['ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER'];
      if (!validTypes.includes(txType)) {
        res.status(400).json({ ok: false, message: 'نوع تراکنش مالی معتبر نیست.' });
        return;
      }

      if (!description || description.length < 2) {
        res.status(400).json({ ok: false, message: 'ثبت شرح تراکنش الزامی است.' });
        return;
      }

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM financial_transactions WHERE id = ? FOR UPDATE`,
        [txId]
      );

      if (rows.length === 0) {
        await conn.rollback();
        res.status(404).json({ ok: false, message: 'مورد مالی یافت نشد.' });
        return;
      }

      const existing = mapRowToFinancialTx(rows[0]);
      const isManager = req.user!.role === 'manager';

      if (!isManager && (existing.user_id !== req.user!.id || existing.created_by_user_id !== req.user!.id)) {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          message: 'شما مجوز ویرایش اطلاعات مالی کاربر دیگر را ندارید.',
        });
        return;
      }

      if (!isManager && existing.status !== 'PENDING') {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          message: 'پس از بررسی مدیریت، فقط مدیر امکان ویرایش و اصلاح موارد پرداخت‌شده را دارد.',
        });
        return;
      }

      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : existing.shamsi_date;
      const txDate = shamsiToGregorian(shamsiDate);

      const nextStatus =
        isManager && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusInput)
          ? (statusInput as 'PENDING' | 'APPROVED' | 'REJECTED')
          : existing.status;

      const nextManagerNote = isManager ? managerNote : existing.manager_note;

      await conn.execute(
        `UPDATE financial_transactions
         SET amount_toman = ?,
             tx_type = ?,
             tx_date = ?,
             shamsi_date = ?,
             description = ?,
             manager_note = ?,
             status = ?,
             reviewed_by_user_id = CASE WHEN ? = 1 THEN ? ELSE reviewed_by_user_id END,
             reviewed_at = CASE WHEN ? = 1 THEN NOW() ELSE reviewed_at END
         WHERE id = ?`,
        [
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          nextManagerNote,
          nextStatus,
          isManager ? 1 : 0,
          req.user!.id,
          isManager ? 1 : 0,
          txId,
        ]
      );

      await conn.commit();

      res.json({
        ok: true,
        message: 'اطلاعات پرداخت / تراکنش مالی با موفقیت اصلاح و به‌روزرسانی شد.',
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

/**
 * حذف تراکنش مالی (توسط مدیر برای همه موارد، و توسط پرسنل فقط برای درخواست‌های در انتظار تأیید)
 */
apiRouter.delete(
  '/finance/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const txId = Number(req.params.id);
      if (!txId) {
        res.status(400).json({ ok: false, message: 'شناسه تراکنش معتبر نیست.' });
        return;
      }

      const pool = getPool();
      const [rows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT * FROM financial_transactions WHERE id = ? LIMIT 1',
        [txId]
      );

      if (rows.length === 0) {
        res.status(404).json({ ok: false, message: 'مورد مالی یافت نشد.' });
        return;
      }

      const existing = mapRowToFinancialTx(rows[0]);
      if (
        req.user!.role !== 'manager' &&
        (existing.user_id !== req.user!.id || existing.created_by_user_id !== req.user!.id)
      ) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          message: 'شما مجوز حذف اطلاعات مالی کاربر دیگر را ندارید.',
        });
        return;
      }

      if (req.user!.role !== 'manager' && existing.status !== 'PENDING') {
        res.status(403).json({
          ok: false,
          message: 'فقط مدیریت امکان حذف موارد پرداخت‌شده یا بررسی‌شده را دارد.',
        });
        return;
      }

      await pool.execute('DELETE FROM financial_transactions WHERE id = ?', [txId]);

      res.json({
        ok: true,
        message: 'مورد مالی حذف شد و مانده حساب به‌روزرسانی گردید.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۷. مکاتبات کاری، پیام‌رسانی، پیام صوتی و ارسال فایل
// ============================================================================
apiRouter.get('/correspondences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const search = req.query.search ? String(req.query.search).trim() : '';
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : '';
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : '';
    const senderRole = req.query.senderRole ? String(req.query.senderRole).trim() : '';

    let sql = `
      SELECT c.*,
             s.full_name AS sender_name,
             s.role AS sender_role,
             s.avatar_url AS sender_avatar_url,
             p.message_text AS parent_preview
      FROM work_correspondences c
      INNER JOIN users s ON s.id = c.sender_user_id
      LEFT JOIN work_correspondences p ON p.id = c.parent_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (req.user!.role !== 'manager') {
      sql += ` AND (c.sender_user_id = ? OR c.receiver_user_id = ?)`;
      params.push(req.user!.id, req.user!.id);
    }

    if (fromShamsi) {
      sql += ` AND c.shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND c.shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (senderRole && ['manager', 'worker'].includes(senderRole)) {
      sql += ` AND s.role = ?`;
      params.push(senderRole);
    }
    if (search) {
      sql += ` AND (c.subject LIKE ? OR c.message_text LIKE ? OR c.attachments_json LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY c.id DESC LIMIT 300`;

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params);
    const items: WorkCorrespondence[] = rows.map((r) => {
      let attachments: CorrespondenceAttachment[] = [];
      if (r.attachments_json) {
        try {
          attachments =
            typeof r.attachments_json === 'string'
              ? JSON.parse(r.attachments_json)
              : r.attachments_json;
        } catch {
          attachments = [];
        }
      }
      return {
        id: Number(r.id),
        sender_user_id: Number(r.sender_user_id),
        sender_role: r.sender_role,
        sender_name: String(r.sender_name),
        sender_avatar_url: r.sender_avatar_url ? String(r.sender_avatar_url) : null,
        receiver_user_id: Number(r.receiver_user_id),
        parent_id: r.parent_id ? Number(r.parent_id) : null,
        parent_preview: r.parent_preview ? String(r.parent_preview).slice(0, 100) : null,
        subject: r.subject ? String(r.subject) : null,
        message_text: String(r.message_text),
        audio_url: r.audio_url ? String(r.audio_url) : null,
        audio_duration_seconds:
          r.audio_duration_seconds !== null && r.audio_duration_seconds !== undefined
            ? Number(r.audio_duration_seconds)
            : null,
        attachments,
        delivery_channel: (r.delivery_channel as DeliveryChannel) || 'IN_APP',
        sms_sent: Boolean(r.sms_sent),
        sms_status_text: r.sms_status_text ? String(r.sms_status_text) : null,
        shamsi_date: String(r.shamsi_date),
        recorded_time: String(r.recorded_time),
        is_read: Boolean(r.is_read),
        read_at: r.read_at ? new Date(r.read_at).toISOString() : null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
      };
    });

    const [unreadRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0',
      [req.user!.id]
    );

    res.json({
      ok: true,
      correspondences: items,
      unreadCount: Number(unreadRows[0]?.cnt || 0),
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/correspondences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subject = req.body?.subject ? String(req.body.subject).trim().slice(0, 200) : null;
    const messageText = String(req.body?.message_text || '').trim();
    const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
    const rawChannel = String(req.body?.delivery_channel || 'IN_APP') as DeliveryChannel;
    const deliveryChannel: DeliveryChannel =
      req.user!.role === 'manager' && ['IN_APP', 'SMS', 'BOTH'].includes(rawChannel)
        ? rawChannel
        : 'IN_APP';

    const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    const audioBase64 = req.body?.audio_base64 ? String(req.body.audio_base64) : null;
    const audioMimeType = req.body?.audio_mime_type ? String(req.body.audio_mime_type) : 'audio/webm';
    const audioDurationSeconds = req.body?.audio_duration_seconds
      ? Math.max(1, Math.round(Number(req.body.audio_duration_seconds)))
      : null;

    if (!messageText && rawFiles.length === 0 && !audioBase64) {
      res.status(400).json({
        ok: false,
        message: 'متن پیام، پیام صوتی یا حداقل یک فایل پیوست الزامی است.',
      });
      return;
    }

    let savedAudioUrl: string | null = null;
    if (audioBase64) {
      const ext = audioMimeType.includes('mp4')
        ? '.mp4'
        : audioMimeType.includes('ogg')
          ? '.ogg'
          : '.webm';
      const savedAudio = saveBase64MediaFile('audio', `voice-message${ext}`, audioBase64);
      savedAudioUrl = savedAudio.publicUrl;
    }

    const attachments: CorrespondenceAttachment[] = [];
    for (const f of rawFiles.slice(0, 6)) {
      if (f && f.file_base64 && f.file_name) {
        const saved = saveBase64MediaFile(
          'attachments',
          String(f.file_name),
          String(f.file_base64)
        );
        attachments.push({
          file_name: String(f.file_name),
          file_url: saved.publicUrl,
          file_size: saved.sizeBytes,
          mime_type: String(f.mime_type || 'application/octet-stream'),
        });
      }
    }

    const pool = getPool();
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);

    const targetRole = req.user!.role === 'manager' ? 'worker' : 'manager';
    const [targetRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, phone_number FROM users WHERE role = ? LIMIT 1',
      [targetRole]
    );
    if (targetRows.length === 0) {
      res.status(404).json({ ok: false, message: 'گیرنده پیام یافت نشد.' });
      return;
    }
    const receiverId = Number(targetRows[0].id);
    const workerPhone =
      settings.worker_phone_number ||
      (targetRows[0].phone_number ? String(targetRows[0].phone_number) : '');

    let smsSent = false;
    let smsStatusText: string | null = null;

    const effectiveText =
      messageText || (savedAudioUrl ? 'پیام صوتی جدید' : 'ارسال فایل پیوست');

    if (req.user!.role === 'manager' && (deliveryChannel === 'SMS' || deliveryChannel === 'BOTH')) {
      const smsBody = `پیام مدیریت (مجید نورایی)\n${subject ? `${subject}: ` : ''}${effectiveText}`;
      const smsRes = await sendMelipayamakSms(settings, workerPhone, smsBody);
      smsSent = smsRes.sent;
      smsStatusText = smsRes.statusMessage;
    }

    const [ins] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO work_correspondences
        (sender_user_id, receiver_user_id, parent_id, subject, message_text, audio_url, audio_duration_seconds, attachments_json, delivery_channel, sms_sent, sms_status_text, shamsi_date, work_date, recorded_time, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        req.user!.id,
        receiverId,
        parentId,
        subject,
        effectiveText,
        savedAudioUrl,
        audioDurationSeconds,
        JSON.stringify(attachments),
        deliveryChannel,
        smsSent ? 1 : 0,
        smsStatusText,
        nowInfo.shamsiDate,
        nowInfo.workDate,
        nowInfo.timeHHMMSS,
      ]
    );

    let feedbackMsg = 'پیام با موفقیت ارسال و ثبت شد.';
    if (deliveryChannel === 'SMS' || deliveryChannel === 'BOTH') {
      feedbackMsg = smsSent
        ? 'پیام ثبت شد و پیامک نیز با موفقیت ارسال گردید.'
        : `پیام در برنامه ثبت شد اما ارسال پیامک انجام نشد: ${smsStatusText}`;
    }

    res.status(201).json({
      ok: true,
      id: ins.insertId,
      smsSent,
      smsStatusText,
      message: feedbackMsg,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/correspondences/mark-read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const messageId = req.body?.id ? Number(req.body.id) : null;
    if (messageId) {
      await pool.execute(
        'UPDATE work_correspondences SET is_read = 1, read_at = NOW() WHERE id = ? AND receiver_user_id = ? AND is_read = 0',
        [messageId, req.user!.id]
      );
    } else {
      await pool.execute(
        'UPDATE work_correspondences SET is_read = 1, read_at = NOW() WHERE receiver_user_id = ? AND is_read = 0',
        [req.user!.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    handleServerError(res, err);
  }
});

// ============================================================================
// ۸. داشبورد جامع مدیر (مجید نورایی)
// ============================================================================
apiRouter.get(
  '/manager/dashboard',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pool = getPool();
      const workerInfo = await getWorkerInfo(pool);
      const workerId = workerInfo.id;
      const currentSettings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(currentSettings.timezone);

      const [allLogRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND is_deleted = 0
         ORDER BY work_date DESC, recorded_time ASC, id ASC`,
        [workerId]
      );
      const allLogs = allLogRows.map(mapRowToAttendanceLog);

      const byDate = new Map<string, AttendanceLog[]>();
      for (const log of allLogs) {
        const list = byDate.get(log.work_date) || [];
        list.push(log);
        byDate.set(log.work_date, list);
      }

      const todayLogs = allLogs
        .filter((l) => l.shamsi_date === nowInfo.shamsiDate || l.work_date === nowInfo.workDate)
        .sort((a, b) => a.recorded_time.localeCompare(b.recorded_time) || a.id - b.id);
      const liveState = evaluateWorkerLiveState(todayLogs, currentSettings);
      liveState.worker_profile = {
        full_name: workerInfo.full_name,
        avatar_url: workerInfo.avatar_url,
        collaboration_start_shamsi:
          currentSettings.collaboration_start_shamsi ||
          workerInfo.collaboration_start_shamsi ||
          '1405/06/15',
        phone_number: currentSettings.worker_phone_number || workerInfo.phone_number,
      };

      await attachForgottenCheckoutWarning(pool, workerId, liveState, currentSettings, nowInfo);

      let totalConfirmedNetWorkMinutes = 0;
      let totalConfirmedOvertimeMinutes = 0;
      let totalRecordedWorkDays = 0;
      let incompleteDaysCount = 0;

      const dailySummaries: DailyAttendanceSummary[] = [];

      for (const [workDate, dayLogs] of byDate.entries()) {
        const shamsiDate = dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate);
        const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
        const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
          isToday: workDate === nowInfo.workDate,
          currentTimeHHMM: nowInfo.timeHHMM,
        });
        dailySummaries.push(summary);

        if (summary.is_incomplete) {
          incompleteDaysCount += 1;
        } else if (summary.logs.length > 0) {
          totalRecordedWorkDays += 1;
          totalConfirmedNetWorkMinutes += summary.net_work_minutes;
          totalConfirmedOvertimeMinutes += summary.overtime_minutes;
        }
      }

      const [histTotals] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN work_days_count ELSE 0 END), 0) AS hist_days,
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN net_work_minutes ELSE 0 END), 0) AS hist_net_minutes,
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN overtime_minutes ELSE 0 END), 0) AS hist_ot_minutes,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_hist_count,
           COUNT(CASE WHEN is_seen_by_manager = 0 THEN 1 END) AS unseen_hist_count
         FROM historical_work_records
         WHERE user_id = ?`,
        [workerId]
      );

      totalRecordedWorkDays += Number(histTotals[0]?.hist_days || 0);
      totalConfirmedNetWorkMinutes += Number(histTotals[0]?.hist_net_minutes || 0);
      totalConfirmedOvertimeMinutes += Number(histTotals[0]?.hist_ot_minutes || 0);

      const [finRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count,
           COUNT(CASE WHEN is_seen_by_manager = 0 OR status = 'PENDING' THEN 1 END) AS unseen_or_pending_fin
         FROM financial_transactions
         WHERE user_id = ?`,
        [workerId]
      );

      const [repUnseenRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS unseen_reports FROM daily_work_reports WHERE user_id = ? AND is_seen_by_manager = 0`,
        [workerId]
      );

      const [corrUnreadRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS unread_corr FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0`,
        [req.user!.id]
      );

      const [leavePendingRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_leaves,
           COUNT(CASE WHEN is_seen_by_manager = 0 OR status = 'PENDING' THEN 1 END) AS unseen_or_pending_leaves
         FROM leave_requests
         WHERE user_id = ?`,
        [workerId]
      );

      const salaryCalc = calculateSalaryAndOvertimeRates(
        currentSettings,
        totalConfirmedOvertimeMinutes
      );

      const [histAllRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT h.*, u.role AS creator_role
         FROM historical_work_records h
         LEFT JOIN users u ON u.id = h.created_by_user_id
         WHERE h.user_id = ?
         ORDER BY h.work_date DESC, h.id DESC`,
        [workerId]
      );
      const historicalRecords = histAllRows.map(mapRowToHistoricalWork);
      const mergedDailySummaries = mergeApprovedHistoricalIntoDailySummaries(
        dailySummaries,
        historicalRecords
      );

      const confirmedChronological = [...mergedDailySummaries]
        .filter((d) => d.logs.length > 0 || d.net_work_minutes > 0 || d.overtime_minutes > 0)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));

      const weeklyChartData = confirmedChronological.slice(-7).map((d) => ({
        shamsiDate: d.shamsi_date,
        dayName: d.day_name,
        netHours: Number((d.net_work_minutes / 60).toFixed(2)),
        overtimeHours: Number((d.overtime_minutes / 60).toFixed(2)),
        isIncomplete: d.is_incomplete,
        statusLabel: d.status_label,
      }));

      const monthlyChartData = confirmedChronological.slice(-30).map((d) => ({
        shamsiDate: d.shamsi_date,
        dayName: d.day_name,
        netHours: Number((d.net_work_minutes / 60).toFixed(2)),
        overtimeHours: Number((d.overtime_minutes / 60).toFixed(2)),
        isIncomplete: d.is_incomplete,
        statusLabel: d.status_label,
      }));

      res.json({
        ok: true,
        serverTime: nowInfo,
        liveState,
        kpis: {
          approvedPaymentsToman: Number(finRows[0]?.approved_total || 0),
          pendingPaymentsToman: Number(finRows[0]?.pending_total || 0),
          pendingPaymentsCount: Number(finRows[0]?.pending_count || 0),
          totalNetWorkMinutes: totalConfirmedNetWorkMinutes,
          totalOvertimeMinutes: totalConfirmedOvertimeMinutes,
          totalWorkDays: totalRecordedWorkDays,
          incompleteDaysCount,
          baseSalaryToman: salaryCalc.baseSalaryToman,
          effectiveHourlyRateToman: salaryCalc.effectiveHourlyRateToman,
          effectiveOvertimeHourlyRateToman: salaryCalc.effectiveOvertimeHourlyRateToman,
          totalOvertimePayToman: salaryCalc.totalOvertimePayToman,
        },
        unseenAlerts: {
          financeAlert: Number(finRows[0]?.unseen_or_pending_fin || 0) > 0,
          pendingFinanceCount: Number(finRows[0]?.pending_count || 0),
          reportsAlert: Number(repUnseenRows[0]?.unseen_reports || 0) > 0,
          unseenReportsCount: Number(repUnseenRows[0]?.unseen_reports || 0),
          historicalAlert:
            Number(histTotals[0]?.pending_hist_count || 0) > 0 ||
            Number(histTotals[0]?.unseen_hist_count || 0) > 0 ||
            Number(leavePendingRows[0]?.unseen_or_pending_leaves || 0) > 0,
          pendingHistoricalCount:
            Number(histTotals[0]?.pending_hist_count || 0) +
            Number(leavePendingRows[0]?.pending_leaves || 0),
          correspondenceAlert: Number(corrUnreadRows[0]?.unread_corr || 0) > 0,
          unreadCorrespondenceCount: Number(corrUnreadRows[0]?.unread_corr || 0),
        },
        charts: {
          weekly: weeklyChartData,
          monthly: monthlyChartData,
        },
        recentSummaries: mergedDailySummaries.slice(0, 14),
        settings: sanitizeSettingsForRole(currentSettings, 'manager'),
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۸-الف. پشتیبان‌گیری یک‌کلیکی (Backup) برای مدیر (اکسل جامع و فایل JSON)
// ============================================================================
apiRouter.get(
  '/manager/backup/excel',
  requireAuth,
  requireRole('manager'),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const pool = getPool();
      const workerId = await getWorkerUserId(pool);

      const [attRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT shamsi_date, event_type, recorded_time, note, is_manual_override FROM attendance_logs WHERE user_id = ? AND is_deleted = 0 ORDER BY work_date DESC, recorded_time ASC',
        [workerId]
      );
      const [histRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT shamsi_date, title, work_days_count, net_work_minutes, overtime_minutes, status, note FROM historical_work_records WHERE user_id = ? ORDER BY work_date DESC',
        [workerId]
      );
      const [finRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT shamsi_date, tx_type, amount_toman, status, description, manager_note FROM financial_transactions WHERE user_id = ? ORDER BY tx_date DESC',
        [workerId]
      );
      const [leaveRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT shamsi_date, leave_type, start_time, end_time, duration_minutes, status, reason, manager_note FROM leave_requests WHERE user_id = ? ORDER BY work_date DESC',
        [workerId]
      );
      const [repRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT shamsi_date, recorded_time, duration_minutes, activity_description FROM daily_work_reports WHERE user_id = ? ORDER BY report_date DESC',
        [workerId]
      );

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          attRows.map((r) => ({
            'تاریخ': r.shamsi_date,
            'نوع تردد':
              r.event_type === 'WORK_START'
                ? 'شروع کار'
                : r.event_type === 'WORK_END'
                  ? 'پایان کار'
                  : r.event_type === 'MISSION_START'
                    ? 'شروع مأموریت'
                    : 'پایان مأموریت',
            'ساعت': r.recorded_time,
            'توضیحات': r.note || '',
            'ثبت دستی مدیر': r.is_manual_override ? 'بله' : 'خیر',
          }))
        ),
        'ترددها'
      );

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          histRows.map((r) => ({
            'تاریخ': r.shamsi_date,
            'عنوان': r.title,
            'تعداد روز': r.work_days_count,
            'کارکرد خالص': formatDurationPersian(Number(r.net_work_minutes || 0)),
            'اضافه‌کاری': formatDurationPersian(Number(r.overtime_minutes || 0)),
            'وضعیت': r.status === 'APPROVED' ? 'تأییدشده' : r.status === 'PENDING' ? 'در انتظار' : 'ردشده',
            'توضیحات': r.note || '',
          }))
        ),
        'سوابق قبلی'
      );

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          finRows.map((r) => ({
            'تاریخ': r.shamsi_date,
            'نوع تراکنش':
              r.tx_type === 'ADVANCE'
                ? 'مساعده'
                : r.tx_type === 'SALARY'
                  ? 'حقوق'
                  : r.tx_type === 'ON_ACCOUNT'
                    ? 'علی‌الحساب'
                    : r.tx_type === 'PETTY_CASH'
                      ? 'هزینه تنخواه / خرید کارگاهی'
                      : 'سایر',
            'مبلغ (تومان)': Number(r.amount_toman),
            'وضعیت': r.status === 'APPROVED' ? 'تأییدشده' : r.status === 'PENDING' ? 'در انتظار' : 'ردشده',
            'شرح': r.description,
            'یادداشت مدیریت': r.manager_note || '',
          }))
        ),
        'امور مالی و تنخواه'
      );

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          leaveRows.map((r) => ({
            'تاریخ': r.shamsi_date,
            'نوع مرخصی': r.leave_type === 'HOURLY' ? 'ساعتی' : 'روزانه',
            'از ساعت': r.start_time || '-',
            'تا ساعت': r.end_time || '-',
            'مدت': formatDurationPersian(Number(r.duration_minutes || 0)),
            'وضعیت': r.status === 'APPROVED' ? 'تأییدشده' : r.status === 'PENDING' ? 'در انتظار' : 'ردشده',
            'علت': r.reason,
          }))
        ),
        'مرخصی‌ها'
      );

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          repRows.map((r) => ({
            'تاریخ': r.shamsi_date,
            'ساعت ثبت': r.recorded_time,
            'مدت (دقیقه)': r.duration_minutes || '',
            'شرح فعالیت': r.activity_description,
          }))
        ),
        'گزارش کارها'
      );

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="mgammon-full-backup.xlsx"'
      );
      res.send(buffer);
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

apiRouter.get(
  '/manager/backup/json',
  requireAuth,
  requireRole('manager'),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const pool = getPool();
      const settings = await getSystemSettingsFromDb();
      const [attendance] = await pool.execute('SELECT * FROM attendance_logs WHERE is_deleted = 0');
      const [historical] = await pool.execute('SELECT * FROM historical_work_records');
      const [finance] = await pool.execute('SELECT * FROM financial_transactions');
      const [leaves] = await pool.execute('SELECT * FROM leave_requests');
      const [reports] = await pool.execute('SELECT * FROM daily_work_reports');
      const [tasks] = await pool.execute('SELECT * FROM work_tasks');
      const [correspondences] = await pool.execute('SELECT * FROM work_correspondences');

      const backupPayload = {
        exported_at: new Date().toISOString(),
        app: 'Mgammon',
        settings: sanitizeSettingsForRole(settings, 'manager'),
        attendance,
        historical,
        finance,
        leaves,
        reports,
        tasks,
        correspondences,
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="mgammon-backup.json"');
      res.send(JSON.stringify(backupPayload, null, 2));
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۹. تنظیمات قواعد کارکرد، پنجشنبه‌ها، حقوق، اضافه‌کاری، سهمیه مرخصی و پیامک
// ============================================================================
apiRouter.get('/settings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await getSystemSettingsFromDb();
    res.json({ ok: true, settings: sanitizeSettingsForRole(settings, req.user!.role) });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.put(
  '/settings/banner',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const bannerBgUrl = req.body?.banner_bg_url ? String(req.body.banner_bg_url).trim() : null;
      if (bannerBgUrl && !bannerBgUrl.startsWith('/') && !bannerBgUrl.startsWith('https://')) {
        res.status(400).json({ ok: false, message: 'آدرس تصویر بنر معتبر نیست.' });
        return;
      }
      const pool = getPool();
      await pool.execute('UPDATE system_settings SET banner_bg_url = ?, updated_by_user_id = ?', [
        bannerBgUrl,
        req.user!.id,
      ]);
      res.json({
        ok: true,
        banner_bg_url: bannerBgUrl,
        message: 'تصویر بنر سامانه با موفقیت به‌روزرسانی شد.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

apiRouter.put(
  '/settings',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const currentSettings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(currentSettings.timezone);

      const shiftStart = toEnglishDigits(
        String(req.body?.shift_start_time || currentSettings.shift_start_time)
      ).trim();
      const shiftEnd = toEnglishDigits(
        String(req.body?.shift_end_time || currentSettings.shift_end_time)
      ).trim();
      const overtimeStart = toEnglishDigits(
        String(req.body?.overtime_start_time || currentSettings.overtime_start_time)
      ).trim();

      const thuStart = toEnglishDigits(
        String(req.body?.thursday_shift_start_time || currentSettings.thursday_shift_start_time || '07:00')
      ).trim();
      const thuEnd = toEnglishDigits(
        String(req.body?.thursday_shift_end_time || currentSettings.thursday_shift_end_time || '14:00')
      ).trim();
      const thuOtStart = toEnglishDigits(
        String(
          req.body?.thursday_overtime_start_time ||
            req.body?.thursday_shift_end_time ||
            currentSettings.thursday_overtime_start_time ||
            '14:00'
        )
      ).trim();

      const timeRegex = /^\d{2}:\d{2}$/;
      if (
        !timeRegex.test(shiftStart) ||
        !timeRegex.test(shiftEnd) ||
        !timeRegex.test(overtimeStart) ||
        !timeRegex.test(thuStart) ||
        !timeRegex.test(thuEnd) ||
        !timeRegex.test(thuOtStart)
      ) {
        res.status(400).json({ ok: false, message: 'فرمت تمام ساعات شیفت و پنجشنبه باید HH:MM باشد.' });
        return;
      }

      const gracePeriod = Math.max(
        0,
        Math.min(240, Number(req.body?.grace_period_minutes ?? currentSettings.grace_period_minutes))
      );
      const breakDuration = Math.max(
        0,
        Math.min(240, Number(req.body?.break_duration_minutes ?? currentSettings.break_duration_minutes))
      );
      const workingDays = Array.isArray(req.body?.working_days)
        ? req.body.working_days.map(Number).filter((d: number) => d >= 0 && d <= 6)
        : currentSettings.working_days;

      const overtimeBeforeShift = Boolean(req.body?.overtime_before_shift);
      const missionPolicy =
        req.body?.mission_policy === 'SEPARATE_EXTRA' ? 'SEPARATE_EXTRA' : 'PAID_AS_WORK';
      const fridayHolidayPolicy = ['ALL_OVERTIME', 'REGULAR_WORK', 'DISABLED'].includes(
        req.body?.friday_holiday_policy
      )
        ? req.body.friday_holiday_policy
        : 'ALL_OVERTIME';

      const officialHolidays: string[] = Array.isArray(req.body?.official_holidays)
        ? req.body.official_holidays
            .map((d: string) => toEnglishDigits(String(d)).trim())
            .filter((d: string) => isValidShamsiDate(d))
            .map((d: string) => normalizeShamsiDate(d))
        : currentSettings.official_holidays;

      const parseOptionalToman = (val: unknown): number | null => {
        if (val === null || val === undefined || String(val).trim() === '') return null;
        const n = Number(toEnglishDigits(String(val)).replace(/,/g, '').trim());
        return Number.isNaN(n) || n <= 0 ? null : Math.round(n);
      };

      const baseSalaryToman = parseOptionalToman(req.body?.base_salary_toman);
      const hourlyRate = parseOptionalToman(req.body?.hourly_rate_toman);
      const overtimeRate = parseOptionalToman(req.body?.overtime_rate_toman);

      const overtimeCalcMode: OvertimeCalcMode =
        req.body?.overtime_calc_mode === 'FIXED_RATE' ? 'FIXED_RATE' : 'PERCENTAGE';
      const overtimePercentage = Math.max(
        1,
        Math.min(500, Number(toEnglishDigits(String(req.body?.overtime_percentage ?? 140))) || 140)
      );

      const collabRaw = String(
        req.body?.collaboration_start_shamsi || currentSettings.collaboration_start_shamsi || '1405/06/15'
      ).trim();
      const collaborationStartShamsi = isValidShamsiDate(collabRaw)
        ? normalizeShamsiDate(collabRaw)
        : currentSettings.collaboration_start_shamsi || '1405/06/15';

      const monthlyLeaveQuotaDays = Math.max(
        0,
        Math.min(
          30,
          Number(
            toEnglishDigits(
              String(req.body?.monthly_leave_quota_days ?? currentSettings.monthly_leave_quota_days ?? 2.5)
            )
          ) || 2.5
        )
      );

      const smsEnabled = Boolean(req.body?.sms_enabled);
      const melipayamakUsername = String(req.body?.melipayamak_username ?? currentSettings.melipayamak_username).trim();
      const rawInputSmsPass = String(req.body?.melipayamak_password ?? '').trim();
      const melipayamakPassword =
        rawInputSmsPass && rawInputSmsPass !== '••••••••'
          ? rawInputSmsPass
          : currentSettings.melipayamak_password;
      const melipayamakFromNumber = toEnglishDigits(
        String(req.body?.melipayamak_from_number ?? currentSettings.melipayamak_from_number)
      ).trim();
      const melipayamakIsFlash = Boolean(req.body?.melipayamak_is_flash);
      const workerPhoneNumber = toEnglishDigits(
        String(req.body?.worker_phone_number ?? currentSettings.worker_phone_number)
      ).trim();

      const applyRetroactively = Boolean(req.body?.apply_retroactively);
      const effectiveFromShamsi = applyRetroactively
        ? '1400/01/01'
        : req.body?.effective_from_shamsi && isValidShamsiDate(String(req.body.effective_from_shamsi))
          ? normalizeShamsiDate(String(req.body.effective_from_shamsi))
          : nowInfo.shamsiDate;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      if (!applyRetroactively) {
        await conn.execute(
          `INSERT INTO system_settings_snapshots (effective_from_shamsi, settings_json, created_by_user_id)
           VALUES (?, ?, ?)`,
          [
            currentSettings.effective_from_shamsi,
            JSON.stringify(sanitizeSettingsForRole(currentSettings, 'manager')),
            req.user!.id,
          ]
        );
      }

      await conn.execute(
        `UPDATE system_settings SET
          shift_start_time = ?,
          shift_end_time = ?,
          thursday_shift_start_time = ?,
          thursday_shift_end_time = ?,
          thursday_overtime_start_time = ?,
          grace_period_minutes = ?,
          break_duration_minutes = ?,
          working_days_json = ?,
          overtime_start_time = ?,
          overtime_before_shift = ?,
          mission_policy = ?,
          friday_holiday_policy = ?,
          official_holidays_json = ?,
          base_salary_toman = ?,
          hourly_rate_toman = ?,
          overtime_calc_mode = ?,
          overtime_percentage = ?,
          overtime_rate_toman = ?,
          collaboration_start_shamsi = ?,
          monthly_leave_quota_days = ?,
          sms_enabled = ?,
          melipayamak_username = ?,
          melipayamak_password = ?,
          melipayamak_from_number = ?,
          melipayamak_is_flash = ?,
          worker_phone_number = ?,
          rules_confirmed_by_manager = 1,
          effective_from_shamsi = ?,
          updated_by_user_id = ?
         WHERE id = ?`,
        [
          shiftStart,
          shiftEnd,
          thuStart,
          thuEnd,
          thuOtStart,
          gracePeriod,
          breakDuration,
          JSON.stringify(workingDays),
          overtimeStart,
          overtimeBeforeShift ? 1 : 0,
          missionPolicy,
          fridayHolidayPolicy,
          JSON.stringify(officialHolidays),
          baseSalaryToman,
          hourlyRate,
          overtimeCalcMode,
          overtimePercentage,
          overtimeRate,
          collaborationStartShamsi,
          monthlyLeaveQuotaDays,
          smsEnabled ? 1 : 0,
          melipayamakUsername,
          melipayamakPassword,
          melipayamakFromNumber,
          melipayamakIsFlash ? 1 : 0,
          workerPhoneNumber,
          effectiveFromShamsi,
          req.user!.id,
          currentSettings.id,
        ]
      );

      await conn.execute(
        `UPDATE users SET collaboration_start_shamsi = ?, phone_number = ? WHERE role = 'worker'`,
        [collaborationStartShamsi, workerPhoneNumber || null]
      );

      const [updatedRows] = await conn.execute<mysql.RowDataPacket[]>(
        'SELECT * FROM system_settings WHERE id = ?',
        [currentSettings.id]
      );
      const newSettings = sanitizeSettingsForRole(mapRowToSystemSettings(updatedRows[0]), 'manager');

      await conn.commit();

      res.json({
        ok: true,
        settings: newSettings,
        message: 'تنظیمات سامانه با موفقیت ذخیره شد.',
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

apiRouter.post(
  '/settings/test-sms',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const currentSettings = await getSystemSettingsFromDb();
      const rawPass = String(req.body?.melipayamak_password ?? '').trim();
      const mergedSettings = {
        ...currentSettings,
        melipayamak_username: String(
          req.body?.melipayamak_username ?? currentSettings.melipayamak_username
        ),
        melipayamak_password:
          rawPass && rawPass !== '••••••••' ? rawPass : currentSettings.melipayamak_password,
        melipayamak_from_number: String(
          req.body?.melipayamak_from_number ?? currentSettings.melipayamak_from_number
        ),
        melipayamak_is_flash: Boolean(
          req.body?.melipayamak_is_flash ?? currentSettings.melipayamak_is_flash
        ),
        worker_phone_number: String(
          req.body?.worker_phone_number ?? currentSettings.worker_phone_number
        ),
      };

      const creditCheck = await checkMelipayamakCredit(
        mergedSettings.melipayamak_username,
        mergedSettings.melipayamak_password
      );

      const targetPhone = String(
        req.body?.test_phone || mergedSettings.worker_phone_number || ''
      ).trim();

      const testText =
        'پیامک آزمایشی جهت بررسی اتصال سامانه مدیریت کارکرد (مدیریت: مجید نورایی)';
      const result = await sendMelipayamakSms(
        mergedSettings,
        targetPhone,
        testText
      );

      const combinedMsg = creditCheck.ok
        ? `${creditCheck.message} — ${result.statusMessage}`
        : result.statusMessage;

      res.json({
        ok: result.sent,
        sent: result.sent,
        creditOk: creditCheck.ok,
        credit: creditCheck.credit ?? null,
        message: combinedMsg,
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

apiRouter.get(
  '/audit-logs',
  requireAuth,
  requireRole('manager'),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const pool = getPool();
      const [rows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT a.*, u.full_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.id DESC
         LIMIT 200`
      );
      res.json({
        ok: true,
        logs: rows.map((r) => ({
          id: Number(r.id),
          actor_user_id: r.actor_user_id ? Number(r.actor_user_id) : null,
          actor_name: r.actor_name || 'سیستم',
          action_type: String(r.action_type),
          target_entity: String(r.target_entity),
          target_id: r.target_id ? Number(r.target_id) : null,
          before_state:
            typeof r.before_state === 'string' ? JSON.parse(r.before_state) : r.before_state,
          after_state:
            typeof r.after_state === 'string' ? JSON.parse(r.after_state) : r.after_state,
          reason: r.reason ? String(r.reason) : null,
          ip_address: r.ip_address ? String(r.ip_address) : null,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
        })),
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
