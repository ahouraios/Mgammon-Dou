import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import {
  checkDatabaseConnection,
  getPool,
  getSystemSettingsFromDb,
  mapRowToSystemSettings,
} from './db';
import {
  AuthenticatedRequest,
  clearSessionCookie,
  createServerSession,
   getSessionUser,
  handleServerError,
  recordAuditLog,
  requireAuth,
  requireRole,
  setSessionCookie,
} from './auth';
import {
  AttendanceEventType,
  AttendanceLog,
  DailyAttendanceSummary,
  DailyWorkReport,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
} from '../shared/types';
import {
  getNowInTimezone,
  gregorianToShamsi,
  isValidShamsiDate,
  normalizeShamsiDate,
  shamsiToGregorian,
  toEnglishDigits,
} from '../shared/jalali';
import {
  calculateDailyAttendance,
  evaluateWorkerLiveState,
  validateAttendanceSequence,
  validateFullDayLogSequence,
} from '../shared/calculationEngine';

export const apiRouter = Router();

function mapRowToAttendanceLog(row: mysql.RowDataPacket): AttendanceLog {
  const workDate =
    row.work_date instanceof Date
      ? row.work_date.toISOString().slice(0, 10)
      : String(row.work_date).slice(0, 10);
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
  const txDate =
    row.tx_date instanceof Date
      ? row.tx_date.toISOString().slice(0, 10)
      : String(row.tx_date).slice(0, 10);
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
    status: row.status as FinancialStatus,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    manager_note: row.manager_note ? String(row.manager_note) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

async function getWorkerUserId(pool: mysql.Pool): Promise<number> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'worker' LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error('حساب نیروی کاری یافت نشد');
  }
  return Number(rows[0].id);
}

// ============================================================================
// ۱. بررسی وضعیت سلامت سرویس و اتصال دیتابیس (بدون افشای اطلاعات حساس)
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
  const settings = await getSystemSettingsFromDb();
  const nowInfo = getNowInTimezone(settings.timezone);
  res.json({
    ok: true,
    dbConnected: true,
    serverTime: nowInfo,
  });
});

// ============================================================================
// ۲. احراز هویت: ورود، خروج، نشست فعلی و تغییر رمز عبور
// ============================================================================
apiRouter.post('/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        message: 'نام کاربری و رمز عبور الزامی است.',
      });
      return;
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, username, full_name, role, password_hash, is_active, last_login_at FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      res.status(401).json({
        ok: false,
        message: 'نام کاربری یا رمز عبور اشتباه است.',
      });
      return;
    }

    const userRow = rows[0];
    const match = await bcrypt.compare(password, String(userRow.password_hash));
    if (!match) {
      await recordAuditLog({
        actorUserId: Number(userRow.id),
        actionType: 'LOGIN_FAILED',
        targetEntity: 'users',
        targetId: Number(userRow.id),
        ipAddress: req.ip || null,
      });
      res.status(401).json({
        ok: false,
        message: 'نام کاربری یا رمز عبور اشتباه است.',
      });
      return;
    }

    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userRow.id]);

    const { rawToken, expiresAt } = await createServerSession(
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

    res.json({
      ok: true,
      token: rawToken,
      user: {
        id: Number(userRow.id),
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
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
    res.json({
      ok: true,
      user: req.user,
      serverTime: nowInfo,
      settings,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post('/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

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
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    // باطل کردن سایر نشست‌های قبلی کاربر برای امنیت بیشتر
    if (req.sessionTokenHash) {
      await pool.execute(
        'DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?',
        [userId, req.sessionTokenHash]
      );
    }

    await recordAuditLog({
      actorUserId: userId,
      actionType: 'PASSWORD_CHANGE',
      targetEntity: 'users',
      targetId: userId,
      ipAddress: req.ip || null,
    });

    res.json({
      ok: true,
      message: 'رمز عبور با موفقیت تغییر یافت.',
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

// ============================================================================
// ۳. عملیات تردد نیروی کاری (فقط نقش worker مجاز به ثبت مستقیم تردد روزانه است)
// ============================================================================
apiRouter.get('/attendance/live-status', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await getWorkerUserId(pool);
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM attendance_logs
       WHERE user_id = ? AND work_date = ? AND is_deleted = 0
       ORDER BY recorded_time ASC, id ASC`,
      [workerId, nowInfo.workDate]
    );

    const todayLogs = rows.map(mapRowToAttendanceLog);
    const liveState = evaluateWorkerLiveState(todayLogs, settings);

    res.json({
      ok: true,
      serverTime: nowInfo,
      liveState,
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
      const workerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      // قفل کردن رکوردهای امروز کاربر برای جلوگیری از ثبت هم‌زمان تکراری (Race Condition)
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

      res.status(201).json({
        ok: true,
        logId: insertResult.insertId,
        message: 'عملیات تردد با موفقیت در پایگاه داده ثبت و تأیید شد.',
        liveState,
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
          // ignore rollback error
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

// ============================================================================
// ۴. مشاهده سوابق تردد و محاسبات روزانه + اصلاح تردد توسط مدیر با ثبت Audit Log
// ============================================================================
apiRouter.get('/attendance/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await getWorkerUserId(pool);
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

    // گروه‌بندی بر اساس روز کاری
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

    res.json({
      ok: true,
      dailySummaries,
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * افزودن یا اصلاح رکورد تردد توسط مدیر (همراه با اعتبارسنجی توالی و ثبت در Audit Log)
 */
apiRouter.post(
  '/attendance/manager-override',
  requireAuth,
  requireRole('manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    const pool = getPool();
    let conn: mysql.PoolConnection | null = null;
    try {
      const action = String(req.body?.action || ''); // 'ADD' | 'UPDATE' | 'DELETE'
      const reason = String(req.body?.reason || '').trim();

      if (!reason || reason.length < 3) {
        res.status(400).json({
          ok: false,
          message: 'ثبت علت دقیق اصلاح تردد برای درج در سابقه تغییرات (Audit Log) الزامی است.',
        });
        return;
      }

      const workerId = await getWorkerUserId(pool);
      const managerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      if (action === 'ADD') {
        const shamsiDateRaw = String(req.body?.shamsi_date || '');
        if (!isValidShamsiDate(shamsiDateRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: 'تاریخ شمسی واردشده معتبر نیست.' });
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
        const [ins] = await conn.execute<mysql.ResultSetHeader>(
          `INSERT INTO attendance_logs
            (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, modified_by_user_id, modification_reason, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
          [workerId, workDate, shamsiDate, eventType, recordedAt, recordedTime, note, managerId, reason]
        );

        await recordAuditLog({
          actorUserId: managerId,
          actionType: 'ATTENDANCE_ADD_MANUAL',
          targetEntity: 'attendance_logs',
          targetId: ins.insertId,
          beforeState: null,
          afterState: { shamsiDate, eventType, recordedTime, note },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.status(201).json({
          ok: true,
          message: 'رکورد تردد با ثبت در تاریخچه تغییرات اضافه شد.',
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
          beforeState: {
            event_type: targetLog.event_type,
            recorded_time: targetLog.recorded_time,
            shamsi_date: targetLog.shamsi_date,
          },
          afterState: {
            event_type: newEventType,
            recorded_time: recordedTime,
            shamsi_date: targetLog.shamsi_date,
          },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.json({
          ok: true,
          message: 'اصلاح تردد با موفقیت انجام و در لاگ ممیزی ثبت شد.',
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
          actionType: 'ATTENDANCE_DELETE',
          targetEntity: 'attendance_logs',
          targetId: logId,
          beforeState: targetLog,
          afterState: { is_deleted: true },
          reason,
          ipAddress: req.ip || null,
          connection: conn,
        });

        await conn.commit();
        res.json({
          ok: true,
          message: 'رکورد تردد حذف و سابقه تغییر ثبت شد.',
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
// ۵. گزارش‌های کار روزانه (ثبت توسط نیرو، مشاهده و فیلتر توسط نیرو و مدیر)
// ============================================================================
apiRouter.get('/reports', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await getWorkerUserId(pool);

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
      report_date:
        r.report_date instanceof Date
          ? r.report_date.toISOString().slice(0, 10)
          : String(r.report_date).slice(0, 10),
      shamsi_date: String(r.shamsi_date),
      activity_description: String(r.activity_description),
      duration_minutes: r.duration_minutes !== null ? Number(r.duration_minutes) : null,
      recorded_time: String(r.recorded_time),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));

    res.json({ ok: true, reports });
  } catch (err) {
    handleServerError(res, err);
  }
});

apiRouter.post(
  '/reports',
  requireAuth,
  requireRole('worker'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const description = String(req.body?.activity_description || '').trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : '';
      const durationRaw = req.body?.duration_minutes;

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

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);

      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const reportDate = shamsiToGregorian(shamsiDate);

      const pool = getPool();
      const [result] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO daily_work_reports
          (user_id, report_date, shamsi_date, activity_description, duration_minutes, recorded_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user!.id, reportDate, shamsiDate, description, durationMinutes, nowInfo.timeHHMMSS]
      );

      res.status(201).json({
        ok: true,
        reportId: result.insertId,
        message: 'گزارش کار روزانه با موفقیت ثبت شد.',
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۶. امور مالی و کارتابل پرداخت‌ها (ثبت توسط نیرو، تأیید/رد مقاوم در برابر تکرار، ثبت مستقیم مدیر)
// ============================================================================
apiRouter.get('/finance', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const workerId = await getWorkerUserId(pool);

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

    // محاسبه مجموع پرداخت‌های قطعی (فقط APPROVED) و در انتظار تأیید (PENDING) از دیتابیس
    const [totalsRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
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
        pendingCount: Number(totalsRows[0]?.pending_count || 0),
      },
    });
  } catch (err) {
    handleServerError(res, err);
  }
});

/**
 * ثبت درخواست مالی یا دریافتی توسط نیروی کاری (وضعیت اولیه: PENDING)
 */
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
          message: 'ثبت توضیحات برای درخواست مالی الزامی است.',
        });
        return;
      }

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);

      const pool = getPool();
      const workerId = req.user!.id;

      // همیشه با وضعیت PENDING ثبت می‌شود و تا زمان تأیید مدیر در پرداخت‌های قطعی محاسبه نمی‌گردد
      const [result] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, status, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [workerId, workerId, amountToman, txType, txDate, shamsiDate, description, idempotencyKey]
      );

      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message: 'درخواست مالی ثبت شد و در وضعیت «در انتظار تأیید مدیر» قرار گرفت.',
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

/**
 * ثبت مستقیم پرداخت قطعی توسط مدیر (وضعیت: APPROVED)
 */
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

      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);

      const workerId = await getWorkerUserId(pool);
      const managerId = req.user!.id;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [result] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, status, reviewed_by_user_id, reviewed_at, manager_note, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, NOW(), 'ثبت مستقیم توسط مدیر', ?)`,
        [workerId, managerId, amountToman, txType, txDate, shamsiDate, description, managerId, idempotencyKey]
      );

      await recordAuditLog({
        actorUserId: managerId,
        actionType: 'FINANCE_DIRECT_CREATE',
        targetEntity: 'financial_transactions',
        targetId: result.insertId,
        beforeState: null,
        afterState: { amountToman, txType, shamsiDate, description, status: 'APPROVED' },
        reason: 'ثبت مستقیم پرداخت توسط مدیر',
        ipAddress: req.ip || null,
        connection: conn,
      });

      await conn.commit();

      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message: 'پرداخت جدید با موفقیت ثبت و به مجموع پرداخت‌های قطعی اضافه شد.',
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
          message: 'این پرداخت قبلاً ثبت شده است (جلوگیری از ثبت تکراری).',
        });
        return;
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);

/**
 * بررسی درخواست مالی نیرو توسط مدیر (تأیید یا رد) با تراکنش دیتابیس و قفل ردیف (SELECT ... FOR UPDATE)
 * مقاوم در برابر درخواست‌های تکراری هم‌زمان
 */
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

      // قفل انحصاری ردیف در تراکنش برای جلوگیری از تأیید دوبار
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
          message: `این درخواست قبلاً بررسی شده و در وضعیت «${tx.status === 'APPROVED' ? 'تأییدشده' : 'ردشده'}» قرار دارد. امکان ثبت مجدد وجود ندارد.`,
        });
        return;
      }

      await conn.execute(
        `UPDATE financial_transactions
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(), manager_note = ?
         WHERE id = ? AND status = 'PENDING'`,
        [decision, managerId, managerNote, txId]
      );

      await recordAuditLog({
        actorUserId: managerId,
        actionType: decision === 'APPROVED' ? 'FINANCE_APPROVE' : 'FINANCE_REJECT',
        targetEntity: 'financial_transactions',
        targetId: txId,
        beforeState: { status: tx.status, amount_toman: tx.amount_toman },
        afterState: { status: decision, amount_toman: tx.amount_toman, manager_note: managerNote },
        reason: managerNote || (decision === 'APPROVED' ? 'تأیید درخواست مالی' : 'رد درخواست مالی'),
        ipAddress: req.ip || null,
        connection: conn,
      });

      await conn.commit();

      res.json({
        ok: true,
        message:
          decision === 'APPROVED'
            ? 'درخواست مالی تأیید شد و به سوابق پرداخت‌های قطعی اضافه گردید.'
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

// ============================================================================
// ۷. داشبورد جامع مدیر (شاخص‌های اصلی، وضعیت لحظه‌ای نیرو، نمودارهای هفتگی و ماهانه)
// ============================================================================
apiRouter.get(
  '/manager/dashboard',
  requireAuth,
  requireRole('manager'),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const pool = getPool();
      const workerId = await getWorkerUserId(pool);
      const currentSettings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(currentSettings.timezone);

      // ۱. دریافت تمام رکوردهای تردد فعال
      const [allLogRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND is_deleted = 0
         ORDER BY work_date DESC, recorded_time ASC, id ASC`,
        [workerId]
      );
      const allLogs = allLogRows.map(mapRowToAttendanceLog);

      // گروه‌بندی بر اساس تاریخ
      const byDate = new Map<string, AttendanceLog[]>();
      for (const log of allLogs) {
        const list = byDate.get(log.work_date) || [];
        list.push(log);
        byDate.set(log.work_date, list);
      }

      const todayLogs = byDate.get(nowInfo.workDate) || [];
      const liveState = evaluateWorkerLiveState(todayLogs, currentSettings);

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

      // ۲. محاسبه شاخص‌های مالی واقعی از دیتابیس
      const [finRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count
         FROM financial_transactions
         WHERE user_id = ?`,
        [workerId]
      );

      // ۳. داده‌های نمودار روند (فقط روزهای دارای داده واقعی ثبت‌شده طبق بند ۵ الزامات)
      const confirmedChronological = [...dailySummaries]
        .filter((d) => d.logs.length > 0)
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
        },
        charts: {
          weekly: weeklyChartData,
          monthly: monthlyChartData,
        },
        recentSummaries: dailySummaries.slice(0, 14),
        settings: currentSettings,
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// ============================================================================
// ۸. تنظیمات قواعد کارکرد و اضافه‌کاری + لاگ ممیزی (فقط مدیر)
// ============================================================================
apiRouter.get('/settings', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await getSystemSettingsFromDb();
    res.json({ ok: true, settings });
  } catch (err) {
    handleServerError(res, err);
  }
});

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

      const shiftStart = toEnglishDigits(String(req.body?.shift_start_time || currentSettings.shift_start_time)).trim();
      const shiftEnd = toEnglishDigits(String(req.body?.shift_end_time || currentSettings.shift_end_time)).trim();
      const overtimeStart = toEnglishDigits(String(req.body?.overtime_start_time || currentSettings.overtime_start_time)).trim();

      if (!/^\d{2}:\d{2}$/.test(shiftStart) || !/^\d{2}:\d{2}$/.test(shiftEnd) || !/^\d{2}:\d{2}$/.test(overtimeStart)) {
        res.status(400).json({ ok: false, message: 'فرمت ساعات شیفت و اضافه‌کاری باید HH:MM باشد.' });
        return;
      }

      const gracePeriod = Math.max(0, Math.min(240, Number(req.body?.grace_period_minutes ?? currentSettings.grace_period_minutes)));
      const breakDuration = Math.max(0, Math.min(240, Number(req.body?.break_duration_minutes ?? currentSettings.break_duration_minutes)));
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

      const timezone = String(req.body?.timezone || currentSettings.timezone).trim();

      const hourlyRateRaw = req.body?.hourly_rate_toman;
      const hourlyRate =
        hourlyRateRaw !== null && hourlyRateRaw !== undefined && String(hourlyRateRaw).trim() !== ''
          ? Number(toEnglishDigits(String(hourlyRateRaw)).replace(/,/g, ''))
          : null;

      const overtimeRateRaw = req.body?.overtime_rate_toman;
      const overtimeRate =
        overtimeRateRaw !== null && overtimeRateRaw !== undefined && String(overtimeRateRaw).trim() !== ''
          ? Number(toEnglishDigits(String(overtimeRateRaw)).replace(/,/g, ''))
          : null;

      const applyRetroactively = Boolean(req.body?.apply_retroactively);
      const effectiveFromShamsi = applyRetroactively
        ? '1400/01/01'
        : req.body?.effective_from_shamsi && isValidShamsiDate(String(req.body.effective_from_shamsi))
          ? normalizeShamsiDate(String(req.body.effective_from_shamsi))
          : nowInfo.shamsiDate;

      conn = await pool.getConnection();
      await conn.beginTransaction();

      // ذخیره اسنپ‌شات تنظیمات قبلی تا سوابق ماه‌های گذشته بدون مجوز تغییر نکند
      if (!applyRetroactively) {
        await conn.execute(
          `INSERT INTO system_settings_snapshots (effective_from_shamsi, settings_json, created_by_user_id)
           VALUES (?, ?, ?)`,
          [currentSettings.effective_from_shamsi, JSON.stringify(currentSettings), req.user!.id]
        );
      }

      await conn.execute(
        `UPDATE system_settings SET
          shift_start_time = ?,
          shift_end_time = ?,
          grace_period_minutes = ?,
          break_duration_minutes = ?,
          working_days_json = ?,
          overtime_start_time = ?,
          overtime_before_shift = ?,
          mission_policy = ?,
          friday_holiday_policy = ?,
          official_holidays_json = ?,
          timezone = ?,
          hourly_rate_toman = ?,
          overtime_rate_toman = ?,
          rules_confirmed_by_manager = 1,
          effective_from_shamsi = ?,
          updated_by_user_id = ?
         WHERE id = ?`,
        [
          shiftStart,
          shiftEnd,
          gracePeriod,
          breakDuration,
          JSON.stringify(workingDays),
          overtimeStart,
          overtimeBeforeShift ? 1 : 0,
          missionPolicy,
          fridayHolidayPolicy,
          JSON.stringify(officialHolidays),
          timezone,
          hourlyRate,
          overtimeRate,
          effectiveFromShamsi,
          req.user!.id,
          currentSettings.id,
        ]
      );

      const [updatedRows] = await conn.execute<mysql.RowDataPacket[]>(
        'SELECT * FROM system_settings WHERE id = ?',
        [currentSettings.id]
      );
      const newSettings = mapRowToSystemSettings(updatedRows[0]);

      await recordAuditLog({
        actorUserId: req.user!.id,
        actionType: 'SETTINGS_UPDATE',
        targetEntity: 'system_settings',
        targetId: currentSettings.id,
        beforeState: currentSettings,
        afterState: newSettings,
        reason: applyRetroactively
          ? 'به‌روزرسانی تنظیمات همراه با اعمال مجاز بر سوابق گذشته'
          : `به‌روزرسانی تنظیمات از تاریخ مؤثر ${effectiveFromShamsi} (حفظ سوابق قبلی)`,
        ipAddress: req.ip || null,
        connection: conn,
      });

      await conn.commit();

      res.json({
        ok: true,
        settings: newSettings,
        message: 'تنظیمات قواعد کارکرد و اضافه‌کاری با موفقیت ذخیره و تأیید شد.',
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
