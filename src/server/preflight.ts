import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { createRequire } from 'module';
import {
  analyzeEnvValue,
  ENV_VAR_SPECS,
  FORBIDDEN_DEFAULT_PASSWORDS,
  getAppConfig,
  getAppRootDir,
  getDbConfig,
  getEnvLoadMetadata,
  isBundledAppCjs,
  isPassengerEnvironment,
  isProductionMode,
  isValidEnvVarName,
  loadEnvironmentOnce,
  sanitizeSecretErrorText,
  scanForPublicEnvFiles,
  validateProductionDatabaseConfig,
  validateSessionSecret,
} from './config';

export type PreflightStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_CONFIGURED';

export interface PreflightCheckItem {
  id: string;
  category:
    | 'runtime'
    | 'security'
    | 'database'
    | 'environment'
    | 'filesystem'
    | 'modules'
    | 'network';
  label: string;
  status: PreflightStatus;
  message: string;
  remediation?: string;
}

export interface PreflightReport {
  ok: boolean;
  summary: {
    pass: number;
    fail: number;
    warning: number;
    notConfigured: number;
  };
  runtime: {
    nodeVersion: string;
    nodeEnv: string;
    isProduction: boolean;
    isBundled: boolean;
    isPassenger: boolean;
    platform: string;
    cwd: string;
    envSource: string;
    dotenvLoaded: boolean;
    dotenvKeysAppliedCount: number;
  };
  checks: PreflightCheckItem[];
  generatedAt: string;
}

export interface PreflightOptions {
  env?: NodeJS.ProcessEnv;
  checkDb?: boolean;
  dbTimeoutMs?: number;
  searchDirs?: string[];
}

function checkFilesystemWritable(dirPath: string): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const probeFile = path.join(dirPath, `.preflight_probe_${process.pid}_${Date.now()}`);
    fs.writeFileSync(probeFile, 'ok', { mode: 0o600 });
    fs.unlinkSync(probeFile);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeSecretErrorText(err) };
  }
}

function resolveRequiredModuleNames(): { loaded: string[]; failed: string[] } {
  const requiredModules = [
    'express',
    'mysql2/promise',
    'bcryptjs',
    'cookie-parser',
    'dotenv',
    'jalaali-js',
    'xlsx',
  ];
  const loaded: string[] = [];
  const failed: string[] = [];

  let localRequire: NodeRequire | null = null;
  try {
    if (typeof require === 'function') {
      localRequire = require;
    } else {
      localRequire = createRequire(path.resolve(getAppRootDir(), 'package.json'));
    }
  } catch {
    localRequire = null;
  }

  for (const modName of requiredModules) {
    try {
      if (localRequire) {
        localRequire.resolve(modName);
      }
      loaded.push(modName);
    } catch {
      failed.push(modName);
    }
  }

  return { loaded, failed };
}

export async function runPreflightDiagnostics(
  options?: PreflightOptions
): Promise<PreflightReport> {
  const env = options?.env || process.env;
  if (env === process.env) {
    loadEnvironmentOnce({ searchDirs: options?.searchDirs });
  }

  const meta = getEnvLoadMetadata();
  const isProd = isProductionMode(env);
  const isBundled = isBundledAppCjs();
  const isPassenger = isPassengerEnvironment(env);
  const appCfg = getAppConfig(env);
  const checks: PreflightCheckItem[] = [];

  // ۱. بررسی نسخه Node.js
  const nodeVersion = process.versions.node || '0.0.0';
  const majorVersion = Number(nodeVersion.split('.')[0] || 0);
  if (majorVersion >= 20) {
    checks.push({
      id: 'node_version',
      category: 'runtime',
      label: 'نسخه Node.js',
      status: 'PASS',
      message: `نسخه فعال Node.js v${nodeVersion} با برنامه و cPanel/Passenger سازگار است.`,
    });
  } else if (majorVersion >= 18) {
    checks.push({
      id: 'node_version',
      category: 'runtime',
      label: 'نسخه Node.js',
      status: 'WARNING',
      message: `نسخه Node.js v${nodeVersion} قابل اجرا است، اما استفاده از Node.js 20 LTS یا 22 توصیه می‌شود.`,
    });
  } else {
    checks.push({
      id: 'node_version',
      category: 'runtime',
      label: 'نسخه Node.js',
      status: 'FAIL',
      message: `نسخه Node.js v${nodeVersion} قدیمی است و حداقل به نسخه ۱۸ یا بالاتر نیاز است.`,
      remediation: 'در Setup Node.js App سی‌پنل، نسخه Node.js را روی 22 یا 20 تنظیم کنید.',
    });
  }

  // ۲. بررسی حالت اجرا و سازگاری cPanel / Passenger
  const rawNodeEnv = (env.NODE_ENV || '').trim();
  if (!rawNodeEnv && (isBundled || isPassenger)) {
    checks.push({
      id: 'runtime_mode',
      category: 'runtime',
      label: 'حالت اجرا (NODE_ENV و Passenger)',
      status: 'WARNING',
      message:
        'برنامه در محیط بسته‌بندی‌شده/Passenger بدون مقدار صریح NODE_ENV اجرا شده است.',
      remediation: 'در cPanel، Application mode را روی Production قرار دهید یا NODE_ENV=production تنظیم کنید.',
    });
  } else {
    checks.push({
      id: 'runtime_mode',
      category: 'runtime',
      label: 'حالت اجرا (NODE_ENV و Passenger)',
      status: 'PASS',
      message: `حالت اجرا: ${rawNodeEnv || 'development'} | Passenger: ${isPassenger ? 'فعال' : 'خیر'} | فایل اجرایی: ${isBundled ? 'app.cjs' : 'server.ts'}`,
    });
  }

  // ۳. بررسی امنیت فایل‌های .env و عدم قرارگیری در مسیر عمومی وب
  const publicLeaks = options?.searchDirs
    ? scanForPublicEnvFiles(options.searchDirs)
    : meta.publicEnvLeakPaths;
  if (publicLeaks.length > 0) {
    checks.push({
      id: 'env_public_exposure',
      category: 'security',
      label: 'حفاظت فایل‌های محیطی از مسیر عمومی وب',
      status: 'FAIL',
      message: `فایل حساس محیطی در مسیر عمومی وب شناسایی شد (${publicLeaks.length} مورد).`,
      remediation: 'فایل .env را فوراً از پوشه public یا dist حذف کرده و فقط در ریشه خصوصی برنامه نگه دارید.',
    });
  } else if (meta.dotenvParseError) {
    checks.push({
      id: 'env_public_exposure',
      category: 'environment',
      label: 'پارس فایل اختیاری .env',
      status: 'WARNING',
      message: `خواندن فایل .env با خطا مواجه شد: ${meta.dotenvParseError}`,
    });
  } else {
    checks.push({
      id: 'env_public_exposure',
      category: 'security',
      label: 'حفاظت فایل‌های محیطی از مسیر عمومی وب',
      status: 'PASS',
      message: meta.dotenvPathLoaded
        ? `فایل .env صرفاً در مسیر خصوصی ریشه شناسایی شد و برای متغیرهای خالی هاست اعمال گردید (منبع: ${meta.sourceMode}).`
        : `فایلی در مسیر عمومی وب قرار ندارد (منبع تنظیمات: ${meta.sourceMode}).`,
    });
  }

  // ۴. بررسی اعتبار نام‌ها و سازگاری مقادیر با cPanel set_env_vars.py
  const invalidNames: string[] = [];
  const cpanelUnsafeVars: string[] = [];
  const whitespaceTrimmedVars: string[] = [];

  for (const spec of ENV_VAR_SPECS) {
    if (!isValidEnvVarName(spec.name)) {
      invalidNames.push(spec.name);
      continue;
    }
    const rawVal = env[spec.name];
    const insp = analyzeEnvValue(rawVal, { isSecret: spec.secret, checkCpanelSafety: true });
    if (!insp.present) continue;
    if (insp.hasLeadingOrTrailingWhitespace) {
      whitespaceTrimmedVars.push(spec.name);
    }
    if (insp.hasCpanelShellUnsafeChars) {
      cpanelUnsafeVars.push(`${spec.name} (${insp.cpanelUnsafeReasons.join('، ')})`);
    }
  }

  if (invalidNames.length > 0) {
    checks.push({
      id: 'env_names_and_cpanel_safety',
      category: 'environment',
      label: 'ساختار نام و مقادیر متغیرهای محیطی برای cPanel',
      status: 'FAIL',
      message: `نام متغیر(های) نامعتبر: ${invalidNames.join('، ')}`,
    });
  } else if (cpanelUnsafeVars.length > 0) {
    checks.push({
      id: 'env_names_and_cpanel_safety',
      category: 'environment',
      label: 'ساختار نام و مقادیر متغیرهای محیطی برای cPanel',
      status: 'WARNING',
      message: `مقادیر برخی متغیرها ممکن است توسط set_env_vars.py در cPanel رد شوند: ${cpanelUnsafeVars.join(' | ')}`,
      remediation:
        'برای متغیرهای cPanel از کاراکترهای ساده ASCII بدون فاصله، کوتیشن (" یا \')، خط جدید و $ استفاده کنید، یا از فایل .env خصوصی در ریشه برنامه بهره ببرید.',
    });
  } else if (whitespaceTrimmedVars.length > 0) {
    checks.push({
      id: 'env_names_and_cpanel_safety',
      category: 'environment',
      label: 'ساختار نام و مقادیر متغیرهای محیطی برای cPanel',
      status: 'WARNING',
      message: `متغیرهای زیر دارای فاصله اضافی در ابتدا/انتها بودند که هنگام پردازش نادیده گرفته می‌شود: ${whitespaceTrimmedVars.join('، ')}`,
    });
  } else {
    checks.push({
      id: 'env_names_and_cpanel_safety',
      category: 'environment',
      label: 'ساختار نام و مقادیر متغیرهای محیطی برای cPanel',
      status: 'PASS',
      message: 'نام و قالب تمام متغیرهای محیطی تنظیم‌شده با استاندارد Node.js و cPanel/Passenger سازگار است.',
    });
  }

  // ۵. بررسی اختصاصی SESSION_SECRET (بدون افشای مقدار)
  const secretCheck = validateSessionSecret(env);
  checks.push({
    id: 'session_secret',
    category: 'security',
    label: 'اعتبار و امنیت SESSION_SECRET',
    status: secretCheck.status,
    message: secretCheck.reason,
    remediation:
      secretCheck.status === 'FAIL' || secretCheck.status === 'WARNING'
        ? 'یک رشته ۶۴ کاراکتری هگز (شامل حروف a-f و اعداد 0-9، بدون فاصله، کوتیشن یا نمادهای خاص) بسازید و در cPanel یا فایل .env ریشه ثبت کنید.'
        : undefined,
  });

  // ۶. بررسی متغیرهای ضروری و اختیاری پایگاه داده
  const dbCheck = validateProductionDatabaseConfig(env);
  const rawConnLimit = (env.DB_CONNECTION_LIMIT || '').trim();
  if (!dbCheck.valid) {
    checks.push({
      id: 'db_env_vars',
      category: 'database',
      label: 'متغیرهای محیطی پایگاه داده (DB_*)',
      status: isProd ? 'FAIL' : 'WARNING',
      message: dbCheck.message,
      remediation:
        'متغیرهای DB_HOST، DB_PORT، DB_NAME، DB_USER و DB_PASSWORD را دقیقاً مطابق MySQL Databases در cPanel ثبت کنید.',
    });
  } else {
    const dbCfg = getDbConfig(env);
    checks.push({
      id: 'db_env_vars',
      category: 'database',
      label: 'متغیرهای محیطی پایگاه داده (DB_*)',
      status: 'PASS',
      message: `تنظیمات اتصال دیتابیس معتبر است (host=${dbCfg.host}, port=${dbCfg.port}, db=${dbCfg.database}, poolLimit=${dbCfg.connectionLimit}${rawConnLimit ? '' : ' [پیش‌فرض]'}).`,
    });
  }

  // ۷. بررسی متغیرهای اختیاری مهم (APP_TIMEZONE، APP_URL، حساب‌های اولیه)
  const tz = (env.APP_TIMEZONE || '').trim();
  if (!tz) {
    checks.push({
      id: 'optional_timezone',
      category: 'environment',
      label: 'منطقه زمانی (APP_TIMEZONE)',
      status: 'NOT_CONFIGURED',
      message: 'تنظیم نشده است؛ به‌صورت پیش‌فرض روی Asia/Tehran قرار دارد.',
    });
  } else {
    let validTz = true;
    try {
      Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      validTz = false;
    }
    checks.push({
      id: 'optional_timezone',
      category: 'environment',
      label: 'منطقه زمانی (APP_TIMEZONE)',
      status: validTz ? 'PASS' : 'WARNING',
      message: validTz
        ? `منطقه زمانی معتبر است (${tz}).`
        : `مقدار APP_TIMEZONE (${tz}) توسط موتور تاریخ Node.js شناسایی نشد.`,
    });
  }

  const mgrPass = (env.INITIAL_MANAGER_PASSWORD || '').trim();
  const wrkPass = (env.INITIAL_WORKER_PASSWORD || '').trim();
  if (!mgrPass && !wrkPass) {
    checks.push({
      id: 'initial_accounts_env',
      category: 'security',
      label: 'رمزهای اولیه راه‌اندازی (INITIAL_*_PASSWORD)',
      status: 'NOT_CONFIGURED',
      message:
        'متغیرهای رمز اولیه تنظیم نشده‌اند؛ برای دیتابیس‌های موجود بدون مشکل و ضروری نیستند (فقط در اولین راه‌اندازی دیتابیس خالی کاربرد دارند).',
    });
  } else if (
    isProd &&
    ((mgrPass && (mgrPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(mgrPass))) ||
      (wrkPass && (wrkPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(wrkPass))))
  ) {
    checks.push({
      id: 'initial_accounts_env',
      category: 'security',
      label: 'رمزهای اولیه راه‌اندازی (INITIAL_*_PASSWORD)',
      status: 'FAIL',
      message: 'رمز عبور اولیه تعریف‌شده در محیط Production ضعیف یا جزو مقادیر پیش‌فرض ممنوعه است.',
      remediation: 'اگر حساب‌ها از قبل در دیتابیس ساخته شده‌اند این متغیرها را حذف کنید، یا رمز قوی ۸+ کاراکتری قرار دهید.',
    });
  } else {
    checks.push({
      id: 'initial_accounts_env',
      category: 'security',
      label: 'رمزهای اولیه راه‌اندازی (INITIAL_*_PASSWORD)',
      status: 'PASS',
      message: 'تنظیمات رمز عبور اولیه حساب‌ها (بدون تغییر اطلاعات کاربران فعلی) معتبر است.',
    });
  }

  // ۸. بررسی وضعیت پورت و Listener
  const rawPort = (env.PORT || '').trim();
  const isValidNumericPort =
    /^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535;
  if (!rawPort) {
    checks.push({
      id: 'port_config',
      category: 'network',
      label: 'پورت اجرا (PORT)',
      status: isPassenger ? 'PASS' : 'NOT_CONFIGURED',
      message: isPassenger
        ? 'متغیر PORT خالی است؛ در محیط Passenger در صورت تزریق سوکت از طریق hook داخلی Passenger مدیریت می‌شود (نیازمند بررسی روی هاست واقعی).'
        : `پورت صریح تنظیم نشده؛ برنامه از مقدار پیش‌فرض ${String(appCfg.listenTarget)} استفاده می‌کند.`,
    });
  } else if (appCfg.isSocketOrPipe || isValidNumericPort) {
    checks.push({
      id: 'port_config',
      category: 'network',
      label: 'پورت اجرا (PORT)',
      status: 'PASS',
      message: appCfg.isSocketOrPipe
        ? `برنامه به سوکت/پایپ Passenger متصل می‌شود.`
        : `پورت شبکه معتبر است (${String(appCfg.listenTarget)}).`,
    });
  } else {
    checks.push({
      id: 'port_config',
      category: 'network',
      label: 'پورت اجرا (PORT)',
      status: 'FAIL',
      message: `مقدار PORT نامعتبر است (عدد ۱ تا ۶۵۵۳۵ یا مسیر سوکت معتبر با شروع / نیست).`,
      remediation: 'مقدار PORT را عدد بین ۱ تا ۶۵۵۳۵ یا مسیر کامل سوکت یونیکس (/...) بگذارید.',
    });
  }

  // ۹. بررسی بارگذاری ماژول‌های ضروری
  const modResult = resolveRequiredModuleNames();
  checks.push({
    id: 'required_modules',
    category: 'modules',
    label: 'ماژول‌های حیاتی Node.js (node_modules)',
    status: modResult.failed.length === 0 ? 'PASS' : 'FAIL',
    message:
      modResult.failed.length === 0
        ? `تمام ${modResult.loaded.length} ماژول ضروری به‌درستی در دسترس هستند.`
        : `ماژول(های) زیر یافت نشدند: ${modResult.failed.join('، ')}`,
    remediation:
      modResult.failed.length > 0
        ? 'در بخش Setup Node.js App در cPanel دکمه Run NPM Install را اجرا کنید.'
        : undefined,
  });

  // ۱۰. بررسی دسترسی فایل‌سیستم و فایل‌های استاتیک بیلد
  const mediaWrite = checkFilesystemWritable(appCfg.privateMediaDir);
  const backupWrite = checkFilesystemWritable(appCfg.backupDir);
  const appRootDir = getAppRootDir();
  const schemaExists = fs.existsSync(path.resolve(appRootDir, 'database/schema.sql'));
  const distIndexExists = fs.existsSync(path.resolve(appRootDir, 'dist/index.html'));

  if (!mediaWrite.ok || !backupWrite.ok || !schemaExists || (isProd && !distIndexExists)) {
    const fsIssues: string[] = [];
    if (!mediaWrite.ok) fsIssues.push(`عدم دسترسی نوشتن در پوشه رسانه (${mediaWrite.error})`);
    if (!backupWrite.ok) fsIssues.push(`عدم دسترسی نوشتن در پوشه پشتیبان (${backupWrite.error})`);
    if (!schemaExists) fsIssues.push('فایل database/schema.sql یافت نشد');
    if (isProd && !distIndexExists) fsIssues.push('فایل بیلد فرانت‌اند dist/index.html یافت نشد');
    checks.push({
      id: 'filesystem_access',
      category: 'filesystem',
      label: 'دسترسی فایل‌سیستم و فایل‌های بیلد',
      status: 'FAIL',
      message: fsIssues.join(' | '),
      remediation: 'اطمینان حاصل کنید بسته کامل Production در ریشه برنامه Extract شده و دسترسی نوشتن برقرار است.',
    });
  } else {
    checks.push({
      id: 'filesystem_access',
      category: 'filesystem',
      label: 'دسترسی فایل‌سیستم و فایل‌های بیلد',
      status: !distIndexExists ? 'WARNING' : 'PASS',
      message: !distIndexExists
        ? 'پوشه‌های خصوصی و schema.sql آماده هستند (در حالت توسعه فایل dist/index.html اختیاری است).'
        : 'دسترسی خواندن/نوشتن پوشه‌های خصوصی، schema.sql و بیلد dist/index.html برقرار است.',
    });
  }

  // ۱۱. بررسی غیرمخرب اتصال پایگاه داده (در صورت درخواست checkDb)
  if (options?.checkDb) {
    if (!dbCheck.valid && isProd && env.VITEST !== 'true') {
      checks.push({
        id: 'db_connectivity',
        category: 'database',
        label: 'بررسی اتصال زنده به MySQL/MariaDB',
        status: 'FAIL',
        message: 'به دلیل نقص متغیرهای DB_* امکان برقراری اتصال تست وجود ندارد.',
      });
    } else {
      const cfg = getDbConfig(env);
      let conn: mysql.Connection | null = null;
      try {
        conn = await mysql.createConnection({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          connectTimeout: options.dbTimeoutMs || 3500,
        });
        const [verRows] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT VERSION() AS db_version'
        );
        const [tblRows] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES');
        const dbVersion = String(verRows[0]?.db_version || 'unknown');
        checks.push({
          id: 'db_connectivity',
          category: 'database',
          label: 'بررسی اتصال زنده به MySQL/MariaDB',
          status: 'PASS',
          message: `اتصال خواندنی و غیرمخرب به پایگاه داده برقرار شد (نسخه: ${dbVersion} | تعداد جداول فعلی: ${tblRows.length}).`,
        });
      } catch (err) {
        checks.push({
          id: 'db_connectivity',
          category: 'database',
          label: 'بررسی اتصال زنده به MySQL/MariaDB',
          status: 'FAIL',
          message: `عدم دسترسی به پایگاه داده: ${sanitizeSecretErrorText(err)}`,
          remediation:
            'نام دیتابیس، نام کاربری، رمز عبور و دسترسی ALL PRIVILEGES کاربر دیتابیس در MySQL Databases سی‌پنل را بررسی کنید.',
        });
      } finally {
        if (conn) {
          await conn.end().catch(() => {});
        }
      }
    }
  } else {
    checks.push({
      id: 'db_connectivity',
      category: 'database',
      label: 'بررسی اتصال زنده به MySQL/MariaDB',
      status: 'NOT_CONFIGURED',
      message: 'بررسی اتصال زنده در این اجرا درخواست نشده بود.',
    });
  }

  let pass = 0;
  let fail = 0;
  let warning = 0;
  let notConfigured = 0;

  for (const item of checks) {
    if (item.status === 'PASS') pass++;
    else if (item.status === 'FAIL') fail++;
    else if (item.status === 'WARNING') warning++;
    else notConfigured++;
  }

  return {
    ok: fail === 0,
    summary: { pass, fail, warning, notConfigured },
    runtime: {
      nodeVersion: `v${nodeVersion}`,
      nodeEnv: rawNodeEnv || (isProd ? 'production (implicit)' : 'development'),
      isProduction: isProd,
      isBundled,
      isPassenger,
      platform: process.platform,
      cwd: process.cwd(),
      envSource: meta.sourceMode,
      dotenvLoaded: Boolean(meta.dotenvPathLoaded),
      dotenvKeysAppliedCount: meta.dotenvKeysApplied.length,
    },
    checks,
    generatedAt: new Date().toISOString(),
  };
}

export function formatPreflightReportText(report: PreflightReport): string {
  const lines: string[] = [
    '============================================================',
    `[MGAMMON Duo Preflight] Status: ${report.ok ? 'READY' : 'FAILED'} | PASS=${report.summary.pass} WARNING=${report.summary.warning} FAIL=${report.summary.fail} NOT_CONFIGURED=${report.summary.notConfigured}`,
    `[MGAMMON Duo Preflight] Runtime: ${report.runtime.nodeVersion} | NODE_ENV=${report.runtime.nodeEnv} | bundled=${report.runtime.isBundled} | passenger=${report.runtime.isPassenger} | envSource=${report.runtime.envSource}`,
    '------------------------------------------------------------',
  ];

  for (const c of report.checks) {
    lines.push(`[${c.status}] (${c.id}) ${c.label}: ${c.message}`);
    if (c.remediation && (c.status === 'FAIL' || c.status === 'WARNING')) {
      lines.push(`   -> Action: ${c.remediation}`);
    }
  }
  lines.push('============================================================');
  return lines.join('\n');
}
