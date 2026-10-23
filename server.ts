import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { initializeDatabase } from './src/server/db';
import { apiRouter } from './src/server/routes';

export async function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());

  // هدرهای امنیتی پایه
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // اطمینان از وجود پوشه‌های ذخیره فایل و رسانه در assets/media
  const mediaDirs = [
    path.resolve(process.cwd(), 'public/assets/media'),
    path.resolve(process.cwd(), 'public/assets/media/avatars'),
    path.resolve(process.cwd(), 'public/assets/media/attachments'),
    path.resolve(process.cwd(), 'public/assets/media/excel'),
    path.resolve(process.cwd(), 'public/assets/media/audio'),
  ];
  for (const dir of mediaDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  }

  // مسیرهای API
  app.use('/api', apiRouter);

  // سرو کردن فایل‌های استاتیک پوشه public و assets/media
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.use('/assets/media', express.static(path.resolve(process.cwd(), 'public/assets/media')));

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
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
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MGAMMON Duo] Server running on http://0.0.0.0:${PORT}`);
  });

  initializeDatabase()
    .then(() => {
      console.log('[MGAMMON Duo] MySQL/MariaDB database initialized and verified.');
    })
    .catch((err) => {
      console.error(
        '[MGAMMON Duo] Warning: Initial MySQL connection failed:',
        (err as Error).message
      );
    });
}

// اجرا در صورتی که مستقیماً فراخوانی شده باشد (و نه در حین ایمپورت تست‌ها)
if (process.env.VITEST !== 'true') {
  startServer();
}

