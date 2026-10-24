import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  calculateDailyAttendance,
  calculateMonthlyPayrollPeriod,
  calculateSalaryAndOvertimeRates,
  evaluateWorkerLiveState,
  validateAttendanceSequence,
  validateFullDayLogSequence,
} from '../src/shared/calculationEngine';
import {
  gregorianToShamsi,
  shamsiToGregorian,
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
import {
  getPool,
  initializeDatabase,
  setSimulatedDatabaseDisconnect,
  validateProductionSecurityConfig,
} from '../src/server/db';
import { resetAllLoginRateLimits } from '../src/server/auth';
import { createApp } from '../server';
import type { Server } from 'http';

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

  let savedSettingsRow: Record<string, unknown> | null = null;

  const backupTables = [
    'user_sessions',
    'financial_transactions',
    'daily_work_reports',
    'historical_work_records',
    'attendance_logs',
    'leave_requests',
    'system_settings_snapshots',
  ];

  beforeAll(async () => {
    await initializeDatabase();
    const pool = getPool();
    const [sRows] = await pool.execute('SELECT * FROM system_settings ORDER BY id ASC LIMIT 1');
    if (Array.isArray(sRows) && sRows.length > 0) {
      savedSettingsRow = sRows[0] as Record<string, unknown>;
    }

    for (const tbl of backupTables) {
      await pool.execute(`DROP TABLE IF EXISTS _test_bak_${tbl}`);
      await pool.execute(`CREATE TABLE _test_bak_${tbl} AS SELECT * FROM ${tbl}`);
      await pool.execute(`DELETE FROM ${tbl}`);
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
  });

  afterAll(async () => {
    setSimulatedDatabaseDisconnect(false);
    const pool = getPool();
    for (const tbl of backupTables) {
      await pool.execute(`DELETE FROM ${tbl}`);
      await pool.execute(`INSERT INTO ${tbl} SELECT * FROM _test_bak_${tbl}`);
      await pool.execute(`DROP TABLE IF EXISTS _test_bak_${tbl}`);
    }
    await pool.execute(
      "DELETE FROM audit_logs WHERE reason LIKE '%TEST%' OR reason LIKE '%تست%'"
    );
    if (savedSettingsRow) {
      await pool.execute(
        `UPDATE system_settings SET
          shift_start_time = ?,
          shift_end_time = ?,
          thursday_shift_start_time = ?,
          thursday_shift_end_time = ?,
          thursday_overtime_start_time = ?,
          grace_period_minutes = ?,
          break_duration_minutes = ?,
          base_salary_toman = ?,
          hourly_rate_toman = ?,
          overtime_calc_mode = ?,
          overtime_percentage = ?,
          overtime_rate_toman = ?,
          effective_from_shamsi = ?,
          banner_bg_url = ?
         WHERE id = ?`,
        [
          savedSettingsRow.shift_start_time,
          savedSettingsRow.shift_end_time,
          savedSettingsRow.thursday_shift_start_time,
          savedSettingsRow.thursday_shift_end_time,
          savedSettingsRow.thursday_overtime_start_time,
          savedSettingsRow.grace_period_minutes,
          savedSettingsRow.break_duration_minutes,
          savedSettingsRow.base_salary_toman,
          savedSettingsRow.hourly_rate_toman,
          savedSettingsRow.overtime_calc_mode,
          savedSettingsRow.overtime_percentage,
          savedSettingsRow.overtime_rate_toman,
          savedSettingsRow.effective_from_shamsi,
          savedSettingsRow.banner_bg_url ?? null,
          savedSettingsRow.id,
        ]
      );
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
});

