import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import type { UserRole } from '../shared/types.ts';

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
    if (parsed.projectId) return parsed.projectId;
  }
  return 'spatial-campaign-nlvvl';
}

// Initialize Firebase Admin strictly for verifyIdToken (needs no IAM permissions)
const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: getFirebaseProjectId() });
export const adminAuth = getAuth(adminApp);

// Ephemeral fallback secret if SESSION_SIGNING_SECRET is not provided in env
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  return process.env.SESSION_SIGNING_SECRET?.trim() || EPHEMERAL_SIGNING_KEY;
}

export interface SignedTokenPayload {
  sub: string;
  isDemo: boolean;
  role: UserRole;
  namespaceId: string;
  exp: number;
}

export function signHmacToken(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyHmacToken<T extends { exp: number }>(token: string): T | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  prodUser?: DecodedIdToken;
  demoSession?: SignedTokenPayload;
}

/**
 * Protects production endpoints. Explicitly rejects demo session tokens and unauthenticated callers.
 */
export async function requireProductionAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.headers['x-demo-token']) {
    return res.status(403).json({
      error: 'Demo sessions are strictly isolated and cannot access production endpoints.',
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  // Reject demo tokens passed inside Bearer header
  const maybeDemo = verifyHmacToken<SignedTokenPayload>(token);
  if (maybeDemo?.isDemo) {
    return res.status(403).json({
      error: 'Demo tokens cannot access live production APIs.',
    });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.prodUser = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * Protects isolated demo endpoints. Validates HMAC-signed demo token server-side.
 * Never trusts frontend role flags without verifying the server-signed token.
 */
export function requireDemoSession(allowedRoles?: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const rawToken =
      (req.headers['x-demo-token'] as string | undefined) ||
      (req.query.demoToken as string | undefined);

    if (!rawToken) {
      return res.status(401).json({ error: 'Demo session token required.' });
    }

    const payload = verifyHmacToken<SignedTokenPayload>(rawToken);
    if (!payload || !payload.isDemo || !payload.namespaceId) {
      return res.status(401).json({ error: 'Invalid or expired demo session.' });
    }

    if (allowedRoles && !allowedRoles.includes(payload.role)) {
      return res.status(403).json({
        error: `Demo role '${payload.role}' is not authorized for this action.`,
      });
    }

    req.demoSession = payload;
    return next();
  };
}

/**
 * In-memory sliding window rate limiter for public demo & sensitive API endpoints.
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return next();
  };
}

/**
 * Confines file paths strictly inside the configured private asset directory.
 */
export function resolvePrivateAssetPath(baseDir: string, assetKey: string): string | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(assetKey)) {
    return null;
  }
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, assetKey);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}

export function sanitizeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}
