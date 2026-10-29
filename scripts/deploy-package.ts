import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const OUTPUT_ZIP_NAME = 'mgammon-duo-cpanel-deploy.zip';
const OUTPUT_ZIP_PATH = path.resolve(ROOT_DIR, OUTPUT_ZIP_NAME);

interface PackResult {
  zipPath: string;
  sizeBytes: number;
  fileCount: number;
  files: { name: string; size: number }[];
}

function runStep(title: string, command: string): void {
  console.log(`\n============================================================`);
  console.log(`[DEPLOY:PACKAGE] ${title}...`);
  console.log(`$ ${command}`);
  console.log(`============================================================`);
  try {
    execSync(command, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } catch (err) {
    console.error(`\n[DEPLOY:PACKAGE ERROR] مرحله "${title}" با خطا مواجه شد.`);
    console.error(`دستور: ${command}`);
    throw new Error(`PRE_PACKAGE_STEP_FAILED: ${title}`);
  }
}

function validatePrePackageArtifacts(): void {
  const requiredFiles = [
    'app.cjs',
    'dist/index.html',
    'dist/manifest.webmanifest',
    'dist/sw.js',
    'database/schema.sql',
    'package.json',
    'package-lock.json',
    '.env.example',
    'DEPLOYMENT_CPANEL.md',
    'scripts/backup-cli.ts',
  ];

  for (const rel of requiredFiles) {
    const full = path.resolve(ROOT_DIR, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`REQUIRED_FILE_MISSING: فایل ضروری "${rel}" یافت نشد.`);
    }
    const stat = fs.statSync(full);
    if (stat.size === 0) {
      throw new Error(`FILE_EMPTY: فایل "${rel}" خالی (۰ بایت) است.`);
    }
  }

  // بررسی عدم نشت فایل‌های باینری تست یا فایل محرمانه .env
  const forbiddenPatterns = ['.env', '.data/mysql', '.data/deb-cache'];
  for (const f of forbiddenPatterns) {
    const full = path.resolve(ROOT_DIR, f);
    if (f === '.env' && fs.existsSync(full)) {
      console.warn(`[DEPLOY:PACKAGE WARNING] فایل .env در ریشه پروژه وجود دارد؛ این فایل به‌طور صریح از بسته ZIP مستثنی خواهد شد.`);
    }
  }
}

function buildZipPackage(): PackResult {
  console.log(`\n============================================================`);
  console.log(`[DEPLOY:PACKAGE] ایجاد فایل فشرده ${OUTPUT_ZIP_NAME}...`);
  console.log(`============================================================`);

  const pyScriptPath = path.resolve(ROOT_DIR, 'scripts/package-zip.py');
  if (!fs.existsSync(pyScriptPath)) {
    throw new Error(`SCRIPT_MISSING: فایل اسکریپت "${pyScriptPath}" یافت نشد.`);
  }

  const rawOutput = execSync(`python3 "${pyScriptPath}"`, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });

  const result: PackResult = JSON.parse(rawOutput.trim());

  if (!fs.existsSync(OUTPUT_ZIP_PATH)) {
    throw new Error('ZIP_CREATION_FAILED: فایل ZIP ساخته نشد.');
  }

  // اعتبارسنجی ایمنی: اطمینان ۱۰۰٪ از عدم وجود فایل‌های ممنوعه
  for (const item of result.files) {
    const lower = item.name.toLowerCase();
    if (lower.startsWith('.env') && lower !== '.env.example') {
      throw new Error(`SECURITY_BREACH_DETECTED: فایل حساس ${item.name} در بسته قرار گرفته است!`);
    }
    if (lower.includes('node_modules/') || lower.includes('.data/') || lower.includes('tests/')) {
      throw new Error(`FORBIDDEN_FILE_DETECTED: مسیر غیرمجاز ${item.name} در بسته قرار گرفته است!`);
    }
  }

  return result;
}

export function main(): void {
  const skipChecks = process.argv.includes('--skip-checks');

  if (!skipChecks) {
    // ۱. بررسی صحت تایپ‌ها و عدم وجود خطای کامپایل
    runStep('اعتبارسنجی تایپ‌اسکریپت (lint)', 'npm run lint');

    // ۲. اجرای تمام آزمون‌های خودکار پروژه (test)
    runStep('اجرای آزمون‌های خودکار پروژه (test)', 'npm test');

    // ۳. ساخت بیلد نهایی فرانت‌اند و سرور cPanel
    runStep('ساخت بیلد Production (build)', 'npm run build');
  } else {
    console.warn('[DEPLOY:PACKAGE] هشدار: بررسی‌های پیش‌از بیلد به دلیل پرچم --skip-checks نادیده گرفته شد.');
  }

  // ۴. بررسی صحت فایل‌های خروجی مورد نیاز
  validatePrePackageArtifacts();

  // ۵. ایجاد فایل ZIP بسته استقرار
  const result = buildZipPackage();

  console.log(`\n============================================================`);
  console.log(`[DEPLOY:PACKAGE SUCCESS] بسته استقرار cPanel با موفقیت ساخته شد.`);
  console.log(`============================================================`);
  console.log(`مسیر فایل ZIP: ${result.zipPath}`);
  console.log(`حجم فایل: ${(result.sizeBytes / 1024).toFixed(1)} KB (${result.sizeBytes} بایت)`);
  console.log(`تعداد فایل‌های داخل بسته: ${result.fileCount}`);
  console.log(`\nفهرست فایل‌های موجود در بسته:`);
  for (const f of result.files) {
    console.log(`  - ${f.name} (${f.size} بایت)`);
  }
  console.log(`============================================================\n`);
}

main();
