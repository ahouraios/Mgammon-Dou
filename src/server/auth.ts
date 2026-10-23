import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { getPool } from './db';
import { UserProfile, UserRole } from '../shared/types';

export const SESSION_COOKIE_NAME = 'mgammon_duo_sid';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // ۷ روز

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionTokenHash?: string;
}

export function hashSessionToken(rawToken: string): string {
  const secret = process.env.SESSION_SECRET || 'mgammon-duo-default-server-secret-2026';
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

export async function createServerSession(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  const pool = getPool();
  await pool.execute(
    'INSERT INTO user_sessions (token_hash, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
    [tokenHash, userId, ipAddress ? ipAddress.slice(0, 64) : null, userAgent ? userAgent.slice(0, 255) : null, expiresAt]
  );

  return { rawToken, expiresAt };
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: Date): void {
  const isSecure = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https'));
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  const isSecure = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https'));
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    path: '/',
  });
}

export async function getSessionUser(req: Request): Promise<{ user: UserProfile; tokenHash: string } | null> {
  const rawToken =
    req.cookies?.[SESSION_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null);

  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const pool = getPool();

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT u.id, u.username, u.full_name, u.role, u.avatar_url, u.collaboration_start_shamsi, u.phone_number, u.biometric_token_hash, u.last_login_at, s.expires_at
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.is_active = 1
     LIMIT 1`,
    [tokenHash]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }

  return {
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
    req.user = session.user;
    req.sessionTokenHash = session.tokenHash;
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
  const errObj = err as { code?: string; message?: string };
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
    errObj?.message === 'DATABASE_CONNECTION_LOST'
  ) {
    res.status(503).json({
      ok: false,
      code: 'DB_UNAVAILABLE',
      message: 'ارتباط با سرور برقرار نیست. لطفاً اتصال را بررسی کنید.',
    });
    return;
  }

  console.error('[MGAMMON Server Error]:', errObj?.message || 'Unknown error');
  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'خطایی در پردازش درخواست رخ داد. لطفاً مجدداً تلاش کنید.',
  });
}
