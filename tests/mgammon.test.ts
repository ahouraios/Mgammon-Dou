import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  calculateDailyAttendance,
  calculateDayRegularPayToman,
  calculateMonthlyPayrollPeriod,
  calculatePeriodStatement,
  computePaidLeaveBreakdown,
  evaluateWorkerLiveState,
  generateStatementPeriods,
  validateAttendanceSequence,
  validateFullDayLogSequence,
} from '../src/shared/calculationEngine';
import {
  gregorianToShamsi,
  shamsiToGregorian,
  getDayOfWeekFromGregorian,
  isValidShamsiDate,
  isValidTimeHHMMOrHHMMSS,
  isShamsiLeapYear,
  getShamsiMonthLength,
  getShamsiMonthRange,
  getShamsiMonthCalendar,
  formatNumericInputWithCommas,
  numberToPersianTomanWords,
} from '../src/shared/jalali';
import { AttendanceLog, SystemSettings, SystemSettingsSnapshot } from '../src/shared/types';
import { getAppConfig } from '../src/server/config';
import { runPreflightDiagnostics } from '../src/server/preflight';
import {
  columnExists,
  getDbConfig,
  getPool,
  getSystemSettingsSnapshotsFromDb,
  indexExists,
  initializeDatabase,
  isCpanelOrProductionEnvironment,
  resetPool,
  setDatabaseInitializedForTest,
  setSimulatedDatabaseDisconnect,
  setSimulatedMidTransactionFailure,
  validateProductionSecurityConfig,
} from '../src/server/db';
import * as XLSX from 'xlsx';
import {
  BACKUP_TABLES_ORDERED,
  collectDatabaseMetrics,
  createFullBackup,
  restoreFromBackupArchive,
  verifyBackupArchive,
} from '../src/server/backup';
import { resetAllLoginRateLimits } from '../src/server/auth';
import { createApp } from '../server';
import type { Server } from 'http';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BASE_SETTINGS: SystemSettings = {
  id: 1,
  shift_start_time: '08:30',
  shift_end_time: '17:00',
  thursday_shift_start_time: '07:00',
  thursday_shift_end_time: '14:00',
  thursday_overtime_start_time: '14:00',
  grace_period_minutes: 15,
  break_duration_minutes: 30,
  working_days: [6, 0, 1, 2, 3, 4], // شنبه تا پنجشنبه
  overtime_start_time: '17:00',
  overtime_before_shift: false,
  mission_policy: 'PAID_AS_WORK',
  friday_holiday_policy: 'ALL_OVERTIME',
  official_holidays: ['1405/01/01', '1405/01/13'],
  timezone: 'Asia/Tehran',
  base_salary_toman: null,
  hourly_rate_toman: null,
  overtime_calc_mode: 'PERCENTAGE',
  overtime_percentage: 140,
  overtime_rate_toman: null,
  collaboration_start_shamsi: '1405/06/15',
  monthly_leave_quota_days: 2.5,
  sms_enabled: false,
  melipayamak_username: '',
  melipayamak_password: '',
  melipayamak_from_number: '',
  melipayamak_is_flash: false,
  worker_phone_number: '',
  rules_confirmed_by_manager: true,
  effective_from_shamsi: '1405/01/01',
  banner_bg_url: null,
};

function makeLog(
  id: number,
  event_type: AttendanceLog['event_type'],
  recorded_time: string,
  work_date = '2026-10-24',
  shamsi_date = '1405/08/02'
): AttendanceLog {
  return {
    id,
    user_id: 2,
    work_date,
    shamsi_date,
    event_type,
    recorded_at: `${work_date}T${recorded_time}Z`,
    recorded_time,
    note: null,
    is_manual_override: false,
    modified_by_user_id: null,
    modification_reason: null,
    is_deleted: false,
    created_at: `${work_date}T${recorded_time}Z`,
  };
}

describe('MGAMMON Duo — آزمون‌های خودکار ۱۵ سناریوی محاسباتی، مالی، امنیتی و دیتابیس MySQL', () => {
  let server: Server;
  let baseUrl = '';
  let managerToken = '';
  let workerToken = '';

  const origDbName = process.env.DB_NAME;
  const origMediaDir = process.env.PRIVATE_MEDIA_DIR;
  const origBackupDir = process.env.BACKUP_DIR;

  beforeAll(async () => {
    // اجرای تمام آزمون‌ها روی دیتابیس و پوشه‌های کاملاً ایزوله آزمایشی (بدون کوچک‌ترین دستکاری در اطلاعات واقعی mgammon_duo)
    process.env.DB_NAME = 'mgammon_duo_test';
    process.env.PRIVATE_MEDIA_DIR = '.data/test_private_media';
    process.env.BACKUP_DIR = '.data/test_backups';

    await resetPool();
    await initializeDatabase();

    const pool = getPool();
    for (const tbl of [...BACKUP_TABLES_ORDERED].reverse()) {
      if (tbl === 'users' || tbl === 'system_settings' || tbl === 'schema_migrations') continue;
      await pool.execute(`DELETE FROM \`${tbl}\``);
    }

    const app = await createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  }, 60000);

  afterAll(async () => {
    setSimulatedDatabaseDisconnect(false);
    setSimulatedMidTransactionFailure(null);
    setDatabaseInitializedForTest(true);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      const cfg = getDbConfig();
      const adminConn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
      });
      await adminConn.query('DROP DATABASE IF EXISTS `mgammon_duo_test`');
      await adminConn.end();
    } catch {
      // ignore
    }
    await resetPool();

    const testMediaPath = path.resolve(process.cwd(), '.data/test_private_media');
    const testBackupPath = path.resolve(process.cwd(), '.data/test_backups');
    const defaultBackupPath = path.resolve(process.cwd(), '.data/backups');
    try {
      fs.rmSync(testMediaPath, { recursive: true, force: true });
      fs.rmSync(testBackupPath, { recursive: true, force: true });
      if (fs.existsSync(defaultBackupPath)) {
        for (const f of fs.readdirSync(defaultBackupPath)) {
          if (f.startsWith('pre_migration_mgammon_duo_test_')) {
            fs.unlinkSync(path.join(defaultBackupPath, f));
          }
        }
      }
    } catch {
      // ignore
    }

    if (origDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = origDbName;
    if (origMediaDir === undefined) delete process.env.PRIVATE_MEDIA_DIR;
    else process.env.PRIVATE_MEDIA_DIR = origMediaDir;
    if (origBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = origBackupDir;
  });

  it('سناریو ۱۳ + تقویم شمسی و تبدیل مبلغ به حروف فارسی', () => {
    const shamsi = gregorianToShamsi('2026-03-21');
    expect(shamsi).toBe('1405/01/01');
    const greg = shamsiToGregorian('1405/01/01');
    expect(greg).toBe('2026-03-21');
    expect(isValidShamsiDate('1405/07/30')).toBe(true);
    expect(isValidShamsiDate('1405/13/01')).toBe(false);

    const cal = getShamsiMonthCalendar(1405, 7);
    expect(cal.monthLength).toBe(30);

    expect(formatNumericInputWithCommas('15250000')).toBe('15,250,000');
    expect(numberToPersianTomanWords(15250000)).toBe('پانزده میلیون و دویست و پنجاه هزار تومان');
  });

  it('سناریو ۳، ۴، ۵، ۶ و ۱۴ (واحد محاسبات): جلوگیری از تردد نامعتبر، محاسبه مدت کار، مأموریت، تأخیر، اضافه‌کاری، روز ناقص، جمعه و تعطیلات', () => {
    expect(validateAttendanceSequence([], 'WORK_END', '17:00:00').valid).toBe(false);

    const startLog = makeLog(1, 'WORK_START', '08:30:00');
    expect(validateAttendanceSequence([startLog], 'WORK_START', '09:00:00').valid).toBe(false);

    const logsNormalWithMission: AttendanceLog[] = [
      makeLog(1, 'WORK_START', '08:30:00'),
      makeLog(2, 'MISSION_START', '11:00:00'),
      makeLog(3, 'MISSION_END', '13:00:00'),
      makeLog(4, 'WORK_END', '18:30:00'),
    ];
    const summaryNormal = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      logsNormalWithMission,
      BASE_SETTINGS
    );
    expect(summaryNormal.is_incomplete).toBe(false);
    expect(summaryNormal.is_late).toBe(false);
    expect(summaryNormal.mission_minutes).toBe(120);
    expect(summaryNormal.gross_presence_minutes).toBe(600);
    expect(summaryNormal.break_deducted_minutes).toBe(30);
    expect(summaryNormal.net_work_minutes).toBe(570);
    expect(summaryNormal.overtime_minutes).toBe(90);

    const lateLogs = [makeLog(1, 'WORK_START', '09:00:00'), makeLog(2, 'WORK_END', '17:00:00')];
    const summaryLate = calculateDailyAttendance('2026-10-24', '1405/08/02', lateLogs, BASE_SETTINGS);
    expect(summaryLate.is_late).toBe(true);
    expect(summaryLate.late_minutes).toBe(30);

    const incompleteLogs = [makeLog(1, 'WORK_START', '08:30:00')];
    const summaryIncomplete = calculateDailyAttendance(
      '2026-10-20',
      '1405/07/28',
      incompleteLogs,
      BASE_SETTINGS,
      { isToday: false }
    );
    expect(summaryIncomplete.is_incomplete).toBe(true);
    expect(summaryIncomplete.net_work_minutes).toBe(0);
    expect(summaryIncomplete.overtime_minutes).toBe(0);

    const fridayLogs = [
      makeLog(1, 'WORK_START', '10:00:00', '2026-10-23', '1405/08/01'),
      makeLog(2, 'WORK_END', '13:00:00', '2026-10-23', '1405/08/01'),
    ];
    const summaryFriday = calculateDailyAttendance(
      '2026-10-23',
      '1405/08/01',
      fridayLogs,
      BASE_SETTINGS
    );
    expect(summaryFriday.is_holiday_or_friday).toBe(true);
    expect(summaryFriday.overtime_minutes).toBe(180);

    const liveDuringOvertime = evaluateWorkerLiveState(
      [makeLog(1, 'WORK_START', '08:30:00')],
      BASE_SETTINGS,
      new Date('2026-10-24T14:30:00Z')
    );
    expect(liveDuringOvertime.is_overtime_active).toBe(true);
  });

  const mgrInitialPass =
    process.env.INITIAL_MANAGER_PASSWORD &&
    process.env.INITIAL_MANAGER_PASSWORD !== 'CHANGE_ME_MANAGER_PASSWORD'
      ? process.env.INITIAL_MANAGER_PASSWORD
      : 'Mgammon@1405';
  const wrkInitialPass =
    process.env.INITIAL_WORKER_PASSWORD &&
    process.env.INITIAL_WORKER_PASSWORD !== 'CHANGE_ME_WORKER_PASSWORD'
      ? process.env.INITIAL_WORKER_PASSWORD
      : 'Worker@1405';

  it('سناریو ۱ و ۱۵: ورود مدیریت (مجید نورایی) و نیروی کار (امید میثمی) و بررسی کنترل دسترسی APIها در سرور (RBAC)', async () => {
    const mgrRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'manager',
        password: mgrInitialPass,
      }),
    });
    const mgrData = await mgrRes.json();
    expect(mgrRes.status).toBe(200);
    expect(mgrData.user.role).toBe('manager');
    expect(mgrData.user.full_name).toBe('مجید نورایی');
    managerToken = mgrData.token;

    const wrkRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'worker',
        password: wrkInitialPass,
      }),
    });
    const wrkData = await wrkRes.json();
    expect(wrkRes.status).toBe(200);
    expect(wrkData.user.role).toBe('worker');
    expect(wrkData.user.full_name).toBe('امید میثمی');
    workerToken = wrkData.token;

    const forbiddenRes = await fetch(`${baseUrl}/api/manager/dashboard`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(forbiddenRes.status).toBe(403);

    const mgrClockRes = await fetch(`${baseUrl}/api/attendance/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ event_type: 'WORK_START' }),
    });
    expect(mgrClockRes.status).toBe(403);
  });

  it('سناریو ۲، ۳، ۱۰، ۱۲ و ثبت سوابق قبلی کارکرد/اضافه‌کاری و تصویر بنر اصلی', async () => {
    const startRes = await fetch(`${baseUrl}/api/attendance/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ event_type: 'WORK_START', note: 'شروع شیفت تست' }),
    });
    expect(startRes.status).toBe(201);

    const dupStartRes = await fetch(`${baseUrl}/api/attendance/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ event_type: 'WORK_START' }),
    });
    expect(dupStartRes.status).toBe(400);

    // ثبت سابقه کارکرد و اضافه‌کاری قبلی (مثلاً ۱۰ ساعت کارکرد و ۳ ساعت اضافه‌کاری در ۲ روز کاری)
    const histWorkRes = await fetch(`${baseUrl}/api/historical-work`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/06/31',
        title: 'کارکرد قبلی شهریور',
        work_days_count: 2,
        net_work_hours: 10,
        net_work_minutes_part: 0,
        overtime_hours: 3,
        overtime_minutes_part: 0,
      }),
    });
    expect(histWorkRes.status).toBe(201);

    // تنظیم تصویر پس‌زمینه بنر اصلی
    const bannerRes = await fetch(`${baseUrl}/api/settings/banner`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ banner_bg_url: '/uploads/logo.png' }),
    });
    expect(bannerRes.status).toBe(200);

    const [device1Res, device2Res] = await Promise.all([
      fetch(`${baseUrl}/api/attendance/live-status`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      }),
      fetch(`${baseUrl}/api/manager/dashboard`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      }),
    ]);
    const dev1 = await device1Res.json();
    const dev2 = await device2Res.json();
    expect(dev1.liveState.status).toBe(dev2.liveState.status);
    expect(dev1.liveState.last_event.id).toBe(dev2.liveState.last_event.id);
    expect(dev2.kpis.totalNetWorkMinutes).toBe(600);
    expect(dev2.kpis.totalOvertimeMinutes).toBe(180);
    expect(dev2.kpis.totalWorkDays).toBe(2);

    const logId = dev1.liveState.last_event.id;
    const overrideRes = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'UPDATE',
        log_id: logId,
        event_type: 'WORK_START',
        recorded_time: '08:25',
        reason: 'TEST: اصلاح ساعت ورود بر اساس بررسی دوربین',
      }),
    });
    expect(overrideRes.status).toBe(200);

    const auditRes = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const auditData = await auditRes.json();
    expect(auditData.logs.some((l: { action_type: string }) => l.action_type === 'ATTENDANCE_OVERRIDE')).toBe(
      true
    );
  });

  it('سناریو ۷، ۸ و ۹: ثبت درخواست مالی توسط امید میثمی، تأیید توسط مجید نورایی، جلوگیری از تأیید تکراری و ثبت مستقیم سابقه مالی', async () => {
    const reqRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 3500000,
        tx_type: 'ADVANCE',
        shamsi_date: '1405/07/30',
        description: 'درخواست مساعده مهرماه',
      }),
    });
    const reqData = await reqRes.json();
    expect(reqRes.status).toBe(201);
    const txId = reqData.transactionId;

    const beforeApproveRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const beforeApproveData = await beforeApproveRes.json();
    expect(beforeApproveData.summary.approvedTotalToman).toBe(0);
    expect(beforeApproveData.summary.pendingTotalToman).toBe(3500000);

    const approveRes = await fetch(`${baseUrl}/api/finance/${txId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ decision: 'APPROVED', manager_note: 'واریز انجام شد' }),
    });
    expect(approveRes.status).toBe(200);

    const dupApproveRes = await fetch(`${baseUrl}/api/finance/${txId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    expect(dupApproveRes.status).toBe(409);

    const directRes = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 12000000,
        tx_type: 'SALARY',
        shamsi_date: '1405/07/30',
        description: 'تسویه حقوق مهرماه',
      }),
    });
    expect(directRes.status).toBe(201);

    const afterRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const afterData = await afterRes.json();
    expect(afterData.summary.approvedTotalToman).toBe(15500000);
    expect(afterData.summary.pendingTotalToman).toBe(0);
  });

  it('سناریو ۱۱: رفتار امن و صحیح هنگام قطع اتصال دیتابیس MySQL بدون ذخیره پنهانی یا افشای اطلاعات حساس', async () => {
    setSimulatedDatabaseDisconnect(true);
    try {
      const clockFailRes = await fetch(`${baseUrl}/api/attendance/clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ event_type: 'WORK_END' }),
      });
      const clockFailData = await clockFailRes.json();
      expect(clockFailRes.status).toBe(503);
      expect(clockFailData.ok).toBe(false);
      expect(clockFailData.code).toBe('DB_UNAVAILABLE');
      expect(JSON.stringify(clockFailData)).not.toContain('mgammon_pass');
    } finally {
      setSimulatedDatabaseDisconnect(false);
    }
  });

  it('سناریوی همخوانی API مدیر و امور مالی: بازگرداندن settingsSnapshots، جداسازی OTHER از تنخواه و PETTY_CASH از پرداختی و کسر صفر برای ABSENCE', async () => {
    const beforeFinRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const beforeFin = await beforeFinRes.json();
    const prevPettyCash = Number(beforeFin.summary?.approvedPettyCashToman || 0);

    const beforeDashRes = await fetch(`${baseUrl}/api/manager/dashboard`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const beforeDash = await beforeDashRes.json();
    expect(beforeDash.ok).toBe(true);
    expect(Array.isArray(beforeDash.settingsSnapshots)).toBe(true);
    expect(typeof beforeDash.kpis.accountBalanceToman).toBe('number');
    expect(typeof beforeDash.kpis.paidLeavePayToman).toBe('number');
    expect(typeof beforeDash.kpis.approvedPettyCashToman).toBe('number');
    const prevDashPayments = Number(beforeDash.kpis.approvedPaymentsToman || 0);
    const prevDashPetty = Number(beforeDash.kpis.approvedPettyCashToman || 0);

    // ثبت ۱ مورد PETTY_CASH (تنخواه کارگاهی -> باید به تنخواه اضافه شود نه به پرداختی) و ۱ مورد OTHER (هزینه/تعهد -> نباید به تنخواه اضافه شود)
    const pettyRes = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 450000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/07/25',
        description: 'خرید متریال کارگاه',
      }),
    });
    expect(pettyRes.status).toBe(201);

    const otherRes = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 300000,
        tx_type: 'OTHER',
        shamsi_date: '1405/07/26',
        description: 'تعهد کسرشونده تست',
      }),
    });
    expect(otherRes.status).toBe(201);

    const afterFinRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const afterFin = await afterFinRes.json();
    // فقط PETTY_CASH باید در approvedPettyCashToman شمرده شود و OTHER وارد آن نشود
    expect(afterFin.summary.approvedPettyCashToman).toBe(prevPettyCash + 450000);

    const afterDashRes = await fetch(`${baseUrl}/api/manager/dashboard`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const afterDash = await afterDashRes.json();
    expect(afterDash.kpis.approvedPettyCashToman).toBe(prevDashPetty + 450000);
    // PETTY_CASH نباید در approvedPaymentsToman مدیر جمع شود؛ فقط OTHER به پرداختی/کسر از حساب اضافه می‌شود
    expect(afterDash.kpis.approvedPaymentsToman).toBe(prevDashPayments + 300000);
  });

  it('آزمون امنیتی ۱: بررسی ورود با رمز اشتباه، منع رمز پیش‌فرض و SESSION_SECRET ضعیف در محیط عملیاتی، و محدودیت تلاش ورود (Brute-Force)', async () => {
    resetAllLoginRateLimits();

    // ۱-الف: بررسی توقف راه‌اندازی در محیط Production با SESSION_SECRET ضعیف یا پیش‌فرض
    expect(() =>
      validateProductionSecurityConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'mgammon-duo-enterprise-secret-2026',
      })
    ).toThrow(/SESSION_SECRET/);

    expect(() =>
      validateProductionSecurityConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'short-secret',
      })
    ).toThrow(/SESSION_SECRET/);

    // ۱-ب: مسدودسازی ورود با رمز پیش‌فرض در محیط عملیاتی (Production)
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8';
    try {
      const defaultPwdProdRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'worker',
          password: 'Worker@1405',
        }),
      });
      expect(defaultPwdProdRes.status).toBe(403);
      const defaultPwdProdData = await defaultPwdProdRes.json();
      expect(defaultPwdProdData.code).toBe('DEFAULT_PASSWORD_FORBIDDEN');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }

    // ۱-ج: بررسی ورود با رمز اشتباه و اعمال قفل موقت در تلاش پنجم و ششم (Rate Limiting)
    resetAllLoginRateLimits();
    try {
      for (let i = 0; i < 4; i++) {
        const wrongRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'worker',
            password: `WrongPassword_${i}`,
          }),
        });
        expect(wrongRes.status).toBe(401);
      }

      const fifthAttemptLockedRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'worker',
          password: 'WrongPassword_5',
        }),
      });
      expect(fifthAttemptLockedRes.status).toBe(429);

      const sixthAttemptLockedRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'worker',
          password: 'WrongPassword_6',
        }),
      });
      expect(sixthAttemptLockedRes.status).toBe(429);
      const lockedData = await sixthAttemptLockedRes.json();
      expect(lockedData.code).toBe('TOO_MANY_ATTEMPTS');
    } finally {
      resetAllLoginRateLimits();
    }
  });

  it('آزمون امنیتی ۲ و ۳: جلوگیری از اجرای APIهای مدیریتی توسط کارمند (RBAC) و جلوگیری از دسترسی به اطلاعات کاربر دیگر با تغییر شناسه (IDOR)', async () => {
    // ۲: تلاش کارمند برای اجرای APIهای مدیریتی
    const workerSettingsPut = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify(BASE_SETTINGS),
    });
    expect(workerSettingsPut.status).toBe(403);

    const workerDirectFinance = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 5000000,
        tx_type: 'BONUS',
        shamsi_date: '1405/07/30',
        description: 'تلاش غیرمجاز کارمند',
      }),
    });
    expect(workerDirectFinance.status).toBe(403);

    const workerOverride = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        action: 'CREATE',
        work_date: '2026-10-24',
        event_type: 'WORK_START',
        recorded_time: '08:00',
        reason: 'تلاش غیرمجاز',
      }),
    });
    expect(workerOverride.status).toBe(403);

    // بررسی عدم افشای رمز پنل پیامکی برای کارمند در تنظیمات
    const workerSettingsGet = await fetch(`${baseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    const workerSettingsData = await workerSettingsGet.json();
    expect(workerSettingsData.settings.melipayamak_password).toBe('');

    // ۳: تلاش کارمند برای دسترسی به اطلاعات کاربر دیگر با تغییر شناسه (userId=1 متعلق به مدیر)
    const idorFinanceRes = await fetch(`${baseUrl}/api/finance?userId=1`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(idorFinanceRes.status).toBe(403);
    const idorFinanceData = await idorFinanceRes.json();
    expect(idorFinanceData.code).toBe('FORBIDDEN_USER_ACCESS');

    const idorHistoryRes = await fetch(`${baseUrl}/api/attendance/history?user_id=1`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(idorHistoryRes.status).toBe(403);

    const idorLeaveRes = await fetch(`${baseUrl}/api/leaves?userId=1`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(idorLeaveRes.status).toBe(403);
  });

  it('آزمون امنیتی ۴ و ۵: درخواست بدون توکن، بررسی کوکی HttpOnly، محافظت CSRF و بی‌اعتبارسازی نشست پس از خروج یا انقضا', async () => {
    // ۵-الف: درخواست بدون توکن
    const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    expect(noTokenRes.status).toBe(401);

    // ورود برای دریافت کوکی نشست HttpOnly و توکن CSRF
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'worker',
        password: wrkInitialPass,
      }),
    });
    expect(loginRes.status).toBe(200);
    const setCookieHeaders = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get('set-cookie') || ''];
    const cookieJoined = setCookieHeaders.join('; ');
    expect(cookieJoined).toContain('mgammon_duo_sid=');
    expect(cookieJoined).toContain('HttpOnly');
    expect(cookieJoined).toContain('SameSite=Lax');
    expect(cookieJoined).toContain('mgammon_csrf_token=');

    const sidMatch = cookieJoined.match(/mgammon_duo_sid=([^;]+)/);
    const csrfMatch = cookieJoined.match(/mgammon_csrf_token=([^;]+)/);
    expect(sidMatch).not.toBeNull();
    expect(csrfMatch).not.toBeNull();
    const sidCookie = `mgammon_duo_sid=${sidMatch![1]}; mgammon_csrf_token=${csrfMatch![1]}`;
    const csrfToken = decodeURIComponent(csrfMatch![1]);
    const tempLoginData = await loginRes.json();
    const tempBearer = tempLoginData.token;

    // ۵-ب: درخواست تغییردهنده داده با کوکی اما بدون هدر X-CSRF-Token باید مسدود شود (403)
    const csrfMissingRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sidCookie,
      },
      body: JSON.stringify({
        amount_toman: 100000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/07/30',
        description: 'تست بدون توکن CSRF',
      }),
    });
    expect(csrfMissingRes.status).toBe(403);
    const csrfMissingData = await csrfMissingRes.json();
    expect(csrfMissingData.code).toBe('CSRF_TOKEN_INVALID');

    // ۵-ج: درخواست با Origin نامعتبر بیگانه باید مسدود شود (403)
    const csrfBadOriginRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sidCookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://evil-attacker.example.com',
      },
      body: JSON.stringify({
        amount_toman: 100000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/07/30',
        description: 'تست Origin جعلی',
      }),
    });
    expect(csrfBadOriginRes.status).toBe(403);
    const csrfBadOriginData = await csrfBadOriginRes.json();
    expect(csrfBadOriginData.code).toBe('CSRF_ORIGIN_MISMATCH');

    // ۴: خروج از حساب و تلاش برای استفاده مجدد از نشست خروج‌کرده
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: sidCookie,
        'X-CSRF-Token': csrfToken,
      },
    });
    expect(logoutRes.status).toBe(200);

    const reuseAfterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tempBearer}` },
    });
    expect(reuseAfterLogoutRes.status).toBe(401);
  });

  it('آزمون امنیتی ۶ و ۷: محافظت از پیوست‌های خصوصی و جلوگیری از آپلود فایل جعلی، خراب یا نامعتبر', async () => {
    // ۷-الف: آپلود فایل جعلی (محتوای اسکریپت/اجرایی با پسوند تصویر .jpg) باید رد شود
    const fakeJpgBase64 =
      'data:image/jpeg;base64,' + Buffer.from('MZ_FAKE_EXECUTABLE_SCRIPT_CONTENT').toString('base64');

    const fakeUploadRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 250000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/07/30',
        description: 'تست فایل جعلی',
        receipt_base64: fakeJpgBase64,
        receipt_file_name: 'fake_receipt.jpg',
      }),
    });
    expect(fakeUploadRes.status).toBe(400);

    // ۷-ب: آپلود فایل اکسل جعلی یا خراب باید رد شود
    const fakeExcelBase64 = Buffer.from('NOT_A_VALID_EXCEL_OR_ZIP_FILE').toString('base64');
    const fakeExcelRes = await fetch(`${baseUrl}/api/historical-work/upload-excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        file_data: fakeExcelBase64,
      }),
    });
    expect(fakeExcelRes.status).toBe(400);

    // ۶: ایجاد یک پیوست خصوصی معتبر (PNG واقعی) و بررسی عدم دسترسی مستقیم بدون احراز هویت
    const validMinimalPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const validReceiptRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 400000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/07/30',
        description: 'رسید معتبر خصوصی',
        receipt_base64: validMinimalPngBase64,
        receipt_file_name: 'receipt.png',
      }),
    });
    expect(validReceiptRes.status).toBe(201);

    const financeListRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    const financeListData = await financeListRes.json();
    const txWithReceipt = financeListData.transactions.find(
      (t: { description: string; receipt_file_url?: string }) =>
        t.description === 'رسید معتبر خصوصی' && t.receipt_file_url
    );
    expect(txWithReceipt).toBeDefined();
    const privateMediaPath = txWithReceipt.receipt_file_url as string;
    expect(privateMediaPath).toMatch(/^\/assets\/media\/receipts\//);

    // تلاش برای دانلود مستقیم پیوست خصوصی بدون توکن احراز هویت باید با 401 مسدود شود
    const unauthFileRes = await fetch(`${baseUrl}${privateMediaPath}`);
    expect(unauthFileRes.status).toBe(401);

    // دانلود پیوست خصوصی توسط مالک یا مدیر مجاز باید با 200 انجام شود
    const authFileRes = await fetch(`${baseUrl}${privateMediaPath}`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(authFileRes.status).toBe(200);
    expect(authFileRes.headers.get('content-type')).toBe('image/png');
  });

  it('آزمون امنیتی ۸: تغییر رمز عبور، الزام تغییر رمز اولیه و ابطال تمام نشست‌های قبلی پس از تغییر رمز', async () => {
    const originalWorkerPassword = wrkInitialPass;
    const newTemporaryPassword = 'NewSecure@1405!Worker';

    // ورود اولیه برای دریافت نشست قدیمی
    const oldSessionRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'worker',
        password: originalWorkerPassword,
      }),
    });
    expect(oldSessionRes.status).toBe(200);
    const oldSessionData = await oldSessionRes.json();
    const oldToken = oldSessionData.token;

    // تغییر رمز عبور توسط کاربر
    const changePwdRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${oldToken}`,
      },
      body: JSON.stringify({
        currentPassword: originalWorkerPassword,
        newPassword: newTemporaryPassword,
      }),
    });
    expect(changePwdRes.status).toBe(200);
    const changePwdData = await changePwdRes.json();
    const rotatedToken = changePwdData.token;
    expect(rotatedToken).toBeTruthy();

    // نشست قبلی (oldToken) باید بلافاصله باطل شده باشد
    const oldTokenCheckRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    expect(oldTokenCheckRes.status).toBe(401);

    // نشست جدید (rotatedToken) باید معتبر باشد
    const newTokenCheckRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rotatedToken}` },
    });
    expect(newTokenCheckRes.status).toBe(200);

    // بررسی اینکه تغییر رمز به یکی از رمزهای پیش‌فرض ناامن توسط سرور رد می‌شود (400)
    const rejectDefaultPwdRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rotatedToken}`,
      },
      body: JSON.stringify({
        currentPassword: newTemporaryPassword,
        newPassword: 'Worker@1405',
      }),
    });
    expect(rejectDefaultPwdRes.status).toBe(400);

    // بازگرداندن رمز عبور محیط توسعه در دیتابیس برای تکرارپذیری تست‌ها
    const bcrypt = await import('bcryptjs');
    const restoredHash = await bcrypt.default.hash(originalWorkerPassword, 10);
    await getPool().execute('UPDATE users SET password_hash = ? WHERE username = ?', [
      restoredHash,
      'worker',
    ]);
  });

  // ============================================================================
  // مرحله ۲: ۱۷ سناریوی عددی و قابل تکرار ممیزی موتور محاسبات (با اعداد مرجع مستقل)
  // ============================================================================
  it('ممیزی مرحله ۲ — سناریوهای ۱ تا ۱۰: آزمون‌های عددی مستقل حضور و غیاب، تأخیر، تعجیل، اضافه‌کاری، پنجشنبه، جمعه/تعطیلات، مأموریت و روز ناقص', () => {
    const auditSettings: SystemSettings = {
      ...BASE_SETTINGS,
      shift_start_time: '07:00',
      shift_end_time: '15:00',
      overtime_start_time: '15:00',
      thursday_shift_start_time: '07:00',
      thursday_shift_end_time: '14:00',
      thursday_overtime_start_time: '14:00',
      grace_period_minutes: 15,
      break_duration_minutes: 30,
      overtime_before_shift: false,
      friday_holiday_policy: 'ALL_OVERTIME',
      official_holidays: ['1405/08/04'],
    };

    // ۱. روز کاری عادی بدون تأخیر و اضافه‌کاری (شنبه ۱۴۰۵/۰۸/۰۲ برابر 2026-10-24، شیفت ۰۷:۰۰ تا ۱۵:۰۰ با ۳۰ دقیقه استراحت)
    // محاسبه مستقل: حضور ناخالص = 15:00 - 07:00 = 480 دقیقه | کسر استراحت = 30 دقیقه | کار خالص = 450 دقیقه | اضافه‌کاری = 0
    const s1 = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(101, 'WORK_START', '07:00:00', '2026-10-24', '1405/08/02'),
        makeLog(102, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s1.is_incomplete).toBe(false);
    expect(s1.is_late).toBe(false);
    expect(s1.late_minutes).toBe(0);
    expect(s1.gross_presence_minutes).toBe(480);
    expect(s1.break_deducted_minutes).toBe(30);
    expect(s1.net_work_minutes).toBe(450);
    expect(s1.overtime_minutes).toBe(0);

    // ۲. ورود دیرهنگام و اعمال مهلت مجاز (Grace Period = 15 دقیقه)
    // ۲-الف: ورود در ۰۷:۱۲ (۱۲ دقیقه پس از ۰۷:۰۰ <= ۱۵ دقیقه مهلت مجاز): تأخیر = false (۰ دقیقه)، کار خالص = 468 - 30 = 438 دقیقه
    const s2WithinGrace = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(201, 'WORK_START', '07:12:00', '2026-10-24', '1405/08/02'),
        makeLog(202, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s2WithinGrace.is_late).toBe(false);
    expect(s2WithinGrace.late_minutes).toBe(0);
    expect(s2WithinGrace.net_work_minutes).toBe(438);

    // ۲-ب: ورود در ۰۷:۲۵ (۲۵ دقیقه پس از ۰۷:۰۰ > ۱۵ دقیقه مهلت مجاز): تأخیر = true (۲۵ دقیقه)، کار خالص = 455 - 30 = 425 دقیقه
    const s2Late = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(203, 'WORK_START', '07:25:00', '2026-10-24', '1405/08/02'),
        makeLog(204, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s2Late.is_late).toBe(true);
    expect(s2Late.late_minutes).toBe(25);
    expect(s2Late.gross_presence_minutes).toBe(455);
    expect(s2Late.net_work_minutes).toBe(425);
    expect(s2Late.overtime_minutes).toBe(0);

    // ۳. خروج زودتر از موعد (ورود ۰۷:۰۰، خروج ۱۳:۳۰)
    // محاسبه مستقل: حضور ناخالص = 390 دقیقه (>= 300 دقیقه پس 30 دقیقه استراحت کسر می‌شود) -> کار خالص = 360 دقیقه، اضافه‌کاری = 0
    const s3EarlyExit = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(301, 'WORK_START', '07:00:00', '2026-10-24', '1405/08/02'),
        makeLog(302, 'WORK_END', '13:30:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s3EarlyExit.gross_presence_minutes).toBe(390);
    expect(s3EarlyExit.break_deducted_minutes).toBe(30);
    expect(s3EarlyExit.net_work_minutes).toBe(360);
    expect(s3EarlyExit.overtime_minutes).toBe(0);

    // ۴. اضافه‌کاری بعد از پایان شیفت (ورود ۰۷:۰۰، خروج ۱۷:۳۰ در شیفت ۰۷:۰۰ تا ۱۵:۰۰)
    // محاسبه مستقل: حضور ناخالص = 630 دقیقه | کسر استراحت = 30 دقیقه | کار خالص کل = 600 دقیقه | اضافه‌کاری بعد از 15:00 = 150 دقیقه
    const s4OvertimeAfter = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(401, 'WORK_START', '07:00:00', '2026-10-24', '1405/08/02'),
        makeLog(402, 'WORK_END', '17:30:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s4OvertimeAfter.gross_presence_minutes).toBe(630);
    expect(s4OvertimeAfter.net_work_minutes).toBe(600);
    expect(s4OvertimeAfter.overtime_minutes).toBe(150);

    // ۵. کار قبل از شروع شیفت (ورود ۰۶:۰۰، خروج ۱۵:۰۰)
    // ۵-الف: وقتی overtime_before_shift = false -> اضافه‌کاری = 0، حضور ناخالص = 540، کار خالص = 510
    const s5Disallowed = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(501, 'WORK_START', '06:00:00', '2026-10-24', '1405/08/02'),
        makeLog(502, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      { ...auditSettings, overtime_before_shift: false }
    );
    expect(s5Disallowed.overtime_minutes).toBe(0);
    expect(s5Disallowed.net_work_minutes).toBe(510);

    // ۵-ب: وقتی overtime_before_shift = true -> بازه ۰۶:۰۰ تا ۰۷:۰۰ = ۶۰ دقیقه اضافه‌کاری قبل از شیفت
    const s5Allowed = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(503, 'WORK_START', '06:00:00', '2026-10-24', '1405/08/02'),
        makeLog(504, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      { ...auditSettings, overtime_before_shift: true }
    );
    expect(s5Allowed.overtime_minutes).toBe(60);
    expect(s5Allowed.net_work_minutes).toBe(510);

    // ۶. شیفت متفاوت پنجشنبه (پنجشنبه ۱۴۰۵/۰۷/۳۰ برابر 2026-10-22، شیفت ۰۷:۰۰ تا ۱۴:۰۰، شروع اضافه‌کاری ۱۴:۰۰)
    // ورود ۰۷:۰۰، خروج ۱۵:۳۰ -> حضور ناخالص = 510 دقیقه | استراحت = 30 | کار خالص = 480 دقیقه | اضافه‌کاری بعد از 14:00 = 90 دقیقه
    const s6Thursday = calculateDailyAttendance(
      '2026-10-22',
      '1405/07/30',
      [
        makeLog(601, 'WORK_START', '07:00:00', '2026-10-22', '1405/07/30'),
        makeLog(602, 'WORK_END', '15:30:00', '2026-10-22', '1405/07/30'),
      ],
      auditSettings
    );
    expect(s6Thursday.day_name).toBe('پنجشنبه');
    expect(s6Thursday.gross_presence_minutes).toBe(510);
    expect(s6Thursday.net_work_minutes).toBe(480);
    expect(s6Thursday.overtime_minutes).toBe(90);

    // ۷. جمعه‌کاری و تعطیل رسمی در هر ۳ سیاست (ALL_OVERTIME, REGULAR_WORK, DISABLED)
    // ۷-الف: جمعه ۱۴۰۵/۰۸/۰۱ (2026-10-23)، حضور ۰۹:۰۰ تا ۱۳:۰۰ (۲۴۰ دقیقه) با سیاست ALL_OVERTIME -> کار خالص = 240، اضافه‌کاری = 240
    const s7FridayAllOt = calculateDailyAttendance(
      '2026-10-23',
      '1405/08/01',
      [
        makeLog(701, 'WORK_START', '09:00:00', '2026-10-23', '1405/08/01'),
        makeLog(702, 'WORK_END', '13:00:00', '2026-10-23', '1405/08/01'),
      ],
      { ...auditSettings, friday_holiday_policy: 'ALL_OVERTIME' }
    );
    expect(s7FridayAllOt.is_holiday_or_friday).toBe(true);
    expect(s7FridayAllOt.net_work_minutes).toBe(240);
    expect(s7FridayAllOt.overtime_minutes).toBe(240);

    // ۷-ب: تعطیل رسمی ۱۴۰۵/۰۸/۰۴ (2026-10-26) با سیاست REGULAR_WORK، حضور ۰۷:۰۰ تا ۱۶:۰۰ -> کار خالص = 510، اضافه‌کاری فقط بعد از 15:00 = 60 دقیقه
    const s7HolidayRegular = calculateDailyAttendance(
      '2026-10-26',
      '1405/08/04',
      [
        makeLog(703, 'WORK_START', '07:00:00', '2026-10-26', '1405/08/04'),
        makeLog(704, 'WORK_END', '16:00:00', '2026-10-26', '1405/08/04'),
      ],
      { ...auditSettings, friday_holiday_policy: 'REGULAR_WORK' }
    );
    expect(s7HolidayRegular.is_holiday_or_friday).toBe(true);
    expect(s7HolidayRegular.net_work_minutes).toBe(510);
    expect(s7HolidayRegular.overtime_minutes).toBe(60);

    // ۷-ج: جمعه با سیاست DISABLED -> کار خالص = 0، اضافه‌کاری = 0
    const s7FridayDisabled = calculateDailyAttendance(
      '2026-10-23',
      '1405/08/01',
      [
        makeLog(705, 'WORK_START', '09:00:00', '2026-10-23', '1405/08/01'),
        makeLog(706, 'WORK_END', '13:00:00', '2026-10-23', '1405/08/01'),
      ],
      { ...auditSettings, friday_holiday_policy: 'DISABLED' }
    );
    expect(s7FridayDisabled.net_work_minutes).toBe(0);
    expect(s7FridayDisabled.overtime_minutes).toBe(0);

    // ۸. مأموریت رفت‌وبرگشت در میانه روز بدون دوباره‌شماری ساعات
    // ورود ۰۷:۰۰، شروع مأموریت ۱۰:۰۰، پایان مأموریت ۱۲:۰۰، پایان کار ۱۵:۰۰
    // محاسبه مستقل: کل بازه ۰۷:۰۰ تا ۱۵:۰۰ = ۴۸۰ دقیقه (شامل ۱۲۰ دقیقه مأموریت بدون دوباره‌شماری) | استراحت = ۳۰ | کار خالص = ۴۵۰ دقیقه
    const s8MissionMidDay = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(801, 'WORK_START', '07:00:00', '2026-10-24', '1405/08/02'),
        makeLog(802, 'MISSION_START', '10:00:00', '2026-10-24', '1405/08/02'),
        makeLog(803, 'MISSION_END', '12:00:00', '2026-10-24', '1405/08/02'),
        makeLog(804, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s8MissionMidDay.mission_minutes).toBe(120);
    expect(s8MissionMidDay.gross_presence_minutes).toBe(480);
    expect(s8MissionMidDay.net_work_minutes).toBe(450);
    expect(s8MissionMidDay.overtime_minutes).toBe(0);

    // ۹. مأموریت از ابتدای روز (شروع مستقیم با MISSION_START در ۰۷:۰۰، بازگشت به کارگاه در ۰۹:۳۰ با MISSION_END، خروج در ۱۵:۰۰)
    // بررسی اعتبار توالی + عدم دوباره‌شماری: کل حضور ناخالص = 480 دقیقه، مأموریت = 150 دقیقه، کار خالص = 450 دقیقه
    const s9SeqValid = validateAttendanceSequence([], 'MISSION_START', '07:00:00');
    expect(s9SeqValid.valid).toBe(true);
    const s9FullSeqValid = validateFullDayLogSequence([
      { event_type: 'MISSION_START', recorded_time: '07:00:00' },
      { event_type: 'MISSION_END', recorded_time: '09:30:00' },
      { event_type: 'WORK_END', recorded_time: '15:00:00' },
    ]);
    expect(s9FullSeqValid.valid).toBe(true);

    const s9MissionFromStart = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [
        makeLog(901, 'MISSION_START', '07:00:00', '2026-10-24', '1405/08/02'),
        makeLog(902, 'MISSION_END', '09:30:00', '2026-10-24', '1405/08/02'),
        makeLog(903, 'WORK_END', '15:00:00', '2026-10-24', '1405/08/02'),
      ],
      auditSettings
    );
    expect(s9MissionFromStart.is_incomplete).toBe(false);
    expect(s9MissionFromStart.mission_minutes).toBe(150);
    expect(s9MissionFromStart.gross_presence_minutes).toBe(480);
    expect(s9MissionFromStart.net_work_minutes).toBe(450);
    expect(s9MissionFromStart.overtime_minutes).toBe(0);

    // ۱۰. ورود بدون خروج (در روز گذشته -> ناقص، کارکرد قطعی = ۰؛ در روز جاری -> ناقص، کارکرد موقت تا لحظه فعلی)
    const s10PastIncomplete = calculateDailyAttendance(
      '2026-10-20',
      '1405/07/28',
      [makeLog(1001, 'WORK_START', '07:00:00', '2026-10-20', '1405/07/28')],
      auditSettings,
      { isToday: false }
    );
    expect(s10PastIncomplete.is_incomplete).toBe(true);
    expect(s10PastIncomplete.net_work_minutes).toBe(0);
    expect(s10PastIncomplete.provisional_work_minutes).toBe(0);
    expect(s10PastIncomplete.overtime_minutes).toBe(0);

    const s10TodayProvisional = calculateDailyAttendance(
      '2026-10-24',
      '1405/08/02',
      [makeLog(1002, 'WORK_START', '07:00:00', '2026-10-24', '1405/08/02')],
      auditSettings,
      { isToday: true, currentTimeHHMM: '11:00' }
    );
    expect(s10TodayProvisional.is_incomplete).toBe(true);
    expect(s10TodayProvisional.net_work_minutes).toBe(0);
    expect(s10TodayProvisional.provisional_work_minutes).toBe(240);
  });

  it('ممیزی مرحله ۲ — سناریوهای ۱۳، ۱۴ و ۱۵: استخدام در میانه ماه، تغییر نرخ حقوق در میانه ماه (Snapshots) و تقویم شمسی (۲۹، ۳۰، ۳۱ روزه و کبیسه)', () => {
    // ۱۵. بررسی طول ماه‌های ۲۹، ۳۰ و ۳۱ روزه و اسفند کبیسه و غیرکبیسه + اعتبارسنجی ساعت
    expect(getShamsiMonthLength(1405, 1)).toBe(31); // فروردین ۳۱ روزه
    expect(getShamsiMonthLength(1405, 6)).toBe(31); // شهریور ۳۱ روزه
    expect(getShamsiMonthLength(1405, 7)).toBe(30); // مهر ۳۰ روزه
    expect(getShamsiMonthLength(1405, 11)).toBe(30); // بهمن ۳۰ روزه
    expect(isShamsiLeapYear(1403)).toBe(true);
    expect(getShamsiMonthLength(1403, 12)).toBe(30); // اسفند ۱۴۰۳ کبیسه (۳۰ روزه)
    expect(isValidShamsiDate('1403/12/30')).toBe(true);
    expect(isShamsiLeapYear(1404)).toBe(false);
    expect(getShamsiMonthLength(1404, 12)).toBe(29); // اسفند ۱۴۰۴ غیرکبیسه (۲۹ روزه)
    expect(isValidShamsiDate('1404/12/30')).toBe(false);
    expect(isShamsiLeapYear(1405)).toBe(false);
    expect(getShamsiMonthLength(1405, 12)).toBe(29); // اسفند ۱۴۰۵ غیرکبیسه (۲۹ روزه)
    expect(isShamsiLeapYear(1408)).toBe(true);
    expect(getShamsiMonthLength(1408, 12)).toBe(30); // اسفند ۱۴۰۸ کبیسه (۳۰ روزه)

    const rangeMehr = getShamsiMonthRange(1405, 7);
    expect(rangeMehr.monthLength).toBe(30);
    expect(rangeMehr.fromShamsi).toBe('1405/07/01');
    expect(rangeMehr.toShamsi).toBe('1405/07/30');

    expect(isValidTimeHHMMOrHHMMSS('08:30', false)).toBe(true);
    expect(isValidTimeHHMMOrHHMMSS('23:59:59', true)).toBe(true);
    expect(isValidTimeHHMMOrHHMMSS('25:00', false)).toBe(false);
    expect(isValidTimeHHMMOrHHMMSS('12:60', false)).toBe(false);

    // ۱۳ و ۱۴. استخدام در میانه ماه (۱۴۰۵/۰۷/۱۱) + تغییر نرخ حقوق در میانه ماه (از ۱۴۰۵/۰۷/۱۶)
    // نیمه اول ماه (۱۴۰۵/۰۷/۰۱ تا ۱۴۰۵/۰۷/۱۵): نرخ ساعتی عادی = ۱۰۰,۰۰۰ تومان، نرخ اضافه‌کاری = ۱۴۰٪ (۱۴۰,۰۰۰ تومان)
    // نیمه دوم ماه (از ۱۴۰۵/۰۷/۱۶ به بعد): نرخ ساعتی عادی = ۱۵۰,۰۰۰ تومان، نرخ اضافه‌کاری = ۱۴۰٪ (۲۱۰,۰۰۰ تومان)
    const oldSettings: SystemSettings = {
      ...BASE_SETTINGS,
      shift_start_time: '07:00',
      shift_end_time: '15:00',
      overtime_start_time: '15:00',
      break_duration_minutes: 30,
      base_salary_toman: 22000000,
      hourly_rate_toman: 100000,
      overtime_calc_mode: 'PERCENTAGE',
      overtime_percentage: 140,
      overtime_rate_toman: null,
      collaboration_start_shamsi: '1405/07/11', // استخدام از ۱۱ مهر ۱۴۰۵
      effective_from_shamsi: '1405/07/01',
    };

    const newSettingsFrom16th: SystemSettings = {
      ...oldSettings,
      base_salary_toman: 33000000,
      hourly_rate_toman: 150000,
      effective_from_shamsi: '1405/07/16',
    };

    const snapshots: SystemSettingsSnapshot[] = [
      {
        id: 1,
        effective_from_shamsi: '1405/07/01',
        settings: oldSettings,
      },
    ];

    // ترددها در مهر ۱۴۰۵:
    // الف) ۱۴۰۵/۰۷/۰۵ (قبل از تاریخ استخدام ۱۴۰۵/۰۷/۱۱) -> نباید در دوره همکاریِ فعال محاسبه شود
    // ب) ۱۴۰۵/۰۷/۱۲ (در نیمه اول با نرخ ۱۰۰,۰۰۰ تومان): ورود ۰۷:۰۰ تا ۱۷:۰۰ -> حضور ۶۰۰، استراحت ۳۰، کار خالص کل ۵۷۰ (۴۵۰ عادی + ۱۲۰ اضافه‌کاری)
    //    محاسبه مستقل روز ۱۲ مهر:
    //    کار عادی = (450 / 60) * 100,000 = 7.5 * 100,000 = 750,000 تومان
    //    اضافه‌کاری = (120 / 60) * 140,000 = 2 * 140,000 = 280,000 تومان
    // ج) ۱۴۰۵/۰۷/۲۰ (در نیمه دوم با نرخ ۱۵۰,۰۰۰ تومان): ورود ۰۷:۰۰ تا ۱۶:۰۰ -> حضور ۵۴۰، استراحت ۳۰، کار خالص کل ۵۱۰ (۴۵۰ عادی + ۶۰ اضافه‌کاری)
    //    محاسبه مستقل روز ۲۰ مهر:
    //    کار عادی = (450 / 60) * 150,000 = 7.5 * 150,000 = 1,125,000 تومان
    //    اضافه‌کاری = (60 / 60) * 210,000 = 1 * 210,000 = 210,000 تومان
    const g05 = shamsiToGregorian('1405/07/05');
    const g12 = shamsiToGregorian('1405/07/12');
    const g20 = shamsiToGregorian('1405/07/20');

    const periodLogs: AttendanceLog[] = [
      makeLog(1301, 'WORK_START', '07:00:00', g05, '1405/07/05'),
      makeLog(1302, 'WORK_END', '15:00:00', g05, '1405/07/05'),
      makeLog(1303, 'WORK_START', '07:00:00', g12, '1405/07/12'),
      makeLog(1304, 'WORK_END', '17:00:00', g12, '1405/07/12'),
      makeLog(1305, 'WORK_START', '07:00:00', g20, '1405/07/20'),
      makeLog(1306, 'WORK_END', '16:00:00', g20, '1405/07/20'),
    ];

    const payroll = calculateMonthlyPayrollPeriod({
      jy: 1405,
      jm: 7,
      logs: periodLogs,
      currentSettings: newSettingsFrom16th,
      snapshots,
      collaborationStartShamsi: '1405/07/11',
    });

    // بررسی مستقل استخدام در میانه ماه: از ۱۱ تا ۳۰ مهر = ۲۰ روز در دوره استخدام
    expect(payroll.monthRange.monthLength).toBe(30);
    expect(payroll.activeContractCalendarDays).toBe(20);
    expect(payroll.totalConfirmedWorkDays).toBe(2); // فقط ۱۲ مهر و ۲۰ مهر
    expect(payroll.totalRegularWorkMinutes).toBe(900); // 450 + 450
    expect(payroll.totalOvertimeMinutes).toBe(180); // 120 + 60
    expect(payroll.totalNetWorkMinutes).toBe(1080); // 570 + 510
    expect(payroll.earnedRegularWorkToman).toBe(1875000); // 750,000 + 1,125,000
    expect(payroll.earnedOvertimeToman).toBe(490000); // 280,000 + 210,000
    expect(payroll.earnedRegularWorkToman + payroll.earnedOvertimeToman).toBe(2365000); // 1,875,000 + 490,000
  });

  it('ممیزی مرحله ۲ — سناریوهای ۱۱، ۱۲ و ۱۷ (یکپارچه با دیتابیس و API): دو درخواست هم‌زمان (قفل تراکنش)، اصلاح دستی و حذف منطقی، تغییر نرخ حقوق در دیتابیس و بازسازی گزارش پس از اصلاح سوابق', async () => {
    const pool = getPool();
    await pool.execute('DELETE FROM attendance_logs');
    await pool.execute('DELETE FROM historical_work_records');
    await pool.execute('DELETE FROM system_settings_snapshots');

    // دریافت نشست معتبر برای کارمند پس از تست چرخش رمز عبور در تست قبلی
    const freshWrkLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'worker',
        password: wrkInitialPass,
      }),
    });
    expect(freshWrkLoginRes.status).toBe(200);
    const freshWrkLoginData = await freshWrkLoginRes.json();
    workerToken = freshWrkLoginData.token;

    // ۱۱. آزمون دو درخواست هم‌زمان (Concurrent Requests) برای ثبت ورود در روز جاری
    // به لطف قفل ردیف کاربر (SELECT id FROM users WHERE id = ? FOR UPDATE)، دقیقاً یکی باید 201 و دیگری 400 شود
    const [concRes1, concRes2] = await Promise.all([
      fetch(`${baseUrl}/api/attendance/clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ event_type: 'WORK_START', note: 'درخواست هم‌زمان ۱' }),
      }),
      fetch(`${baseUrl}/api/attendance/clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ event_type: 'WORK_START', note: 'درخواست هم‌زمان ۲' }),
      }),
    ]);

    const statuses = [concRes1.status, concRes2.status].sort();
    expect(statuses).toEqual([201, 400]);

    // پاکسازی تردد امروز برای اجرای دقیق سناریوی ۱۲، ۱۴ و ۱۷
    await pool.execute('DELETE FROM attendance_logs');

    // تنظیم نرخ اولیه حقوق از ۱۴۰۵/۰۷/۰۱ (ساعتی ۱۰۰,۰۰۰ تومان، اضافه‌کاری ۱۴۰٪ = ۱۴۰,۰۰۰ تومان)
    const putOldSettingsRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        ...BASE_SETTINGS,
        shift_start_time: '07:00',
        shift_end_time: '15:00',
        overtime_start_time: '15:00',
        break_duration_minutes: 30,
        base_salary_toman: 22000000,
        hourly_rate_toman: 100000,
        overtime_calc_mode: 'PERCENTAGE',
        overtime_percentage: 140,
        effective_from_shamsi: '1405/07/01',
        apply_retroactively: true,
      }),
    });
    expect(putOldSettingsRes.status).toBe(200);

    // ۱۴. تغییر نرخ حقوق در میانه ماه از ۱۴۰۵/۰۷/۱۶ به ساعتی ۱۵۰,۰۰۰ تومان (بدون عطف به ماسبق)
    const putNewSettingsRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        ...BASE_SETTINGS,
        shift_start_time: '07:00',
        shift_end_time: '15:00',
        overtime_start_time: '15:00',
        break_duration_minutes: 30,
        base_salary_toman: 33000000,
        hourly_rate_toman: 150000,
        overtime_calc_mode: 'PERCENTAGE',
        overtime_percentage: 140,
        effective_from_shamsi: '1405/07/16',
        apply_retroactively: false,
      }),
    });
    expect(putNewSettingsRes.status).toBe(200);

    // ۱۲. ثبت تردد دستی توسط مدیر در روز شنبه ۱۴۰۵/۰۷/۱۱ (با نرخ قدیم ۱۰۰,۰۰۰) و روز دوشنبه ۱۴۰۵/۰۷/۲۰ (با نرخ جدید ۱۵۰,۰۰۰)
    // همچنین بررسی رد شدن ساعت نامعتبر (مثلاً 25:99)
    const invalidTimeRes = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'ADD',
        shamsi_date: '1405/07/11',
        event_type: 'WORK_START',
        recorded_time: '25:99',
        reason: 'TEST: ساعت نامعتبر',
      }),
    });
    expect(invalidTimeRes.status).toBe(400);

    // ثبت روز شنبه ۱۴۰۵/۰۷/۱۱: ۰۷:۰۰ تا ۱۷:۰۰ (کار عادی = ۴۵۰ دقیقه = ۷.۵ ساعت * ۱۰۰,۰۰۰ = ۷۵۰,۰۰۰ تومان | اضافه‌کاری = ۱۲۰ دقیقه = ۲ ساعت * ۱۴۰,۰۰۰ = ۲۸۰,۰۰۰ تومان)
    await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'ADD',
        shamsi_date: '1405/07/11',
        event_type: 'WORK_START',
        recorded_time: '07:00',
        reason: 'TEST: ثبت ورود ۱۱ مهر',
      }),
    });
    const addEnd10Res = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'ADD',
        shamsi_date: '1405/07/11',
        event_type: 'WORK_END',
        recorded_time: '17:00',
        reason: 'TEST: ثبت خروج ۱۱ مهر',
      }),
    });
    expect(addEnd10Res.status).toBe(201);

    // ثبت روز ۱۴۰۵/۰۷/۲۰: ۰۷:۰۰ تا ۱۶:۰۰ (کار عادی = ۴۵۰ دقیقه = ۷.۵ ساعت * ۱۵۰,۰۰۰ = ۱,۱۲۵,۰۰۰ تومان | اضافه‌کاری = ۶۰ دقیقه = ۱ ساعت * ۲۱۰,۰۰۰ = ۲۱۰,۰۰۰ تومان)
    await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'ADD',
        shamsi_date: '1405/07/20',
        event_type: 'WORK_START',
        recorded_time: '07:00',
        reason: 'TEST: ثبت ورود ۲۰ مهر',
      }),
    });
    const addEnd20Res = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'ADD',
        shamsi_date: '1405/07/20',
        event_type: 'WORK_END',
        recorded_time: '16:00',
        reason: 'TEST: ثبت خروج ۲۰ مهر',
      }),
    });
    expect(addEnd20Res.status).toBe(201);

    // بررسی گزارش زنده پرسنل و داشبورد مدیر قبل از اصلاح سوابق
    const liveBeforeRes = await fetch(`${baseUrl}/api/attendance/live-status`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    const liveBefore = await liveBeforeRes.json();
    expect(liveBefore.workerKpis.totalWorkDays).toBe(2);
    expect(liveBefore.workerKpis.totalNetWorkMinutes).toBe(1080); // 570 + 510
    expect(liveBefore.workerKpis.totalOvertimeMinutes).toBe(180); // 120 + 60
    expect(liveBefore.workerKpis.earnedRegularWorkToman).toBe(1875000); // 750,000 + 1,125,000
    expect(liveBefore.workerKpis.earnedOvertimeToman).toBe(490000); // 280,000 + 210,000

    // ۱۷. اصلاح سوابق قدیمی و بررسی بازسازی خودکار گزارش‌ها و جمع‌های مالی
    // الف) ویرایش ساعت خروج روز ۱۴۰۵/۰۷/۲۰ از ۱۶:۰۰ به ۱۸:۰۰ (افزایش ۲ ساعت اضافه‌کاری با نرخ جدید ۲۱۰,۰۰۰ -> +۴۲۰,۰۰۰ تومان)
    const histRes = await fetch(`${baseUrl}/api/attendance/history?fromShamsi=1405/07/20&toShamsi=1405/07/20`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const histData = await histRes.json();
    const day20Logs = histData.dailySummaries[0].logs;
    const endLog20 = day20Logs.find((l: AttendanceLog) => l.event_type === 'WORK_END');
    expect(endLog20).toBeDefined();

    const updateEnd20Res = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'UPDATE',
        log_id: endLog20.id,
        event_type: 'WORK_END',
        recorded_time: '18:00',
        reason: 'TEST: اصلاح ساعت خروج ۲۰ مهر به ۱۸:۰۰',
      }),
    });
    expect(updateEnd20Res.status).toBe(200);

    // ب) ثبت یک سابقه کارکرد دستی در ۱۴۰۵/۰۷/۰۵ و سپس ویرایش آن با PUT /api/historical-work/:id
    const addHistWorkRes = await fetch(`${baseUrl}/api/historical-work`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/07/05',
        title: 'کارکرد دستی ۵ مهر',
        work_days_count: 1,
        net_work_hours: 8,
        net_work_minutes_part: 0,
        overtime_hours: 1,
        overtime_minutes_part: 0,
      }),
    });
    expect(addHistWorkRes.status).toBe(201);
    const addHistWorkData = await addHistWorkRes.json();
    const histRecordId = addHistWorkData.id;

    // ویرایش سابقه کارکرد ۵ مهر به ۶ ساعت کار عادی (۳۶۰ دقیقه) و ۲ ساعت اضافه‌کاری (۱۲۰ دقیقه) با نرخ قدیم (۱۰۰,۰۰۰ عادی / ۱۴۰,۰۰۰ اضافه‌کاری)
    // محاسبه مستقل ۵ مهر پس از ویرایش: کار عادی = 6 * 100,000 = 600,000 تومان | اضافه‌کاری = 2 * 140,000 = 280,000 تومان
    const editHistWorkRes = await fetch(`${baseUrl}/api/historical-work/${histRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/07/05',
        title: 'کارکرد اصلاح‌شده ۵ مهر',
        work_days_count: 1,
        net_work_hours: 6,
        net_work_minutes_part: 0,
        overtime_hours: 2,
        overtime_minutes_part: 0,
        reason: 'TEST: اصلاح سابقه کارکرد ۵ مهر',
      }),
    });
    expect(editHistWorkRes.status).toBe(200);

    // بررسی بازسازی گزارش در داشبورد مدیر و وضعیت زنده پرسنل:
    // روز ۱۰ مهر: عادی 450 دقیقه (750,000 تومان) + اضافه‌کاری 120 دقیقه (280,000 تومان) -> کل کار خالص = 570
    // روز ۲۰ مهر (اصلاح‌شده تا ۱۸:۰۰): عادی 450 دقیقه (1,125,000 تومان) + اضافه‌کاری 180 دقیقه (630,000 تومان) -> کل کار خالص = 630
    // سابقه ۵ مهر (اصلاح‌شده): عادی 360 دقیقه (600,000 تومان) + اضافه‌کاری 120 دقیقه (280,000 تومان)
    // جمع کل کار خالص = 570 + 630 + 360 = 1560 دقیقه
    // جمع کل اضافه‌کاری = 120 + 180 + 120 = 420 دقیقه
    // جمع کل دستمزد کار عادی = 750,000 + 1,125,000 + 600,000 = 2,475,000 تومان
    // جمع کل دستمزد اضافه‌کاری = 280,000 + 630,000 + 280,000 = 1,190,000 تومان
    const [liveAfterRes, dashAfterRes] = await Promise.all([
      fetch(`${baseUrl}/api/attendance/live-status`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      }),
      fetch(`${baseUrl}/api/manager/dashboard`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      }),
    ]);
    const liveAfter = await liveAfterRes.json();
    const dashAfter = await dashAfterRes.json();

    expect(liveAfter.workerKpis.totalWorkDays).toBe(3);
    expect(liveAfter.workerKpis.totalNetWorkMinutes).toBe(1560);
    expect(liveAfter.workerKpis.totalOvertimeMinutes).toBe(420);
    expect(liveAfter.workerKpis.earnedRegularWorkToman).toBe(2475000);
    expect(liveAfter.workerKpis.earnedOvertimeToman).toBe(1190000);

    expect(dashAfter.kpis.totalWorkDays).toBe(3);
    expect(dashAfter.kpis.totalNetWorkMinutes).toBe(1560);
    expect(dashAfter.kpis.totalOvertimeMinutes).toBe(420);
    expect(dashAfter.kpis.totalOvertimePayToman).toBe(1190000);

    // ۱۲-ب: حذف منطقی (DELETE) رویداد خروج روز ۲۰ مهر -> روز ۲۰ مهر به حالت ناقص (incomplete) درمی‌آید و از کارکرد قطعی خارج می‌شود
    const deleteEnd20Res = await fetch(`${baseUrl}/api/attendance/manager-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        action: 'DELETE',
        log_id: endLog20.id,
        reason: 'TEST: حذف منطقی خروج ۲۰ مهر برای تست روز ناقص',
      }),
    });
    expect(deleteEnd20Res.status).toBe(200);

    const dashAfterDeleteRes = await fetch(`${baseUrl}/api/manager/dashboard`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const dashAfterDelete = await dashAfterDeleteRes.json();
    expect(dashAfterDelete.kpis.incompleteDaysCount).toBe(1);
    expect(dashAfterDelete.kpis.totalWorkDays).toBe(2); // فقط ۱۰ مهر و ۵ مهر قطعی هستند
    expect(dashAfterDelete.kpis.totalNetWorkMinutes).toBe(930); // 570 + 360
    expect(dashAfterDelete.kpis.totalOvertimeMinutes).toBe(240); // 120 + 120
    expect(dashAfterDelete.kpis.totalOvertimePayToman).toBe(560000); // 280,000 + 280,000
  });

  // ============================================================================
  // مرحله ۳: ۱۰ آزمون اجباری افزایش پایداری دیتابیس، مهاجرت، تراکنش، پشتیبان‌گیری و بازیابی
  // (تمام آزمون‌ها روی دیتابیس ایزوله mgammon_duo_test اجرا می‌شوند و دیتابیس واقعی mgammon_duo دست‌نخورده می‌ماند)
  // ============================================================================
  it('مرحله ۳ — آزمون اجباری ۱ و ۲: اجرای اولیه با دیتابیس کاملاً خالی + اجرای مجدد با اطلاعات موجود بدون بازنشانی رمز یا تنظیمات', async () => {
    expect(getDbConfig().database).toBe('mgammon_duo_test');

    // بررسی محافظت از محیط عملیاتی cPanel (عدم اجرای دستورات نصب محلی در Production یا کاربر غیر root)
    expect(isCpanelOrProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
    expect(isCpanelOrProductionEnvironment({ CPANEL_ENV: 'true' })).toBe(true);
    expect(isCpanelOrProductionEnvironment({ DB_USER: 'cpanel_real_user' })).toBe(true);

    // ۱. تخلیه کامل دیتابیس آزمایشی mgammon_duo_test برای شبیه‌سازی اجرای اولیه روی دیتابیس کاملاً خالی
    const cfg = getDbConfig();
    const adminConn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
    });
    await adminConn.query('REPAIR TABLE mysql.proc').catch(() => {});
    try {
      await adminConn.query('DROP DATABASE IF EXISTS `mgammon_duo_test`');
      await adminConn.query(
        'CREATE DATABASE `mgammon_duo_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } catch {
      await adminConn.query(
        'CREATE DATABASE IF NOT EXISTS `mgammon_duo_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
      await adminConn.query('USE `mgammon_duo_test`');
      await adminConn.query('SET FOREIGN_KEY_CHECKS = 0');
      const [tbls] = await adminConn.query<mysql.RowDataPacket[]>('SHOW TABLES');
      for (const row of tbls) {
        const tblName = Object.values(row)[0];
        if (tblName) {
          await adminConn.query(`DROP TABLE IF EXISTS \`${tblName}\``);
        }
      }
      await adminConn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    await adminConn.end();

    await resetPool();

    // بررسی اینکه پیش از اجرای initializeDatabase، برنامه وضعیت آماده کاذب گزارش نمی‌دهد
    const unreadyHealthRes = await fetch(`${baseUrl}/api/health`);
    expect(unreadyHealthRes.status).toBe(503);
    const unreadyHealthData = await unreadyHealthRes.json();
    expect(unreadyHealthData.ok).toBe(false);
    expect(unreadyHealthData.dbConnected).toBe(false);

    const unreadyApiRes = await fetch(`${baseUrl}/api/settings`);
    expect(unreadyApiRes.status).toBe(503);

    // اجرای اولیه initializeDatabase روی دیتابیس کاملاً خالی
    await initializeDatabase();

    const pool = getPool();
    const metricsAfterFreshInit = await collectDatabaseMetrics(pool);
    expect(metricsAfterFreshInit.tableCounts.users).toBe(2);
    expect(metricsAfterFreshInit.tableCounts.system_settings).toBe(1);
    expect(metricsAfterFreshInit.tableCounts.schema_migrations).toBe(6);

    // ۲. درج اطلاعات سفارشی (تغییر رمز عبور، تغییر بنر، تغییر حقوق پایه و ثبت تراکنش مالی) و اجرای مجدد initializeDatabase
    const bcrypt = await import('bcryptjs');
    const customManagerHash = await bcrypt.default.hash('CustomMgrPass#1405', 10);
    await pool.execute(
      "UPDATE users SET password_hash = ?, phone_number = '09121112233' WHERE role = 'manager'",
      [customManagerHash]
    );
    await pool.execute(
      "UPDATE system_settings SET base_salary_toman = 45000000, banner_bg_url = '/assets/media/custom-banner.png'"
    );

    const [uRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, role FROM users ORDER BY id ASC'
    );
    const mgrId = Number(uRows.find((u) => u.role === 'manager')!.id);
    const wrkId = Number(uRows.find((u) => u.role === 'worker')!.id);

    await pool.execute(
      `INSERT INTO financial_transactions
        (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, status, is_seen_by_manager)
       VALUES (?, ?, 7500000, 'ADVANCE', '2026-10-24', '1405/08/02', 'مساعده تست پایداری', 'APPROVED', 1)`,
      [wrkId, mgrId]
    );

    // اجرای مجدد initializeDatabase روی دیتابیس دارای اطلاعات
    await initializeDatabase();
    await initializeDatabase();

    const [mgrAfterRestart] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT password_hash, phone_number FROM users WHERE role = 'manager'"
    );
    expect(mgrAfterRestart[0].password_hash).toBe(customManagerHash);
    expect(mgrAfterRestart[0].phone_number).toBe('09121112233');

    const [settingsAfterRestart] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT base_salary_toman, banner_bg_url FROM system_settings LIMIT 1'
    );
    expect(Number(settingsAfterRestart[0].base_salary_toman)).toBe(45000000);
    expect(settingsAfterRestart[0].banner_bg_url).toBe('/assets/media/custom-banner.png');

    const [txAfterRestart] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt, SUM(amount_toman) AS total FROM financial_transactions'
    );
    expect(Number(txAfterRestart[0].cnt)).toBe(1);
    expect(Number(txAfterRestart[0].total)).toBe(7500000);

    // بازگرداندن رمز پیش‌فرض مدیر برای ادامه تست‌ها
    const defaultMgrHash = await bcrypt.default.hash(mgrInitialPass, 10);
    await pool.execute("UPDATE users SET password_hash = ? WHERE role = 'manager'", [
      defaultMgrHash,
    ]);
  });

  it('مرحله ۳ — آزمون اجباری ۳ و ۴: قطع دیتابیس هنگام ثبت تردد و ثبت پرداخت (در ابتدای عملیات و در میانه تراکنش) + جلوگیری از پرداخت تکراری', async () => {
    const pool = getPool();

    // دریافت توکن‌های معتبر روی دیتابیس آزمایشی
    const mgrLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager', password: mgrInitialPass }),
    });
    managerToken = (await mgrLogin.json()).token;

    const wrkLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'worker', password: wrkInitialPass }),
    });
    workerToken = (await wrkLogin.json()).token;

    const [attBefore] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM attendance_logs'
    );
    const [auditBefore] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM audit_logs WHERE action_type = 'ATTENDANCE_CLOCK'"
    );

    // ۳-الف: قطع دیتابیس در میانه تراکنش ثبت تردد (پس از درج رکورد در attendance_logs و پیش از COMMIT)
    setSimulatedMidTransactionFailure('attendance_clock');
    try {
      const midFailClockRes = await fetch(`${baseUrl}/api/attendance/clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ event_type: 'WORK_START', note: 'تردد ناتمام به دلیل قطع دیتابیس' }),
      });
      expect(midFailClockRes.status).toBe(503);
      const midFailClockData = await midFailClockRes.json();
      expect(midFailClockData.code).toBe('DB_UNAVAILABLE');
    } finally {
      setSimulatedMidTransactionFailure(null);
    }

    // بررسی اینکه Rollback انجام شده و هیچ رکوردی در attendance_logs یا audit_logs باقی نمانده است
    const [attAfterRollback] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM attendance_logs'
    );
    const [auditAfterRollback] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM audit_logs WHERE action_type = 'ATTENDANCE_CLOCK'"
    );
    expect(Number(attAfterRollback[0].cnt)).toBe(Number(attBefore[0].cnt));
    expect(Number(auditAfterRollback[0].cnt)).toBe(Number(auditBefore[0].cnt));

    // ۴-الف: قطع دیتابیس در میانه تراکنش ثبت پرداخت مالی (پس از درج در financial_transactions و پیش از COMMIT)
    const [finBefore] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_toman), 0) AS sum_toman FROM financial_transactions'
    );

    setSimulatedMidTransactionFailure('finance_payment');
    try {
      const midFailPayRes = await fetch(`${baseUrl}/api/finance/manager-direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          amount_toman: 18000000,
          tx_type: 'SALARY',
          shamsi_date: '1405/08/02',
          description: 'پرداخت ناتمام در حین قطع دیتابیس',
        }),
      });
      expect(midFailPayRes.status).toBe(503);
    } finally {
      setSimulatedMidTransactionFailure(null);
    }

    const [finAfterRollback] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_toman), 0) AS sum_toman FROM financial_transactions'
    );
    expect(Number(finAfterRollback[0].cnt)).toBe(Number(finBefore[0].cnt));
    expect(Number(finAfterRollback[0].sum_toman)).toBe(Number(finBefore[0].sum_toman));

    // ۴-ب: جلوگیری از ثبت پرداخت تکراری با کلید یکتای Idempotency
    const idemKey = 'pay-idem-1405-08-02-unique-001';
    const pay1Res = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
        'X-Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        amount_toman: 9500000,
        tx_type: 'SALARY',
        shamsi_date: '1405/08/02',
        description: 'پرداخت با کلید یکتا',
      }),
    });
    expect(pay1Res.status).toBe(201);

    const pay2DupRes = await fetch(`${baseUrl}/api/finance/manager-direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
        'X-Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        amount_toman: 9500000,
        tx_type: 'SALARY',
        shamsi_date: '1405/08/02',
        description: 'پرداخت با کلید یکتا',
      }),
    });
    expect(pay2DupRes.status).toBe(409);
    const pay2DupData = await pay2DupRes.json();
    expect(pay2DupData.code).toBe('DUPLICATE_REQUEST');
  });

  it('مرحله ۳ — آزمون اجباری ۵ و ۶: Restart کامل برنامه با حفظ نشست‌ها و اطلاعات + اجرای مهاجرت روی نسخه قبلی دیتابیس', async () => {
    // ۵. شبیه‌سازی Restart کامل سرور و استخر اتصالات دیتابیس (Pool) و بررسی حفظ نشست‌های فعال کاربران
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await resetPool();
    await initializeDatabase();
    const restartedApp = await createApp();
    await new Promise<void>((resolve) => {
      server = restartedApp.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    // بررسی اینکه نشست‌های قبلی (managerToken و workerToken) پس از Restart برنامه همچنان معتبر و فعال هستند
    const mgrMeAfterRestart = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(mgrMeAfterRestart.status).toBe(200);

    const wrkMeAfterRestart = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(wrkMeAfterRestart.status).toBe(200);

    // ۶. شبیه‌سازی دیتابیس نسخه قبلی (حذف جدول schema_migrations و حذف چند ستون و ایندکس اضافه‌شده در نسخه‌های جدیدتر)
    const pool = getPool();
    const preMigrationMetrics = await collectDatabaseMetrics(pool);

    await pool.query('DROP TABLE IF EXISTS `schema_migrations`');
    await pool.query('ALTER TABLE `attendance_logs` DROP INDEX `uq_attendance_idempotency`');
    await pool.query('ALTER TABLE `attendance_logs` DROP COLUMN `idempotency_key`');
    await pool.query('ALTER TABLE `work_correspondences` DROP COLUMN `audio_url`');

    expect(await columnExists(pool, 'attendance_logs', 'idempotency_key')).toBe(false);
    expect(await columnExists(pool, 'work_correspondences', 'audio_url')).toBe(false);

    // اجرای initializeDatabase روی ساختار قدیمی و بررسی ارتقای خودکار بدون از دست رفتن اطلاعات
    await initializeDatabase();

    expect(await columnExists(pool, 'attendance_logs', 'idempotency_key')).toBe(true);
    expect(await indexExists(pool, 'attendance_logs', 'uq_attendance_idempotency')).toBe(true);
    expect(await columnExists(pool, 'work_correspondences', 'audio_url')).toBe(true);

    const postMigrationMetrics = await collectDatabaseMetrics(pool);
    expect(postMigrationMetrics.tableCounts.users).toBe(preMigrationMetrics.tableCounts.users);
    expect(postMigrationMetrics.financialSums.totalAmountToman).toBe(
      preMigrationMetrics.financialSums.totalAmountToman
    );
    expect(postMigrationMetrics.tableCounts.schema_migrations).toBe(6);
  });

  it('مرحله ۳ — آزمون اجباری ۷، ۸ و ۹: پشتیبان‌گیری و بازیابی کامل روی محیط آزمایشی، تطابق ۱۰۰٪ تعداد رکوردها و جمع مبالغ پیش و پس از بازیابی، تشخیص پشتیبان خراب، و کنترل دسترسی به فایل‌ها', async () => {
    const pool = getPool();

    // ثبت یک تردد، یک گزارش روزانه، یک سابقه کارکرد و یک درخواست مالی با فایل پیوست خصوصی PNG
    const validPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const wrkFinRes = await fetch(`${baseUrl}/api/finance/worker-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        amount_toman: 1250000,
        tx_type: 'PETTY_CASH',
        shamsi_date: '1405/08/02',
        description: 'فاکتور خرید ابزار جهت تست پشتیبان‌گیری',
        receipt_base64: validPngBase64,
        receipt_file_name: 'tool-invoice.png',
      }),
    });
    expect(wrkFinRes.status).toBe(201);

    // ثبت یک فاکتور مستقیم توسط مدیر برای بررسی عدم دسترسی کارمند به فایل خصوصی متعلق به کاربر دیگر (IDOR File Check)
    const [mgrRows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE role = 'manager' LIMIT 1"
    );
    const mgrId = Number(mgrRows[0].id);
    const managerOnlyReceiptUrl = '/assets/media/receipts/manager_private_doc.png';
    const testMediaBase = path.resolve(process.cwd(), '.data/test_private_media');
    fs.mkdirSync(path.join(testMediaBase, 'receipts'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(testMediaBase, 'receipts', 'manager_private_doc.png'),
      Buffer.from(validPngBase64.split(',')[1], 'base64')
    );
    await pool.execute(
      `INSERT INTO financial_transactions
        (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, receipt_file_url, receipt_file_name, status, is_seen_by_manager)
       VALUES (?, ?, 500000, 'OTHER', '2026-10-24', '1405/08/02', 'سند اختصاصی مدیر', ?, 'manager_private_doc.png', 'APPROVED', 1)`,
      [mgrId, mgrId, managerOnlyReceiptUrl]
    );

    // ۹. بررسی دسترسی غیرمجاز به فایل‌ها و مسیر پشتیبان‌ها
    // الف) بدون توکن -> 401
    const unauthMediaRes = await fetch(`${baseUrl}${managerOnlyReceiptUrl}`);
    expect(unauthMediaRes.status).toBe(401);

    // ب) تلاش کارمند برای دسترسی به پیوست متعلق به مدیر -> 403
    const workerForbiddenMediaRes = await fetch(`${baseUrl}${managerOnlyReceiptUrl}`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(workerForbiddenMediaRes.status).toBe(403);

    // ج) دسترسی مدیر به همان فایل -> 200
    const managerAllowedMediaRes = await fetch(`${baseUrl}${managerOnlyReceiptUrl}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(managerAllowedMediaRes.status).toBe(200);

    // د) تلاش برای دسترسی وب به پوشه مخفی پشتیبان‌ها (/.data/backups) -> 403
    const directBackupWebAccessRes = await fetch(`${baseUrl}/.data/backups/test.json`);
    expect(directBackupWebAccessRes.status).toBe(403);

    // ۷ و ۸. ثبت آمار دقیق پیش از پشتیبان‌گیری (تعداد رکوردهای تمام ۱۳ جدول و جمع کل مبالغ مالی)
    const metricsBeforeBackup = await collectDatabaseMetrics(pool);
    expect(metricsBeforeBackup.financialSums.totalAmountToman).toBe(
      7500000 + 9500000 + 1250000 + 500000
    ); // 18,750,000 تومان

    const testBackupDir = path.resolve(process.cwd(), '.data/test_backups');
    const backupResult = await createFullBackup({
      backupDir: testBackupDir,
      privateMediaDir: testMediaBase,
      customPool: pool,
    });

    expect(fs.existsSync(backupResult.backupFilePath)).toBe(true);
    expect(fs.existsSync(backupResult.sqlDumpFilePath)).toBe(true);
    expect(backupResult.sizeBytes).toBeGreaterThan(500);
    expect(backupResult.manifest.mediaFilesCount).toBeGreaterThanOrEqual(2);

    // بررسی تشخیص فایل پشتیبان خالی یا دستکاری‌شده
    const emptyBackupPath = path.join(testBackupDir, 'empty_corrupt.mgbackup.json');
    fs.writeFileSync(emptyBackupPath, '');
    const emptyCheck = verifyBackupArchive(emptyBackupPath);
    expect(emptyCheck.valid).toBe(false);

    const tamperedBackupPath = path.join(testBackupDir, 'tampered_corrupt.mgbackup.json');
    const tamperedContent = fs
      .readFileSync(backupResult.backupFilePath, 'utf8')
      .replace('18750000', '99999999');
    fs.writeFileSync(tamperedBackupPath, tamperedContent);
    const tamperedCheck = verifyBackupArchive(tamperedBackupPath);
    expect(tamperedCheck.valid).toBe(false);
    await expect(
      restoreFromBackupArchive(tamperedBackupPath, {
        targetMediaDir: testMediaBase,
        customPool: pool,
      })
    ).rejects.toThrow(/RESTORE_ABORTED_INVALID_BACKUP/);

    // پاکسازی کامل رکوردهای مالی، ترددها و فایل‌های رسانه در محیط آزمایشی برای آزمایش بازیابی واقعی
    await pool.execute('DELETE FROM financial_transactions');
    await pool.execute('DELETE FROM attendance_logs');
    fs.rmSync(testMediaBase, { recursive: true, force: true });

    const wipedMetrics = await collectDatabaseMetrics(pool);
    expect(wipedMetrics.tableCounts.financial_transactions).toBe(0);
    expect(wipedMetrics.financialSums.totalAmountToman).toBe(0);

    // اجرای بازیابی کامل از فایل پشتیبان معتبر
    const restoreResult = await restoreFromBackupArchive(backupResult.backupFilePath, {
      targetMediaDir: testMediaBase,
      customPool: pool,
    });

    // ۸. مقایسه دقیق تعداد رکوردها و جمع مبالغ پیش از پشتیبان‌گیری و پس از بازیابی
    const metricsAfterRestore = await collectDatabaseMetrics(pool);
    expect(metricsAfterRestore.tableCounts).toEqual(metricsBeforeBackup.tableCounts);
    expect(metricsAfterRestore.financialSums).toEqual(metricsBeforeBackup.financialSums);
    expect(restoreResult.restoredMediaFilesCount).toBe(backupResult.manifest.mediaFilesCount);
    expect(
      fs.existsSync(path.join(testMediaBase, 'receipts', 'manager_private_doc.png'))
    ).toBe(true);
  });

  it('مرحله ۳ — آزمون اجباری ۱۰: اجرای بیلد نهایی (npm run build) و بررسی صحت فایل اجرایی استقرار cPanel (app.cjs و dist/index.html)', async () => {
    const { stdout, stderr } = await execAsync('npm run build', {
      cwd: process.cwd(),
    });
    expect(stdout + stderr).toContain('app.cjs');

    const appCjsPath = path.resolve(process.cwd(), 'app.cjs');
    const distIndexHtmlPath = path.resolve(process.cwd(), 'dist/index.html');

    expect(fs.existsSync(appCjsPath)).toBe(true);
    expect(fs.existsSync(distIndexHtmlPath)).toBe(true);

    const appCjsStat = fs.statSync(appCjsPath);
    const distIndexStat = fs.statSync(distIndexHtmlPath);
    expect(appCjsStat.size).toBeGreaterThan(20_000);
    expect(distIndexStat.size).toBeGreaterThan(200);
  }, 60_000);

  it('آزمون صورتحساب ماهانه و دوره‌ای (مثلاً از ۱۵ شهریور تا ۱۵ مهر): محاسبه دقیق حقوق + اضافه‌کاری، دریافتی/پرداختی و مانده دوره مجزا از مانده کل', () => {
    const stmt = calculatePeriodStatement({
      periodKey: 'cycle-1405/06/15-1405/07/15',
      title: 'دوره ۱۵ شهریور تا ۱۵ مهر ۱۴۰۵',
      fromShamsi: '1405/06/15',
      toShamsi: '1405/07/15',
      dailySummaries: [
        {
          work_date: '2026-09-06',
          shamsi_date: '1405/06/15',
          day_name: 'یکشنبه',
          is_holiday_or_friday: false,
          is_working_day: true,
          logs: [
            {
              id: 1,
              user_id: 2,
              work_date: '2026-09-06',
              shamsi_date: '1405/06/15',
              event_type: 'WORK_START',
              recorded_at: '',
              recorded_time: '07:00:00',
              note: null,
              is_manual_override: false,
              modified_by_user_id: null,
              modification_reason: null,
              is_deleted: false,
              created_at: '',
            },
            {
              id: 2,
              user_id: 2,
              work_date: '2026-09-06',
              shamsi_date: '1405/06/15',
              event_type: 'WORK_END',
              recorded_at: '',
              recorded_time: '17:00:00',
              note: null,
              is_manual_override: false,
              modified_by_user_id: null,
              modification_reason: null,
              is_deleted: false,
              created_at: '',
            },
          ],
          first_in_time: '07:00',
          last_out_time: '17:00',
          is_incomplete: false,
          is_late: false,
          late_minutes: 0,
          gross_presence_minutes: 600,
          mission_minutes: 0,
          break_deducted_minutes: 0,
          net_work_minutes: 600, // ۸ ساعت کار عادی (۴۸۰ دقیقه) + ۲ ساعت اضافه‌کاری (۱۲۰ دقیقه)
          provisional_work_minutes: 600,
          overtime_minutes: 120,
          status_label: 'ثبت قطعی',
        },
      ],
      historicalRecords: [],
      transactions: [
        {
          id: 10,
          user_id: 2,
          created_by_user_id: 1,
          amount_toman: 500000,
          tx_type: 'ADVANCE',
          tx_date: '2026-09-10',
          shamsi_date: '1405/06/19',
          description: 'مساعده شهریور',
          status: 'APPROVED',
          is_seen_by_manager: true,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          manager_note: null,
          idempotency_key: null,
          created_at: '',
        },
        {
          id: 11,
          user_id: 2,
          created_by_user_id: 2,
          amount_toman: 200000,
          tx_type: 'PETTY_CASH',
          tx_date: '2026-09-12',
          shamsi_date: '1405/06/21',
          description: 'خرید ابزار کارگاه',
          status: 'APPROVED',
          is_seen_by_manager: true,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          manager_note: null,
          idempotency_key: null,
          created_at: '',
        },
      ],
      settings: {
        ...BASE_SETTINGS,
        base_salary_toman: 19200000,
        hourly_rate_toman: 100000,
        overtime_calc_mode: 'FIXED_RATE',
        overtime_rate_toman: 140000,
      },
    });

    // ۸ ساعت کار عادی × ۱۰۰,۰۰۰ = ۸۰۰,۰۰۰ تومان
    expect(stmt.earnedRegularSalaryToman).toBe(800000);
    // ۲ ساعت اضافه‌کاری × ۱۴۰,۰۰۰ = ۲۸۰,۰۰۰ تومان
    expect(stmt.earnedOvertimePayToman).toBe(280000);
    // جمع حقوق + اضافه‌کاری دوره = ۱,۰۸۰,۰۰۰ تومان
    expect(stmt.salaryPlusOvertimeToman).toBe(1080000);
    // تنخواه تأییدشده = ۲۰۰,۰۰۰ تومان
    expect(stmt.approvedPettyCashToman).toBe(200000);
    // جمع کل استحقاقی دوره = ۱,۲۸۰,۰۰۰ تومان
    expect(stmt.totalPeriodEntitlementToman).toBe(1280000);
    // جمع کل دریافتی پرسنل / پرداختی مدیر در دوره = ۵۰۰,۰۰۰ تومان
    expect(stmt.approvedTotalPaidOrReceivedToman).toBe(500000);
    // مانده تسویه همین دوره = ۱,۲۸۰,۰۰۰ - ۵۰۰,۰۰۰ = ۷۸۰,۰۰۰ تومان
    expect(stmt.periodBalanceToman).toBe(780000);

    const periods = generateStatementPeriods({
      mode: 'CONTRACT_CYCLE',
      cycleStartDay: 15,
      inclusiveEndDay: true,
      currentShamsiDate: '1405/07/01',
      collaborationStartShamsi: '1405/06/15',
      dailySummaries: [],
      transactions: [],
      settings: BASE_SETTINGS,
    });
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.some((p) => p.fromShamsi === '1405/06/15' && p.toShamsi === '1405/07/15')).toBe(
      true
    );

    // سناریوی واقعی ماه کاری ۲۶ روزه با پایه حقوق ۲۵,۰۰۰,۰۰۰ تومان و ۲ ماه کارکرد (۱۵ شهریور تا ۱۵ آبان) و ۴۰ میلیون پرداختی در ۱۴۰۵/۰۷/۱۵
    const monthlyFixedSettings: SystemSettings = {
      ...BASE_SETTINGS,
      base_salary_toman: 25000000,
      hourly_rate_toman: null,
      overtime_calc_mode: 'PERCENTAGE',
      overtime_percentage: 140,
      overtime_rate_toman: null,
      collaboration_start_shamsi: '1405/06/15',
    };
    const twoMonthsPeriods = generateStatementPeriods({
      mode: 'CONTRACT_CYCLE',
      cycleStartDay: 15,
      inclusiveEndDay: true,
      currentShamsiDate: '1405/08/02',
      collaborationStartShamsi: '1405/06/15',
      dailySummaries: [],
      historicalRecords: [
        {
          id: 1,
          user_id: 2,
          created_by_user_id: 2,
          work_date: '2026-09-06',
          shamsi_date: '1405/06/15',
          title: 'فایل اکسل دو ماهه',
          work_days_count: 2,
          net_work_minutes: 224 * 60 + 112 * 60,
          overtime_minutes: 160 * 60,
          note: 'اکسل کارکرد',
          excel_file_url: null,
          excel_file_name: null,
          parsed_rows: [
            {
              shamsi_date: '1405/06/10',
              title: 'روز پیش از شروع قرارداد (نباید لحاظ شود)',
              work_days_count: 1,
              check_in: '07:00',
              check_out: '15:00',
              net_work_minutes: 8 * 60,
              overtime_minutes: 0,
              note: 'پیش از تاریخ شروع قرارداد',
            },
            {
              shamsi_date: '1405/06/20',
              title: 'کارکرد ماه اول',
              work_days_count: 1,
              check_in: '07:00',
              check_out: '18:00',
              net_work_minutes: 224 * 60,
              overtime_minutes: 106 * 60,
              note: 'کارکرد ماه اول',
            },
            {
              shamsi_date: '1405/07/20',
              title: 'کارکرد ماه دوم',
              work_days_count: 1,
              check_in: '07:00',
              check_out: '18:00',
              net_work_minutes: 112 * 60,
              overtime_minutes: 54 * 60,
              note: 'کارکرد ماه دوم',
            },
          ],
          status: 'APPROVED',
          is_seen_by_manager: true,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          created_at: '',
        },
      ],
      transactions: [
        {
          id: 99,
          user_id: 2,
          created_by_user_id: 1,
          amount_toman: 40000000,
          tx_type: 'SALARY',
          tx_date: '2026-10-07',
          shamsi_date: '1405/07/15',
          description: 'پرداخت حقوق ماهانه',
          status: 'APPROVED',
          is_seen_by_manager: true,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          manager_note: null,
          idempotency_key: null,
          created_at: '',
        },
      ],
      settings: monthlyFixedSettings,
    });

    const cycle1 = twoMonthsPeriods.find(
      (p) => p.fromShamsi === '1405/06/15' && p.toShamsi === '1405/07/15'
    )!;
    const cycle2 = twoMonthsPeriods.find(
      (p) => p.fromShamsi === '1405/07/15' && p.toShamsi === '1405/08/15'
    )!;
    expect(cycle1).toBeDefined();
    expect(cycle2).toBeDefined();

    // محاسبه روزشمار بر اساس کارکرد واقعی از تاریخ شروع قرارداد (۱۴۰۵/۰۶/۱۵) به بعد — روز ۱۴۰۵/۰۶/۱۰ لحاظ نمی‌شود
    const expectedHourlyRate = Math.round(25000000 / 208);
    expect(cycle1.earnedRegularSalaryToman).toBe(Math.round(224 * expectedHourlyRate));
    expect(cycle2.earnedRegularSalaryToman).toBe(Math.round(112 * expectedHourlyRate));
    expect(cycle1.dayDetails.some((d) => d.shamsiDate === '1405/06/10')).toBe(false);

    // پرداخت ۴۰ میلیون در ۱۴۰۵/۰۷/۱۵ فقط در ماه اول (۱۵ شهریور تا ۱۵ مهر) لحاظ می‌شود و در ماه دوم تکرار نمی‌شود
    expect(cycle1.approvedTotalPaidOrReceivedToman).toBe(40000000);
    expect(cycle2.approvedTotalPaidOrReceivedToman).toBe(0);

    // مانده ماه اول و ماه دوم هر دو مثبت (بستانکار) هستند و پرسنل بدهکار نمی‌شود
    expect(cycle1.periodBalanceToman).toBeGreaterThan(2800000);
    expect(cycle2.periodBalanceToman).toBeGreaterThan(20000000);
  });

  it('سناریوی تکمیلی ۲۴: پایه حقوق ماهانه بدون نرخ ساعتی (کامل کردن شیفت شنبه تا چهارشنبه و پنجشنبه ۷ ساعته = دقیقاً مزد ۱ روز کامل)', () => {
    const monthlySettings: SystemSettings = {
      ...BASE_SETTINGS,
      shift_start_time: '08:30',
      shift_end_time: '17:00',
      thursday_shift_start_time: '07:00',
      thursday_shift_end_time: '14:00',
      break_duration_minutes: 30,
      base_salary_toman: 25000000,
      hourly_rate_toman: null,
      overtime_calc_mode: 'PERCENTAGE',
      overtime_percentage: 140,
      overtime_rate_toman: null,
    };
    const dailyRate = Math.round(25000000 / 26);

    // شنبه کامل: ۰۸:۳۰ تا ۱۷:۰۰ (۵۱۰ دقیقه حضور) با ۳۰ دقیقه استراحت => ۴۸۰ دقیقه خالص = ۱ روز کامل
    const satFull = calculateDayRegularPayToman({
      dayRegularMinutes: 480,
      dayOfWeek: 6,
      settings: monthlySettings,
      isBulkHistorical: false,
    });
    expect(satFull).toBe(dailyRate);

    // پنجشنبه ۷ ساعته کامل: ۰۷:۰۰ تا ۱۴:۰۰ (۴۲۰ دقیقه حضور) با ۳۰ دقیقه استراحت => ۳۹۰ دقیقه خالص = ۱ روز کامل
    const thuFull = calculateDayRegularPayToman({
      dayRegularMinutes: 390,
      dayOfWeek: 4,
      settings: monthlySettings,
      isBulkHistorical: false,
    });
    expect(thuFull).toBe(dailyRate);

    // نصف شیفت عادی (۲۴۰ از ۴۸۰ دقیقه) => ۵۰٪ مزد روزانه
    const satHalf = calculateDayRegularPayToman({
      dayRegularMinutes: 240,
      dayOfWeek: 6,
      settings: monthlySettings,
      isBulkHistorical: false,
    });
    expect(satHalf).toBe(Math.round(dailyRate * 0.5));
  });

  it('سناریوی تکمیلی ۲۵: احتساب مرخصی باحقوق تا سقف سهمیه ماهانه (۲.۵ روز = ۱۲۰۰ دقیقه) و عدم پرداخت مازاد + همپوشانی با کارکرد همان روز', () => {
    const leaveSettings: SystemSettings = {
      ...BASE_SETTINGS,
      base_salary_toman: 26000000, // مزد روزانه دقیقاً ۱,۰۰۰,۰۰۰ تومان
      hourly_rate_toman: null,
      monthly_leave_quota_days: 2.5,
      collaboration_start_shamsi: '1405/07/01',
    };

    const breakdown = computePaidLeaveBreakdown({
      approvedLeaves: [
        {
          id: 1,
          user_id: 2,
          leave_type: 'DAILY',
          shamsi_date: '1405/07/05',
          work_date: '2026-09-27',
          start_time: null,
          end_time: null,
          duration_minutes: 480,
          reason: 'مرخصی روزانه اول',
          status: 'APPROVED',
          is_seen_by_manager: true,
          manager_note: null,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          created_at: '',
        },
        {
          id: 2,
          user_id: 2,
          leave_type: 'DAILY',
          shamsi_date: '1405/07/06',
          work_date: '2026-09-28',
          start_time: null,
          end_time: null,
          duration_minutes: 480,
          reason: 'مرخصی روزانه دوم',
          status: 'APPROVED',
          is_seen_by_manager: true,
          manager_note: null,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          created_at: '',
        },
        {
          id: 3,
          user_id: 2,
          leave_type: 'HOURLY',
          shamsi_date: '1405/07/10',
          work_date: '2026-10-02',
          start_time: '08:30',
          end_time: '12:30',
          duration_minutes: 240,
          reason: 'مرخصی ساعتی (تکمیل سقف ۱۲۰۰ دقیقه)',
          status: 'APPROVED',
          is_seen_by_manager: true,
          manager_note: null,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          created_at: '',
        },
        {
          id: 4,
          user_id: 2,
          leave_type: 'DAILY',
          shamsi_date: '1405/07/20',
          work_date: '2026-10-12',
          start_time: null,
          end_time: null,
          duration_minutes: 480,
          reason: 'مرخصی مازاد بر سهمیه ماهانه (بدون حقوق)',
          status: 'APPROVED',
          is_seen_by_manager: true,
          manager_note: null,
          reviewed_by_user_id: 1,
          reviewed_at: null,
          created_at: '',
        },
      ],
      workedRegularMinutesByDate: new Map<string, number>([['1405/07/10', 300]]), // ۵ ساعت کار + حداکثر ۱۸۰ دقیقه مرخصی ساعتی = ۴۸۰ دقیقه
      currentSettings: leaveSettings,
      collabStartShamsi: '1405/07/01',
    });

    // ۴۸۰ + ۴۸۰ + ۱۸۰ (به‌خاطر همپوشانی با کارکرد همان روز) + ۶۰ (باقیمانده سهمیه ۱۲۰۰ دقیقه) = ۱۲۰۰ دقیقه باحقوق
    expect(breakdown.totalPaidMinutes).toBe(1200);
    expect(breakdown.totalPaidToman).toBe(2500000);
    expect(breakdown.items.find((i) => i.shamsiDate === '1405/07/10')?.paidMinutes).toBe(180);
    expect(breakdown.items.find((i) => i.shamsiDate === '1405/07/20')?.paidMinutes).toBe(60);
    expect(breakdown.items.find((i) => i.shamsiDate === '1405/07/20')?.unpaidMinutes).toBe(420);
  });

  it('سناریوی تکمیلی ۲۶: غیبت روزانه (ABSENCE) نباید جریمه مضاعف (۲ برابری) ایجاد کند', () => {
    const absSettings: SystemSettings = {
      ...BASE_SETTINGS,
      base_salary_toman: 26000000,
      hourly_rate_toman: null,
      absence_deduction_unit: 'DAY',
      absence_deduction_rate_toman: 1000000,
    };

    const absStartLog: AttendanceLog = {
      ...makeLog(1, 'WORK_START', '11:00:00', '2026-09-29', '1405/07/07'),
      late_status: 'ABSENCE',
      late_reason: 'تست غیبت روزانه',
    };
    const absDay = calculateDailyAttendance(
      '2026-09-29',
      '1405/07/07',
      [absStartLog, makeLog(2, 'WORK_END', '17:00:00', '2026-09-29', '1405/07/07')],
      absSettings
    );

    expect(absDay.net_work_minutes).toBe(0);
    expect(absDay.overtime_minutes).toBe(0);
    // چون در سیستم روزشمار کارکرد این روز صفر شده، کسر مجدد غیبت باید ۰ باشد تا ۲ بار از حقوق کم نشود
    expect(absDay.late_deduction_toman).toBe(0);

    const stmt = calculatePeriodStatement({
      periodKey: 'test-abs',
      title: 'مهر',
      subtitle: '',
      fromShamsi: '1405/07/01',
      toShamsi: '1405/07/30',
      collabStartShamsi: '1405/07/01',
      dailySummaries: [absDay],
      transactions: [],
      settings: absSettings,
    });
    expect(stmt.earnedRegularSalaryToman).toBe(0);
    expect(stmt.lateAndAbsenceDeductionToman).toBe(0);
    expect(stmt.periodBalanceToman).toBe(0);
  });

  it('آزمون امنیتی تکمیلی ۱: رد کامل احراز هویت با ?token= در نشانی و مدیریت امن نشانی‌های خراب (Malformed URI -> 400)', async () => {
    const queryTokenAuthRes = await fetch(
      `${baseUrl}/api/auth/me?token=${encodeURIComponent(managerToken)}`
    );
    expect(queryTokenAuthRes.status).toBe(401);

    const queryTokenMediaRes = await fetch(
      `${baseUrl}/assets/media/receipts/manager_private_doc.png?token=${encodeURIComponent(managerToken)}`
    );
    expect(queryTokenMediaRes.status).toBe(401);

    const malformedUriRes = await fetch(`${baseUrl}/assets/media/receipts/%E0%A4%A`);
    expect(malformedUriRes.status).toBe(400);
    const malformedData = await malformedUriRes.json();
    expect(malformedData.code).toBe('BAD_REQUEST');
  });

  it('آزمون امنیتی تکمیلی ۲: کارکرد صحیح /api/media/storage و /api/media/cleanup بدون خطای SQL و کنترل دسترسی کارمند روی فایل‌های مدیر و فایل‌های سیستمی', async () => {
    const pool = getPool();
    const validPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // ثبت یک گزارش روزانه دارای تصویر برای بررسی ستون واقعی photo_url
    const reportRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/08/02',
        activity_description: 'گزارش تست عکس دار برای ممیزی رسانه',
        photo_base64: validPngBase64,
        photo_name: 'report-audit.png',
      }),
    });
    expect(reportRes.status).toBe(201);

    // ایجاد یک فایل بدون مرجع (ORPHAN_FILE) در دیسک تست
    const testMediaBase = path.resolve(process.cwd(), '.data/test_private_media');
    fs.mkdirSync(path.join(testMediaBase, 'attachments'), { recursive: true, mode: 0o700 });
    const orphanDiskPath = path.join(testMediaBase, 'attachments', 'orphan_audit_file.png');
    fs.writeFileSync(orphanDiskPath, Buffer.from(validPngBase64.split(',')[1], 'base64'));
    const orphanUrl = '/assets/media/attachments/orphan_audit_file.png';

    // ۱) دریافت فهرست رسانه‌ها توسط کارمند نباید خطای SQL بدهد و نباید فایل‌های مدیر یا ORPHAN_FILE را افشا کند
    const workerStorageRes = await fetch(`${baseUrl}/api/media/storage`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(workerStorageRes.status).toBe(200);
    const workerStorageData = await workerStorageRes.json();
    expect(workerStorageData.ok).toBe(true);
    expect(
      workerStorageData.storage.items.some(
        (i: { source_type: string }) => i.source_type === 'ORPHAN_FILE'
      )
    ).toBe(false);
    expect(
      workerStorageData.storage.items.some(
        (i: { file_url: string }) => i.file_url === '/assets/media/receipts/manager_private_doc.png'
      )
    ).toBe(false);
    expect(
      workerStorageData.storage.items.some(
        (i: { source_type: string }) => i.source_type === 'REPORT_PHOTO'
      )
    ).toBe(true);

    // ۲) دریافت فهرست رسانه‌ها توسط مدیر باید بدون خطای SQL همه‌ی فایل‌ها (از جمله ORPHAN_FILE) را برگرداند
    const mgrStorageRes = await fetch(`${baseUrl}/api/media/storage`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(mgrStorageRes.status).toBe(200);
    const mgrStorageData = await mgrStorageRes.json();
    const mgrFinanceReceipt = mgrStorageData.storage.items.find(
      (i: { file_url: string }) => i.file_url === '/assets/media/receipts/manager_private_doc.png'
    );
    expect(mgrFinanceReceipt).toBeDefined();
    expect(
      mgrStorageData.storage.items.some(
        (i: { source_type: string; file_url: string }) =>
          i.source_type === 'ORPHAN_FILE' && i.file_url === orphanUrl
      )
    ).toBe(true);

    // ۳) تلاش کارمند برای پاکسازی ORPHAN_FILE یا رسید متعلق به مدیر باید با 403 مسدود شود
    const workerDeleteOrphanRes = await fetch(`${baseUrl}/api/media/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        items: [{ source_type: 'ORPHAN_FILE', record_id: null, file_url: orphanUrl }],
      }),
    });
    expect(workerDeleteOrphanRes.status).toBe(403);
    expect(fs.existsSync(orphanDiskPath)).toBe(true);

    const workerDeleteMgrDocRes = await fetch(`${baseUrl}/api/media/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        items: [
          {
            source_type: 'FINANCE_RECEIPT',
            record_id: mgrFinanceReceipt.record_id,
            file_url: mgrFinanceReceipt.file_url,
          },
        ],
      }),
    });
    expect(workerDeleteMgrDocRes.status).toBe(403);

    // بررسی اینکه رسید مدیر همچنان در دیتابیس سالم است
    const [mgrFinCheck] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT receipt_file_url FROM financial_transactions WHERE id = ?',
      [mgrFinanceReceipt.record_id]
    );
    expect(mgrFinCheck[0].receipt_file_url).toBe('/assets/media/receipts/manager_private_doc.png');

    // ۴) پاکسازی ORPHAN_FILE توسط مدیر باید مجاز و موفق باشد
    const mgrDeleteOrphanRes = await fetch(`${baseUrl}/api/media/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        items: [{ source_type: 'ORPHAN_FILE', record_id: null, file_url: orphanUrl }],
      }),
    });
    expect(mgrDeleteOrphanRes.status).toBe(200);
    const mgrDeleteOrphanData = await mgrDeleteOrphanRes.json();
    expect(mgrDeleteOrphanData.deletedCount).toBe(1);
    expect(fs.existsSync(orphanDiskPath)).toBe(false);
  });

  it('آزمون امنیتی تکمیلی ۳: جلوگیری از بازنویسی رکورد تاییدشده اکسل سوابق کاری توسط کارمند (APPROVED_RECORD_LOCKED)', async () => {
    // ساخت یک فایل اکسل معتبر در حافظه
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['تاریخ', 'توضیحات', 'روز کاری', 'ساعت کارکرد', 'ساعت اضافه کاری'],
      ['1405/08/03', 'کارکرد تاییدشده', 1, 8, 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const xlsxBase64 = xlsxBuffer.toString('base64');

    // ثبت اولیه توسط مدیر به‌صورت تاییدشده (APPROVED)
    const mgrUploadRes = await fetch(`${baseUrl}/api/historical-work/upload-excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/08/03',
        title: 'کارکرد تاییدشده قفل‌شده',
        file_name: 'approved-history.xlsx',
        file_base64: xlsxBase64,
      }),
    });
    expect(mgrUploadRes.status).toBe(201);

    // تلاش کارمند برای بازنویسی رکورد تاییدشده در همان تاریخ و عنوان باید با 409 رد شود
    const workerOverwriteRes = await fetch(`${baseUrl}/api/historical-work/upload-excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        shamsi_date: '1405/08/03',
        title: 'کارکرد تاییدشده قفل‌شده',
        file_name: 'tamper-attempt.xlsx',
        file_base64: xlsxBase64,
      }),
    });
    expect(workerOverwriteRes.status).toBe(409);
    const overwriteData = await workerOverwriteRes.json();
    expect(overwriteData.code).toBe('APPROVED_RECORD_LOCKED');
  });

  it('آزمون امنیتی تکمیلی ۴ و ۵: الزام تغییر رمز اولیه (PASSWORD_CHANGE_REQUIRED)، ابطال بیومتریک پس از تغییر رمز، و محدودیت تلاش /api/auth/verify-unlock', async () => {
    const pool = getPool();
    resetAllLoginRateLimits();

    // الف) ثبت بیومتریک برای کارمند و فعال‌سازی پرچم must_change_password = 1
    const bioRegRes = await fetch(`${baseUrl}/api/auth/biometric/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ credential_id: 'cred_test_revoke_01' }),
    });
    expect(bioRegRes.status).toBe(200);
    const bioRegData = await bioRegRes.json();
    expect(bioRegData.biometric_token).toBeTruthy();

    const prevEnforce = process.env.ENFORCE_PASSWORD_CHANGE;
    process.env.ENFORCE_PASSWORD_CHANGE = 'true';
    await pool.execute("UPDATE users SET must_change_password = 1 WHERE username = 'worker'");

    const newForcedPassword = 'ForcedUpdated@1405!';
    try {
      // وقتی must_change_password=1 و ENFORCE_PASSWORD_CHANGE=true است، دسترسی به مسیرهای عادی مسدود می‌شود (403)
      const blockedFinanceRes = await fetch(`${baseUrl}/api/finance`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      expect(blockedFinanceRes.status).toBe(403);
      const blockedFinanceData = await blockedFinanceRes.json();
      expect(blockedFinanceData.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // بررسی /api/auth/me باید مجاز باشد و passwordChangeRequired: true برگرداند
      const meForcedRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      expect(meForcedRes.status).toBe(200);
      const meForcedData = await meForcedRes.json();
      expect(meForcedData.passwordChangeRequired).toBe(true);

      // تغییر رمز عبور اجباری
      const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          currentPassword: wrkInitialPass,
          newPassword: newForcedPassword,
        }),
      });
      expect(changeRes.status).toBe(200);
      const changeData = await changeRes.json();
      workerToken = changeData.token;

      // پس از تغییر رمز عبور، دسترسی مجدداً باز می‌شود و کلید بیومتریک قبلی نیز ابطال شده است
      const unlockedFinanceRes = await fetch(`${baseUrl}/api/finance`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      expect(unlockedFinanceRes.status).toBe(200);

      const staleBioLoginRes = await fetch(`${baseUrl}/api/auth/biometric/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'worker',
          credential_id: 'cred_test_revoke_01',
          biometric_token: bioRegData.biometric_token,
        }),
      });
      expect(staleBioLoginRes.status).toBe(401);

      // ب) بررسی محدودیت تلاش ناموفق روی /api/auth/verify-unlock
      for (let i = 0; i < 4; i++) {
        const badUnlock = await fetch(`${baseUrl}/api/auth/verify-unlock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify({ password: `BadUnlock_${i}` }),
        });
        expect(badUnlock.status).toBe(401);
      }
      const fifthLockedUnlock = await fetch(`${baseUrl}/api/auth/verify-unlock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ password: 'BadUnlock_5' }),
      });
      expect(fifthLockedUnlock.status).toBe(429);
      const lockedUnlockData = await fifthLockedUnlock.json();
      expect(lockedUnlockData.code).toBe('TOO_MANY_ATTEMPTS');
    } finally {
      if (prevEnforce === undefined) delete process.env.ENFORCE_PASSWORD_CHANGE;
      else process.env.ENFORCE_PASSWORD_CHANGE = prevEnforce;
      resetAllLoginRateLimits();

      const bcrypt = await import('bcryptjs');
      const restoredHash = await bcrypt.default.hash(wrkInitialPass, 10);
      await pool.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = 'worker'",
        [restoredHash]
      );
    }
  });

  it('آزمون تکمیلی ۶: حفظ جدول یادآورها (user_reminders) در پشتیبان‌گیری و بازیابی + خواندن بدون خطای سوابق تنظیمات (getSystemSettingsSnapshotsFromDb)', async () => {
    const pool = getPool();

    // ثبت تغییر تنظیمات توسط مدیر و سپس تغییر بعدی تا نسخه قبلی در system_settings_snapshots بایگانی شود
    const putSettingsRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        ...BASE_SETTINGS,
        grace_period_minutes: 20,
      }),
    });
    expect(putSettingsRes.status).toBe(200);

    const putSettings2Res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        ...BASE_SETTINGS,
        grace_period_minutes: 25,
      }),
    });
    expect(putSettings2Res.status).toBe(200);

    const snapshots = await getSystemSettingsSnapshotsFromDb();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots.some((s) => s.settings.grace_period_minutes === 20)).toBe(true);
    expect(typeof snapshots[0].changed_by_user_id).toBe('number');

    // ثبت یک یادآور برای بررسی بقا پس از Backup / Wipe / Restore
    const remCreateRes = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        title: 'یادآور تست پشتیبان‌گیری',
        description: 'بررسی بقا در فایل پشتیبان',
        due_shamsi_date: '1405/08/10',
        due_time: '10:30',
        repeat_type: 'ONCE',
        target_scope: 'WORKER',
        send_sms: false,
      }),
    });
    expect(remCreateRes.status).toBe(201);
    const remData = await remCreateRes.json();
    const reminderId = Number(remData.id);

    const [beforeRemRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM user_reminders WHERE id = ?',
      [reminderId]
    );
    expect(Number(beforeRemRows[0].cnt)).toBe(1);

    const testBackupDir = path.resolve(process.cwd(), '.data/test_backups');
    const testMediaBase = path.resolve(process.cwd(), '.data/test_private_media');
    const bkp = await createFullBackup({
      backupDir: testBackupDir,
      privateMediaDir: testMediaBase,
      customPool: pool,
    });

    await pool.execute('DELETE FROM user_reminders');
    const [wipedRemRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM user_reminders'
    );
    expect(Number(wipedRemRows[0].cnt)).toBe(0);

    await restoreFromBackupArchive(bkp.backupFilePath, {
      targetMediaDir: testMediaBase,
      customPool: pool,
    });

    const [restoredRemRows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT title, shamsi_date FROM user_reminders WHERE id = ?',
      [reminderId]
    );
    expect(restoredRemRows.length).toBe(1);
    expect(restoredRemRows[0].title).toBe('یادآور تست پشتیبان‌گیری');
  });

  it('آزمون ممیزی مستقل ۱: خروجی اکسل مدیر (/api/manager/export/excel و backup/excel) و خروجی اکسل پرسنل بدون خطای SQL ستون‌های گزارش کار', async () => {
    // شیت گزارش‌ها باید پس از ثبت گزارش عکسی در آزمون‌های قبلی، بدون خطای ستون‌های ناموجود تولید شود
    const mgrExcelAllRes = await fetch(`${baseUrl}/api/manager/export/excel?section=all`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(mgrExcelAllRes.status).toBe(200);
    expect(mgrExcelAllRes.headers.get('content-type') || '').toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const allBuf = Buffer.from(await mgrExcelAllRes.arrayBuffer());
    const allWb = XLSX.read(allBuf, { type: 'buffer' });
    expect(allWb.SheetNames).toContain('ساعات کاری و کارکرد');
    expect(allWb.SheetNames).toContain('گزارش کارها');
    expect(allWb.SheetNames).toContain('لیست پرداختی‌ها و مالی');
    const reportRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      allWb.Sheets['گزارش کارها']
    );
    expect(reportRows.length).toBeGreaterThanOrEqual(1);
    expect(
      reportRows.some(
        (r) =>
          String(r['شرح کامل گزارش کار'] || '').includes('ممیزی رسانه') &&
          r['تصویر پیوست'] === 'دارد'
      )
    ).toBe(true);

    const mgrBackupExcelRes = await fetch(`${baseUrl}/api/manager/backup/excel`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(mgrBackupExcelRes.status).toBe(200);
    const backupBuf = Buffer.from(await mgrBackupExcelRes.arrayBuffer());
    const backupWb = XLSX.read(backupBuf, { type: 'buffer' });
    expect(backupWb.SheetNames).toContain('گزارش کارها');

    const mgrReportsExcelRes = await fetch(`${baseUrl}/api/manager/export/excel?section=reports`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(mgrReportsExcelRes.status).toBe(200);

    const wrkForbiddenExcelRes = await fetch(`${baseUrl}/api/manager/export/excel?section=all`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(wrkForbiddenExcelRes.status).toBe(403);
  });

  it('آزمون ممیزی مستقل ۲: تشخیص دقیق روز هفته در /api/attendance/flexible-clock (شنبه کاری، پنجشنبه شیفت خاص، جمعه تعطیل)', async () => {
    const pool = getPool();
    // 1405/08/07 = پنجشنبه (4)، 1405/08/08 = جمعه (5)، 1405/08/09 = شنبه (6)
    const thuShamsi = '1405/08/07';
    const friShamsi = '1405/08/08';
    const satShamsi = '1405/08/09';
    expect(getDayOfWeekFromGregorian(shamsiToGregorian(thuShamsi))).toBe(4);
    expect(getDayOfWeekFromGregorian(shamsiToGregorian(friShamsi))).toBe(5);
    expect(getDayOfWeekFromGregorian(shamsiToGregorian(satShamsi))).toBe(6);

    const insertedLogIds: number[] = [];
    try {
      // ۱) شنبه (روز کاری عادی، شروع 08:30 + تلورانس فعلی 25 دقیقه = 08:55): ورود در 09:30 باید PENDING شود
      const satRes = await fetch(`${baseUrl}/api/attendance/flexible-clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          entry_mode: 'FULL_SHIFT',
          shift_category: 'WORK',
          shamsi_date: satShamsi,
          check_in_time: '09:30',
          check_out_time: '17:00',
          late_reason: 'ترافیک شنبه',
        }),
      });
      expect(satRes.status).toBe(201);
      const [satRows] = await pool.execute<mysql.RowDataPacket[]>(
        "SELECT id, late_status FROM attendance_logs WHERE shamsi_date = ? AND event_type = 'WORK_START' AND is_deleted = 0",
        [satShamsi]
      );
      expect(satRows.length).toBeGreaterThanOrEqual(1);
      expect(satRows[0].late_status).toBe('PENDING');

      // ۲) پنجشنبه (شروع 07:00 + تلورانس 25 دقیقه = 07:25): ورود در 08:00 باید PENDING شود (حتی با وجود اینکه < 08:30 عادی است)
      const thuRes = await fetch(`${baseUrl}/api/attendance/flexible-clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          entry_mode: 'START_ONLY',
          shift_category: 'WORK',
          shamsi_date: thuShamsi,
          check_in_time: '08:00',
          late_reason: 'تأخیر پنجشنبه',
        }),
      });
      expect(thuRes.status).toBe(201);
      const thuData = await thuRes.json();
      insertedLogIds.push(Number(thuData.logId));
      const [thuRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT late_status FROM attendance_logs WHERE id = ?',
        [thuData.logId]
      );
      expect(thuRows[0].late_status).toBe('PENDING');

      // ۳) جمعه (تعطیل رسمی هفتگی): نباید تأخیر PENDING ثبت شود
      const friRes = await fetch(`${baseUrl}/api/attendance/flexible-clock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          entry_mode: 'FULL_SHIFT',
          shift_category: 'WORK',
          shamsi_date: friShamsi,
          check_in_time: '10:00',
          check_out_time: '14:00',
        }),
      });
      expect(friRes.status).toBe(201);
      const [friRows] = await pool.execute<mysql.RowDataPacket[]>(
        "SELECT late_status FROM attendance_logs WHERE shamsi_date = ? AND event_type = 'WORK_START' AND is_deleted = 0",
        [friShamsi]
      );
      expect(friRows[0].late_status).toBe('NONE');

      // ۴) تعیین تکلیف تأخیر شنبه توسط مدیر روی تمام حالت‌ها و اعتبارسنجی ورودی نامعتبر
      const badReviewRes = await fetch(`${baseUrl}/api/attendance/review-late`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          log_id: satRows[0].id,
          decision: 'INVALID_OPTION',
        }),
      });
      expect(badReviewRes.status).toBe(400);

      for (const decision of [
        'EXCUSED',
        'APPROVED_DELAY',
        'DEDUCT_LEAVE',
        'ABSENCE',
        'CUSTOM',
      ] as const) {
        const revRes = await fetch(`${baseUrl}/api/attendance/review-late`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${managerToken}`,
          },
          body: JSON.stringify({
            log_id: satRows[0].id,
            decision,
            manager_note: `تصمیم ممیزی: ${decision}`,
            ...(decision === 'CUSTOM' ? { custom_deduction_toman: 75000 } : {}),
          }),
        });
        expect(revRes.status).toBe(200);
        const [revDbRows] = await pool.execute<mysql.RowDataPacket[]>(
          'SELECT late_status, manager_late_note, custom_deduction_toman FROM attendance_logs WHERE id = ?',
          [satRows[0].id]
        );
        expect(revDbRows[0].late_status).toBe(decision);
        expect(revDbRows[0].manager_late_note).toBe(`تصمیم ممیزی: ${decision}`);
        if (decision === 'CUSTOM') {
          expect(Number(revDbRows[0].custom_deduction_toman)).toBe(75000);
        }
      }
    } finally {
      await pool.execute('DELETE FROM leave_requests WHERE shamsi_date IN (?, ?, ?)', [
        thuShamsi,
        friShamsi,
        satShamsi,
      ]);
      await pool.execute(
        'DELETE FROM attendance_logs WHERE shamsi_date IN (?, ?, ?)',
        [thuShamsi, friShamsi, satShamsi]
      );
    }
  });

  it('آزمون ممیزی مستقل ۳: همخوانی محاسبه کسر تأخیر اکسل تاریخی بین live-status و manager/dashboard + انقضای نشست و کاربر غیرفعال', async () => {
    const pool = getPool();

    // ۱) درج یک رکورد تاریخی تاییدشده دارای ردیفِ جریمه‌شده (CUSTOM) در تاریخی که تردد زنده ندارد
    const histParsed = JSON.stringify([
      {
        row_index: 1,
        shamsi_date: '1405/08/11',
        net_work_minutes: 420,
        overtime_minutes: 0,
        work_days_count: 1,
        late_status: 'CUSTOM',
        late_deduction_toman: 0,
        custom_deduction_toman: 125000,
      },
    ]);
    const [histIns] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO historical_work_records
        (user_id, created_by_user_id, work_date, shamsi_date, title, net_work_minutes, overtime_minutes, work_days_count, status, parsed_rows_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?)`,
      [2, 1, shamsiToGregorian('1405/08/11'), '1405/08/11', 'رکورد جریمه ممیزی', 420, 0, 1, histParsed]
    );

    try {
      const [liveRes, dashRes] = await Promise.all([
        fetch(`${baseUrl}/api/attendance/live-status`, {
          headers: { Authorization: `Bearer ${workerToken}` },
        }),
        fetch(`${baseUrl}/api/manager/dashboard`, {
          headers: { Authorization: `Bearer ${managerToken}` },
        }),
      ]);
      expect(liveRes.status).toBe(200);
      expect(dashRes.status).toBe(200);
      const liveData = await liveRes.json();
      const dashData = await dashRes.json();

      expect(liveData.workerKpis.lateAndAbsenceDeductionToman).toBe(125000);
      expect(liveData.workerKpis.lateAndAbsenceDeductionToman).toBe(
        dashData.kpis.totalLateDeductionToman
      );
      expect(liveData.workerKpis.accountBalanceToman).toBe(dashData.kpis.accountBalanceToman);
      expect(liveData.bannerBgUrl).not.toContain('banner-bg.svg');

      const [prevBannerRows] = await pool.execute<mysql.RowDataPacket[]>(
        'SELECT banner_bg_url FROM system_settings WHERE id = 1'
      );
      const prevBanner = prevBannerRows[0]?.banner_bg_url || null;
      try {
        await pool.execute('UPDATE system_settings SET banner_bg_url = NULL WHERE id = 1');
        const defaultBannerLiveRes = await fetch(`${baseUrl}/api/attendance/live-status`, {
          headers: { Authorization: `Bearer ${workerToken}` },
        });
        expect(defaultBannerLiveRes.status).toBe(200);
        const defaultBannerData = await defaultBannerLiveRes.json();
        expect(defaultBannerData.bannerBgUrl).toBe('/assets/media/banner-bg.webp');
      } finally {
        await pool.execute('UPDATE system_settings SET banner_bg_url = ? WHERE id = 1', [
          prevBanner,
        ]);
      }

      // ۲) مسدودسازی نشست منقضی‌شده و کاربر غیرفعال‌شده (is_active = 0)
      const expiredRaw = 'expired-test-token-audit-001';
      const { hashSessionToken } = await import('../src/server/auth');
      await pool.execute(
        'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 HOUR))',
        [2, hashSessionToken(expiredRaw)]
      );
      const expiredRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${expiredRaw}` },
      });
      expect(expiredRes.status).toBe(401);

      await pool.execute('UPDATE users SET is_active = 0 WHERE id = 2');
      const inactiveUserRes = await fetch(`${baseUrl}/api/finance`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      expect(inactiveUserRes.status).toBe(401);
    } finally {
      const { hashSessionToken } = await import('../src/server/auth');
      await pool.execute('UPDATE users SET is_active = 1 WHERE id = 2');
      await pool.execute(
        'INSERT IGNORE INTO user_sessions (user_id, token_hash, expires_at) VALUES (2, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [hashSessionToken(workerToken)]
      );
      await pool.execute('DELETE FROM historical_work_records WHERE id = ?', [histIns.insertId]);
      await pool.execute('DELETE FROM user_sessions WHERE expires_at <= NOW()');
    }
  });

  it('آزمون ممیزی مستقل ۴: شبیه‌سازی کامل preflight و تنظیمات cPanel/Passenger (پورت سوکت یونیکس، SESSION_SECRET ضعیف، افشای .env عمومی)', async () => {
    const validHexSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // ۱) محیط Passenger cPanel معتبر با UNIX socket در متغیر PORT
    const passengerEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      PASSENGER_APP_ENV: 'production',
      PORT: '/tmp/passenger_node_audit.sock',
      SESSION_SECRET: validHexSecret,
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'cpanel_mgammon_usr',
      DB_PASSWORD: 'StrongDbPassword!2026',
      DB_NAME: 'cpanel_mgammon_db',
      APP_TIMEZONE: 'Asia/Tehran',
    };
    const appCfg = getAppConfig(passengerEnv);
    expect(appCfg.isProduction).toBe(true);
    expect(appCfg.isPassenger).toBe(true);
    expect(appCfg.isSocketOrPipe).toBe(true);
    expect(appCfg.listenTarget).toBe('/tmp/passenger_node_audit.sock');

    const validReport = await runPreflightDiagnostics({ env: passengerEnv, checkDb: false });
    expect(validReport.checks.find((c) => c.id === 'session_secret')?.status).toBe('PASS');
    expect(validReport.checks.find((c) => c.id === 'port_config')?.status).toBe('PASS');
    expect(validReport.checks.find((c) => c.id === 'db_env_vars')?.status).toBe('PASS');

    // ۲) شناسایی خطای قطعی هنگام نبود SESSION_SECRET یا مقدار ضعیف در Production
    const weakSecretReport = await runPreflightDiagnostics({
      env: { ...passengerEnv, SESSION_SECRET: 'weak-secret' },
      checkDb: false,
    });
    expect(weakSecretReport.ok).toBe(false);
    expect(weakSecretReport.checks.find((c) => c.id === 'session_secret')?.status).toBe('FAIL');

    // ۳) هشدار/خطا برای کاراکترهای ناایمن پوسته cPanel ($) یا کوتیشن در SESSION_SECRET
    const shellUnsafeReport = await runPreflightDiagnostics({
      env: { ...passengerEnv, SESSION_SECRET: 'Aa1$Bb2$Cc3$Dd4$Ee5$Ff6$Gg7$Hh8$Ii9$' },
      checkDb: false,
    });
    expect(shellUnsafeReport.checks.find((c) => c.id === 'session_secret')?.status).toBe(
      'WARNING'
    );

    // ۴) تشخیص نشت فایل .env در پوشه عمومی شبیه‌سازی‌شده
    const tmpLeakDir = path.resolve(process.cwd(), '.data/test_preflight_leak');
    const tmpPublicDir = path.join(tmpLeakDir, 'public');
    fs.mkdirSync(tmpPublicDir, { recursive: true });
    fs.writeFileSync(path.join(tmpPublicDir, '.env'), 'SESSION_SECRET=leak\n');
    try {
      const leakReport = await runPreflightDiagnostics({
        env: passengerEnv,
        checkDb: false,
        searchDirs: [tmpLeakDir],
      });
      expect(leakReport.ok).toBe(false);
      expect(leakReport.checks.find((c) => c.id === 'env_public_exposure')?.status).toBe('FAIL');
    } finally {
      fs.rmSync(tmpLeakDir, { recursive: true, force: true });
    }
  });

  it('آزمون ممیزی مستقل ۵: تشخیص ریشه برنامه (getAppRootDir)، انسداد مسیرهای محرمانه، همخوانی کسر تأخیر سابقه تاریخی در خروجی اکسل و حفاظت از رکوردهای تأییدشده', async () => {
    const pool = getPool();
    const { getAppRootDir, analyzeEnvValue } = await import('../src/server/config');
    const XLSX = await import('xlsx');

    // ۱) بررسی getAppRootDir و انسداد مسیرهای محرمانه (/.env، /.data، /database، /backups)
    const rootDir = getAppRootDir();
    expect(fs.existsSync(path.resolve(rootDir, 'database/schema.sql'))).toBe(true);

    for (const forbiddenPath of [
      '/.env',
      '/.data/backups/test.json',
      '/database/schema.sql',
      '/backups/dump.sql',
    ]) {
      const res = await fetch(`${baseUrl}${forbiddenPath}`);
      expect(res.status).toBe(403);
    }

    // ۲) بررسی رفتار کاراکترهای خاص در analyzeEnvValue (کوتیشن، فاصله و کاراکترهای حساس پوسته cPanel)
    const quotedInsp = analyzeEnvValue('"secret_with_quotes"', {
      isSecret: true,
      checkCpanelSafety: true,
    });
    expect(quotedInsp.hasSurroundingQuotes).toBe(true);
    expect(quotedInsp.hasCpanelShellUnsafeChars).toBe(true);

    const dollarInsp = analyzeEnvValue('Pass$With#Special', {
      isSecret: true,
      checkCpanelSafety: true,
    });
    expect(dollarInsp.hasCpanelShellUnsafeChars).toBe(true);

    // ۳) درج رکورد تاریخی تاییدشده با تصمیم CUSTOM و بررسی انعکاس دقیق جریمه در خروجی اکسل مدیریت و حفاظت در برابر ویرایش/حذف توسط پرسنل
    const targetShamsi = '1405/08/19';
    const histParsed = JSON.stringify([
      {
        row_index: 1,
        shamsi_date: targetShamsi,
        check_in: '07:45',
        check_out: '15:00',
        net_work_minutes: 435,
        overtime_minutes: 0,
        work_days_count: 1,
        late_status: 'CUSTOM',
        late_deduction_toman: 0,
        custom_deduction_toman: 135000,
      },
    ]);
    const [histIns] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO historical_work_records
        (user_id, created_by_user_id, work_date, shamsi_date, title, net_work_minutes, overtime_minutes, work_days_count, status, parsed_rows_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?)`,
      [
        2,
        1,
        shamsiToGregorian(targetShamsi),
        targetShamsi,
        'رکورد تست اکسل و حفاظت ممیزی',
        435,
        0,
        1,
        histParsed,
      ]
    );

    try {
      // الف) تلاش پرسنل برای ویرایش یا حذف رکورد تاریخی تاییدشده باید با 403 مسدود شود
      const workerEditHistRes = await fetch(
        `${baseUrl}/api/historical-work/${histIns.insertId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify({
            shamsi_date: targetShamsi,
            title: 'تلاش دستکاری توسط پرسنل',
            work_days_count: 1,
            net_work_minutes: 600,
            overtime_minutes: 120,
          }),
        }
      );
      expect(workerEditHistRes.status).toBe(403);

      const workerDeleteHistRes = await fetch(
        `${baseUrl}/api/historical-work/${histIns.insertId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${workerToken}` },
        }
      );
      expect(workerDeleteHistRes.status).toBe(403);

      // ب) خروجی اکسل مدیریت باید کسر تأخیر 135,000 تومانی رکورد تاریخی CUSTOM را در شیت حضور و غیاب منعکس کند
      const excelRes = await fetch(
        `${baseUrl}/api/manager/export/excel?from_shamsi=${targetShamsi}&to_shamsi=${targetShamsi}`,
        {
          headers: { Authorization: `Bearer ${managerToken}` },
        }
      );
      expect(excelRes.status).toBe(200);
      const buf = Buffer.from(await excelRes.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const attRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets['ساعات کاری و کارکرد']
      );
      const matchingRow = attRows.find((r) => r['تاریخ شمسی'] === targetShamsi);
      expect(matchingRow).toBeDefined();
      expect(Number(matchingRow!['کسر تأخیر (تومان)'])).toBe(135000);
    } finally {
      await pool.execute('DELETE FROM historical_work_records WHERE id = ?', [histIns.insertId]);
    }
  });

  it('آزمون ممیزی مستقل ۶: پوشش کامل سناریوهای محیطی (SESSION_SECRET خالی/فاصله/خط جدید، DB_* مفقود، حالت Development، PORT=passenger، جلوگیری از اجرای چندباره و عدم افشای Secret)', async () => {
    const {
      validateSessionSecret,
      validateProductionDatabaseConfig,
      sanitizeSecretErrorText,
      getAppConfig,
    } = await import('../src/server/config');
    const { formatPreflightReportText } = await import('../src/server/preflight');
    const { startServer, stopServer } = await import('../server');

    const realSecret = '9f8e7d6c5b4a392817263544536271809f8e7d6c5b4a39281726354453627180';
    const realDbPass = 'SuperSecretDbPass_2026!';

    // ۱) SESSION_SECRET خالی در Production -> FAIL
    const emptyCheck = validateSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: '' });
    expect(emptyCheck.valid).toBe(false);
    expect(emptyCheck.status).toBe('FAIL');
    expect(emptyCheck.code).toBe('SECRET_EMPTY');

    // ۲) SESSION_SECRET با فاصله میانی، خط جدید یا کوتیشن -> FAIL
    const newlineCheck = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: `${realSecret}\n`,
    });
    expect(newlineCheck.valid).toBe(false);
    expect(newlineCheck.code).toBe('SECRET_INVALID_CHARACTERS');

    const spaceCheck = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a1b2c3d4 e5f60718 293a4b5c 6d7e8f90 a1b2c3d4',
    });
    expect(spaceCheck.valid).toBe(false);
    expect(spaceCheck.code).toBe('SECRET_INVALID_CHARACTERS');

    // ۳) حالت Development با SESSION_SECRET خالی مجاز است (NOT_CONFIGURED_DEV)
    const devCheck = validateSessionSecret({ NODE_ENV: 'development', SESSION_SECRET: '' });
    expect(devCheck.valid).toBe(true);
    expect(devCheck.status).toBe('NOT_CONFIGURED');
    expect(() => validateProductionSecurityConfig({ NODE_ENV: 'development' })).not.toThrow();

    // ۴) متغیر دیتابیس مفقود در Production -> FAIL در config و preflight
    const missingDb = validateProductionDatabaseConfig({
      NODE_ENV: 'production',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'cpanel_usr',
      DB_NAME: '',
      DB_PASSWORD: '',
    });
    expect(missingDb.valid).toBe(false);
    expect(missingDb.missingVars).toContain('DB_NAME');
    expect(missingDb.missingVars).toContain('DB_PASSWORD');

    const missingDbReport = await runPreflightDiagnostics({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: realSecret,
        DB_HOST: '127.0.0.1',
        DB_PORT: '3306',
        DB_USER: 'cpanel_usr',
        DB_NAME: '',
        DB_PASSWORD: '',
      },
      checkDb: false,
    });
    expect(missingDbReport.ok).toBe(false);
    expect(missingDbReport.checks.find((c) => c.id === 'db_env_vars')?.status).toBe('FAIL');

    // ۵) رد مقادیر نامعتبر PORT (مانند متن غیرسوکت 'passenger' یا پورت خارج از بازه) و تفکیک FAIL / WARNING / NOT_CONFIGURED در Preflight
    for (const badPort of ['passenger', '0', '99999']) {
      const badPortCfg = getAppConfig({
        NODE_ENV: 'production',
        PASSENGER_APP_ENV: 'production',
        PORT: badPort,
      });
      expect(badPortCfg.isSocketOrPipe).toBe(false);
      expect(badPortCfg.listenTarget).toBe(3000);

      const badPortReport = await runPreflightDiagnostics({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: realSecret,
          DB_HOST: '127.0.0.1',
          DB_PORT: '3306',
          DB_USER: 'cpanel_usr',
          DB_NAME: 'cpanel_db',
          DB_PASSWORD: realDbPass,
          PORT: badPort,
        },
        checkDb: false,
      });
      expect(badPortReport.ok).toBe(false);
      expect(badPortReport.checks.find((c) => c.id === 'port_config')?.status).toBe('FAIL');
    }

    // ۵-الف) بررسی هماهنگی بازه DB_CONNECTION_LIMIT (۲ تا ۵۰) و اختیاری بودن DB_PORT با پیش‌فرض ۳۳۰۶ و وضعیت WARNING برای PORT خالی در Passenger
    const { ENV_VAR_SPECS } = await import('../src/server/config');
    expect(ENV_VAR_SPECS.find((s) => s.name === 'DB_PORT')?.requiredInProduction).toBe(false);

    const omittedDbPortCheck = validateProductionDatabaseConfig({
      NODE_ENV: 'production',
      DB_HOST: '127.0.0.1',
      DB_USER: 'cpanel_usr',
      DB_NAME: 'cpanel_db',
      DB_PASSWORD: realDbPass,
    });
    expect(omittedDbPortCheck.valid).toBe(true);
    expect(
      getDbConfig({
        NODE_ENV: 'production',
        DB_HOST: '127.0.0.1',
        DB_USER: 'cpanel_usr',
        DB_NAME: 'cpanel_db',
        DB_PASSWORD: realDbPass,
      }).port
    ).toBe(3306);

    for (const invalidPoolLimit of ['0', '1', '51', '100']) {
      const badLimit = validateProductionDatabaseConfig({
        NODE_ENV: 'production',
        DB_HOST: '127.0.0.1',
        DB_USER: 'cpanel_usr',
        DB_NAME: 'cpanel_db',
        DB_PASSWORD: realDbPass,
        DB_CONNECTION_LIMIT: invalidPoolLimit,
      });
      expect(badLimit.valid).toBe(false);
    }
    expect(
      validateProductionDatabaseConfig({
        NODE_ENV: 'production',
        DB_HOST: '127.0.0.1',
        DB_USER: 'cpanel_usr',
        DB_NAME: 'cpanel_db',
        DB_PASSWORD: realDbPass,
        DB_CONNECTION_LIMIT: '2',
      }).valid
    ).toBe(true);
    expect(
      validateProductionDatabaseConfig({
        NODE_ENV: 'production',
        DB_HOST: '127.0.0.1',
        DB_USER: 'cpanel_usr',
        DB_NAME: 'cpanel_db',
        DB_PASSWORD: realDbPass,
        DB_CONNECTION_LIMIT: '50',
      }).valid
    ).toBe(true);

    const passengerEmptyPortReport = await runPreflightDiagnostics({
      env: {
        NODE_ENV: 'production',
        PASSENGER_APP_ENV: 'production',
        PORT: '',
        SESSION_SECRET: realSecret,
        DB_HOST: '127.0.0.1',
        DB_USER: 'cpanel_usr',
        DB_NAME: 'cpanel_db',
        DB_PASSWORD: realDbPass,
      },
      checkDb: false,
    });
    expect(passengerEmptyPortReport.checks.find((c) => c.id === 'port_config')?.status).toBe(
      'WARNING'
    );
    expect(passengerEmptyPortReport.checks.find((c) => c.id === 'db_env_vars')?.status).toBe(
      'PASS'
    );

    // ۶) عدم افشای اطلاعات محرمانه در گزارش Preflight و sanitizeSecretErrorText
    const prevSecret = process.env.SESSION_SECRET;
    const prevDbPass = process.env.DB_PASSWORD;
    process.env.SESSION_SECRET = realSecret;
    process.env.DB_PASSWORD = realDbPass;
    try {
      const cleanReport = await runPreflightDiagnostics({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: realSecret,
          DB_HOST: '127.0.0.1',
          DB_PORT: '3306',
          DB_USER: 'cpanel_usr',
          DB_NAME: 'cpanel_db',
          DB_PASSWORD: realDbPass,
        },
        checkDb: false,
      });
      const reportText = formatPreflightReportText(cleanReport);
      expect(reportText).not.toContain(realSecret);
      expect(reportText).not.toContain(realDbPass);

      const sanitizedErr = sanitizeSecretErrorText(
        new Error(`Auth failed password=${realDbPass} token=${realSecret}`)
      );
      expect(sanitizedErr).not.toContain(realSecret);
      expect(sanitizedErr).not.toContain(realDbPass);
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
      if (prevDbPass === undefined) delete process.env.DB_PASSWORD;
      else process.env.DB_PASSWORD = prevDbPass;
    }

    // ۷) جلوگیری از اجرای چندباره startServer و پاکسازی کامل در stopServer
    const prevPort = process.env.PORT;
    process.env.PORT = '45199';
    try {
      const s1 = await startServer();
      const s2 = await startServer();
      expect(s1).toBe(s2);
      expect(s1.listening).toBe(true);
    } finally {
      await stopServer({ closeDbPool: false });
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });

  it('آزمون ممیزی مستقل ۷: نمونه‌های عددی قابل تکرار و موارد مرزی محاسبه حقوق، کسر استراحت، پنجشنبه، تأخیر/غیبت، مرخصی، تنخواه و اقساط', async () => {
    const { calculateSalaryAndOvertimeRates, calculateCumulativeFinancialSummaryAsOf } =
      await import('../src/shared/calculationEngine');

    const sampleSettings: SystemSettings = {
      ...BASE_SETTINGS,
      shift_start_time: '07:00',
      shift_end_time: '15:00',
      overtime_start_time: '15:00',
      thursday_shift_start_time: '07:00',
      thursday_shift_end_time: '14:00',
      thursday_overtime_start_time: '14:00',
      grace_period_minutes: 15,
      break_duration_minutes: 0,
      working_days: [6, 0, 1, 2, 3, 4],
      friday_holiday_policy: 'ALL_OVERTIME',
      base_salary_toman: 26000000, // روزانه 1,000,000 تومان، ساعتی 125,000 تومان
      hourly_rate_toman: null,
      overtime_calc_mode: 'PERCENTAGE',
      overtime_percentage: 140, // اضافه‌کاری ساعتی 175,000 تومان
      overtime_rate_toman: null,
      collaboration_start_shamsi: '1405/07/15',
      monthly_leave_quota_days: 2.5,
      late_deduction_unit: 'MINUTE',
      late_deduction_rate_toman: null,
    };

    const baseRates = calculateSalaryAndOvertimeRates(sampleSettings, 120);
    expect(baseRates.dailyBaseRateToman).toBe(1000000);
    expect(baseRates.effectiveHourlyRateToman).toBe(125000);
    expect(baseRates.effectiveOvertimeHourlyRateToman).toBe(175000);
    expect(baseRates.totalOvertimePayToman).toBe(350000);

    // ۱) مرز کسر استراحت: حضور <= ۲۴۰ دقیقه بدون کسر استراحت؛ حضور ۲۴۱ دقیقه با کسر استراحت
    const breakSettings: SystemSettings = { ...sampleSettings, break_duration_minutes: 30 };
    const at240 = calculateDailyAttendance(
      '2026-10-17',
      '1405/07/25',
      [
        makeLog(7001, 'WORK_START', '07:00:00', '2026-10-17', '1405/07/25'),
        makeLog(7002, 'WORK_END', '11:00:00', '2026-10-17', '1405/07/25'),
      ],
      breakSettings
    );
    expect(at240.break_deducted_minutes).toBe(0);
    expect(at240.net_work_minutes).toBe(240);

    const at241 = calculateDailyAttendance(
      '2026-10-17',
      '1405/07/25',
      [
        makeLog(7003, 'WORK_START', '07:00:00', '2026-10-17', '1405/07/25'),
        makeLog(7004, 'WORK_END', '11:01:00', '2026-10-17', '1405/07/25'),
      ],
      breakSettings
    );
    expect(at241.break_deducted_minutes).toBe(30);
    expect(at241.net_work_minutes).toBe(211);

    // ۲) محاسبه نمونه روزانه و دوره ۱۵ام به ۱۵ام (۱۴۰۵/۰۷/۱۵ تا ۱۴۰۵/۰۸/۱۴ و تراکنش‌ها تا ۱۴۰۵/۰۸/۱۵)
    // روز ۱ (شنبه ۱۴۰۵/۰۷/۱۸ = 2026-10-10): کار ۰۷:۰۰ تا ۱۷:۰۰ -> ۴۸۰ عادی (1,000,000) + ۱۲۰ اضافه‌کاری (350,000)
    const d1 = calculateDailyAttendance(
      shamsiToGregorian('1405/07/18'),
      '1405/07/18',
      [
        makeLog(7101, 'WORK_START', '07:00:00', shamsiToGregorian('1405/07/18'), '1405/07/18'),
        makeLog(7102, 'WORK_END', '17:00:00', shamsiToGregorian('1405/07/18'), '1405/07/18'),
      ],
      sampleSettings
    );
    // روز ۲ (پنجشنبه ۱۴۰۵/۰۷/۲۳ = 2026-10-15): شیفت ۷ ساعته (۰۷:۰۰ تا ۱۴:۰۰) -> ۱ روز کامل (1,000,000) + ۶۰ اضافه‌کاری تا ۱۵:۰۰ (175,000)
    const d2 = calculateDailyAttendance(
      shamsiToGregorian('1405/07/23'),
      '1405/07/23',
      [
        makeLog(7103, 'WORK_START', '07:00:00', shamsiToGregorian('1405/07/23'), '1405/07/23'),
        makeLog(7104, 'WORK_END', '15:00:00', shamsiToGregorian('1405/07/23'), '1405/07/23'),
      ],
      sampleSettings
    );
    // روز ۳ (شنبه ۱۴۰۵/۰۷/۲۵): خروج زودتر (۰۷:۰۰ تا ۱۳:۰۰ = ۳۶۰ دقیقه / ۴۸۰ دقیقه) -> 750,000 تومان
    const d3 = calculateDailyAttendance(
      shamsiToGregorian('1405/07/25'),
      '1405/07/25',
      [
        makeLog(7105, 'WORK_START', '07:00:00', shamsiToGregorian('1405/07/25'), '1405/07/25'),
        makeLog(7106, 'WORK_END', '13:00:00', shamsiToGregorian('1405/07/25'), '1405/07/25'),
      ],
      sampleSettings
    );
    // روز ۴ (یکشنبه ۱۴۰۵/۰۷/۲۶): ورود ۰۷:۳۰ (۳۰ دقیقه تأخیر با APPROVED_DELAY) تا ۱۵:۰۰
    // کار عادی = ۴۵۰ دقیقه -> Math.round((450/480)*1,000,000) = 937,500؛ جریمه تأخیر = 30 * Math.round(125,000/60) = 30 * 2,083 = 62,490 تومان
    const d4 = calculateDailyAttendance(
      shamsiToGregorian('1405/07/26'),
      '1405/07/26',
      [
        {
          ...makeLog(7107, 'WORK_START', '07:30:00', shamsiToGregorian('1405/07/26'), '1405/07/26'),
          late_status: 'APPROVED_DELAY',
        },
        makeLog(7108, 'WORK_END', '15:00:00', shamsiToGregorian('1405/07/26'), '1405/07/26'),
      ],
      sampleSettings
    );
    expect(d4.late_deduction_toman).toBe(62490);

    // روز ۵ (دوشنبه ۱۴۰۵/۰۷/۲۷): ثبت غیبت ABSENCE (با وجود تردد) -> کارکرد 0، جریمه اضافه 0 (عدم کسر مضاعف)
    const d5Absence = calculateDailyAttendance(
      shamsiToGregorian('1405/07/27'),
      '1405/07/27',
      [
        {
          ...makeLog(7109, 'WORK_START', '09:00:00', shamsiToGregorian('1405/07/27'), '1405/07/27'),
          late_status: 'ABSENCE',
        },
        makeLog(7110, 'WORK_END', '12:00:00', shamsiToGregorian('1405/07/27'), '1405/07/27'),
      ],
      sampleSettings
    );
    expect(d5Absence.net_work_minutes).toBe(0);
    expect(d5Absence.overtime_minutes).toBe(0);
    expect(d5Absence.late_deduction_toman).toBe(0);

    // روز ۶ (جمعه ۱۴۰۵/۰۸/۰۱): ۴ ساعت جمعه‌کاری ALL_OVERTIME (240 دقیقه، ۰ عادی + ۲۴۰ اضافه‌کاری = 700,000 تومان)
    const d6Friday = calculateDailyAttendance(
      shamsiToGregorian('1405/08/01'),
      '1405/08/01',
      [
        makeLog(7111, 'WORK_START', '09:00:00', shamsiToGregorian('1405/08/01'), '1405/08/01'),
        makeLog(7112, 'WORK_END', '13:00:00', shamsiToGregorian('1405/08/01'), '1405/08/01'),
      ],
      sampleSettings
    );
    expect(d6Friday.net_work_minutes).toBe(240);
    expect(d6Friday.overtime_minutes).toBe(240);

    // مرخصی روزانه باحقوق در ۱۴۰۵/۰۷/۲۸ (۴۸۰ دقیقه -> 1,000,000 تومان) + مرخصی مازاد بر سهمیه در همان ماه (۱۵۰ دقیقه در ۱۰ روز نیست؛ فرض ۲ روز قبلی + ۰.۷ روز = ۲.۷ روز، مازاد ۰.۲ روز = ۹۶ دقیقه بی‌حقوق)
    const sampleLeaves = [
      {
        id: 1,
        user_id: 2,
        shamsi_date: '1405/07/28',
        work_date: shamsiToGregorian('1405/07/28'),
        leave_type: 'DAILY' as const,
        start_time: null,
        end_time: null,
        duration_minutes: 480,
        reason: 'مرخصی استحقاقی ۱',
        status: 'APPROVED' as const,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        is_seen_by_manager: true,
        created_at: '',
      },
      {
        id: 2,
        user_id: 2,
        shamsi_date: '1405/07/29',
        work_date: shamsiToGregorian('1405/07/29'),
        leave_type: 'DAILY' as const,
        start_time: null,
        end_time: null,
        duration_minutes: 480,
        reason: 'مرخصی استحقاقی ۲',
        status: 'APPROVED' as const,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        is_seen_by_manager: true,
        created_at: '',
      },
      {
        id: 3,
        user_id: 2,
        shamsi_date: '1405/07/30',
        work_date: shamsiToGregorian('1405/07/30'),
        leave_type: 'HOURLY' as const,
        start_time: '07:00',
        end_time: '12:36',
        duration_minutes: 336, // فقط 240 دقیقه در سهمیه ۱۲۰۰ دقیقه‌ای مهر می‌ماند، ۹۶ دقیقه مازاد بدون حقوق است
        reason: 'مرخصی ساعتی مرزی',
        status: 'APPROVED' as const,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        is_seen_by_manager: true,
        created_at: '',
      },
    ];

    const sampleTxs = [
      {
        id: 1,
        user_id: 2,
        created_by_user_id: 1,
        tx_date: shamsiToGregorian('1405/07/24'),
        shamsi_date: '1405/07/24',
        tx_type: 'PETTY_CASH' as const,
        amount_toman: 300000,
        description: 'خرید ملزومات کارگاه',
        status: 'APPROVED' as const,
        settlement_mode: 'LUMP_SUM' as const,
        monthly_deduction_toman: null,
        installment_start_shamsi: null,
        receipt_file_url: null,
        receipt_file_name: null,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        idempotency_key: null,
        is_seen_by_manager: true,
        created_at: '',
      },
      {
        id: 2,
        user_id: 2,
        created_by_user_id: 1,
        tx_date: shamsiToGregorian('1405/08/02'),
        shamsi_date: '1405/08/02',
        tx_type: 'ADVANCE' as const,
        amount_toman: 1200000,
        description: 'مساعده میان‌دوره',
        status: 'APPROVED' as const,
        settlement_mode: 'LUMP_SUM' as const,
        monthly_deduction_toman: null,
        installment_start_shamsi: null,
        receipt_file_url: null,
        receipt_file_name: null,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        idempotency_key: null,
        is_seen_by_manager: true,
        created_at: '',
      },
      {
        id: 3,
        user_id: 2,
        created_by_user_id: 1,
        tx_date: shamsiToGregorian('1405/08/05'),
        shamsi_date: '1405/08/05',
        tx_type: 'OTHER' as const,
        amount_toman: 1500000,
        description: 'خرید ابزار اقساطی',
        status: 'APPROVED' as const,
        settlement_mode: 'INSTALLMENT' as const,
        monthly_deduction_toman: 500000,
        installment_start_shamsi: '1405/08/05',
        receipt_file_url: null,
        receipt_file_name: null,
        manager_note: null,
        reviewed_by_user_id: 1,
        reviewed_at: null,
        idempotency_key: null,
        is_seen_by_manager: true,
        created_at: '',
      },
    ];

    const stmt = calculatePeriodStatement({
      periodKey: 'cycle-1405/07/15-1405/08/15',
      title: 'مهر ۱۴۰۵',
      fromShamsi: '1405/07/15',
      toShamsi: '1405/08/14',
      txFromShamsi: '1405/07/15',
      txToShamsi: '1405/08/15',
      collabStartShamsi: '1405/07/15',
      dailySummaries: [d1, d2, d3, d4, d5Absence, d6Friday],
      approvedLeaves: sampleLeaves,
      transactions: sampleTxs,
      settings: sampleSettings,
    });

    // حقوق روزشمار کارکرد = 1,000,000 (d1) + 1,000,000 (d2) + 750,000 (d3) + 937,500 (d4) + 0 (d5 غیبت) + 0 (d6 جمعه تماماً اضافه‌کاری) = 3,687,500
    // مرخصی باحقوق = 1200 دقیقه (2.5 روز سقف سهمیه مهر) = 2,500,000 -> جمع کار عادی + مرخصی باحقوق = 6,187,500
    expect(stmt.paidLeaveMinutes).toBe(1200);
    expect(stmt.paidLeavePayToman).toBe(2500000);
    expect(stmt.earnedRegularSalaryToman).toBe(6187500);
    // اضافه‌کاری = 120m (350,000) + 60m (175,000) + 240m جمعه (700,000) = 420 دقیقه = 1,225,000 تومان
    expect(stmt.overtimeMinutes).toBe(420);
    expect(stmt.earnedOvertimePayToman).toBe(1225000);
    // کسر تأخیر = 62,490 تومان
    expect(stmt.lateAndAbsenceDeductionToman).toBe(62490);
    // خالص حقوق + اضافه‌کاری = 6,187,500 + 1,225,000 - 62,490 = 7,350,010 تومان
    expect(stmt.salaryPlusOvertimeToman).toBe(7350010);
    // جمع استحقاقی با تنخواه (+300,000) = 7,650,010 تومان
    expect(stmt.approvedPettyCashToman).toBe(300000);
    expect(stmt.totalPeriodEntitlementToman).toBe(7650010);
    // دریافتی/کسورات دوره = 1,200,000 (مساعده) + 500,000 (قسط ۱ از ۳) = 1,700,000؛ مانده تعهد آتی = 1,000,000
    expect(stmt.installmentDeductionThisPeriodToman).toBe(500000);
    expect(stmt.remainingDeferredDebtAfterPeriodToman).toBe(1000000);
    expect(stmt.approvedTotalPaidOrReceivedToman).toBe(1700000);
    // مانده تسویه دوره = 7,650,010 - 1,700,000 = 5,950,010 تومان
    expect(stmt.periodBalanceToman).toBe(5950010);

    // تطبیق خلاصه تجمعی مالی تا پایان روزهای کاری دوره اول (۱۴۰۵/۰۸/۱۴ -> ۱ قسط سررسیدشده = ۵۰۰,۰۰۰)
    const finCumEndCycle1 = calculateCumulativeFinancialSummaryAsOf({
      transactions: sampleTxs,
      currentShamsiDate: '1405/08/14',
      collabStartShamsi: '1405/07/15',
      anchorDay: 15,
    });
    expect(finCumEndCycle1.approvedPettyCashToman).toBe(300000);
    expect(finCumEndCycle1.approvedMaturedReceivedToman).toBe(1700000);
    expect(finCumEndCycle1.unamortizedDeferredDebtToman).toBe(1000000);

    // تطبیق مجموع صورتحساب‌های دوره‌ای generateStatementPeriods با مانده تجمعی در تاریخ شروع دوره دوم (۱۴۰۵/۰۸/۱۵ -> ۲ قسط سررسیدشده)
    const allGenerated = generateStatementPeriods({
      mode: 'CONTRACT_CYCLE',
      cycleStartDay: 15,
      inclusiveEndDay: true,
      currentShamsiDate: '1405/08/15',
      collaborationStartShamsi: '1405/07/15',
      dailySummaries: [d1, d2, d3, d4, d5Absence, d6Friday],
      approvedLeaves: sampleLeaves,
      transactions: sampleTxs,
      settings: sampleSettings,
    });
    const finCumStartCycle2 = calculateCumulativeFinancialSummaryAsOf({
      transactions: sampleTxs,
      currentShamsiDate: '1405/08/15',
      collabStartShamsi: '1405/07/15',
      anchorDay: 15,
    });
    expect(finCumStartCycle2.approvedMaturedReceivedToman).toBe(2200000);
    expect(finCumStartCycle2.unamortizedDeferredDebtToman).toBe(500000);
    const sumPaidAcrossPeriods = allGenerated.reduce(
      (sum, p) => sum + p.approvedTotalPaidOrReceivedToman,
      0
    );
    expect(sumPaidAcrossPeriods).toBe(finCumStartCycle2.approvedMaturedReceivedToman);
    const sumBalanceAcrossPeriods = allGenerated.reduce(
      (sum, p) => sum + p.periodBalanceToman,
      0
    );
    const expectedCumBalance =
      stmt.totalPeriodEntitlementToman - finCumStartCycle2.approvedMaturedReceivedToman;
    expect(sumBalanceAcrossPeriods).toBe(expectedCumBalance);
  });

  it('آزمون ممیزی مستقل ۸: سیاست یکپارچه آنتروپی SESSION_SECRET (حداقل ۳۲ طول و ۱۰ کاراکتر یکتا، سازگار با ۶۴ کاراکتر هگز) و تشخیص ریشه برنامه (getAppRootDir) در صورت وجود package.json نامرتبط در cwd', async () => {
    const os = await import('os');
    const {
      MIN_SESSION_SECRET_LENGTH,
      MIN_SESSION_SECRET_UNIQUE_CHARS,
      getAppRootDir,
      isMgammonAppRootDir,
      validateSessionSecret,
    } = await import('../src/server/config');

    // ۱) بررسی ثابت‌های سیاست یکپارچه SESSION_SECRET
    expect(MIN_SESSION_SECRET_LENGTH).toBe(32);
    expect(MIN_SESSION_SECRET_UNIQUE_CHARS).toBe(10);

    // الف) کلید ۶۴ کاراکتری هگز استاندارد (۱۶ کاراکتر یکتا) -> PASS
    const validHex64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hex64Res = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: validHex64,
    });
    expect(hex64Res.valid).toBe(true);
    expect(hex64Res.status).toBe('PASS');
    expect(hex64Res.code).toBe('VALID');

    // ب) کلید ۳۲ کاراکتری با دقیقاً ۱۰ کاراکتر یکتا -> معتبر (با هشدار طول کمتر از ۶۴)
    const valid10Unique = '01234567890123456789012345678901';
    expect(valid10Unique.length).toBe(32);
    expect(new Set(valid10Unique.split('')).size).toBe(10);
    const unique10Res = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: valid10Unique,
    });
    expect(unique10Res.valid).toBe(true);
    expect(unique10Res.status).toBe('WARNING');
    expect(unique10Res.code).toBe('VALID_WITH_WARNINGS');

    // ج) کلید ۶۴ کاراکتری با فقط ۸ کاراکتر یکتا -> FAIL (SECRET_LOW_ENTROPY)
    const weak8Unique = '01234567'.repeat(8);
    expect(new Set(weak8Unique.split('')).size).toBe(8);
    const unique8Res = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: weak8Unique,
    });
    expect(unique8Res.valid).toBe(false);
    expect(unique8Res.status).toBe('FAIL');
    expect(unique8Res.code).toBe('SECRET_LOW_ENTROPY');

    // د) کلید ۶۴ کاراکتری با فقط ۹ کاراکتر یکتا -> FAIL (SECRET_LOW_ENTROPY)
    const weak9Unique = '012345678'.repeat(8).slice(0, 64);
    expect(new Set(weak9Unique.split('')).size).toBe(9);
    const unique9Res = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: weak9Unique,
    });
    expect(unique9Res.valid).toBe(false);
    expect(unique9Res.status).toBe('FAIL');
    expect(unique9Res.code).toBe('SECRET_LOW_ENTROPY');

    // هـ) کلید کوتاه‌تر از ۳۲ کاراکتر با بیش از ۱۰ کاراکتر یکتا -> FAIL (SECRET_TOO_SHORT)
    const short31 = '0123456789abcdef0123456789abcde';
    expect(short31.length).toBe(31);
    const shortRes = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: short31,
    });
    expect(shortRes.valid).toBe(false);
    expect(shortRes.code).toBe('SECRET_TOO_SHORT');

    // و) کلید پیش‌فرض ممنوعه -> FAIL (SECRET_DEFAULT_FORBIDDEN)
    const defaultRes = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: 'mgammon-duo-enterprise-secret-2026',
    });
    expect(defaultRes.valid).toBe(false);
    expect(defaultRes.code).toBe('SECRET_DEFAULT_FORBIDDEN');

    // ز) کلید دارای کوتیشن اطراف مقدار -> FAIL (SECRET_INVALID_CHARACTERS)
    const quotedRes = validateSessionSecret({
      NODE_ENV: 'production',
      SESSION_SECRET: `"${validHex64}"`,
    });
    expect(quotedRes.valid).toBe(false);
    expect(quotedRes.code).toBe('SECRET_INVALID_CHARACTERS');

    // ۲) بررسی getAppRootDir() هنگامی که پوشه کاری (cwd) نامرتبط است و package.json و .env خودش را دارد
    const unrelatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgammon-unrelated-cwd-'));
    try {
      fs.writeFileSync(
        path.join(unrelatedDir, 'package.json'),
        JSON.stringify({ name: 'unrelated-host-app', version: '1.0.0' }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(unrelatedDir, '.env'),
        'SESSION_SECRET=poison_short_value\nDB_NAME=wrong_unrelated_db\n',
        'utf8'
      );

      expect(isMgammonAppRootDir(unrelatedDir)).toBe(false);

      const resolvedRoot = getAppRootDir({ cwd: unrelatedDir });
      expect(resolvedRoot).not.toBe(path.resolve(unrelatedDir));
      expect(isMgammonAppRootDir(resolvedRoot)).toBe(true);
      expect(fs.existsSync(path.join(resolvedRoot, 'database/schema.sql'))).toBe(true);

      // حتی اگر پوشه نامرتبط اولین کاندید در لیست candidates باشد، باید نادیده گرفته شود
      const resolvedFromCandidates = getAppRootDir({
        cwd: unrelatedDir,
        candidates: [unrelatedDir, resolvedRoot],
      });
      expect(resolvedFromCandidates).toBe(resolvedRoot);
    } finally {
      fs.rmSync(unrelatedDir, { recursive: true, force: true });
    }
  });
});


