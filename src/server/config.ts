import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface EnvVarSpec {
  name: string;
  requiredInProduction: boolean;
  secret: boolean;
  cpanelSensitive: boolean;
  description: string;
  defaultValue?: string;
}

export const ENV_VAR_SPECS: EnvVarSpec[] = [
  {
    name: 'NODE_ENV',
    requiredInProduction: true,
    secret: false,
    cpanelSensitive: true,
    description: 'حالت اجرای برنامه (production یا development)',
    defaultValue: 'development',
  },
  {
    name: 'SESSION_SECRET',
    requiredInProduction: true,
    secret: true,
    cpanelSensitive: true,
    description: 'کلید امضای نشست‌ها و توکن‌های امنیتی (حداقل ۳۲ و ترجیحاً ۶۴ کاراکتر هگز ASCII)',
  },
  {
    name: 'DB_HOST',
    requiredInProduction: true,
    secret: false,
    cpanelSensitive: true,
    description: 'آدرس سرور پایگاه داده MySQL/MariaDB (در cPanel معمولاً 127.0.0.1 یا localhost)',
    defaultValue: '127.0.0.1',
  },
  {
    name: 'DB_PORT',
    requiredInProduction: true,
    secret: false,
    cpanelSensitive: true,
    description: 'پورت پایگاه داده (پیش‌فرض 3306)',
    defaultValue: '3306',
  },
  {
    name: 'DB_NAME',
    requiredInProduction: true,
    secret: false,
    cpanelSensitive: true,
    description: 'نام پایگاه داده ساخته شده در cPanel',
  },
  {
    name: 'DB_USER',
    requiredInProduction: true,
    secret: false,
    cpanelSensitive: true,
    description: 'نام کاربری پایگاه داده MySQL در cPanel',
  },
  {
    name: 'DB_PASSWORD',
    requiredInProduction: true,
    secret: true,
    cpanelSensitive: true,
    description: 'رمز عبور کاربر پایگاه داده',
  },
  {
    name: 'DB_CONNECTION_LIMIT',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'حداکثر تعداد اتصال هم‌زمان استخر دیتابیس (عدد بین ۲ تا ۵۰، پیش‌فرض ۱۰)',
    defaultValue: '10',
  },
  {
    name: 'APP_TIMEZONE',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'منطقه زمانی سرور (پیش‌فرض Asia/Tehran)',
    defaultValue: 'Asia/Tehran',
  },
  {
    name: 'PORT',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'پورت یا سوکت اختصاص‌یافته توسط هاست/Passenger (در توسعه 3000)',
    defaultValue: '3000',
  },
  {
    name: 'APP_URL',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'نشانی دامنه اصلی برنامه (مثلاً https://mgammon.example.ir)',
  },
  {
    name: 'INITIAL_MANAGER_USERNAME',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'نام کاربری اولیه مدیر (فقط در اولین ساخت کاربر در دیتابیس خالی)',
    defaultValue: 'manager',
  },
  {
    name: 'INITIAL_MANAGER_PASSWORD',
    requiredInProduction: false,
    secret: true,
    cpanelSensitive: true,
    description: 'رمز عبور اولیه مدیر (فقط در اولین راه‌اندازی روی دیتابیس خالی)',
  },
  {
    name: 'INITIAL_WORKER_USERNAME',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'نام کاربری اولیه پرسنل (فقط در اولین ساخت کاربر در دیتابیس خالی)',
    defaultValue: 'worker',
  },
  {
    name: 'INITIAL_WORKER_PASSWORD',
    requiredInProduction: false,
    secret: true,
    cpanelSensitive: true,
    description: 'رمز عبور اولیه پرسنل (فقط در اولین راه‌اندازی روی دیتابیس خالی)',
  },
  {
    name: 'PRIVATE_MEDIA_DIR',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'مسیر ذخیره فایل‌ها و پیوست‌های خصوصی خارج از مسیر وب',
    defaultValue: '.data/private_media',
  },
  {
    name: 'BACKUP_DIR',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'مسیر ذخیره فایل‌های پشتیبان خارج از مسیر وب',
    defaultValue: '.data/backups',
  },
  {
    name: 'CPANEL_ENV',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'پرچم اختیاری شناسایی صریح محیط cPanel (true)',
  },
  {
    name: 'ENFORCE_PASSWORD_CHANGE',
    requiredInProduction: false,
    secret: false,
    cpanelSensitive: true,
    description: 'الزام تغییر رمز اولیه در اولین ورود (true در محیط عملیاتی)',
  },
];

export const FORBIDDEN_DEFAULT_SECRETS = new Set([
  '',
  'undefined',
  'null',
  'mgammon-duo-default-server-secret-2026',
  'mgammon-duo-enterprise-secret-2026',
  'mgammon-duo-dev-only-ephemeral-secret-key-2026-local',
  'CHANGE_THIS_TO_A_STRONG_64_CHAR_RANDOM_SECRET_KEY',
  'replace_with_a_long_random_64_char_secret_string',
  'your_session_secret',
  'secret',
  'changeme',
  'default',
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

export const PLACEHOLDER_DB_USERS = new Set(['', 'cpanel_username_mgammon', 'your_db_user']);
export const PLACEHOLDER_DB_PASSWORDS = new Set([
  '',
  'YOUR_STRONG_MYSQL_PASSWORD',
  'your_db_password',
]);
export const PLACEHOLDER_DB_NAMES = new Set(['', 'cpanel_username_mgammon_duo', 'your_db_name']);

export interface EnvLoadMetadata {
  loaded: boolean;
  sourceMode: 'HOST_ENV_ONLY' | 'DOTENV_FALLBACK_ONLY' | 'MIXED_HOST_AND_DOTENV';
  dotenvPathLoaded: string | null;
  dotenvKeysApplied: string[];
  hostKeysPreserved: string[];
  publicEnvLeakPaths: string[];
  dotenvParseError: string | null;
}

export interface EnvValueInspection {
  present: boolean;
  rawLength: number;
  trimmedLength: number;
  hasLeadingOrTrailingWhitespace: boolean;
  hasInternalWhitespace: boolean;
  hasNewlines: boolean;
  hasControlChars: boolean;
  hasBomOrZeroWidth: boolean;
  hasNonAscii: boolean;
  hasSurroundingQuotes: boolean;
  hasCpanelShellUnsafeChars: boolean;
  cpanelUnsafeReasons: string[];
}

export interface SessionSecretValidationResult {
  valid: boolean;
  status: 'PASS' | 'FAIL' | 'WARNING' | 'NOT_CONFIGURED';
  code:
    | 'VALID'
    | 'VALID_WITH_WARNINGS'
    | 'SECRET_EMPTY'
    | 'SECRET_TOO_SHORT'
    | 'SECRET_DEFAULT_FORBIDDEN'
    | 'SECRET_INVALID_CHARACTERS'
    | 'SECRET_LOW_ENTROPY'
    | 'NOT_CONFIGURED_DEV';
  reason: string;
  length: number;
  cpanelWarnings: string[];
}

const VALID_ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const NEWLINE_RE = /[\r\n]/;
const BOM_OR_ZERO_WIDTH_RE = /[\uFEFF\u200B-\u200F\u202A-\u202E\u2060]/;
const NON_ASCII_RE = /[^\x20-\x7E\r\n\t]/;
const CPANEL_SHELL_UNSAFE_RE = /["'`$\\;#\r\n]/;

let envLoadMetadata: EnvLoadMetadata = {
  loaded: false,
  sourceMode: 'HOST_ENV_ONLY',
  dotenvPathLoaded: null,
  dotenvKeysApplied: [],
  hostKeysPreserved: [],
  publicEnvLeakPaths: [],
  dotenvParseError: null,
};

let devOnlyEphemeralSecret: string | null = null;

export const MIN_SESSION_SECRET_LENGTH = 32;
export const MIN_SESSION_SECRET_UNIQUE_CHARS = 10;

export function isMgammonAppRootDir(dir: string): boolean {
  try {
    const hasSchema = fs.existsSync(path.resolve(dir, 'database/schema.sql'));
    const hasEntryOrBuild =
      fs.existsSync(path.resolve(dir, 'app.cjs')) ||
      fs.existsSync(path.resolve(dir, 'server.ts')) ||
      fs.existsSync(path.resolve(dir, 'dist/index.html'));
    return hasSchema && hasEntryOrBuild;
  } catch {
    return false;
  }
}

function getCandidateAppRoots(customCwd?: string): string[] {
  const dirs: string[] = [];

  if (typeof __dirname === 'string' && __dirname) {
    const cleanDir = path.resolve(__dirname);
    if (!dirs.includes(cleanDir)) {
      dirs.push(cleanDir);
    }
    const parentDir = path.resolve(cleanDir, '..', '..');
    if (!dirs.includes(parentDir)) {
      dirs.push(parentDir);
    }
  }

  if (process.argv[1]) {
    const argvDir = path.resolve(path.dirname(process.argv[1]));
    if (!dirs.includes(argvDir)) {
      dirs.push(argvDir);
    }
  }

  const cwd = path.resolve(customCwd || process.cwd());
  if (!dirs.includes(cwd)) {
    dirs.push(cwd);
  }

  return dirs;
}

export function getAppRootDir(options?: { cwd?: string; candidates?: string[] }): string {
  const candidates = options?.candidates || getCandidateAppRoots(options?.cwd);

  // ۱. اولویت قطعی با پوشه‌ای که ساختار واقعی MGAMMON Duo (فایل database/schema.sql به همراه app.cjs یا server.ts یا dist/index.html) را دارد
  for (const dir of candidates) {
    if (isMgammonAppRootDir(dir)) {
      return path.resolve(dir);
    }
  }

  // ۲. بررسی وجود هم‌زمان app.cjs و dist/index.html یا database/schema.sql (بدون پذیرش صرفِ package.json متفرقه)
  for (const dir of candidates) {
    try {
      if (
        fs.existsSync(path.resolve(dir, 'database/schema.sql')) ||
        fs.existsSync(path.resolve(dir, 'app.cjs'))
      ) {
        return path.resolve(dir);
      }
    } catch {
      // ignore filesystem read errors
    }
  }

  return path.resolve(options?.cwd || process.cwd());
}

function isPublicWebDirectory(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/public/') ||
    normalized.endsWith('/public') ||
    normalized.includes('/dist/') ||
    normalized.endsWith('/dist') ||
    normalized.includes('/public_html/')
  );
}

export function scanForPublicEnvFiles(baseDirs: string[] = getCandidateAppRoots()): string[] {
  const found: string[] = [];
  for (const base of baseDirs) {
    for (const sub of ['public', 'dist']) {
      for (const envName of ['.env', '.env.local', '.env.production']) {
        const candidate = path.resolve(base, sub, envName);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            if (!found.includes(candidate)) {
              found.push(candidate);
            }
          }
        } catch {
          // ignore filesystem read errors
        }
      }
    }
  }
  return found;
}

/**
 * بارگذاری ایمن و غیرتخریبی متغیرهای محیطی از .env (فقط یک‌بار و بدون بازنویسی متغیرهای غیرخالی هاست).
 * - متغیرهای غیرخالی تنظیم‌شده در cPanel / Passenger همیشه اولویت اول دارند.
 * - اگر cPanel متغیری را رد یا خالی رها کرده باشد و فایل .env در ریشه خصوصی برنامه باشد، مقدار معتبر آن تکمیل می‌شود.
 * - فایل‌های .env درون public/ یا dist/ هرگز بارگذاری نمی‌شوند و به‌عنوان هشدار/خطای امنیتی ثبت می‌گردند.
 */
export function loadEnvironmentOnce(options?: {
  forceReload?: boolean;
  searchDirs?: string[];
  allowInVitest?: boolean;
}): EnvLoadMetadata {
  if (envLoadMetadata.loaded && !options?.forceReload) {
    return envLoadMetadata;
  }

  const isVitest = process.env.VITEST === 'true';
  const publicEnvLeakPaths = scanForPublicEnvFiles(options?.searchDirs);

  if (isVitest && !options?.allowInVitest) {
    envLoadMetadata = {
      loaded: true,
      sourceMode: 'HOST_ENV_ONLY',
      dotenvPathLoaded: null,
      dotenvKeysApplied: [],
      hostKeysPreserved: [],
      publicEnvLeakPaths,
      dotenvParseError: null,
    };
    return envLoadMetadata;
  }

  const appRootDir = getAppRootDir();
  const searchDirs = options?.searchDirs || [appRootDir];
  const candidateEnvPaths: string[] = [];

  if (process.env.MGAMMON_ENV_FILE) {
    const explicitPath = path.resolve(appRootDir, process.env.MGAMMON_ENV_FILE);
    if (!isPublicWebDirectory(explicitPath)) {
      candidateEnvPaths.push(explicitPath);
    }
  }

  for (const dir of searchDirs) {
    const envFile = path.resolve(dir, '.env');
    if (!isPublicWebDirectory(envFile) && !candidateEnvPaths.includes(envFile)) {
      candidateEnvPaths.push(envFile);
    }
  }

  let dotenvPathLoaded: string | null = null;
  let dotenvParseError: string | null = null;
  const dotenvKeysApplied: string[] = [];
  const hostKeysPreserved: string[] = [];

  for (const candidate of candidateEnvPaths) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const rawBytes = fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
        const parsed = dotenv.parse(rawBytes);
        dotenvPathLoaded = candidate;

        for (const [key, parsedVal] of Object.entries(parsed)) {
          if (!isValidEnvVarName(key)) {
            continue;
          }
          const existing = process.env[key];
          const existingTrimmed = typeof existing === 'string' ? existing.trim() : '';
          if (existingTrimmed.length > 0) {
            hostKeysPreserved.push(key);
          } else if (typeof parsedVal === 'string' && parsedVal.trim().length > 0) {
            process.env[key] = parsedVal;
            dotenvKeysApplied.push(key);
          }
        }
        break;
      }
    } catch (err) {
      dotenvParseError = err instanceof Error ? err.message : 'Failed to parse .env file';
      break;
    }
  }

  const sourceMode: EnvLoadMetadata['sourceMode'] =
    dotenvKeysApplied.length === 0
      ? 'HOST_ENV_ONLY'
      : hostKeysPreserved.length === 0
        ? 'DOTENV_FALLBACK_ONLY'
        : 'MIXED_HOST_AND_DOTENV';

  envLoadMetadata = {
    loaded: true,
    sourceMode,
    dotenvPathLoaded,
    dotenvKeysApplied,
    hostKeysPreserved,
    publicEnvLeakPaths,
    dotenvParseError,
  };

  return envLoadMetadata;
}

export function getEnvLoadMetadata(): EnvLoadMetadata {
  if (!envLoadMetadata.loaded) {
    loadEnvironmentOnce();
  }
  return envLoadMetadata;
}

export function resetConfigCacheForTest(): void {
  envLoadMetadata = {
    loaded: false,
    sourceMode: 'HOST_ENV_ONLY',
    dotenvPathLoaded: null,
    dotenvKeysApplied: [],
    hostKeysPreserved: [],
    publicEnvLeakPaths: [],
    dotenvParseError: null,
  };
}

export function isValidEnvVarName(name: string): boolean {
  return VALID_ENV_NAME_RE.test(name);
}

export function analyzeEnvValue(
  rawValue: string | undefined,
  options?: { isSecret?: boolean; checkCpanelSafety?: boolean }
): EnvValueInspection {
  if (rawValue === undefined || rawValue === null) {
    return {
      present: false,
      rawLength: 0,
      trimmedLength: 0,
      hasLeadingOrTrailingWhitespace: false,
      hasInternalWhitespace: false,
      hasNewlines: false,
      hasControlChars: false,
      hasBomOrZeroWidth: false,
      hasNonAscii: false,
      hasSurroundingQuotes: false,
      hasCpanelShellUnsafeChars: false,
      cpanelUnsafeReasons: [],
    };
  }

  const str = String(rawValue);
  const trimmed = str.trim();
  const hasNewlines = NEWLINE_RE.test(str);
  const hasControlChars = CONTROL_CHAR_RE.test(str);
  const hasBomOrZeroWidth = BOM_OR_ZERO_WIDTH_RE.test(str);
  const hasNonAscii = NON_ASCII_RE.test(str);
  const hasLeadingOrTrailingWhitespace = str !== trimmed;
  const hasInternalWhitespace = /[ \t]/.test(trimmed);
  const hasSurroundingQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2);

  const cpanelUnsafeReasons: string[] = [];
  if (options?.checkCpanelSafety !== false && trimmed.length > 0) {
    if (hasNewlines) cpanelUnsafeReasons.push('دارای کاراکتر خط جدید (CR/LF)');
    if (hasControlChars) cpanelUnsafeReasons.push('دارای کاراکترهای کنترلی نامرئی');
    if (hasBomOrZeroWidth) cpanelUnsafeReasons.push('دارای کاراکتر مخفی BOM یا نیم‌فاصله (ZWNJ)');
    if (hasNonAscii) cpanelUnsafeReasons.push('دارای کاراکتر غیرانگلیسی (غیر ASCII / فارسی)');
    if (hasLeadingOrTrailingWhitespace) cpanelUnsafeReasons.push('دارای فاصله در ابتدا یا انتها');
    if (hasInternalWhitespace) cpanelUnsafeReasons.push('دارای فاصله (Space/Tab) درون مقدار');
    if (hasSurroundingQuotes) cpanelUnsafeReasons.push('دارای علامت کوتیشن (" یا \') در اطراف مقدار');
    if (CPANEL_SHELL_UNSAFE_RE.test(trimmed)) {
      cpanelUnsafeReasons.push('دارای کاراکترهای حساس شِل/Apache مثل $ یا " یا \' یا \\ یا # یا ;');
    }
  }

  return {
    present: trimmed.length > 0,
    rawLength: str.length,
    trimmedLength: trimmed.length,
    hasLeadingOrTrailingWhitespace,
    hasInternalWhitespace,
    hasNewlines,
    hasControlChars,
    hasBomOrZeroWidth,
    hasNonAscii,
    hasSurroundingQuotes,
    hasCpanelShellUnsafeChars: cpanelUnsafeReasons.length > 0,
    cpanelUnsafeReasons,
  };
}

export function isBundledAppCjs(): boolean {
  if (typeof __filename === 'string' && path.basename(__filename) === 'app.cjs') {
    return true;
  }
  if (process.argv[1] && path.basename(process.argv[1]) === 'app.cjs') {
    return true;
  }
  return false;
}

export function isPassengerEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.PASSENGER_BASE_URI ||
      env.PASSENGER_APP_ENV ||
      env.IN_PASSENGER ||
      env.PASSENGER_SPAWN_METHOD ||
      typeof (globalThis as Record<string, unknown>).PhusionPassenger !== 'undefined'
  );
}

export function isProductionMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return true;
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return false;
  if (env.PASSENGER_APP_ENV === 'production') return true;
  if (env.VITEST === 'true') return false;
  if (isUsingProcessEnv(env) && (isBundledAppCjs() || env.CPANEL_ENV === 'true')) {
    return true;
  }
  return false;
}

export function isCpanelOrProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionMode(env)) return true;
  if (env.CPANEL_ENV === 'true' || env.CPANEL === '1') return true;
  if (isPassengerEnvironment(env)) return true;
  const rawUser = (env.DB_USER || '').trim();
  if (rawUser && !PLACEHOLDER_DB_USERS.has(rawUser) && rawUser !== 'root') {
    return true;
  }
  return false;
}

function isUsingProcessEnv(env: NodeJS.ProcessEnv): boolean {
  return env === process.env;
}

export function validateSessionSecret(
  env: NodeJS.ProcessEnv = process.env
): SessionSecretValidationResult {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  const raw = env.SESSION_SECRET;
  const inspection = analyzeEnvValue(raw, { isSecret: true, checkCpanelSafety: true });
  const trimmed = (raw || '').trim();
  const isProd = isProductionMode(env);

  if (!inspection.present || trimmed === 'undefined' || trimmed === 'null') {
    return {
      valid: !isProd,
      status: isProd ? 'FAIL' : 'NOT_CONFIGURED',
      code: isProd ? 'SECRET_EMPTY' : 'NOT_CONFIGURED_DEV',
      reason: isProd
        ? 'SESSION_SECRET در محیط Production خالی یا تعریف‌نشده است (احتمالاً در cPanel ثبت نشده یا توسط set_env_vars.py رد شده است).'
        : 'SESSION_SECRET در محیط توسعه تنظیم نشده و از کلید موقت حافظه‌ای استفاده می‌شود.',
      length: 0,
      cpanelWarnings: [],
    };
  }

  if (
    inspection.hasNewlines ||
    inspection.hasControlChars ||
    inspection.hasBomOrZeroWidth ||
    inspection.hasNonAscii ||
    inspection.hasInternalWhitespace ||
    inspection.hasSurroundingQuotes
  ) {
    const defects: string[] = [];
    if (inspection.hasNewlines) defects.push('خط جدید (CR/LF)');
    if (inspection.hasControlChars) defects.push('کاراکتر کنترلی');
    if (inspection.hasBomOrZeroWidth) defects.push('BOM یا کاراکتر مخفی نیم‌فاصله');
    if (inspection.hasNonAscii) defects.push('کاراکتر غیر ASCII');
    if (inspection.hasInternalWhitespace) defects.push('فاصله میانی');
    if (inspection.hasSurroundingQuotes) defects.push('کوتیشن اطراف مقدار');

    return {
      valid: false,
      status: 'FAIL',
      code: 'SECRET_INVALID_CHARACTERS',
      reason: `SESSION_SECRET دارای کاراکترهای نامعتبر (${defects.join('، ')}) است؛ مقدار باید یک رشته یکدست و پاک ASCII بدون فاصله، کوتیشن و خط جدید باشد.`,
      length: trimmed.length,
      cpanelWarnings: inspection.cpanelUnsafeReasons,
    };
  }

  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_DEFAULT_SECRETS.has(trimmed) || FORBIDDEN_DEFAULT_SECRETS.has(lower)) {
    return {
      valid: false,
      status: 'FAIL',
      code: 'SECRET_DEFAULT_FORBIDDEN',
      reason: 'SESSION_SECRET روی مقدار پیش‌فرض یا الگوهای نمونه ناامن تنظیم شده است.',
      length: trimmed.length,
      cpanelWarnings: inspection.cpanelUnsafeReasons,
    };
  }

  if (trimmed.length < MIN_SESSION_SECRET_LENGTH) {
    return {
      valid: false,
      status: 'FAIL',
      code: 'SECRET_TOO_SHORT',
      reason: `طول SESSION_SECRET برابر ${trimmed.length} کاراکتر است و از حداقل مجاز ${MIN_SESSION_SECRET_LENGTH} کاراکتر کمتر است.`,
      length: trimmed.length,
      cpanelWarnings: inspection.cpanelUnsafeReasons,
    };
  }

  const uniqueCharsCount = new Set(trimmed.split('')).size;
  if (uniqueCharsCount < MIN_SESSION_SECRET_UNIQUE_CHARS) {
    return {
      valid: false,
      status: 'FAIL',
      code: 'SECRET_LOW_ENTROPY',
      reason: `تنوع کاراکترهای SESSION_SECRET بسیار پایین (${uniqueCharsCount} کاراکتر یکتا؛ حداقل مجاز ${MIN_SESSION_SECRET_UNIQUE_CHARS} کاراکتر یکتا) است و امنیت کافی ندارد.`,
      length: trimmed.length,
      cpanelWarnings: inspection.cpanelUnsafeReasons,
    };
  }

  const cpanelWarnings = [...inspection.cpanelUnsafeReasons];
  if (trimmed.length < 64) {
    cpanelWarnings.push(
      `طول کلید ${trimmed.length} کاراکتر است (معتبر، اما استفاده از ۶۴ کاراکتر هگز توصیه می‌شود).`
    );
  }

  return {
    valid: true,
    status: cpanelWarnings.length > 0 ? 'WARNING' : 'PASS',
    code: cpanelWarnings.length > 0 ? 'VALID_WITH_WARNINGS' : 'VALID',
    reason:
      cpanelWarnings.length > 0
        ? `SESSION_SECRET معتبر است (${trimmed.length} کاراکتر) ولی هشدار سازگاری cPanel دارد.`
        : `SESSION_SECRET معتبر و امن است (${trimmed.length} کاراکتر).`,
    length: trimmed.length,
    cpanelWarnings,
  };
}

export function validateProductionSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  if (!isProductionMode(env)) {
    return;
  }

  const secretCheck = validateSessionSecret(env);
  if (!secretCheck.valid) {
    throw new Error(`SECURITY_CONFIG_ERROR: ${secretCheck.reason}`);
  }

  const mgrPassRaw = env.INITIAL_MANAGER_PASSWORD;
  const wrkPassRaw = env.INITIAL_WORKER_PASSWORD;
  const mgrInspect = analyzeEnvValue(mgrPassRaw, { isSecret: true, checkCpanelSafety: false });
  const wrkInspect = analyzeEnvValue(wrkPassRaw, { isSecret: true, checkCpanelSafety: false });

  if (
    mgrInspect.hasNewlines ||
    mgrInspect.hasControlChars ||
    wrkInspect.hasNewlines ||
    wrkInspect.hasControlChars
  ) {
    throw new Error(
      'SECURITY_CONFIG_ERROR: رمز عبور اولیه حساب‌ها (INITIAL_MANAGER_PASSWORD / INITIAL_WORKER_PASSWORD) دارای کاراکتر کنترلی یا خط جدید است.'
    );
  }

  const mgrPass = (mgrPassRaw || '').trim();
  const wrkPass = (wrkPassRaw || '').trim();
  if (
    (mgrPass && (mgrPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(mgrPass))) ||
    (wrkPass && (wrkPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(wrkPass)))
  ) {
    throw new Error(
      'SECURITY_CONFIG_ERROR: استفاده از رمز عبور پیش‌فرض یا ضعیف برای حساب‌های اولیه در محیط عملیاتی (Production) مجاز نیست.'
    );
  }
}

export function validateProductionDatabaseConfig(env: NodeJS.ProcessEnv = process.env): {
  valid: boolean;
  missingVars: string[];
  invalidVars: string[];
  message: string;
} {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  const missingVars: string[] = [];
  const invalidVars: string[] = [];

  const rawHost = (env.DB_HOST || '').trim();
  const rawPort = (env.DB_PORT || '').trim();
  const rawName = (env.DB_NAME || '').trim();
  const rawUser = (env.DB_USER || '').trim();
  const rawPass = env.DB_PASSWORD || '';
  const rawConnLimit = (env.DB_CONNECTION_LIMIT || '').trim();

  if (rawPort) {
    const portNum = Number(rawPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      invalidVars.push('DB_PORT (عدد پورت نامعتبر؛ باید بین ۱ تا ۶۵۵۳۵ باشد)');
    }
  }

  if (rawConnLimit) {
    const limitNum = Number(rawConnLimit);
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      invalidVars.push('DB_CONNECTION_LIMIT (باید عدد صحیح بین ۱ تا ۱۰۰ باشد)');
    }
  }

  const nameInspect = analyzeEnvValue(rawName);
  const userInspect = analyzeEnvValue(rawUser);
  const hostInspect = analyzeEnvValue(rawHost);

  if (hostInspect.hasNewlines || hostInspect.hasControlChars || hostInspect.hasBomOrZeroWidth) {
    invalidVars.push('DB_HOST (دارای کاراکتر کنترلی یا خط جدید)');
  }
  if (nameInspect.hasNewlines || nameInspect.hasControlChars || nameInspect.hasBomOrZeroWidth) {
    invalidVars.push('DB_NAME (دارای کاراکتر کنترلی یا خط جدید)');
  }
  if (userInspect.hasNewlines || userInspect.hasControlChars || userInspect.hasBomOrZeroWidth) {
    invalidVars.push('DB_USER (دارای کاراکتر کنترلی یا خط جدید)');
  }

  if (isProductionMode(env) && env.VITEST !== 'true') {
    if (!rawHost) missingVars.push('DB_HOST');
    if (!rawName || PLACEHOLDER_DB_NAMES.has(rawName)) missingVars.push('DB_NAME');
    if (!rawUser || PLACEHOLDER_DB_USERS.has(rawUser)) missingVars.push('DB_USER');
    if (!rawPass.trim() || PLACEHOLDER_DB_PASSWORDS.has(rawPass.trim())) {
      missingVars.push('DB_PASSWORD');
    }
  }

  const valid = missingVars.length === 0 && invalidVars.length === 0;
  const parts: string[] = [];
  if (missingVars.length > 0) {
    parts.push(`متغیر(های) مفقود یا دارای مقدار نمونه: ${missingVars.join('، ')}`);
  }
  if (invalidVars.length > 0) {
    parts.push(`متغیر(های) نامعتبر: ${invalidVars.join('، ')}`);
  }

  return {
    valid,
    missingVars,
    invalidVars,
    message: valid ? 'تنظیمات پایگاه داده معتبر است.' : parts.join(' | '),
  };
}

export function getDbConfig(env: NodeJS.ProcessEnv = process.env) {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  const rawUser = (env.DB_USER || '').trim();
  const rawPassword = env.DB_PASSWORD || '';
  const rawDbName = (env.DB_NAME || '').trim();
  const rawHost = (env.DB_HOST || '').trim();
  const rawPort = (env.DB_PORT || '').trim();
  const rawLimit = (env.DB_CONNECTION_LIMIT || '').trim();

  const parsedPort = rawPort ? Number(rawPort) : 3306;
  const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 3306;

  const parsedLimit = rawLimit ? Number(rawLimit) : 10;
  const connectionLimit =
    Number.isInteger(parsedLimit) && parsedLimit >= 2 && parsedLimit <= 50 ? parsedLimit : 10;

  const allowDevPlaceholderFallback = !isProductionMode(env) || env.VITEST === 'true';

  const resolvedUser = PLACEHOLDER_DB_USERS.has(rawUser)
    ? allowDevPlaceholderFallback
      ? 'root'
      : ''
    : rawUser;

  const resolvedPassword = PLACEHOLDER_DB_PASSWORDS.has(rawPassword)
    ? ''
    : rawPassword;

  const resolvedDatabase = PLACEHOLDER_DB_NAMES.has(rawDbName)
    ? allowDevPlaceholderFallback
      ? 'mgammon_duo'
      : ''
    : rawDbName;

  return {
    host: rawHost || '127.0.0.1',
    port,
    user: resolvedUser,
    password: resolvedPassword,
    database: resolvedDatabase,
    waitForConnections: true,
    connectionLimit,
    connectTimeout: 5000,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+03:30',
    dateStrings: ['DATE'] as ('DATE' | 'DATETIME' | 'TIMESTAMP')[],
  };
}

export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  validateProductionSecurityConfig(env);
  const check = validateSessionSecret(env);
  if (check.valid && env.SESSION_SECRET && env.SESSION_SECRET.trim().length >= 32) {
    return env.SESSION_SECRET.trim();
  }

  if (isProductionMode(env)) {
    throw new Error(`SECURITY_CONFIG_ERROR: ${check.reason}`);
  }

  if (!devOnlyEphemeralSecret) {
    devOnlyEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devOnlyEphemeralSecret;
}

export function getAppConfig(env: NodeJS.ProcessEnv = process.env) {
  if (isUsingProcessEnv(env)) {
    loadEnvironmentOnce();
  }

  const rawPort = (env.PORT || '').trim();
  let listenTarget: number | string = 3000;
  let isSocketOrPipe = false;

  if (rawPort) {
    if (/^\d+$/.test(rawPort)) {
      const n = Number(rawPort);
      if (n >= 1 && n <= 65535) {
        listenTarget = n;
      }
    } else if (
      rawPort.toLowerCase() === 'passenger' ||
      rawPort.startsWith('/') ||
      rawPort.startsWith('\\\\.\\pipe\\')
    ) {
      listenTarget = rawPort.toLowerCase() === 'passenger' ? 'passenger' : rawPort;
      isSocketOrPipe = true;
    }
  }

  const appRootDir = getAppRootDir();

  const privateMediaDir = (env.PRIVATE_MEDIA_DIR || '').trim()
    ? path.resolve(appRootDir, (env.PRIVATE_MEDIA_DIR || '').trim())
    : path.resolve(appRootDir, '.data/private_media');

  const backupDir = (env.BACKUP_DIR || '').trim()
    ? path.resolve(appRootDir, (env.BACKUP_DIR || '').trim())
    : path.resolve(appRootDir, '.data/backups');

  return {
    appRootDir,
    nodeEnv: (env.NODE_ENV || '').trim() || 'development',
    isProduction: isProductionMode(env),
    isBundled: isBundledAppCjs(),
    isPassenger: isPassengerEnvironment(env),
    isVitest: env.VITEST === 'true',
    listenTarget,
    isSocketOrPipe,
    appUrl: (env.APP_URL || '').trim() || null,
    appTimezone: (env.APP_TIMEZONE || '').trim() || 'Asia/Tehran',
    enforcePasswordChange:
      env.ENFORCE_PASSWORD_CHANGE === 'true' || isProductionMode(env),
    privateMediaDir,
    backupDir,
    initialManagerUsername: (env.INITIAL_MANAGER_USERNAME || 'manager').trim() || 'manager',
    initialManagerPassword: (env.INITIAL_MANAGER_PASSWORD || '').trim(),
    initialWorkerUsername: (env.INITIAL_WORKER_USERNAME || 'worker').trim() || 'worker',
    initialWorkerPassword: (env.INITIAL_WORKER_PASSWORD || '').trim(),
    localMariaDbDataDir: (env.LOCAL_MARIADB_DATADIR || '/var/lib/mysql').trim(),
    localDebCacheDir: (env.LOCAL_DEB_CACHE_DIR || '/var/cache/apt/archives').trim(),
    simulateDbDown: env.SIMULATE_DB_DOWN === 'true',
  };
}

export function sanitizeSecretErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown error');
  let sanitized = raw
    .replace(
      /(password|passwd|pwd|token|secret|authorization|session_secret|db_password|api[_-]?key)\s*[:=]\s*[^\s,;'"&]+/gi,
      '$1=[REDACTED]'
    )
    .replace(/using password:\s*(YES|NO)/gi, 'using password: [REDACTED]')
    .replace(/'[^']*'@'[^']*'/g, "'[USER]'@'[HOST]'");

  // حذف تصادفی هر مقدار محرمانه ثبت‌شده از متن خطاها
  for (const secretKey of [
    'SESSION_SECRET',
    'DB_PASSWORD',
    'INITIAL_MANAGER_PASSWORD',
    'INITIAL_WORKER_PASSWORD',
  ]) {
    const val = (process.env[secretKey] || '').trim();
    if (val && val.length >= 6 && sanitized.includes(val)) {
      sanitized = sanitized.split(val).join('[REDACTED]');
    }
  }

  return sanitized;
}
