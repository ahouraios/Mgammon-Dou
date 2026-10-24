import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { OvertimeCalcMode, SystemSettings } from '../shared/types';

let pool: mysql.Pool | null = null;
let localMariaDbBootstrapped = false;

export function getDbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mgammon_duo',
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 4000,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+03:30',
    dateStrings: ['DATE'] as ('DATE' | 'DATETIME' | 'TIMESTAMP')[],
  };
}

function ensureLocalMariaDbRunningIfNeeded(): void {
  if (localMariaDbBootstrapped) return;
  const cfg = getDbConfig();
  const isLocal = cfg.host === '127.0.0.1' || cfg.host === 'localhost';
  if (!isLocal) {
    localMariaDbBootstrapped = true;
    return;
  }

  try {
    const persistentDataDir = path.resolve(process.cwd(), '.data/mysql');
    const debCacheDir = path.resolve(process.cwd(), '.data/deb-cache');

    // در محیط کانتینر محلی، اگر باینری mariadbd پس از ری‌استارت کانتینر پاک شده باشد از کش محلی نصب می‌شود
    let hasMariadbd = false;
    try {
      execSync('which mariadbd', { stdio: 'ignore' });
      hasMariadbd = true;
    } catch {
      hasMariadbd = false;
    }

    if (!hasMariadbd && fs.existsSync('/etc/debian_version')) {
      fs.mkdirSync(debCacheDir, { recursive: true });
      const cachedDebs = fs.readdirSync(debCacheDir).filter((f) => f.endsWith('.deb'));
      if (cachedDebs.length > 0) {
        try {
          execSync(
            `DEBIAN_FRONTEND=noninteractive dpkg --force-confdef --force-confold -i "${debCacheDir}"/*.deb`,
            { stdio: 'ignore' }
          );
        } catch {
          // ignore partial dpkg warnings
        }
      } else {
        try {
          execSync(
            `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" -o Dir::Cache::archives="${debCacheDir}" mariadb-server`,
            { stdio: 'ignore' }
          );
        } catch {
          // ignore
        }
      }
    }

    const socketExists =
      fs.existsSync('/run/mysqld/mysqld.sock') ||
      fs.existsSync('/var/run/mysqld/mysqld.sock');

    if (!socketExists) {
      fs.mkdirSync('/run/mysqld', { recursive: true });
      fs.mkdirSync(persistentDataDir, { recursive: true });

      if (
        !fs.existsSync(path.join(persistentDataDir, 'mysql')) ||
        !fs.existsSync(path.join(persistentDataDir, 'ib_logfile0'))
      ) {
        try {
          fs.rmSync(persistentDataDir, { recursive: true, force: true });
          fs.mkdirSync(persistentDataDir, { recursive: true });
          execSync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`, {
            stdio: 'ignore',
          });
          execSync(
            `mariadb-install-db --user=mysql --datadir="${persistentDataDir}" --innodb-log-file-size=8M --auth-root-authentication-method=normal`,
            { stdio: 'ignore' }
          );
        } catch {
          // ignore
        }
      }

      try {
        execSync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`, {
          stdio: 'ignore',
        });
      } catch {
        // ignore if mysql user not present
      }

      const child = spawn(
        'mariadbd',
        [
          '--user=mysql',
          `--datadir=${persistentDataDir}`,
          '--innodb-log-file-size=8M',
          '--socket=/run/mysqld/mysqld.sock',
          '--pid-file=/run/mysqld/mysqld.pid',
          '--bind-address=127.0.0.1',
          '--port=3306',
        ],
        {
          detached: true,
          stdio: 'ignore',
        }
      );
      child.on('error', () => {
        // نادیده گرفتن خطا در صورتی که باینری mariadbd روی هاست خارجی نصب نباشد
      });
      child.unref();

      for (let i = 0; i < 20; i++) {
        if (
          fs.existsSync('/run/mysqld/mysqld.sock') ||
          fs.existsSync('/var/run/mysqld/mysqld.sock')
        ) {
          break;
        }
        execSync('sleep 0.5');
      }
    }

    const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, '');
    execSync(
      `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${safeDbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD(''); GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' IDENTIFIED VIA mysql_native_password USING PASSWORD('') WITH GRANT OPTION; FLUSH PRIVILEGES;"`,
      { stdio: 'ignore' }
    );
  } catch {
    // در هاست اشتراکی cPanel سرویس MySQL از قبل توسط هاست اجرا شده است
  } finally {
    localMariaDbBootstrapped = true;
  }
}

let simulatedDisconnect = false;

export function setSimulatedDatabaseDisconnect(disconnected: boolean): void {
  simulatedDisconnect = disconnected;
}

export function getPool(): mysql.Pool {
  if (simulatedDisconnect) {
    throw new Error('SIMULATED_DB_DISCONNECT');
  }
  if (!pool) {
    pool = mysql.createPool(getDbConfig());
  }
  return pool;
}

export async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  message?: string;
}> {
  if (simulatedDisconnect) {
    return {
      connected: false,
      message: 'ارتباط با پایگاه داده MySQL موقتاً در دسترس نیست.',
    };
  }
  if (process.env.SIMULATE_DB_DOWN === 'true') {
    return {
      connected: false,
      message: 'ارتباط با سرور برقرار نیست.',
    };
  }
  try {
    const p = getPool();
    await p.execute('SELECT 1 AS ok');
    return { connected: true };
  } catch {
    return {
      connected: false,
      message: 'ارتباط با سرور برقرار نیست. لطفاً اتصال را بررسی کنید.',
    };
  }
}

export const FORBIDDEN_DEFAULT_SECRETS = new Set([
  '',
  'mgammon-duo-default-server-secret-2026',
  'mgammon-duo-enterprise-secret-2026',
  'CHANGE_THIS_TO_A_STRONG_64_CHAR_RANDOM_SECRET_KEY',
  'replace_with_a_long_random_64_char_secret_string',
  'secret',
  'changeme',
]);

export const FORBIDDEN_DEFAULT_PASSWORDS = new Set([
  'Mgammon@1405',
  'Worker@1405',
  'CHANGE_ME_MANAGER_PASSWORD',
  'CHANGE_ME_WORKER_PASSWORD',
  '123456',
  '12345678',
  'password',
  'admin',
]);

export function validateProductionSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const sessionSecret = (env.SESSION_SECRET || '').trim();
  if (
    !sessionSecret ||
    sessionSecret.length < 32 ||
    FORBIDDEN_DEFAULT_SECRETS.has(sessionSecret)
  ) {
    throw new Error(
      'SECURITY_CONFIG_ERROR: متغیر محیطی SESSION_SECRET در محیط عملیاتی (Production) خالی، کوتاه‌تر از ۳۲ کاراکتر یا دارای مقدار پیش‌فرض است. راه‌اندازی سرور متوقف شد.'
    );
  }

  const mgrPass = (env.INITIAL_MANAGER_PASSWORD || '').trim();
  const wrkPass = (env.INITIAL_WORKER_PASSWORD || '').trim();
  if (
    (mgrPass && (mgrPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(mgrPass))) ||
    (wrkPass && (wrkPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(wrkPass)))
  ) {
    throw new Error(
      'SECURITY_CONFIG_ERROR: استفاده از رمز عبور پیش‌فرض یا ضعیف برای حساب‌های اولیه در محیط عملیاتی (Production) مجاز نیست.'
    );
  }
}

export async function initializeDatabase(): Promise<void> {
  validateProductionSecurityConfig(process.env);
  ensureLocalMariaDbRunningIfNeeded();

  const p = getPool();
  const schemaPath = path.resolve(process.cwd(), 'database/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

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

  // ارتقای خودکار ستون‌ها برای دیتابیس‌های موجود
  const migrations = [
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `avatar_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `collaboration_start_shamsi` VARCHAR(10) NULL DEFAULT '1405/06/15'",
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `phone_number` VARCHAR(20) NULL DEFAULT NULL",
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `biometric_credential_id` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `biometric_token_hash` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `must_change_password` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED'",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `excel_file_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `excel_file_name` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `parsed_rows_json` LONGTEXT NULL DEFAULT NULL",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `reviewed_by_user_id` INT UNSIGNED NULL DEFAULT NULL",
    "ALTER TABLE `historical_work_records` ADD COLUMN IF NOT EXISTS `reviewed_at` DATETIME NULL DEFAULT NULL",
    "ALTER TABLE `daily_work_reports` ADD COLUMN IF NOT EXISTS `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `daily_work_reports` ADD COLUMN IF NOT EXISTS `photo_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `daily_work_reports` ADD COLUMN IF NOT EXISTS `photo_name` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `financial_transactions` ADD COLUMN IF NOT EXISTS `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `financial_transactions` ADD COLUMN IF NOT EXISTS `receipt_file_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `financial_transactions` ADD COLUMN IF NOT EXISTS `receipt_file_name` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `banner_bg_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `thursday_shift_start_time` VARCHAR(5) NOT NULL DEFAULT '07:00'",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `thursday_shift_end_time` VARCHAR(5) NOT NULL DEFAULT '14:00'",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `thursday_overtime_start_time` VARCHAR(5) NOT NULL DEFAULT '14:00'",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `base_salary_toman` DECIMAL(15, 0) NULL DEFAULT NULL",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `overtime_calc_mode` ENUM('FIXED_RATE', 'PERCENTAGE') NOT NULL DEFAULT 'PERCENTAGE'",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `overtime_percentage` DECIMAL(6, 2) NOT NULL DEFAULT 140.00",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `collaboration_start_shamsi` VARCHAR(10) NOT NULL DEFAULT '1405/06/15'",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `monthly_leave_quota_days` DECIMAL(4, 1) NOT NULL DEFAULT 2.5",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `sms_enabled` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `melipayamak_username` VARCHAR(120) NOT NULL DEFAULT ''",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `melipayamak_password` VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `melipayamak_from_number` VARCHAR(64) NOT NULL DEFAULT ''",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `melipayamak_is_flash` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `system_settings` ADD COLUMN IF NOT EXISTS `worker_phone_number` VARCHAR(20) NOT NULL DEFAULT ''",
    "ALTER TABLE `work_correspondences` ADD COLUMN IF NOT EXISTS `audio_url` MEDIUMTEXT NULL DEFAULT NULL",
    "ALTER TABLE `work_correspondences` ADD COLUMN IF NOT EXISTS `audio_duration_seconds` INT UNSIGNED NULL DEFAULT NULL",
  ];

  for (const mig of migrations) {
    try {
      await p.query(mig);
    } catch {
      // ignore if already exists
    }
  }

  // بررسی و ایجاد تنها دو حساب مجاز سامانه:
  // ۱. مدیریت: مجید نورایی
  // ۲. پرسنل: امید میثمی
  const [existingUsers] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT id, username, role, full_name FROM users ORDER BY id ASC'
  );

  const hasManager = existingUsers.some((u) => u.role === 'manager');
  const hasWorker = existingUsers.some((u) => u.role === 'worker');
  const isProd = process.env.NODE_ENV === 'production';

  if (!hasManager) {
    const managerUsername = (process.env.INITIAL_MANAGER_USERNAME || 'manager').trim();
    const managerPassword = process.env.INITIAL_MANAGER_PASSWORD || (isProd ? '' : 'Mgammon@1405');
    if (isProd && (!managerPassword || FORBIDDEN_DEFAULT_PASSWORDS.has(managerPassword) || managerPassword.length < 8)) {
      throw new Error(
        'SECURITY_CONFIG_ERROR: برای ایجاد حساب اولیه مدیر در محیط عملیاتی باید متغیر محیطی INITIAL_MANAGER_PASSWORD با مقدار امن و غیرپیش‌فرض تنظیم شود.'
      );
    }
    const hash = await bcrypt.hash(managerPassword, 10);
    await p.execute(
      'INSERT INTO users (username, full_name, role, password_hash, collaboration_start_shamsi, is_active, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 1)',
      [managerUsername, 'مجید نورایی', 'manager', hash, '1405/06/15']
    );
  } else {
    await p.execute("UPDATE users SET full_name = 'مجید نورایی' WHERE role = 'manager'");
  }

  if (!hasWorker) {
    const workerUsername = (process.env.INITIAL_WORKER_USERNAME || 'worker').trim();
    const workerPassword = process.env.INITIAL_WORKER_PASSWORD || (isProd ? '' : 'Worker@1405');
    if (isProd && (!workerPassword || FORBIDDEN_DEFAULT_PASSWORDS.has(workerPassword) || workerPassword.length < 8)) {
      throw new Error(
        'SECURITY_CONFIG_ERROR: برای ایجاد حساب اولیه پرسنل در محیط عملیاتی باید متغیر محیطی INITIAL_WORKER_PASSWORD با مقدار امن و غیرپیش‌فرض تنظیم شود.'
      );
    }
    const hash = await bcrypt.hash(workerPassword, 10);
    await p.execute(
      'INSERT INTO users (username, full_name, role, password_hash, collaboration_start_shamsi, is_active, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 1)',
      [workerUsername, 'امید میثمی', 'worker', hash, '1405/06/15']
    );
  } else {
    await p.execute(
      "UPDATE users SET full_name = 'امید میثمی', collaboration_start_shamsi = '1405/06/15' WHERE role = 'worker' AND (collaboration_start_shamsi IS NULL OR collaboration_start_shamsi = '1405/01/01')"
    );
  }

  // بررسی و مقداردهی اولیه تنظیمات پایه سامانه
  const [settingsRows] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT id, shift_start_time, shift_end_time, thursday_shift_end_time, collaboration_start_shamsi FROM system_settings LIMIT 1'
  );

  if (settingsRows.length === 0) {
    await p.execute(
      `INSERT INTO system_settings (
        shift_start_time,
        shift_end_time,
        thursday_shift_start_time,
        thursday_shift_end_time,
        thursday_overtime_start_time,
        grace_period_minutes,
        break_duration_minutes,
        working_days_json,
        overtime_start_time,
        overtime_before_shift,
        mission_policy,
        friday_holiday_policy,
        official_holidays_json,
        timezone,
        base_salary_toman,
        hourly_rate_toman,
        overtime_calc_mode,
        overtime_percentage,
        overtime_rate_toman,
        collaboration_start_shamsi,
        monthly_leave_quota_days,
        rules_confirmed_by_manager,
        effective_from_shamsi,
        banner_bg_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'PERCENTAGE', 140.00, NULL, '1405/06/15', 2.5, 0, ?, '/assets/media/banner-bg.svg')`,
      [
        '07:00',
        '15:00',
        '07:00',
        '14:00',
        '14:00',
        15,
        30,
        JSON.stringify([6, 0, 1, 2, 3, 4]),
        '15:00',
        0,
        'PAID_AS_WORK',
        'ALL_OVERTIME',
        JSON.stringify([]),
        process.env.APP_TIMEZONE || 'Asia/Tehran',
        '1405/06/15',
      ]
    );
  } else {
    await p.execute(
      `UPDATE system_settings
       SET banner_bg_url = '/assets/media/banner-bg.svg',
           shift_start_time = CASE WHEN shift_start_time = '08:30' THEN '07:00' ELSE shift_start_time END,
           shift_end_time = CASE WHEN shift_end_time = '17:00' THEN '15:00' ELSE shift_end_time END,
           overtime_start_time = CASE WHEN overtime_start_time = '17:00' THEN '15:00' ELSE overtime_start_time END,
           thursday_shift_start_time = CASE WHEN thursday_shift_start_time = '08:30' THEN '07:00' ELSE thursday_shift_start_time END,
           thursday_shift_end_time = CASE WHEN thursday_shift_end_time = '13:00' THEN '14:00' ELSE thursday_shift_end_time END,
           thursday_overtime_start_time = CASE WHEN thursday_overtime_start_time = '13:00' THEN '14:00' ELSE thursday_overtime_start_time END,
           collaboration_start_shamsi = CASE WHEN collaboration_start_shamsi = '1405/01/01' OR collaboration_start_shamsi IS NULL THEN '1405/06/15' ELSE collaboration_start_shamsi END`
    );
  }
}

export async function getSystemSettingsFromDb(targetShamsiDate?: string): Promise<SystemSettings> {
  const p = getPool();

  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT * FROM system_settings ORDER BY id ASC LIMIT 1'
  );

  if (rows.length === 0) {
    throw new Error('تنظیمات سامانه یافت نشد');
  }

  const row = rows[0];
  const currentMapped = mapRowToSystemSettings(row);

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
      return {
        ...currentMapped,
        ...(parsed as SystemSettings),
        banner_bg_url: currentMapped.banner_bg_url,
      };
    }
  }

  return currentMapped;
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
    shift_start_time: String(row.shift_start_time || '07:00'),
    shift_end_time: String(row.shift_end_time || '15:00'),
    thursday_shift_start_time: String(row.thursday_shift_start_time || '07:00'),
    thursday_shift_end_time: String(row.thursday_shift_end_time || '14:00'),
    thursday_overtime_start_time: String(row.thursday_overtime_start_time || '14:00'),
    grace_period_minutes: Number(row.grace_period_minutes ?? 15),
    break_duration_minutes: Number(row.break_duration_minutes ?? 30),
    working_days: workingDays,
    overtime_start_time: String(row.overtime_start_time || '15:00'),
    overtime_before_shift: Boolean(row.overtime_before_shift),
    mission_policy: row.mission_policy || 'PAID_AS_WORK',
    friday_holiday_policy: row.friday_holiday_policy || 'ALL_OVERTIME',
    official_holidays: officialHolidays,
    timezone: String(row.timezone || 'Asia/Tehran'),
    base_salary_toman:
      row.base_salary_toman !== null && row.base_salary_toman !== undefined
        ? Number(row.base_salary_toman)
        : null,
    hourly_rate_toman:
      row.hourly_rate_toman !== null && row.hourly_rate_toman !== undefined
        ? Number(row.hourly_rate_toman)
        : null,
    overtime_calc_mode: (row.overtime_calc_mode as OvertimeCalcMode) || 'PERCENTAGE',
    overtime_percentage:
      row.overtime_percentage !== null && row.overtime_percentage !== undefined
        ? Number(row.overtime_percentage)
        : 140,
    overtime_rate_toman:
      row.overtime_rate_toman !== null && row.overtime_rate_toman !== undefined
        ? Number(row.overtime_rate_toman)
        : null,
    collaboration_start_shamsi: String(row.collaboration_start_shamsi || '1405/06/15'),
    monthly_leave_quota_days:
      row.monthly_leave_quota_days !== null && row.monthly_leave_quota_days !== undefined
        ? Number(row.monthly_leave_quota_days)
        : 2.5,
    sms_enabled: Boolean(row.sms_enabled),
    melipayamak_username: String(row.melipayamak_username || ''),
    melipayamak_password: String(row.melipayamak_password || ''),
    melipayamak_from_number: String(row.melipayamak_from_number || ''),
    melipayamak_is_flash: Boolean(row.melipayamak_is_flash),
    worker_phone_number: String(row.worker_phone_number || ''),
    rules_confirmed_by_manager: Boolean(row.rules_confirmed_by_manager),
    effective_from_shamsi: String(row.effective_from_shamsi || '1405/06/15'),
    banner_bg_url: row.banner_bg_url ? String(row.banner_bg_url) : '/assets/media/banner-bg.svg',
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}
