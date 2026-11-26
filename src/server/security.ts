import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { UserRole } from '../shared/types.js';

const AUTH_APP_NAME = 'devstore-firebase-auth';
const DEFAULT_APPLET_PROJECT_ID = 'spatial-campaign-nlvvl';
let loggedProjectMismatchWarning = false;

function readAppletConfigProjectId(): string | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      if (parsed.projectId?.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Fall back safely in bundled serverless environments
  }
  return null;
}

export function getFirebaseProjectId(): string {
  const envProjectId = process.env.FIREBASE_PROJECT_ID?.trim().replace(/^["']|["']$/g, '') || '';
  const configProjectId = readAppletConfigProjectId();

  if (configProjectId) {
    if (envProjectId && envProjectId !== configProjectId && !loggedProjectMismatchWarning) {
      loggedProjectMismatchWarning = true;
      console.warn('[DevStore Auth Config Warning]', {
        reason: 'env_project_id_mismatch',
        envFirebaseProjectId: envProjectId,
        clientConfigProjectId: configProjectId,
        action: 'Using firebase-applet-config.json projectId so token verification matches frontend sign-in.',
      });
    }
    return configProjectId;
  }

  return envProjectId || DEFAULT_APPLET_PROJECT_ID;
}

type AdminAuthInstance = ReturnType<typeof import('firebase-admin/auth')['getAuth']>;
let cachedAdminAuth: AdminAuthInstance | null = null;
let cachedProjectId: string | null = null;

/**
 * Lazily loads Firebase Admin Auth only when verifying live production Firebase ID tokens.
 * Keeps Demo Mode, health checks, and webhooks insulated from cold-start Admin SDK loading.
 */
export async function getAdminAuth(): Promise<AdminAuthInstance> {
  const targetProjectId = getFirebaseProjectId();
  if (cachedAdminAuth && cachedProjectId === targetProjectId) {
    return cachedAdminAuth;
  }

  const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);

  const existingApp = getApps().find((app) => app.name === AUTH_APP_NAME);
  const adminApp =
    existingApp && (existingApp.options.projectId === targetProjectId || !existingApp.options.projectId)
      ? existingApp
      : initializeApp({ projectId: targetProjectId }, existingApp ? `${AUTH_APP_NAME}-${targetProjectId}` : AUTH_APP_NAME);

  cachedAdminAuth = getAuth(adminApp);
  cachedProjectId = targetProjectId;
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
 * Safely inspects non-sensitive JWT structural claims ONLY on verification failure
 * for server-side diagnostics (never logs raw tokens, UIDs, emails, or secrets).
 */
function inspectJwtDiagnostics(token: string): {
  segmentCount: number;
  alg?: string;
  hasKid: boolean;
  aud?: string;
  iss?: string;
  expSkewSeconds?: number;
  signInProvider?: string;
} {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { segmentCount: segments.length, hasKid: false };
  }
  try {
    const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      aud?: unknown;
      iss?: unknown;
      exp?: unknown;
      firebase?: { sign_in_provider?: unknown };
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      segmentCount: 3,
      alg: typeof header.alg === 'string' ? header.alg : undefined,
      hasKid: typeof header.kid === 'string' && header.kid.length > 0,
      aud: typeof payload.aud === 'string' ? payload.aud : undefined,
      iss: typeof payload.iss === 'string' ? payload.iss : undefined,
      expSkewSeconds: typeof payload.exp === 'number' ? payload.exp - nowSeconds : undefined,
      signInProvider:
        typeof payload.firebase?.sign_in_provider === 'string'
          ? payload.firebase.sign_in_provider
          : undefined,
    };
  } catch {
    return { segmentCount: segments.length, hasKid: false };
  }
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
      code: 'DEMO_TOKEN_FORBIDDEN',
    });
  }

  const rawAuthHeader = req.headers.authorization;
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  if (!authHeader || !authHeader.trim()) {
    console.warn('[DevStore Auth Rejected]', {
      reason: 'missing_authorization_header',
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: 'Authentication required. Please sign in to continue.',
      code: 'AUTH_MISSING',
    });
  }

  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!bearerMatch) {
    console.warn('[DevStore Auth Rejected]', {
      reason: 'non_bearer_authorization_header',
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: 'Invalid authentication header format.',
      code: 'AUTH_MALFORMED',
    });
  }

  const token = bearerMatch[1].trim();
  if (!token || token === 'null' || token === 'undefined' || /^["'].*["']$/.test(token)) {
    console.warn('[DevStore Auth Rejected]', {
      reason: 'empty_or_placeholder_bearer_token',
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: 'Invalid authentication header format.',
      code: 'AUTH_MALFORMED',
    });
  }

  // Reject demo tokens passed inside Bearer header
  const maybeDemo = verifyHmacToken<SignedTokenPayload>(token);
  if (maybeDemo?.isDemo) {
    return res.status(403).json({
      error: 'Demo tokens cannot access live production APIs.',
      code: 'DEMO_TOKEN_FORBIDDEN',
    });
  }

  const expectedProjectId = getFirebaseProjectId();

  let adminAuth: AdminAuthInstance;
  try {
    adminAuth = await getAdminAuth();
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : 'init_error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DevStore Auth Admin SDK Init Error]', {
      code,
      message,
      expectedProjectId,
      method: req.method,
      path: req.path,
    });
    return res.status(503).json({
      error: 'Unable to verify your sign-in session right now. Please try again in a moment.',
      code: 'AUTH_SERVICE_ERROR',
    });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.prodUser = decoded;
    return next();
  } catch (err) {
    const firebaseCode =
      typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : '';
    const rawMessage = err instanceof Error ? err.message : String(err);
    const diagnostics = inspectJwtDiagnostics(token);

    if (firebaseCode === 'auth/id-token-expired') {
      console.warn('[DevStore Auth Rejected]', {
        reason: 'token_expired',
        firebaseCode,
        method: req.method,
        path: req.path,
        expectedProjectId,
        tokenAud: diagnostics.aud,
        expSkewSeconds: diagnostics.expSkewSeconds,
        signInProvider: diagnostics.signInProvider,
      });
      return res.status(401).json({
        error: 'Your sign-in session expired. Please sign in again to continue.',
        code: 'TOKEN_EXPIRED',
      });
    }

    if (firebaseCode === 'auth/id-token-revoked') {
      console.warn('[DevStore Auth Rejected]', {
        reason: 'token_revoked',
        firebaseCode,
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        error: 'Your sign-in session is no longer active. Please sign in again.',
        code: 'TOKEN_REVOKED',
      });
    }

    const isProjectMismatch =
      rawMessage.includes('incorrect "aud"') ||
      rawMessage.includes('incorrect "iss"') ||
      (diagnostics.aud !== undefined &&
        diagnostics.aud !== expectedProjectId &&
        !diagnostics.aud.includes('identitytoolkit.googleapis.com'));

    if (isProjectMismatch) {
      console.error('[DevStore Auth Project Mismatch]', {
        firebaseCode,
        method: req.method,
        path: req.path,
        expectedProjectId,
        tokenAud: diagnostics.aud,
        tokenIss: diagnostics.iss,
        envFirebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
      });
      return res.status(401).json({
        error: 'Authentication configuration mismatch. Please sign out, refresh the page, and sign in again.',
        code: 'AUTH_PROJECT_MISMATCH',
      });
    }

    const isInfraOrCertFetchError =
      firebaseCode === 'auth/invalid-credential' ||
      firebaseCode === 'auth/internal-error' ||
      /Error fetching public keys|Error fetching Json Web Keys|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(
        rawMessage
      );

    if (isInfraOrCertFetchError) {
      console.error('[DevStore Auth Verification Service Error]', {
        firebaseCode,
        message: rawMessage,
        method: req.method,
        path: req.path,
        expectedProjectId,
      });
      return res.status(503).json({
        error: 'Unable to verify your sign-in session right now. Please try again in a moment.',
        code: 'AUTH_SERVICE_ERROR',
      });
    }

    console.warn('[DevStore Auth Rejected]', {
      reason: 'invalid_token',
      firebaseCode: firebaseCode || 'unknown',
      detail: rawMessage.split(' See https://')[0],
      method: req.method,
      path: req.path,
      expectedProjectId,
      segmentCount: diagnostics.segmentCount,
      alg: diagnostics.alg,
      hasKid: diagnostics.hasKid,
      tokenAud: diagnostics.aud,
      signInProvider: diagnostics.signInProvider,
    });
    return res.status(401).json({
      error: 'Invalid or expired authentication token.',
      code: 'INVALID_TOKEN',
    });
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
    let resolvedIp: string | undefined;
    try {
      resolvedIp = req.ip;
    } catch {
      resolvedIp = undefined;
    }
    const key = resolvedIp || forwardedIp || req.socket?.remoteAddress || 'unknown';
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
