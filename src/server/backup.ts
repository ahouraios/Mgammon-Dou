import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { getDbConfig, getPool } from './db';

export const BACKUP_TABLES_ORDERED = [
  'schema_migrations',
  'users',
  'user_sessions',
  'system_settings',
  'system_settings_snapshots',
  'attendance_logs',
  'historical_work_records',
  'daily_work_reports',
  'financial_transactions',
  'work_correspondences',
  'leave_requests',
  'work_tasks',
  'audit_logs',
] as const;

export const PRIVATE_MEDIA_SUBFOLDERS = [
  'avatars',
  'attachments',
  'excel',
  'audio',
  'receipts',
  'reports',
] as const;

export interface DatabaseIntegrityMetrics {
  tableCounts: Record<string, number>;
  financialSums: {
    totalTransactionsCount: number;
    totalAmountToman: number;
    approvedAmountToman: number;
    pendingAmountToman: number;
    rejectedAmountToman: number;
    totalHistoricalNetWorkMinutes: number;
    totalHistoricalOvertimeMinutes: number;
    activeAttendanceLogsCount: number;
  };
}

export interface BackupMediaFileEntry {
  folder: string;
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  base64Data: string;
}

export interface BackupManifest {
  backupId: string;
  formatVersion: number;
  createdAt: string;
  database: string;
  tableCounts: Record<string, number>;
  financialSums: DatabaseIntegrityMetrics['financialSums'];
  mediaFilesCount: number;
  mediaTotalBytes: number;
  payloadChecksum: string;
}

export interface BackupArchiveBundle {
  manifest: BackupManifest;
  tables: Record<string, Record<string, unknown>[]>;
  mediaFiles: BackupMediaFileEntry[];
  sqlDump: string;
}

function computeSha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `'${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}'`;
  }
  if (typeof val === 'object') {
    const jsonStr = JSON.stringify(val)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    return `'${jsonStr}'`;
  }
  const str = String(val)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${str}'`;
}

function normalizeRowValueForInsert(val: unknown, colName: string): unknown {
  if (val === null || val === undefined) return null;
  if (
    typeof val === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val) &&
    (colName.endsWith('_at') || colName === 'recorded_at' || colName === 'expires_at')
  ) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  if (
    typeof val === 'object' &&
    !(val instanceof Date) &&
    !Buffer.isBuffer(val)
  ) {
    return JSON.stringify(val);
  }
  return val;
}

/**
 * استخراج دقیق آمار تعداد رکوردهای تمام جداول و جمع مبالغ مالی برای راستی‌آزمایی پیش و پس از بازیابی
 */
export async function collectDatabaseMetrics(
  customPool?: mysql.Pool
): Promise<DatabaseIntegrityMetrics> {
  const p = customPool || getPool();
  const tableCounts: Record<string, number> = {};

  for (const tbl of BACKUP_TABLES_ORDERED) {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM \`${tbl}\``
    );
    tableCounts[tbl] = Number(rows[0]?.cnt || 0);
  }

  const [finRows] = await p.query<mysql.RowDataPacket[]>(`
    SELECT
      COUNT(*) AS total_cnt,
      COALESCE(SUM(amount_toman), 0) AS total_amount,
      COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_amount,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_amount,
      COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN amount_toman ELSE 0 END), 0) AS rejected_amount
    FROM financial_transactions
  `);

  const [histRows] = await p.query<mysql.RowDataPacket[]>(`
    SELECT
      COALESCE(SUM(net_work_minutes), 0) AS total_net_mins,
      COALESCE(SUM(overtime_minutes), 0) AS total_ot_mins
    FROM historical_work_records
    WHERE status = 'APPROVED'
  `);

  const [attRows] = await p.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS active_cnt
    FROM attendance_logs
    WHERE is_deleted = 0
  `);

  return {
    tableCounts,
    financialSums: {
      totalTransactionsCount: Number(finRows[0]?.total_cnt || 0),
      totalAmountToman: Number(finRows[0]?.total_amount || 0),
      approvedAmountToman: Number(finRows[0]?.approved_amount || 0),
      pendingAmountToman: Number(finRows[0]?.pending_amount || 0),
      rejectedAmountToman: Number(finRows[0]?.rejected_amount || 0),
      totalHistoricalNetWorkMinutes: Number(histRows[0]?.total_net_mins || 0),
      totalHistoricalOvertimeMinutes: Number(histRows[0]?.total_ot_mins || 0),
      activeAttendanceLogsCount: Number(attRows[0]?.active_cnt || 0),
    },
  };
}

/**
 * ایجاد نسخه پشتیبان کامل و اتمیک (دیتابیس + فایل‌های خصوصی پیوست) خارج از مسیر عمومی وب (.data/backups)
 */
export async function createFullBackup(options?: {
  backupDir?: string;
  privateMediaDir?: string;
  customPool?: mysql.Pool;
  maxRetainedBackups?: number;
}): Promise<{
  backupFilePath: string;
  sqlDumpFilePath: string;
  manifest: BackupManifest;
  sizeBytes: number;
}> {
  const p = options?.customPool || getPool();
  const cfg = getDbConfig();
  const backupDir =
    options?.backupDir ||
    process.env.BACKUP_DIR ||
    path.resolve(process.cwd(), '.data/backups');
  const privateMediaDir =
    options?.privateMediaDir ||
    path.resolve(process.cwd(), '.data/private_media');

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const metrics = await collectDatabaseMetrics(p);
  if ((metrics.tableCounts.users || 0) === 0 || (metrics.tableCounts.system_settings || 0) === 0) {
    throw new Error(
      'BACKUP_EMPTY_DB_ERROR: دیتابیس فاقد کاربران یا تنظیمات پایه است؛ پشتیبان‌گیری از وضعیت ناقص متوقف شد.'
    );
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  const sqlLines: string[] = [
    '-- MGAMMON Duo Verified SQL Backup',
    `-- Database: ${cfg.database}`,
    `-- Created At: ${new Date().toISOString()}`,
    'SET NAMES utf8mb4;',
    "SET time_zone = '+03:30';",
    'SET FOREIGN_KEY_CHECKS = 0;',
    'START TRANSACTION;',
    '',
  ];

  for (const tbl of BACKUP_TABLES_ORDERED) {
    const [rows] = await p.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${tbl}\``);
    const plainRows = rows.map((r) => ({ ...r }));
    tables[tbl] = plainRows;

    sqlLines.push(`-- Table: ${tbl} (${plainRows.length} rows)`);
    sqlLines.push(`DELETE FROM \`${tbl}\`;`);
    for (const row of plainRows) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const valList = cols.map((c) => escapeSqlValue(row[c])).join(', ');
      sqlLines.push(`INSERT INTO \`${tbl}\` (${colList}) VALUES (${valList});`);
    }
    sqlLines.push('');
  }

  sqlLines.push('COMMIT;');
  sqlLines.push('SET FOREIGN_KEY_CHECKS = 1;');
  const sqlDump = sqlLines.join('\n');

  const mediaFiles: BackupMediaFileEntry[] = [];
  let mediaTotalBytes = 0;

  if (fs.existsSync(privateMediaDir)) {
    for (const folder of PRIVATE_MEDIA_SUBFOLDERS) {
      const folderPath = path.join(privateMediaDir, folder);
      if (!fs.existsSync(folderPath)) continue;
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(folderPath, entry.name);
        const buf = fs.readFileSync(fullPath);
        if (buf.length === 0) continue;
        const sha256 = computeSha256(buf);
        mediaFiles.push({
          folder,
          fileName: entry.name,
          relativePath: `${folder}/${entry.name}`,
          sizeBytes: buf.length,
          sha256,
          base64Data: buf.toString('base64'),
        });
        mediaTotalBytes += buf.length;
      }
    }
  }

  const payloadString = JSON.stringify({ tables, mediaFiles, sqlDump });
  const payloadChecksum = computeSha256(payloadString);

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const backupId = `mgbackup_${cfg.database}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`;

  const manifest: BackupManifest = {
    backupId,
    formatVersion: 1,
    createdAt: now.toISOString(),
    database: cfg.database,
    tableCounts: metrics.tableCounts,
    financialSums: metrics.financialSums,
    mediaFilesCount: mediaFiles.length,
    mediaTotalBytes,
    payloadChecksum,
  };

  const archiveBundle: BackupArchiveBundle = {
    manifest,
    tables,
    mediaFiles,
    sqlDump,
  };

  const backupFilePath = path.join(backupDir, `${backupId}.mgbackup.json`);
  const tmpFilePath = `${backupFilePath}.tmp`;
  const sqlDumpFilePath = path.join(backupDir, `${backupId}.sql`);

  const serializedArchive = JSON.stringify(archiveBundle, null, 2);
  fs.writeFileSync(tmpFilePath, serializedArchive, { mode: 0o600 });

  // راستی‌آزمایی فایل نوشته‌شده پیش از نهایی‌سازی (جلوگیری از پذیرش فایل خالی یا ناقص)
  const verification = verifyBackupArchive(tmpFilePath);
  if (!verification.valid) {
    try {
      fs.unlinkSync(tmpFilePath);
    } catch {
      // ignore
    }
    throw new Error(
      `BACKUP_VERIFICATION_FAILED: پشتیبان‌گیری ناموفق بود (${verification.reason})`
    );
  }

  fs.renameSync(tmpFilePath, backupFilePath);
  fs.writeFileSync(sqlDumpFilePath, sqlDump, { mode: 0o600 });

  // چرخش خودکار نسخه‌های قدیمی در صورت تعیین سقف نگهداری
  const maxRetained = options?.maxRetainedBackups ?? 30;
  if (maxRetained > 0) {
    pruneOldBackups(backupDir, maxRetained);
  }

  const stat = fs.statSync(backupFilePath);
  return {
    backupFilePath,
    sqlDumpFilePath,
    manifest,
    sizeBytes: stat.size,
  };
}

/**
 * بررسی صحت، کامل بودن و تطابق امضای دیجیتال (SHA-256 Checksum) فایل پشتیبان
 * صرف وجود یک فایل خالی یا ناقص هرگز به عنوان پشتیبان معتبر پذیرفته نمی‌شود.
 */
export function verifyBackupArchive(backupFilePath: string): {
  valid: boolean;
  reason?: string;
  manifest?: BackupManifest;
} {
  try {
    if (!fs.existsSync(backupFilePath)) {
      return { valid: false, reason: 'فایل پشتیبان یافت نشد.' };
    }

    const stat = fs.statSync(backupFilePath);
    if (!stat.isFile() || stat.size < 128) {
      return { valid: false, reason: 'فایل پشتیبان خالی یا ناقص است.' };
    }

    const rawText = fs.readFileSync(backupFilePath, 'utf8');
    if (!rawText || !rawText.trim().startsWith('{') || !rawText.trim().endsWith('}')) {
      return { valid: false, reason: 'محتوای فایل پشتیبان ناقص یا بریده‌شده (Truncated) است.' };
    }

    const parsed = JSON.parse(rawText) as Partial<BackupArchiveBundle>;
    if (!parsed.manifest || !parsed.tables || !Array.isArray(parsed.mediaFiles) || typeof parsed.sqlDump !== 'string') {
      return { valid: false, reason: 'ساختار داخلی فایل پشتیبان فاقد بخش‌های اجباری است.' };
    }

    const { manifest, tables, mediaFiles, sqlDump } = parsed as BackupArchiveBundle;
    if (!manifest.payloadChecksum || !manifest.tableCounts || !manifest.financialSums) {
      return { valid: false, reason: 'متادیتای مانیفست پشتیبان ناقص است.' };
    }

    for (const tbl of BACKUP_TABLES_ORDERED) {
      if (!Array.isArray(tables[tbl])) {
        return { valid: false, reason: `جدول اجباری ${tbl} در نسخه پشتیبان وجود ندارد.` };
      }
      if (tables[tbl].length !== manifest.tableCounts[tbl]) {
        return {
          valid: false,
          reason: `تعداد رکوردهای جدول ${tbl} (${tables[tbl].length}) با مانیفست (${manifest.tableCounts[tbl]}) همخوانی ندارد.`,
        };
      }
    }

    const activeFinRows = (tables.financial_transactions || []).filter(
      (r) => r.deleted_at === null || r.deleted_at === undefined
    );
    const actualTotalAmount = activeFinRows.reduce(
      (acc, r) => acc + Number(r.amount_toman || 0),
      0
    );
    if (actualTotalAmount !== Number(manifest.financialSums.totalAmountToman || 0)) {
      return {
        valid: false,
        reason: `جمع مبالغ مالی در رکوردها (${actualTotalAmount}) با مانیفست (${manifest.financialSums.totalAmountToman}) مطابقت ندارد.`,
      };
    }

    if ((tables.users?.length || 0) === 0 || (tables.system_settings?.length || 0) === 0) {
      return {
        valid: false,
        reason: 'نسخه پشتیبان فاقد کاربران یا تنظیمات سامانه است.',
      };
    }

    const expectedChecksum = computeSha256(JSON.stringify({ tables, mediaFiles, sqlDump }));
    if (expectedChecksum !== manifest.payloadChecksum) {
      return {
        valid: false,
        reason: 'عدم تطابق امضای دیجیتال (SHA-256 Checksum)؛ فایل پشتیبان خراب یا دستکاری شده است.',
      };
    }

    for (const mf of mediaFiles) {
      const buf = Buffer.from(mf.base64Data || '', 'base64');
      if (buf.length !== mf.sizeBytes || computeSha256(buf) !== mf.sha256) {
        return {
          valid: false,
          reason: `فایل پیوست ${mf.relativePath} در بسته پشتیبان خراب شده است.`,
        };
      }
    }

    return {
      valid: true,
      manifest,
    };
  } catch (err) {
    return {
      valid: false,
      reason: `خطا در خواندن یا اعتبارسنجی فایل پشتیبان: ${(err as Error).message}`,
    };
  }
}

/**
 * بازیابی اتمیک و کامل دیتابیس و فایل‌های خصوصی از نسخه پشتیبان به همراه راستی‌آزمایی تعداد رکوردها و جمع مبالغ
 */
export async function restoreFromBackupArchive(
  backupFilePath: string,
  options?: {
    targetMediaDir?: string;
    customPool?: mysql.Pool;
    allowLiveDatabaseRestore?: boolean;
  }
): Promise<{
  restoredManifest: BackupManifest;
  postRestoreMetrics: DatabaseIntegrityMetrics;
  restoredMediaFilesCount: number;
}> {
  const cfg = getDbConfig();
  if (cfg.database === 'mgammon_duo' && !options?.allowLiveDatabaseRestore) {
    throw new Error(
      'SAFETY_GUARD: بازیابی مستقیم روی دیتابیس اصلی بدون فعال‌سازی صریح پرچم allowLiveDatabaseRestore مجاز نیست.'
    );
  }

  const verification = verifyBackupArchive(backupFilePath);
  if (!verification.valid) {
    throw new Error(
      `RESTORE_ABORTED_INVALID_BACKUP: فایل پشتیبان معتبر نیست (${verification.reason})`
    );
  }

  const archive = JSON.parse(fs.readFileSync(backupFilePath, 'utf8')) as BackupArchiveBundle;
  const p = options?.customPool || getPool();
  const targetMediaDir =
    options?.targetMediaDir ||
    path.resolve(process.cwd(), '.data/private_media');

  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // پاکسازی جداول به ترتیب معکوس وابستگی کلید خارجی
    for (const tbl of [...BACKUP_TABLES_ORDERED].reverse()) {
      await conn.query(`DELETE FROM \`${tbl}\``);
    }

    // درج مجدد تمام رکوردها به ترتیب صحیح وابستگی
    for (const tbl of BACKUP_TABLES_ORDERED) {
      const rows = archive.tables[tbl] || [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const colNamesSql = cols.map((c) => `\`${c}\``).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map((c) => normalizeRowValueForInsert(row[c], c));
        await conn.execute(
          `INSERT INTO \`${tbl}\` (${colNamesSql}) VALUES (${placeholders})`,
          values as (string | number | null)[]
        );
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
  } catch (err) {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      await conn.rollback();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    conn.release();
  }

  // بازیابی فایل‌های خصوصی پیوست و بررسی SHA-256 هر فایل
  let restoredMediaFilesCount = 0;
  for (const folder of PRIVATE_MEDIA_SUBFOLDERS) {
    fs.mkdirSync(path.join(targetMediaDir, folder), { recursive: true, mode: 0o700 });
  }

  for (const mf of archive.mediaFiles) {
    if (!PRIVATE_MEDIA_SUBFOLDERS.includes(mf.folder as (typeof PRIVATE_MEDIA_SUBFOLDERS)[number])) {
      continue;
    }
    const safeFileName = path.basename(mf.fileName);
    const destPath = path.join(targetMediaDir, mf.folder, safeFileName);
    const buf = Buffer.from(mf.base64Data, 'base64');
    if (computeSha256(buf) !== mf.sha256) {
      throw new Error(`RESTORE_MEDIA_CHECKSUM_MISMATCH: عدم تطابق هش فایل ${mf.relativePath}`);
    }
    fs.writeFileSync(destPath, buf, { mode: 0o600 });
    restoredMediaFilesCount += 1;
  }

  // راستی‌آزمایی پس از بازیابی: مقایسه دقیق تعداد رکوردها و جمع مبالغ مالی با مانیفست اولیه
  const postRestoreMetrics = await collectDatabaseMetrics(p);

  for (const tbl of BACKUP_TABLES_ORDERED) {
    const expectedCnt = archive.manifest.tableCounts[tbl] ?? 0;
    const actualCnt = postRestoreMetrics.tableCounts[tbl] ?? 0;
    if (actualCnt !== expectedCnt) {
      throw new Error(
        `POST_RESTORE_COUNT_MISMATCH: تعداد رکوردهای جدول ${tbl} پس از بازیابی (${actualCnt}) با مقدار پیش از پشتیبان‌گیری (${expectedCnt}) برابر نیست.`
      );
    }
  }

  if (
    postRestoreMetrics.financialSums.totalAmountToman !==
      archive.manifest.financialSums.totalAmountToman ||
    postRestoreMetrics.financialSums.approvedAmountToman !==
      archive.manifest.financialSums.approvedAmountToman ||
    postRestoreMetrics.financialSums.pendingAmountToman !==
      archive.manifest.financialSums.pendingAmountToman
  ) {
    throw new Error(
      'POST_RESTORE_FINANCIAL_SUM_MISMATCH: جمع مبالغ مالی پس از بازیابی با مقادیر پیش از پشتیبان‌گیری تطابق ندارد.'
    );
  }

  return {
    restoredManifest: archive.manifest,
    postRestoreMetrics,
    restoredMediaFilesCount,
  };
}

export function listAvailableBackups(customBackupDir?: string): Array<{
  fileName: string;
  filePath: string;
  sizeBytes: number;
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
}> {
  const backupDir =
    customBackupDir ||
    process.env.BACKUP_DIR ||
    path.resolve(process.cwd(), '.data/backups');

  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mgbackup.json'))
    .sort((a, b) => b.name.localeCompare(a.name));

  return entries.map((e) => {
    const fullPath = path.join(backupDir, e.name);
    const stat = fs.statSync(fullPath);
    const check = verifyBackupArchive(fullPath);
    return {
      fileName: e.name,
      filePath: fullPath,
      sizeBytes: stat.size,
      valid: check.valid,
      manifest: check.manifest,
      error: check.reason,
    };
  });
}

function pruneOldBackups(backupDir: string, maxRetained: number): void {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('.mgbackup.json'))
      .sort((a, b) => b.localeCompare(a));

    if (files.length <= maxRetained) return;
    const toRemove = files.slice(maxRetained);
    for (const f of toRemove) {
      const fullJson = path.join(backupDir, f);
      const fullSql = fullJson.replace(/\.mgbackup\.json$/, '.sql');
      try {
        if (fs.existsSync(fullJson)) fs.unlinkSync(fullJson);
        if (fs.existsSync(fullSql)) fs.unlinkSync(fullSql);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
