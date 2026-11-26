import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { UserRole } from '../shared/types.js';

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    }
  } catch {
    // Fall back safely in bundled serverless environments
  }
  return 'spatial-campaign-nlvvl';
}

type AdminAuthInstance = ReturnType<typeof import('firebase-admin/auth')['getAuth']>;
let cachedAdminAuth: AdminAuthInstance | null = null;

/**
 * Lazily loads Firebase Admin Auth only when verifying live production Firebase ID tokens.
 * Keeps Demo Mode, health checks, and webhooks insulated from cold-start Admin SDK loading.
 */
export async function getAdminAuth(): Promise<AdminAuthInstance> {
  if (cachedAdminAuth) return cachedAdminAuth;
  const [{ initializeApp, getApps, getApp }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({ projectId: getFirebaseProjectId() });
  cachedAdminAuth = getAuth(adminApp);
  return cachedAdminAuth;
}

// Ephemeral fallback secret if SESSION_SIGNING_SECRET is not provided in local dev env
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

export function hasExplicitSessionSecret(): boolean {
  return Boolean(process.env.SESSION_SIGNING_SECRET?.trim());
}

function getSigningSecret(): string {
  const configured = process.env.SESSION_SIGNING_SECRET?.trim();
  if (configured) return configured;

  // On serverless platforms like Vercel, separate invocations in the same deployment share
  // deployment-scoped metadata. Deriving a deployment-scoped fallback key keeps Demo Mode
  // HMAC tokens consistent across cold starts and multiple serverless containers.
  const deploymentSeed =
    process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_PROJECT_ID?.trim() ||
    process.env.VERCEL_URL?.trim();

  if (deploymentSeed) {
    return crypto
      .createHmac('sha256', deploymentSeed)
      .update(`devstore-serverless:${getFirebaseProjectId()}`)
      .digest('hex');
  }

  return EPHEMERAL_SIGNING_KEY;
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
    const adminAuth = await getAdminAuth();
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
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : undefined;
    const key = req.ip || forwardedIp || req.socket?.remoteAddress || 'unknown';
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
    if (hits.size > 1000) {
      for (const [k, v] of hits.entries()) {
        if (!v.some((t) => t > cutoff)) hits.delete(k);
      }
    }
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
