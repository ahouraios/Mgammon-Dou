import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { OvertimeCalcMode, SystemSettings } from '../shared/types';

const execAsync = promisify(exec);

let pool: mysql.Pool | null = null;
let currentPoolDbName = '';
let dbInitialized = false;
let dbInitializingPromise: Promise<void> | null = null;
let lastDbError: string | null = null;
let localMariaDbBootstrapped = false;
let localMariaDbBootstrapPromise: Promise<void> | null = null;

let simulatedDisconnect = false;
let simulatedMidTxFailureTag: string | null = null;

const PLACEHOLDER_DB_USERS = new Set(['', 'cpanel_username_mgammon', 'your_db_user']);
const PLACEHOLDER_DB_PASSWORDS = new Set(['', 'YOUR_STRONG_MYSQL_PASSWORD', 'your_db_password']);
const PLACEHOLDER_DB_NAMES = new Set(['', 'cpanel_username_mgammon_duo', 'your_db_name']);

export function sanitizeDbErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown database error');
  return raw
    .replace(/(password|passwd|pwd|token|secret|authorization|key)\s*[:=]\s*[^\s,;'"&]+/gi, '$1=[REDACTED]')
    .replace(/using password:\s*(YES|NO)/gi, 'using password: [REDACTED]')
    .replace(/'[^']*'@'[^']*'/g, "'[USER]'@'[HOST]'");
}

export function isCpanelOrProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return true;
  if (env.CPANEL_ENV === 'true' || env.CPANEL === '1') return true;
  const rawUser = (env.DB_USER || '').trim();
  if (rawUser && !PLACEHOLDER_DB_USERS.has(rawUser) && rawUser !== 'root') {
    return true;
  }
  return false;
}

export function getDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawUser = (env.DB_USER || '').trim();
  const rawPassword = env.DB_PASSWORD || '';
  const rawDbName = (env.DB_NAME || '').trim();

  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: PLACEHOLDER_DB_USERS.has(rawUser) ? 'root' : rawUser,
    password: PLACEHOLDER_DB_PASSWORDS.has(rawPassword) ? '' : rawPassword,
    database: PLACEHOLDER_DB_NAMES.has(rawDbName) ? 'mgammon_duo' : rawDbName,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 5000,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+03:30',
    dateStrings: ['DATE'] as ('DATE' | 'DATETIME' | 'TIMESTAMP')[],
  };
}

async function hasMariadbdBinary(): Promise<boolean> {
  try {
    await execAsync('which mariadbd');
    return true;
  } catch {
    return false;
  }
}

/**
 * فقط در محیط توسعه/آزمایشی کانتینر (غیرعملیاتی) در صورت عدم اجرای سرویس محلی MariaDB آن را راه‌اندازی می‌کند.
 * در محیط عملیاتی cPanel یا هر زمانی که کاربر دیتابیس غیر از root باشد یا سرویس MySQL در دسترس باشد،
 * هیچ دستور سیستمی، نصب بسته، تغییر مالکیت پوشه یا تغییر رمز root اجرا نمی‌شود.
 */
async function ensureLocalMariaDbRunningIfNeeded(): Promise<void> {
  if (isCpanelOrProductionEnvironment(process.env)) {
    localMariaDbBootstrapped = true;
    return;
  }

  const cfg = getDbConfig();
  const isLocalHost = cfg.host === '127.0.0.1' || cfg.host === 'localhost';
  if (!isLocalHost || cfg.user !== 'root') {
    localMariaDbBootstrapped = true;
    return;
  }

  const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, '');

  // ۱. ابتدا بررسی می‌کنیم آیا سرویس MySQL/MariaDB همین الان در دسترس است؟
  try {
    const probeConn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 1500,
    });
    await probeConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await probeConn.end();
    localMariaDbBootstrapped = true;
    return;
  } catch {
    // سرویس محلی هنوز بالا نیامده است؛ ادامه برای راه‌اندازی سندباکس توسعه
  }

  if (localMariaDbBootstrapPromise) {
    return localMariaDbBootstrapPromise;
  }

  localMariaDbBootstrapPromise = (async () => {
    try {
      const persistentDataDir = path.resolve(process.cwd(), '.data/mysql');
      const debCacheDir = path.resolve(process.cwd(), '.data/deb-cache');
      fs.mkdirSync(debCacheDir, { recursive: true });
      let hasMariadbd = await hasMariadbdBinary();

      if (!hasMariadbd && fs.existsSync('/etc/debian_version')) {
        // ابتدا نصب سریع آفلاین از بسته‌های کش‌شده در .data/deb-cache بدون نیاز به اینترنت یا apt-get update
        try {
          const cachedDebs = fs
            .readdirSync(debCacheDir)
            .filter((f) => f.endsWith('.deb'));
          if (cachedDebs.length > 0) {
            await execAsync(
              `DEBIAN_FRONTEND=noninteractive dpkg -i --force-confdef --force-confold "${debCacheDir}"/*.deb || DEBIAN_FRONTEND=noninteractive dpkg --configure -a`
            );
          }
        } catch {
          // ignore
        }
        hasMariadbd = await hasMariadbdBinary();
      }

      if (!hasMariadbd && fs.existsSync('/etc/debian_version')) {
        try {
          if (
            fs.existsSync('/etc/apt/sources.list.d/debian.sources') &&
            fs.existsSync('/etc/apt/sources.list')
          ) {
            fs.unlinkSync('/etc/apt/sources.list');
          }
        } catch {
          // ignore
        }

        try {
          await execAsync(
            `DEBIAN_FRONTEND=noninteractive dpkg --configure -a && DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get --fix-broken install -y && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" -o Dir::Cache::archives="${debCacheDir}" mariadb-server`
          );
        } catch {
          // ignore
        }
        hasMariadbd = await hasMariadbdBinary();
      }

      if (!hasMariadbd) {
        return;
      }

      const isSocketReady = () =>
        fs.existsSync('/run/mysqld/mysqld.sock') ||
        fs.existsSync('/var/run/mysqld/mysqld.sock');

      const initFreshDataDir = async () => {
        fs.rmSync(persistentDataDir, { recursive: true, force: true });
        fs.mkdirSync(persistentDataDir, { recursive: true });
        await execAsync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`);
        await execAsync(
          `mariadb-install-db --user=mysql --datadir="${persistentDataDir}" --innodb-log-file-size=8M --auth-root-authentication-method=normal`
        );
      };

      const spawnMariadbdAndWait = async (): Promise<boolean> => {
        try {
          await execAsync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`);
        } catch {
          // ignore
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
          // ignore
        });
        child.unref();

        for (let i = 0; i < 25; i++) {
          if (isSocketReady()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return isSocketReady();
      };

      if (!isSocketReady()) {
        fs.mkdirSync('/run/mysqld', { recursive: true });
        fs.mkdirSync(persistentDataDir, { recursive: true });

        if (
          !fs.existsSync(path.join(persistentDataDir, 'mysql')) ||
          !fs.existsSync(path.join(persistentDataDir, 'ibdata1'))
        ) {
          try {
            await initFreshDataDir();
          } catch {
            // ignore
          }
        }

        let started = await spawnMariadbdAndWait();
        if (!started) {
          try {
            await initFreshDataDir();
            started = await spawnMariadbdAndWait();
          } catch {
            // ignore
          }
        }
      }

      await execAsync(
        `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${safeDbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD(''); GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' IDENTIFIED VIA mysql_native_password USING PASSWORD('') WITH GRANT OPTION; FLUSH PRIVILEGES;"`
      );
    } catch {
      // در محیط هاست واقعی سرویس از قبل توسط سرور مدیریت می‌شود
    } finally {
      localMariaDbBootstrapped = true;
      localMariaDbBootstrapPromise = null;
    }
  })();

  return localMariaDbBootstrapPromise;
}

export function setSimulatedDatabaseDisconnect(disconnected: boolean): void {
  simulatedDisconnect = disconnected;
}

export function setSimulatedMidTransactionFailure(operationTag: string | null): void {
  simulatedMidTxFailureTag = operationTag;
}

export function getSimulatedMidTransactionFailure(): string | null {
  return simulatedMidTxFailureTag;
}

export function isDatabaseInitialized(): boolean {
  const cfg = getDbConfig();
  return dbInitialized && !simulatedDisconnect && currentPoolDbName === cfg.database;
}

export async function waitForPendingDatabaseInit(): Promise<void> {
  if (dbInitializingPromise) {
    try {
      await dbInitializingPromise;
    } catch {
      // handled by caller checking isDatabaseInitialized()
    }
  }
}

export function setDatabaseInitializedForTest(ready: boolean): void {
  dbInitialized = ready;
}

export async function resetPool(): Promise<void> {
  dbInitialized = false;
  dbInitializingPromise = null;
  if (pool) {
    try {
      await pool.end();
    } catch {
      // ignore
    }
    pool = null;
  }
  currentPoolDbName = '';
}

export function getPool(): mysql.Pool {
  if (simulatedDisconnect) {
    throw new Error('SIMULATED_DB_DISCONNECT');
  }
  const cfg = getDbConfig();
  if (!pool || currentPoolDbName !== cfg.database) {
    if (pool) {
      pool.end().catch(() => {});
    }
    pool = mysql.createPool(cfg);
    currentPoolDbName = cfg.database;
  }
  return pool;
}

/**
 * اجرای امن عملیات چندمرحله‌ای در قالب تراکنش اتمیک دیتابیس (ACID Transaction)
 * همراه با پشتیبانی از شبیه‌سازی قطع ارتباط در میانه تراکنش برای آزمون‌های پایداری.
 */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
  operationTag?: string
): Promise<T> {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    if (simulatedDisconnect || (operationTag && simulatedMidTxFailureTag === operationTag)) {
      throw new Error('SIMULATED_DB_DISCONNECT');
    }
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error on dead connection
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  initialized: boolean;
  message?: string;
}> {
  if (simulatedDisconnect) {
    return {
      connected: false,
      initialized: false,
      message: 'ارتباط با پایگاه داده MySQL موقتاً در دسترس نیست.',
    };
  }
  if (process.env.SIMULATE_DB_DOWN === 'true') {
    return {
      connected: false,
      initialized: false,
      message: 'ارتباط با سرور برقرار نیست.',
    };
  }
  if (!isDatabaseInitialized()) {
    return {
      connected: false,
      initialized: false,
      message: lastDbError || 'پایگاه داده هنوز آماده بهره‌برداری نیست.',
    };
  }
  try {
    const p = getPool();
    await p.execute('SELECT 1 AS ok');
    return { connected: true, initialized: true };
  } catch (err) {
    lastDbError = sanitizeDbErrorMessage(err);
    return {
      connected: false,
      initialized: false,
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

// ============================================================================
// توابع کمکی مهاجرت سازگار با هر دو موتور MySQL 5.7/8.0+ و MariaDB 10.3+
// (استفاده از INFORMATION_SCHEMA به جای نحو غیرستاندارد ADD COLUMN IF NOT EXISTS)
// ============================================================================
export async function columnExists(
  p: mysql.Pool,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

export async function ensureColumnExists(
  p: mysql.Pool,
  tableName: string,
  columnName: string,
  columnDefinitionSql: string
): Promise<boolean> {
  const exists = await columnExists(p, tableName, columnName);
  if (exists) return false;
  await p.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinitionSql}`);
  return true;
}

export async function indexExists(
  p: mysql.Pool,
  tableName: string,
  indexName: string
): Promise<boolean> {
  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

export async function ensureIndexExists(
  p: mysql.Pool,
  tableName: string,
  indexName: string,
  indexSql: string
): Promise<boolean> {
  const exists = await indexExists(p, tableName, indexName);
  if (exists) return false;
  await p.query(`ALTER TABLE \`${tableName}\` ADD ${indexSql}`);
  return true;
}

export async function foreignKeyExists(
  p: mysql.Pool,
  tableName: string,
  constraintName: string
): Promise<boolean> {
  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return rows.length > 0;
}

export async function ensureForeignKeyExists(
  p: mysql.Pool,
  tableName: string,
  constraintName: string,
  fkDefinitionSql: string
): Promise<boolean> {
  const exists = await foreignKeyExists(p, tableName, constraintName);
  if (exists) return false;
  await p.query(
    `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` ${fkDefinitionSql}`
  );
  return true;
}

interface SchemaMigrationSpec {
  version: number;
  name: string;
  up: (p: mysql.Pool) => Promise<void>;
}

const SCHEMA_MIGRATIONS: SchemaMigrationSpec[] = [
  {
    version: 1,
    name: 'v1_base_tables_and_core_constraints',
    up: async (p) => {
      await ensureIndexExists(p, 'users', 'uq_users_username', 'UNIQUE KEY `uq_users_username` (`username`)');
      await ensureIndexExists(p, 'users', 'uq_users_single_role', 'UNIQUE KEY `uq_users_single_role` (`role`)');
      await ensureIndexExists(
        p,
        'user_sessions',
        'idx_sessions_user_expires',
        'KEY `idx_sessions_user_expires` (`user_id`, `expires_at`)'
      );
      await ensureIndexExists(
        p,
        'attendance_logs',
        'idx_attendance_user_date',
        'KEY `idx_attendance_user_date` (`user_id`, `work_date`, `is_deleted`)'
      );
      await ensureIndexExists(
        p,
        'attendance_logs',
        'idx_attendance_shamsi',
        'KEY `idx_attendance_shamsi` (`shamsi_date`)'
      );
    },
  },
  {
    version: 2,
    name: 'v2_users_profile_biometric_and_password_policy',
    up: async (p) => {
      await ensureColumnExists(p, 'users', 'avatar_url', 'MEDIUMTEXT NULL DEFAULT NULL');
      await ensureColumnExists(
        p,
        'users',
        'collaboration_start_shamsi',
        "VARCHAR(10) NULL DEFAULT '1405/06/15'"
      );
      await ensureColumnExists(p, 'users', 'phone_number', 'VARCHAR(20) NULL DEFAULT NULL');
      await ensureColumnExists(
        p,
        'users',
        'biometric_credential_id',
        'VARCHAR(255) NULL DEFAULT NULL'
      );
      await ensureColumnExists(p, 'users', 'biometric_token_hash', 'VARCHAR(255) NULL DEFAULT NULL');
      await ensureColumnExists(
        p,
        'users',
        'must_change_password',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
    },
  },
  {
    version: 3,
    name: 'v3_historical_work_and_daily_reports_attachments',
    up: async (p) => {
      await ensureColumnExists(
        p,
        'historical_work_records',
        'status',
        "ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED'"
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'excel_file_url',
        'MEDIUMTEXT NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'excel_file_name',
        'VARCHAR(255) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'parsed_rows_json',
        'LONGTEXT NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'is_seen_by_manager',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'reviewed_by_user_id',
        'INT UNSIGNED NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'reviewed_at',
        'DATETIME NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'daily_work_reports',
        'is_seen_by_manager',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
      await ensureColumnExists(p, 'daily_work_reports', 'photo_url', 'MEDIUMTEXT NULL DEFAULT NULL');
      await ensureColumnExists(
        p,
        'daily_work_reports',
        'photo_name',
        'VARCHAR(255) NULL DEFAULT NULL'
      );
    },
  },
  {
    version: 4,
    name: 'v4_financial_receipts_and_system_settings_extensions',
    up: async (p) => {
      await ensureColumnExists(
        p,
        'financial_transactions',
        'is_seen_by_manager',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
      await ensureColumnExists(
        p,
        'financial_transactions',
        'receipt_file_url',
        'MEDIUMTEXT NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'financial_transactions',
        'receipt_file_name',
        'VARCHAR(255) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'financial_transactions',
        'idempotency_key',
        'VARCHAR(64) NULL DEFAULT NULL'
      );
      await ensureIndexExists(
        p,
        'financial_transactions',
        'uq_fin_idempotency',
        'UNIQUE KEY `uq_fin_idempotency` (`idempotency_key`)'
      );
      await ensureColumnExists(p, 'system_settings', 'banner_bg_url', 'MEDIUMTEXT NULL DEFAULT NULL');
      await ensureColumnExists(
        p,
        'system_settings',
        'thursday_shift_start_time',
        "VARCHAR(5) NOT NULL DEFAULT '07:00'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'thursday_shift_end_time',
        "VARCHAR(5) NOT NULL DEFAULT '14:00'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'thursday_overtime_start_time',
        "VARCHAR(5) NOT NULL DEFAULT '14:00'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'base_salary_toman',
        'DECIMAL(15, 0) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'overtime_calc_mode',
        "ENUM('FIXED_RATE', 'PERCENTAGE') NOT NULL DEFAULT 'PERCENTAGE'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'overtime_percentage',
        'DECIMAL(6, 2) NOT NULL DEFAULT 140.00'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'collaboration_start_shamsi',
        "VARCHAR(10) NOT NULL DEFAULT '1405/06/15'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'monthly_leave_quota_days',
        'DECIMAL(4, 1) NOT NULL DEFAULT 2.5'
      );
      await ensureColumnExists(p, 'system_settings', 'sms_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
      await ensureColumnExists(
        p,
        'system_settings',
        'melipayamak_username',
        "VARCHAR(120) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'melipayamak_password',
        "VARCHAR(255) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'melipayamak_from_number',
        "VARCHAR(64) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'melipayamak_is_flash',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'worker_phone_number',
        "VARCHAR(20) NOT NULL DEFAULT ''"
      );
    },
  },
  {
    version: 5,
    name: 'v5_correspondence_audio_and_foreign_keys',
    up: async (p) => {
      await ensureColumnExists(
        p,
        'work_correspondences',
        'audio_url',
        'MEDIUMTEXT NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'work_correspondences',
        'audio_duration_seconds',
        'INT UNSIGNED NULL DEFAULT NULL'
      );
      await ensureForeignKeyExists(
        p,
        'historical_work_records',
        'fk_hist_work_reviewer',
        'FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL'
      );
      await ensureForeignKeyExists(
        p,
        'leave_requests',
        'fk_leave_reviewer',
        'FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL'
      );
    },
  },
  {
    version: 6,
    name: 'v6_idempotency_keys_and_composite_indexes',
    up: async (p) => {
      await ensureColumnExists(
        p,
        'attendance_logs',
        'idempotency_key',
        'VARCHAR(64) NULL DEFAULT NULL'
      );
      await ensureIndexExists(
        p,
        'attendance_logs',
        'uq_attendance_idempotency',
        'UNIQUE KEY `uq_attendance_idempotency` (`idempotency_key`)'
      );
      await ensureColumnExists(
        p,
        'historical_work_records',
        'idempotency_key',
        'VARCHAR(64) NULL DEFAULT NULL'
      );
      await ensureIndexExists(
        p,
        'historical_work_records',
        'uq_hist_idempotency',
        'UNIQUE KEY `uq_hist_idempotency` (`idempotency_key`)'
      );
      await ensureIndexExists(
        p,
        'historical_work_records',
        'idx_hist_work_user_status',
        'KEY `idx_hist_work_user_status` (`user_id`, `status`)'
      );
      await ensureColumnExists(
        p,
        'daily_work_reports',
        'idempotency_key',
        'VARCHAR(64) NULL DEFAULT NULL'
      );
      await ensureIndexExists(
        p,
        'daily_work_reports',
        'uq_reports_idempotency',
        'UNIQUE KEY `uq_reports_idempotency` (`idempotency_key`)'
      );
      await ensureColumnExists(
        p,
        'leave_requests',
        'idempotency_key',
        'VARCHAR(64) NULL DEFAULT NULL'
      );
      await ensureIndexExists(
        p,
        'leave_requests',
        'uq_leaves_idempotency',
        'UNIQUE KEY `uq_leaves_idempotency` (`idempotency_key`)'
      );
      await ensureIndexExists(
        p,
        'financial_transactions',
        'idx_fin_user_status',
        'KEY `idx_fin_user_status` (`user_id`, `status`)'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'late_status',
        "ENUM('NONE', 'PENDING', 'EXCUSED', 'APPROVED_DELAY', 'ABSENCE', 'DEDUCT_LEAVE', 'CUSTOM') NOT NULL DEFAULT 'NONE'"
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'late_reason',
        'VARCHAR(500) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'manager_late_note',
        'VARCHAR(500) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'custom_deduction_toman',
        'DECIMAL(15, 0) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'late_reviewed_by_user_id',
        'INT UNSIGNED NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'late_reviewed_at',
        'DATETIME NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'attendance_logs',
        'is_late_seen_by_worker',
        'TINYINT(1) NOT NULL DEFAULT 1'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'late_deduction_unit',
        "ENUM('MINUTE', 'HOUR') NOT NULL DEFAULT 'MINUTE'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'late_deduction_rate_toman',
        'DECIMAL(15, 0) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'absence_deduction_unit',
        "ENUM('DAY', 'HOUR') NOT NULL DEFAULT 'DAY'"
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'absence_deduction_rate_toman',
        'DECIMAL(15, 0) NULL DEFAULT NULL'
      );
      await ensureColumnExists(
        p,
        'system_settings',
        'sms_on_task_and_message',
        'TINYINT(1) NOT NULL DEFAULT 0'
      );
    },
  },
];

async function createPreMigrationSafetySnapshot(
  p: mysql.Pool,
  targetVersion: number
): Promise<string | null> {
  try {
    const [uRows] = await p.execute<mysql.RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM users');
    const userCount = Number(uRows[0]?.cnt || 0);
    if (userCount === 0) {
      return null;
    }

    const backupDir = path.resolve(process.cwd(), '.data/backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

    const tablesToSnap = [
      'users',
      'system_settings',
      'financial_transactions',
      'attendance_logs',
      'historical_work_records',
      'leave_requests',
      'daily_work_reports',
    ];
    const snapshotData: Record<string, unknown[]> = {};
    for (const tbl of tablesToSnap) {
      try {
        const [rows] = await p.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${tbl}\``);
        snapshotData[tbl] = rows;
      } catch {
        snapshotData[tbl] = [];
      }
    }

    const cfg = getDbConfig();
    const fileName = `pre_migration_${cfg.database}_v${targetVersion}_${Date.now()}.json`;
    const fullPath = path.join(backupDir, fileName);
    const content = JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        database: cfg.database,
        targetMigrationVersion: targetVersion,
        tables: snapshotData,
      },
      null,
      2
    );
    fs.writeFileSync(fullPath, content, { mode: 0o600 });
    return fullPath;
  } catch {
    return null;
  }
}

export async function runVersionedMigrations(p: mysql.Pool): Promise<{
  appliedVersions: number[];
  totalMigrations: number;
  preMigrationSnapshotPath: string | null;
}> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\` INT UNSIGNED NOT NULL,
      \`name\` VARCHAR(120) NOT NULL,
      \`checksum\` VARCHAR(64) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`execution_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (\`version\`),
      UNIQUE KEY \`uq_schema_migrations_name\` (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [appliedRows] = await p.execute<mysql.RowDataPacket[]>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC'
  );
  const appliedMap = new Map<number, { name: string; checksum: string }>();
  for (const r of appliedRows) {
    appliedMap.set(Number(r.version), {
      name: String(r.name),
      checksum: String(r.checksum),
    });
  }

  let preMigrationSnapshotPath: string | null = null;
  const pendingSpecs = SCHEMA_MIGRATIONS.filter((m) => !appliedMap.has(m.version));
  if (pendingSpecs.length > 0) {
    preMigrationSnapshotPath = await createPreMigrationSafetySnapshot(
      p,
      pendingSpecs[0].version
    );
  }

  const appliedVersions: number[] = [];

  for (const mig of SCHEMA_MIGRATIONS) {
    const startMs = Date.now();
    const checksum = crypto
      .createHash('sha256')
      .update(`${mig.version}:${mig.name}`)
      .digest('hex');

    // اجرای بررسی‌های Idempotent ستون‌ها و ایندکس‌ها (حتی اگر نسخه قبلاً ثبت شده باشد، کمبود ستون احتمالی را بدون خطا ترمیم می‌کند)
    await mig.up(p);

    if (!appliedMap.has(mig.version)) {
      const execMs = Math.max(0, Date.now() - startMs);
      await p.execute(
        `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), execution_ms = VALUES(execution_ms)`,
        [mig.version, mig.name, checksum, execMs]
      );
      appliedVersions.push(mig.version);
    }
  }

  return {
    appliedVersions,
    totalMigrations: SCHEMA_MIGRATIONS.length,
    preMigrationSnapshotPath,
  };
}

/**
 * انتقال خودکار پیوست‌های قدیمی از مسیر عمومی public/assets/media به مسیر خصوصی .data/private_media
 * تا هیچ فایل خصوصی در مسیر قابل دسترس مستقیم وب باقی نماند و هیچ فایلی از دست نرود.
 */
export function migrateLegacyPublicMediaToPrivate(): void {
  const folders = ['avatars', 'attachments', 'excel', 'audio', 'receipts', 'reports'];
  const privateBaseDir = path.resolve(process.cwd(), '.data/private_media');
  const legacyPublicMediaDir = path.resolve(process.cwd(), 'public/assets/media');

  for (const folder of folders) {
    try {
      const targetDir = path.resolve(privateBaseDir, folder);
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

      const legacyDir = path.resolve(legacyPublicMediaDir, folder);
      if (fs.existsSync(legacyDir)) {
        const entries = fs.readdirSync(legacyDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const srcPath = path.join(legacyDir, entry.name);
          const dstPath = path.join(targetDir, entry.name);
          if (!fs.existsSync(dstPath)) {
            fs.copyFileSync(srcPath, dstPath);
          }
          try {
            fs.unlinkSync(srcPath);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function initializeDatabase(): Promise<void> {
  if (dbInitializingPromise) {
    return dbInitializingPromise;
  }

  dbInitializingPromise = (async () => {
    try {
      validateProductionSecurityConfig(process.env);
      await ensureLocalMariaDbRunningIfNeeded();
      migrateLegacyPublicMediaToPrivate();

      const cfg = getDbConfig();
      const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, '');

      // در محیط توسعه/تست، اطمینان از وجود دیتابیس هدف (مثلاً mgammon_duo یا mgammon_duo_test)
      if (!isCpanelOrProductionEnvironment(process.env) && cfg.user === 'root') {
        try {
          const adminConn = await mysql.createConnection({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            connectTimeout: 3000,
          });
          await adminConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          );
          await adminConn.end();
        } catch {
          // ignore if user lacks CREATE DATABASE privilege
        }
      }

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

      // اجرای سیستم مهاجرت نسخه‌بندی‌شده و Idempotent
      await runVersionedMigrations(p);

      // بررسی و ایجاد تنها دو حساب مجاز سامانه (فقط در صورت عدم وجود! هرگز رمز یا نام کاربری موجود بازنشانی نمی‌شود):
      // ۱. مدیریت: مجید نورایی
      // ۲. پرسنل: امید میثمی
      const [existingUsers] = await p.execute<mysql.RowDataPacket[]>(
        'SELECT id, username, role, full_name, collaboration_start_shamsi FROM users ORDER BY id ASC'
      );

      const hasManager = existingUsers.some((u) => u.role === 'manager');
      const hasWorker = existingUsers.some((u) => u.role === 'worker');
      const isProd = process.env.NODE_ENV === 'production';

      const rawMgrPass = (process.env.INITIAL_MANAGER_PASSWORD || '').trim();
      const managerUsername = (process.env.INITIAL_MANAGER_USERNAME || 'manager').trim();
      const managerPassword =
        !rawMgrPass || (!isProd && rawMgrPass === 'CHANGE_ME_MANAGER_PASSWORD')
          ? isProd
            ? ''
            : 'Mgammon@1405'
          : rawMgrPass;

      if (!hasManager) {
        if (
          isProd &&
          (!managerPassword ||
            FORBIDDEN_DEFAULT_PASSWORDS.has(managerPassword) ||
            managerPassword.length < 8)
        ) {
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
        // حفظ کامل رمز عبور، نام کاربری و وضعیت حساب مدیر در راه‌اندازی‌های مجدد
        await p.execute(
          "UPDATE users SET full_name = 'مجید نورایی' WHERE role = 'manager' AND (full_name IS NULL OR full_name = '')"
        );
      }

      const rawWrkPass = (process.env.INITIAL_WORKER_PASSWORD || '').trim();
      const workerUsername = (process.env.INITIAL_WORKER_USERNAME || 'worker').trim();
      const workerPassword =
        !rawWrkPass || (!isProd && rawWrkPass === 'CHANGE_ME_WORKER_PASSWORD')
          ? isProd
            ? ''
            : 'Worker@1405'
          : rawWrkPass;

      if (!hasWorker) {
        if (
          isProd &&
          (!workerPassword ||
            FORBIDDEN_DEFAULT_PASSWORDS.has(workerPassword) ||
            workerPassword.length < 8)
        ) {
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
        // حفظ کامل رمز عبور، نام کاربری و تنظیمات حساب پرسنل در راه‌اندازی‌های مجدد
        await p.execute(
          "UPDATE users SET full_name = 'امید میثمی', collaboration_start_shamsi = COALESCE(NULLIF(collaboration_start_shamsi, ''), '1405/06/15') WHERE role = 'worker' AND (full_name IS NULL OR full_name = '' OR collaboration_start_shamsi IS NULL OR collaboration_start_shamsi = '')"
        );
      }

      // بررسی و مقداردهی اولیه تنظیمات پایه سامانه (فقط در صورتی که هنوز رکوردی وجود ندارد)
      const [settingsRows] = await p.execute<mysql.RowDataPacket[]>(
        'SELECT id, banner_bg_url FROM system_settings LIMIT 1'
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
      }

      dbInitialized = true;
      lastDbError = null;
    } catch (err) {
      dbInitialized = false;
      lastDbError = sanitizeDbErrorMessage(err);
      throw err;
    } finally {
      dbInitializingPromise = null;
    }
  })();

  return dbInitializingPromise;
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
    let chosenJson: unknown = snapRows.length > 0 ? snapRows[0].settings_json : null;

    if (!chosenJson) {
      const [oldestSnapRows] = await p.execute<mysql.RowDataPacket[]>(
        `SELECT settings_json FROM system_settings_snapshots
         ORDER BY effective_from_shamsi ASC, id ASC LIMIT 1`
      );
      if (oldestSnapRows.length > 0) {
        chosenJson = oldestSnapRows[0].settings_json;
      }
    }

    if (chosenJson) {
      const parsed = (
        typeof chosenJson === 'string'
          ? JSON.parse(chosenJson)
          : chosenJson
      ) as Partial<SystemSettings>;
      const merged: SystemSettings = {
        ...currentMapped,
        ...parsed,
        banner_bg_url: currentMapped.banner_bg_url,
      };
      if (
        (merged.base_salary_toman === null || merged.base_salary_toman === undefined || merged.base_salary_toman <= 0) &&
        (merged.hourly_rate_toman === null || merged.hourly_rate_toman === undefined || merged.hourly_rate_toman <= 0)
      ) {
        merged.base_salary_toman = currentMapped.base_salary_toman;
        merged.hourly_rate_toman = currentMapped.hourly_rate_toman;
        merged.overtime_calc_mode = currentMapped.overtime_calc_mode;
        merged.overtime_percentage = currentMapped.overtime_percentage;
        merged.overtime_rate_toman = currentMapped.overtime_rate_toman;
      }
      return merged;
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
    late_deduction_unit: row.late_deduction_unit === 'HOUR' ? 'HOUR' : 'MINUTE',
    late_deduction_rate_toman:
      row.late_deduction_rate_toman !== null &&
      row.late_deduction_rate_toman !== undefined &&
      Number(row.late_deduction_rate_toman) > 0
        ? Number(row.late_deduction_rate_toman)
        : null,
    absence_deduction_unit: row.absence_deduction_unit === 'HOUR' ? 'HOUR' : 'DAY',
    absence_deduction_rate_toman:
      row.absence_deduction_rate_toman !== null &&
      row.absence_deduction_rate_toman !== undefined &&
      Number(row.absence_deduction_rate_toman) > 0
        ? Number(row.absence_deduction_rate_toman)
        : null,
    collaboration_start_shamsi: String(row.collaboration_start_shamsi || '1405/06/15'),
    monthly_leave_quota_days:
      row.monthly_leave_quota_days !== null && row.monthly_leave_quota_days !== undefined
        ? Number(row.monthly_leave_quota_days)
        : 2.5,
    sms_enabled: Boolean(row.sms_enabled),
    sms_on_task_and_message: Boolean(row.sms_on_task_and_message),
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
