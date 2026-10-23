import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  calculateDailyAttendance,
  evaluateWorkerLiveState,
  validateAttendanceSequence,
} from '../src/shared/calculationEngine';
import {
  gregorianToShamsi,
  shamsiToGregorian,
  isValidShamsiDate,
  getShamsiMonthCalendar,
  formatNumericInputWithCommas,
  numberToPersianTomanWords,
} from '../src/shared/jalali';
import { AttendanceLog, SystemSettings } from '../src/shared/types';
import {
  getPool,
  initializeDatabase,
  setSimulatedDatabaseDisconnect,
} from '../src/server/db';
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

  beforeAll(async () => {
    await initializeDatabase();
    const pool = getPool();
    await pool.execute('DELETE FROM financial_transactions');
    await pool.execute('DELETE FROM daily_work_reports');
    await pool.execute('DELETE FROM historical_work_records');
    await pool.execute('DELETE FROM attendance_logs');

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
    await pool.execute('DELETE FROM financial_transactions');
    await pool.execute('DELETE FROM daily_work_reports');
    await pool.execute('DELETE FROM historical_work_records');
    await pool.execute('DELETE FROM attendance_logs');
    await pool.execute(
      "DELETE FROM audit_logs WHERE reason LIKE '%TEST%' OR action_type IN ('FINANCE_APPROVE', 'FINANCE_DIRECT_CREATE', 'HISTORICAL_WORK_ADD')"
    );
    await pool.execute('UPDATE system_settings SET banner_bg_url = NULL');
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

  it('سناریو ۱ و ۱۵: ورود مدیریت (مجید نورایی) و نیروی کار (امید میثمی) و بررسی کنترل دسترسی APIها در سرور (RBAC)', async () => {
    const mgrRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'manager',
        password: process.env.INITIAL_MANAGER_PASSWORD || 'Mgammon@1405',
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
        password: process.env.INITIAL_WORKER_PASSWORD || 'Worker@1405',
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

    setSimulatedDatabaseDisconnect(false);
  });
});
