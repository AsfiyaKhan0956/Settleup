import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SESSION_COOKIE_NAME = 'settleup_sid';
const SCRYPT_KEYLEN = 64;

function getSecret(): string {
  return process.env.SESSION_SECRET || 'settleup-dev-secret-do-not-use-in-prod-change-me';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', getSecret()).update(rawToken).digest('hex');
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  return Boolean(req.secure || process.env.NODE_ENV === 'production');
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, rememberMe: boolean): void {
  const maxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
  });
}

export function readSessionCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[SESSION_COOKIE_NAME] ?? null;
}

export function readSessionToken(req: Request): string | null {
  const cookieToken = readSessionCookie(req);
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return null;
}

/**
 * Simple in-memory sliding-window rate limiter to protect auth & AI routes.
 */
export function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

/**
 * Origin / CSRF check for state-changing API requests.
 */
export function verifySameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  const forwardedHostRaw = req.headers['x-forwarded-host'];
  const forwardedHost =
    typeof forwardedHostRaw === 'string' ? forwardedHostRaw.split(',')[0].trim() : undefined;

  if (origin && (host || forwardedHost)) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && originHost !== forwardedHost) {
        res.status(403).json({ error: 'Cross-origin mutation blocked.' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid request origin.' });
      return;
    }
  }
  next();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Normalizes a phone number by stripping spaces, dashes, and parentheses while preserving leading '+'.
 * Returns null if invalid.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return null;
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^[0-9]{10}$/.test(cleaned)) {
    // 10-digit local mobile number -> normalize to +91 (default INR context) if no country code supplied
    return `+91${cleaned}`;
  }
  if (/^[1-9]\d{9,14}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  return null;
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}

export function passwordStrengthErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('One number');
  return errors;
}
