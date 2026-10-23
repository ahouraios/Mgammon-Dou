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
  grace_period_minutes: 15,
  break_duration_minutes: 30,
  working_days: [6, 0, 1, 2, 3, 4], // شنبه تا پنجشنبه
  overtime_start_time: '17:00',
  overtime_before_shift: false,
  mission_policy: 'PAID_AS_WORK',
  friday_holiday_policy: 'ALL_OVERTIME',
  official_holidays: ['1405/01/01', '1405/01/13'],
  timezone: 'Asia/Tehran',
  hourly_rate_toman: null,
  overtime_rate_toman: null,
  rules_confirmed_by_manager: true,
  effective_from_shamsi: '1405/01/01',
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
    // پاکسازی جداول عملیاتی پیش از شروع تست
    await pool.execute('DELETE FROM financial_transactions');
    await pool.execute('DELETE FROM daily_work_reports');
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
    // پاکسازی کامل داده‌های تست از محیط واقعی طبق بند ۸ الزامات
    await pool.execute('DELETE FROM financial_transactions');
    await pool.execute('DELETE FROM daily_work_reports');
    await pool.execute('DELETE FROM attendance_logs');
    await pool.execute("DELETE FROM audit_logs WHERE reason LIKE '%TEST%' OR action_type IN ('FINANCE_APPROVE', 'FINANCE_DIRECT_CREATE')");
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('سناریو ۱۳: تبدیل و نمایش صحیح تاریخ شمسی و میلادی', () => {
    const shamsi = gregorianToShamsi('2026-03-21');
    expect(shamsi).toBe('1405/01/01');
    const greg = shamsiToGregorian('1405/01/01');
    expect(greg).toBe('2026-03-21');
    expect(isValidShamsiDate('1405/07/30')).toBe(true);
    expect(isValidShamsiDate('1405/13/01')).toBe(false);
  });

  it('سناریو ۳، ۴، ۵، ۶ و ۱۴ (واحد محاسبات): جلوگیری از تردد نامعتبر، محاسبه مدت کار، مأموریت، تأخیر، اضافه‌کاری، روز ناقص، جمعه و تعطیلات', () => {
    // جلوگیری از پایان کار بدون شروع کار
    expect(validateAttendanceSequence([], 'WORK_END', '17:00:00').valid).toBe(false);

    const startLog = makeLog(1, 'WORK_START', '08:30:00');
    // جلوگیری از شروع کار تکراری
    expect(validateAttendanceSequence([startLog], 'WORK_START', '09:00:00').valid).toBe(false);

    // ثبت مأموریت و بازگشت و پایان کار در روز عادی (۰۸:۳۰ تا ۱۸:۳۰ = ۱۰ ساعت حضور، ۳۰ دقیقه کسر استراحت = ۹.۵ ساعت خالص، ۱.۵ ساعت اضافه‌کاری)
    const logsNormalWithMission: AttendanceLog[] = [
      makeLog(1, 'WORK_START', '08:30:00'),
      makeLog(2, 'MISSION_START', '11:00:00'),
      makeLog(3, 'MISSION_END', '13:00:00'),
      makeLog(4, 'WORK_END', '18:30:00'),
    ];
    const summaryNormal = calculateDailyAttendance(
      '2026-10-24', // شنبه
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

    // تشخیص تأخیر (ورود ۰۹:۰۰ با فرجه ۱۵ دقیقه نسبت به ۰۸:۳۰ -> ۳۰ دقیقه تأخیر)
    const lateLogs = [makeLog(1, 'WORK_START', '09:00:00'), makeLog(2, 'WORK_END', '17:00:00')];
    const summaryLate = calculateDailyAttendance('2026-10-24', '1405/08/02', lateLogs, BASE_SETTINGS);
    expect(summaryLate.is_late).toBe(true);
    expect(summaryLate.late_minutes).toBe(30);

    // روز ناقص (فراموشی ثبت پایان کار در روز گذشته -> ساعات قطعی باید ۰ باشد تا تعیین تکلیف شود)
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

    // کار در روز جمعه (2026-10-23 جمعه است) -> تمام ساعت کاری به عنوان اضافه‌کاری محاسبه شود
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

    // بررسی نشانگر متحرک «+» اضافه‌کاری در وضعیت زنده
    const liveDuringOvertime = evaluateWorkerLiveState(
      [makeLog(1, 'WORK_START', '08:30:00')],
      BASE_SETTINGS,
      new Date('2026-10-24T14:30:00Z') // 18:00 به وقت تهران (بعد از ساعت 17:00)
    );
    expect(liveDuringOvertime.is_overtime_active).toBe(true);
  });

  it('سناریو ۱ و ۱۵: ورود مدیر و نیروی کاری و بررسی کنترل دسترسی APIها در سرور (RBAC)', async () => {
    // ورود مدیر
    const mgrRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager', password: process.env.INITIAL_MANAGER_PASSWORD || 'Mgammon@1405' }),
    });
    const mgrData = await mgrRes.json();
    expect(mgrRes.status).toBe(200);
    expect(mgrData.user.role).toBe('manager');
    managerToken = mgrData.token;

    // ورود نیروی کاری
    const wrkRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'worker', password: process.env.INITIAL_WORKER_PASSWORD || 'Worker@1405' }),
    });
    const wrkData = await wrkRes.json();
    expect(wrkRes.status).toBe(200);
    expect(wrkData.user.role).toBe('worker');
    workerToken = wrkData.token;

    // تلاش نیروی کاری برای دسترسی به داشبورد مدیر -> باید 403 Forbidden برگرداند
    const forbiddenRes = await fetch(`${baseUrl}/api/manager/dashboard`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(forbiddenRes.status).toBe(403);

    // تلاش مدیر برای ثبت مستقیم دکمه تردد نیرو -> باید 403 برگرداند
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

  it('سناریو ۲، ۳، ۱۰ و ۱۲: ثبت تردد توسط نیرو، جلوگیری از تکرار، نمایش یکسان در دو دستگاه و اصلاح توسط مدیر با Audit Log', async () => {
    // ثبت شروع کار توسط نیرو
    const startRes = await fetch(`${baseUrl}/api/attendance/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ event_type: 'WORK_START', note: 'شروع شیفت تست' }),
    });
    expect(startRes.status).toBe(201);

    // تلاش برای ثبت شروع کار تکراری -> باید 400 برگرداند
    const dupStartRes = await fetch(`${baseUrl}/api/attendance/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ event_type: 'WORK_START' }),
    });
    expect(dupStartRes.status).toBe(400);

    // بررسی نمایش یکسان وضعیت نیرو در دستگاه مدیر و دستگاه نیرو
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

    // اصلاح ساعت تردد توسط مدیر همراه با ثبت در Audit Log
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

  it('سناریو ۷، ۸ و ۹: ثبت درخواست مالی توسط نیرو، تأیید توسط مدیر، جلوگیری از تأیید تکراری و ثبت مستقیم پرداخت', async () => {
    // ۱. ثبت درخواست مساعده توسط نیرو
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

    // بررسی اینکه تا قبل از تأیید مدیر در مجموع پرداخت‌های قطعی محاسبه نشده باشد
    const beforeApproveRes = await fetch(`${baseUrl}/api/finance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const beforeApproveData = await beforeApproveRes.json();
    expect(beforeApproveData.summary.approvedTotalToman).toBe(0);
    expect(beforeApproveData.summary.pendingTotalToman).toBe(3500000);

    // ۲. تأیید درخواست توسط مدیر
    const approveRes = await fetch(`${baseUrl}/api/finance/${txId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ decision: 'APPROVED', manager_note: 'واریز انجام شد' }),
    });
    expect(approveRes.status).toBe(200);

    // ۳. تلاش برای تأیید تکراری همان درخواست -> باید 409 Conflict برگرداند و مبلغ دوبار جمع نشود
    const dupApproveRes = await fetch(`${baseUrl}/api/finance/${txId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    expect(dupApproveRes.status).toBe(409);

    // ۴. ثبت مستقیم پرداخت توسط مدیر
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

    // بررسی مجموع نهایی پرداخت‌های قطعی (3,500,000 + 12,000,000 = 15,500,000)
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
    // اطمینان از عدم نشت رمز عبور یا اطلاعات اتصال دیتابیس در پیام خطا
    expect(JSON.stringify(clockFailData)).not.toContain('mgammon_pass');

    setSimulatedDatabaseDisconnect(false);
  });
});
