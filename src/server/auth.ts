import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import {
  FORBIDDEN_DEFAULT_SECRETS,
  getPool,
  validateProductionSecurityConfig,
} from './db';
import { UserProfile, UserRole } from '../shared/types';

export const SESSION_COOKIE_NAME = 'mgammon_duo_sid';
export const CSRF_COOKIE_NAME = 'mgammon_csrf_token';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // ۷ روز

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionTokenHash?: string;
  rawSessionToken?: string;
}

export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  validateProductionSecurityConfig(env);
  const raw = (env.SESSION_SECRET || '').trim();
  if (raw && raw !== 'undefined' && !FORBIDDEN_DEFAULT_SECRETS.has(raw) && raw.length >= 32) {
    return raw;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SECURITY_CONFIG_ERROR: SESSION_SECRET در محیط عملیاتی تنظیم نشده یا ناامن است.'
    );
  }
  return 'mgammon-duo-dev-only-ephemeral-secret-key-2026-local';
}

export function hashSessionToken(rawToken: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

export function generateCsrfToken(rawSessionToken: string): string {
  const secret = getSessionSecret();
  return crypto
    .createHmac('sha256', `${secret}:csrf-protection`)
    .update(rawSessionToken)
    .digest('hex');
}

export async function createServerSession(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null
): Promise<{ rawToken: string; csrfToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = generateCsrfToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  const pool = getPool();
  await pool.execute(
    'INSERT INTO user_sessions (token_hash, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
    [
      tokenHash,
      userId,
      ipAddress ? ipAddress.slice(0, 64) : null,
      userAgent ? userAgent.slice(0, 255) : null,
      expiresAt,
    ]
  );

  return { rawToken, csrfToken, expiresAt };
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: Date): string {
  const isSecure =
    process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https://'));
  const csrfToken = generateCsrfToken(rawToken);

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  res.setHeader('X-CSRF-Token', csrfToken);
  return csrfToken;
}

export function clearSessionCookie(res: Response): void {
  const isSecure =
    process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https://'));
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
  });
}

// ============================================================================
// محدودکننده تلاش ورود ناموفق (Brute-Force Protection)
// ============================================================================
interface LoginAttemptState {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const loginAttemptsMap = new Map<string, LoginAttemptState>();
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // ۱۵ دقیقه
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // ۱۵ دقیقه

function getLoginAttemptKey(ip: string, username: string): string {
  return `${ip || 'unknown'}:${username.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(
  ip: string,
  username: string
): { allowed: boolean; retryAfterSeconds: number; attempts: number } {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const entry = loginAttemptsMap.get(key);
  if (!entry) {
    return { allowed: true, retryAfterSeconds: 0, attempts: 0 };
  }
  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      attempts: entry.count,
    };
  }
  if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptsMap.delete(key);
    return { allowed: true, retryAfterSeconds: 0, attempts: 0 };
  }
  return { allowed: true, retryAfterSeconds: 0, attempts: entry.count };
}

export async function recordFailedLoginAttempt(
  ip: string,
  username: string
): Promise<{ locked: boolean; attempts: number; retryAfterSeconds: number }> {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const existing = loginAttemptsMap.get(key);

  let state: LoginAttemptState;
  if (!existing || now - existing.firstAttemptAt > LOGIN_WINDOW_MS) {
    state = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    state = {
      ...existing,
      count: existing.count + 1,
    };
  }

  if (state.count >= MAX_FAILED_LOGIN_ATTEMPTS) {
    state.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }

  loginAttemptsMap.set(key, state);

  // تأخیر تدریجی برای مقابله با حملات حدس رمز عبور
  const delayMs = Math.min(400, state.count * 75);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    locked: state.lockedUntil > now,
    attempts: state.count,
    retryAfterSeconds: state.lockedUntil > now ? Math.ceil(LOGIN_LOCKOUT_MS / 1000) : 0,
  };
}

export function clearLoginAttempts(ip: string, username: string): void {
  const key = getLoginAttemptKey(ip, username);
  loginAttemptsMap.delete(key);
}

export function resetAllLoginRateLimits(): void {
  loginAttemptsMap.clear();
}

// ============================================================================
// محافظت در برابر CSRF و اعتبارسنجی Origin برای درخواست‌های تغییردهنده داده با کوکی
// ============================================================================
export function requireCsrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method.toUpperCase())) {
    next();
    return;
  }

  // ۱. بررسی Origin در صورت ارسال شدن توسط مرورگر
  const originHeader = req.headers.origin;
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  if (originHeader && hostHeader) {
    try {
      const originUrl = new URL(String(originHeader));
      const allowedHost = String(hostHeader).split(',')[0].trim();
      let appUrlHost = '';
      if (process.env.APP_URL) {
        try {
          appUrlHost = new URL(process.env.APP_URL).host;
        } catch {
          appUrlHost = '';
        }
      }
      if (originUrl.host !== allowedHost && (!appUrlHost || originUrl.host !== appUrlHost)) {
        res.status(403).json({
          ok: false,
          code: 'CSRF_ORIGIN_MISMATCH',
          message: 'درخواست از مبدأ غیرمجاز (Origin نامعتبر) مسدود شد.',
        });
        return;
      }
    } catch {
      res.status(403).json({
        ok: false,
        code: 'CSRF_ORIGIN_INVALID',
        message: 'هدر Origin درخواست معتبر نیست.',
      });
      return;
    }
  }

  // ۲. اگر احراز هویت با کوکی انجام شده است (بدون هدر صریح Authorization: Bearer)
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const hasBearerHeader = Boolean(req.headers.authorization?.startsWith('Bearer '));
  const publicAuthPaths = ['/auth/login', '/auth/biometric/login'];

  if (cookieToken && !hasBearerHeader && !publicAuthPaths.includes(req.path)) {
    const clientCsrf = String(req.headers['x-csrf-token'] || '').trim();
    const expectedCsrf = generateCsrfToken(String(cookieToken));
    if (
      !clientCsrf ||
      clientCsrf.length !== expectedCsrf.length ||
      !crypto.timingSafeEqual(Buffer.from(clientCsrf), Buffer.from(expectedCsrf))
    ) {
      res.status(403).json({
        ok: false,
        code: 'CSRF_TOKEN_INVALID',
        message: 'توکن امنیتی CSRF ارسال نشده یا نامعتبر است.',
      });
      return;
    }
  }

  next();
}

export async function getSessionUser(
  req: Request
): Promise<{ user: UserProfile; tokenHash: string; rawToken: string } | null> {
  const queryToken =
    req.method === 'GET' && typeof req.query?.token === 'string'
      ? req.query.token.trim()
      : null;

  const rawToken =
    req.cookies?.[SESSION_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null) ||
    queryToken;

  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const pool = getPool();

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT u.id, u.username, u.full_name, u.role, u.avatar_url, u.collaboration_start_shamsi, u.phone_number, u.biometric_token_hash, u.must_change_password, u.is_active, u.last_login_at, s.expires_at
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  if (!row.is_active) {
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [row.id]);
    return null;
  }

  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }

  return {
    rawToken,
    tokenHash,
    user: {
      id: Number(row.id),
      username: String(row.username),
      full_name: String(row.full_name),
      role: row.role as UserRole,
      avatar_url: row.avatar_url ? String(row.avatar_url) : null,
      collaboration_start_shamsi: row.collaboration_start_shamsi
        ? String(row.collaboration_start_shamsi)
        : '1405/06/15',
      phone_number: row.phone_number ? String(row.phone_number) : null,
      biometric_enabled: Boolean(row.biometric_token_hash),
      must_change_password: Boolean(row.must_change_password),
      last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    },
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'نشست کاربری شما منقضی شده یا وارد حساب نشده‌اید.',
      });
      return;
    }

    const enforceInitialPassChange =
      process.env.NODE_ENV === 'production' ||
      process.env.ENFORCE_PASSWORD_CHANGE === 'true' ||
      req.headers['x-enforce-password-change'] === '1';

    const allowedDuringPassChange = ['/auth/change-password', '/auth/logout', '/auth/me'];
    if (
      enforceInitialPassChange &&
      session.user.must_change_password &&
      !allowedDuringPassChange.includes(req.path)
    ) {
      res.status(403).json({
        ok: false,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'به دلایل امنیتی، پیش از ادامه کار باید رمز عبور اولیه خود را تغییر دهید.',
      });
      return;
    }

    req.user = session.user;
    req.sessionTokenHash = session.tokenHash;
    req.rawSessionToken = session.rawToken;
    next();
  } catch (err) {
    handleServerError(res, err);
  }
}

export function requireRole(allowedRole: UserRole) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        const session = await getSessionUser(req);
        if (!session) {
          res.status(401).json({
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'لطفاً ابتدا وارد حساب کاربری شوید.',
          });
          return;
        }
        req.user = session.user;
        req.sessionTokenHash = session.tokenHash;
        req.rawSessionToken = session.rawToken;
      }

      if (req.user.role !== allowedRole) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          message: 'شما مجوز دسترسی به این بخش یا انجام این عملیات را ندارید.',
        });
        return;
      }

      next();
    } catch (err) {
      handleServerError(res, err);
    }
  };
}

export async function recordAuditLog(params: {
  actorUserId: number | null;
  actionType: string;
  targetEntity: string;
  targetId?: number | null;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  connection?: mysql.PoolConnection;
}): Promise<void> {
  const executor = params.connection || getPool();
  await executor.execute(
    `INSERT INTO audit_logs
      (actor_user_id, action_type, target_entity, target_id, before_state, after_state, reason, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.actorUserId,
      params.actionType,
      params.targetEntity,
      params.targetId ?? null,
      params.beforeState !== undefined ? JSON.stringify(params.beforeState) : null,
      params.afterState !== undefined ? JSON.stringify(params.afterState) : null,
      params.reason ?? null,
      params.ipAddress ? params.ipAddress.slice(0, 64) : null,
    ]
  );
}

export function handleServerError(res: Response, err: unknown): void {
  const errObj = err as { code?: string; message?: string; statusCode?: number };
  if (errObj?.statusCode && errObj.statusCode >= 400 && errObj.statusCode < 500) {
    res.status(errObj.statusCode).json({
      ok: false,
      code: errObj.code || 'VALIDATION_ERROR',
      message: errObj.message || 'ورودی نامعتبر است.',
    });
    return;
  }

  const dbErrorCodes = [
    'ECONNREFUSED',
    'PROTOCOL_CONNECTION_LOST',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
    'ETIMEDOUT',
    'ENOTFOUND',
  ];

  if (
    (errObj?.code && dbErrorCodes.includes(errObj.code)) ||
    errObj?.message === 'DATABASE_CONNECTION_LOST' ||
    errObj?.message === 'SIMULATED_DB_DISCONNECT'
  ) {
    res.status(503).json({
      ok: false,
      code: 'DB_UNAVAILABLE',
      message: 'ارتباط با سرور برقرار نیست. لطفاً اتصال را بررسی کنید.',
    });
    return;
  }

  // ثبت خطای عمومی بدون افشای رمز، توکن یا جزئیات محرمانه
  const safeMsg = (errObj?.message || 'Unknown error').replace(
    /(password|token|secret|authorization)=[^\s&]+/gi,
    '$1=[REDACTED]'
  );
  console.error('[MGAMMON Server Error]:', safeMsg);
  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'خطایی در پردازش درخواست رخ داد. لطفاً مجدداً تلاش کنید.',
  });
}
