import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { SystemSettings } from '../shared/types';

let pool: mysql.Pool | null = null;
let simulatedDisconnectForTest = false;

export function setSimulatedDatabaseDisconnect(disconnect: boolean): void {
  simulatedDisconnectForTest = disconnect;
}

export function isSimulatedDatabaseDisconnect(): boolean {
  return simulatedDisconnectForTest;
}

export function getDbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'mgammon_user',
    password: process.env.DB_PASSWORD || 'mgammon_pass_2026',
    database: process.env.DB_NAME || 'mgammon_duo',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+03:30',
    decimalNumbers: true,
    dateStrings: ['DATE'] as ('DATE' | 'DATETIME' | 'TIMESTAMP')[],
  };
}

/**
 * در محیط کانتینر محلی، اگر سرویس MariaDB نصب باشد اما هنوز اجرا نشده باشد آن را راه‌اندازی می‌کند.
 * در محیط هاست اشتراکی cPanel که MySQL از قبل توسط سرویس‌دهنده اجراست، مستقیماً متصل می‌شود.
 */
function ensureLocalMariaDbRunningIfNeeded(): void {
  const host = process.env.DB_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') return;

  try {
    const hasMariadbd = execSync('which mariadbd-safe || true', { stdio: 'pipe' }).toString().trim();
    if (!hasMariadbd) return;

    const isRunning = execSync('pgrep -x mariadbd || pgrep -x mysqld || true', { stdio: 'pipe' })
      .toString()
      .trim();

    if (!isRunning) {
      execSync(
        'mkdir -p /run/mysqld && chown -R mysql:mysql /run/mysqld /var/lib/mysql && (mariadbd-safe --datadir=/var/lib/mysql --bind-address=127.0.0.1 --port=3306 > /tmp/mariadb.log 2>&1 &) && sleep 2',
        { stdio: 'pipe' }
      );
      const dbName = process.env.DB_NAME || 'mgammon_duo';
      const dbUser = process.env.DB_USER || 'mgammon_user';
      const dbPass = process.env.DB_PASSWORD || 'mgammon_pass_2026';
      execSync(
        `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPass}'; CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'127.0.0.1'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'localhost'; FLUSH PRIVILEGES;"`,
        { stdio: 'pipe' }
      );
    }
  } catch {
    // در هاست اشتراکی cPanel نیازی به اجرای دستور سیستمی نیست
  }
}

export function getPool(): mysql.Pool {
  if (simulatedDisconnectForTest) {
    const err = new Error('DATABASE_CONNECTION_LOST');
    (err as unknown as { code: string }).code = 'ECONNREFUSED';
    throw err;
  }
  if (!pool) {
    pool = mysql.createPool(getDbConfig());
  }
  return pool;
}

export async function checkDatabaseConnection(): Promise<{ connected: boolean; message?: string }> {
  if (simulatedDisconnectForTest) {
    return {
      connected: false,
      message: 'ارتباط با پایگاه داده MySQL برقرار نیست.',
    };
  }
  try {
    const p = getPool();
    await p.execute('SELECT 1 AS ok');
    return { connected: true };
  } catch {
    return {
      connected: false,
      message: 'ارتباط با پایگاه داده MySQL برقرار نیست. لطفاً تنظیمات سرور را بررسی کنید.',
    };
  }
}

export async function initializeDatabase(): Promise<void> {
  ensureLocalMariaDbRunningIfNeeded();

  const p = getPool();
  const schemaPath = path.resolve(process.cwd(), 'database/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // حذف خطوط کامنت SQL و سپس جداسازی دستورات با نقطه ویرگول
  const cleanedSql = schemaSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanedSql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await p.query(stmt);
  }

  // بررسی و ایجاد تنها دو حساب مجاز سامانه: ۱. مدیر ۲. نیروی کاری
  const [existingUsers] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT id, username, role FROM users ORDER BY id ASC'
  );

  const hasManager = existingUsers.some((u) => u.role === 'manager');
  const hasWorker = existingUsers.some((u) => u.role === 'worker');

  if (!hasManager) {
    const managerUsername = process.env.INITIAL_MANAGER_USERNAME || 'manager';
    const managerPassword = process.env.INITIAL_MANAGER_PASSWORD || 'Mgammon@1405';
    const hash = await bcrypt.hash(managerPassword, 10);
    await p.execute(
      'INSERT INTO users (username, full_name, role, password_hash, is_active) VALUES (?, ?, ?, ?, 1)',
      [managerUsername, 'مدیر مجموعه (Mgammon)', 'manager', hash]
    );
  }

  if (!hasWorker) {
    const workerUsername = process.env.INITIAL_WORKER_USERNAME || 'worker';
    const workerPassword = process.env.INITIAL_WORKER_PASSWORD || 'Worker@1405';
    const hash = await bcrypt.hash(workerPassword, 10);
    await p.execute(
      'INSERT INTO users (username, full_name, role, password_hash, is_active) VALUES (?, ?, ?, ?, 1)',
      [workerUsername, 'نیروی کاری مجموعه', 'worker', hash]
    );
  }

  // بررسی و مقداردهی اولیه تنظیمات پایه سامانه (بدون داده آزمایشی یا جعلی در جداول عملیاتی)
  const [settingsRows] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT id FROM system_settings LIMIT 1'
  );

  if (settingsRows.length === 0) {
    await p.execute(
      `INSERT INTO system_settings (
        shift_start_time,
        shift_end_time,
        grace_period_minutes,
        break_duration_minutes,
        working_days_json,
        overtime_start_time,
        overtime_before_shift,
        mission_policy,
        friday_holiday_policy,
        official_holidays_json,
        timezone,
        hourly_rate_toman,
        overtime_rate_toman,
        rules_confirmed_by_manager,
        effective_from_shamsi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
      [
        '08:30',
        '17:00',
        15,
        30,
        JSON.stringify([6, 0, 1, 2, 3, 4]),
        '17:00',
        0,
        'PAID_AS_WORK',
        'ALL_OVERTIME',
        JSON.stringify([]),
        process.env.APP_TIMEZONE || 'Asia/Tehran',
        '1405/01/01',
      ]
    );
  }
}

export async function getSystemSettingsFromDb(targetShamsiDate?: string): Promise<SystemSettings> {
  const p = getPool();

  // اگر تاریخ مربوط به قبل از effective_from_shamsi تنظیمات فعلی باشد، از آخرین اسنپ‌شات معتبر همان دوره استفاده می‌شود
  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT * FROM system_settings ORDER BY id ASC LIMIT 1'
  );

  if (rows.length === 0) {
    throw new Error('تنظیمات سامانه یافت نشد');
  }

  const row = rows[0];

  if (targetShamsiDate && targetShamsiDate < String(row.effective_from_shamsi)) {
    const [snapRows] = await p.execute<mysql.RowDataPacket[]>(
      `SELECT settings_json FROM system_settings_snapshots
       WHERE effective_from_shamsi <= ?
       ORDER BY effective_from_shamsi DESC, id DESC LIMIT 1`,
      [targetShamsiDate]
    );
    if (snapRows.length > 0) {
      const parsed =
        typeof snapRows[0].settings_json === 'string'
          ? JSON.parse(snapRows[0].settings_json)
          : snapRows[0].settings_json;
      return parsed as SystemSettings;
    }
  }

  return mapRowToSystemSettings(row);
}

export function mapRowToSystemSettings(row: mysql.RowDataPacket): SystemSettings {
  let workingDays: number[] = [6, 0, 1, 2, 3, 4];
  try {
    workingDays = JSON.parse(row.working_days_json || '[6,0,1,2,3,4]');
  } catch {
    workingDays = [6, 0, 1, 2, 3, 4];
  }

  let officialHolidays: string[] = [];
  try {
    officialHolidays = JSON.parse(row.official_holidays_json || '[]');
  } catch {
    officialHolidays = [];
  }

  return {
    id: Number(row.id),
    shift_start_time: String(row.shift_start_time),
    shift_end_time: String(row.shift_end_time),
    grace_period_minutes: Number(row.grace_period_minutes),
    break_duration_minutes: Number(row.break_duration_minutes),
    working_days: workingDays,
    overtime_start_time: String(row.overtime_start_time),
    overtime_before_shift: Boolean(row.overtime_before_shift),
    mission_policy: row.mission_policy,
    friday_holiday_policy: row.friday_holiday_policy,
    official_holidays: officialHolidays,
    timezone: String(row.timezone || 'Asia/Tehran'),
    hourly_rate_toman: row.hourly_rate_toman !== null ? Number(row.hourly_rate_toman) : null,
    overtime_rate_toman: row.overtime_rate_toman !== null ? Number(row.overtime_rate_toman) : null,
    rules_confirmed_by_manager: Boolean(row.rules_confirmed_by_manager),
    effective_from_shamsi: String(row.effective_from_shamsi || '1405/01/01'),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}
