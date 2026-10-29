import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';
import {
  getPool,
  initializeDatabase,
  isDatabaseInitialized,
  migrateLegacyPublicMediaToPrivate,
  sanitizeDbErrorMessage,
  validateProductionSecurityConfig,
  waitForPendingDatabaseInit,
} from './src/server/db';
import { getSessionUser, requireCsrfProtection } from './src/server/auth';
import { apiRouter } from './src/server/routes';

const PRIVATE_MEDIA_FOLDERS = new Set([
  'avatars',
  'attachments',
  'excel',
  'audio',
  'receipts',
  'reports',
]);

export async function createApp() {
  validateProductionSecurityConfig(process.env);
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // هدرهای امنیتی استاندارد
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
    next();
  });

  // مسدودسازی کامل دسترسی وب به مسیرهای مخفی، پشتیبان‌ها و اسکریپت‌های دیتابیس
  app.use((req, res, next) => {
    const cleanPath = decodeURIComponent(req.path || '').toLowerCase();
    if (
      cleanPath.startsWith('/.data') ||
      cleanPath.startsWith('/backups') ||
      cleanPath.startsWith('/database') ||
      cleanPath.includes('/.env')
    ) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'دسترسی مستقیم به فایل‌های سیستمی و پشتیبان مجاز نیست.',
      });
      return;
    }
    next();
  });

  // اطمینان از وجود پوشه‌های ذخیره فایل خصوصی خارج از مسیر عمومی وب (.data/private_media)
  const privateBaseDir = path.resolve(process.cwd(), '.data/private_media');
  const legacyPublicMediaDir = path.resolve(process.cwd(), 'public/assets/media');
  for (const folder of PRIVATE_MEDIA_FOLDERS) {
    try {
      fs.mkdirSync(path.join(privateBaseDir, folder), { recursive: true, mode: 0o700 });
    } catch {
      // ignore
    }
  }
  migrateLegacyPublicMediaToPrivate();

  // گیت آمادگی دیتابیس: هیچ درخواست وابسته به دیتابیس پیش از تکمیل initializeDatabase پذیرفته نمی‌شود
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }
    if (!isDatabaseInitialized()) {
      await waitForPendingDatabaseInit();
    }
    if (!isDatabaseInitialized()) {
      res.status(503).json({
        ok: false,
        dbConnected: false,
        code: 'DB_UNAVAILABLE',
        message: 'پایگاه داده هنوز آماده بهره‌برداری نیست یا ارتباط با سرور برقرار نشد.',
      });
      return;
    }
    next();
  });

  // محافظت CSRF روی مسیرهای تغییردهنده API
  app.use('/api', requireCsrfProtection, apiRouter);

  // محافظت از فایل‌ها و پیوست‌های خصوصی پیش از express.static
  app.get('/assets/media/:folder/:filename', async (req, res) => {
    try {
      const folder = String(req.params.folder || '').trim();
      const filename = String(req.params.filename || '').trim();

      if (
        !PRIVATE_MEDIA_FOLDERS.has(folder) ||
        !filename ||
        filename.includes('..') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('\0')
      ) {
        res.status(400).json({ ok: false, message: 'مسیر فایل معتبر نیست.' });
        return;
      }

      if (!isDatabaseInitialized()) {
        res.status(503).json({
          ok: false,
          code: 'DB_UNAVAILABLE',
          message: 'ارتباط با پایگاه داده برقرار نیست.',
        });
        return;
      }

      const session = await getSessionUser(req);
      if (!session) {
        res.status(401).json({
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'دسترسی مستقیم بدون احراز هویت به فایل‌های خصوصی مجاز نیست.',
        });
        return;
      }

      const fileUrl = `/assets/media/${folder}/${filename}`;
      const pool = getPool();

      if (session.user.role !== 'manager') {
        let authorized = false;
        const uid = session.user.id;

        if (folder === 'receipts') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM financial_transactions WHERE receipt_file_url = ? AND user_id = ? LIMIT 1',
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === 'reports') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM daily_work_reports WHERE photo_url = ? AND user_id = ? LIMIT 1',
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === 'excel') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM historical_work_records WHERE excel_file_url = ? AND user_id = ? LIMIT 1',
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === 'audio') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM work_correspondences WHERE audio_url = ? AND (sender_user_id = ? OR receiver_user_id = ?) LIMIT 1',
            [fileUrl, uid, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === 'attachments') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM work_correspondences WHERE attachments_json LIKE ? AND (sender_user_id = ? OR receiver_user_id = ?) LIMIT 1',
            [`%${filename}%`, uid, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === 'avatars') {
          const [rows] = await pool.execute<mysql.RowDataPacket[]>(
            'SELECT id FROM users WHERE avatar_url = ? LIMIT 1',
            [fileUrl]
          );
          authorized = rows.length > 0;
        }

        if (!authorized) {
          res.status(403).json({
            ok: false,
            code: 'FORBIDDEN',
            message: 'شما مجوز دسترسی به این فایل خصوصی را ندارید.',
          });
          return;
        }
      }

      const activePrivateBase = process.env.PRIVATE_MEDIA_DIR
        ? path.resolve(process.cwd(), process.env.PRIVATE_MEDIA_DIR)
        : privateBaseDir;

      const candidatePrivate = path.resolve(activePrivateBase, folder, filename);
      const candidateLegacy = path.resolve(legacyPublicMediaDir, folder, filename);

      if (
        !candidatePrivate.startsWith(path.resolve(activePrivateBase, folder)) ||
        !candidateLegacy.startsWith(path.resolve(legacyPublicMediaDir, folder))
      ) {
        res.status(400).json({ ok: false, message: 'مسیر فایل نامعتبر است.' });
        return;
      }

      const targetPath = fs.existsSync(candidatePrivate)
        ? candidatePrivate
        : fs.existsSync(candidateLegacy)
          ? candidateLegacy
          : null;

      if (!targetPath) {
        res.status(404).json({ ok: false, message: 'فایل مورد نظر یافت نشد.' });
        return;
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.sendFile(targetPath);
    } catch {
      res.status(500).json({ ok: false, message: 'خطا در بازیابی فایل.' });
    }
  });

  // مسدودسازی هرگونه دسترسی مستقیم دیگر به زیرپوشه‌های خصوصی
  app.use('/assets/media/:folder', (req, res, next) => {
    const folder = String(req.params.folder || '').trim();
    if (PRIVATE_MEDIA_FOLDERS.has(folder)) {
      res.status(403).json({ ok: false, message: 'دسترسی مستقیم به پوشه خصوصی مجاز نیست.' });
      return;
    }
    next();
  });

  // سرو کردن فایل‌های استاتیک عمومی پوشه public (مانند بنر و آیکون‌های پیش‌فرض)
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  return app;
}

export async function startServer() {
  validateProductionSecurityConfig(process.env);

  // ۱. شروع فوری آماده‌سازی دیتابیس به صورت همزمان تا پورت 3000 بلافاصله باز شود و درخواست‌های API منتظر اتمام آن بمانند
  initializeDatabase()
    .then(() => {
      console.log(
        '[MGAMMON Duo] MySQL/MariaDB database initialized and verified prior to accepting requests.'
      );
    })
    .catch((err) => {
      console.error(
        '[MGAMMON Duo] Database initialization failed during startup:',
        sanitizeDbErrorMessage(err)
      );
    });

  const app = await createApp();
  const PORT = Number(process.env.PORT || 3000);

  const isBundledRuntime =
    (typeof __filename === 'string' && path.basename(__filename) === 'app.cjs') ||
    (process.argv[1] ? path.basename(process.argv[1]) === 'app.cjs' : false);
  const isProductionMode = process.env.NODE_ENV === 'production' || isBundledRuntime;

  if (!isProductionMode) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use('/api', (_req, res) => {
      res.status(404).json({
        ok: false,
        code: 'NOT_FOUND',
        message: 'مسیر وب‌سرویس مورد نظر یافت نشد.',
      });
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MGAMMON Duo] Server running on http://0.0.0.0:${PORT}`);
  });

  return server;
}

// اجرا در صورتی که مستقیماً فراخوانی شده باشد (و نه در حین ایمپورت تست‌ها)
if (process.env.VITEST !== 'true') {
  startServer();
}
