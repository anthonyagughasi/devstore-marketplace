import zlib from 'zlib';
import type { Request, Response } from 'express';
import { signHmacToken, verifyHmacToken } from '../security.js';
import {
  createSeededDemoState,
  demoEngine,
  type DemoNamespaceState,
} from './demoEngine.js';

interface CompactDemoEnvelope {
  v: 1;
  id: string;
  rev: number;
  z: string;
  exp: number;
}

const DEMO_STATE_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const MAX_INFLATED_BYTES = 512 * 1024;

// Baseline seed JSON fingerprints to avoid duplicating large static arrays inside signed tokens
const SEED_BASE = createSeededDemoState('__fingerprint__');
const SEED_JSON = {
  departments: JSON.stringify(SEED_BASE.departments),
  stores: JSON.stringify(SEED_BASE.stores),
  products: JSON.stringify(SEED_BASE.products),
  coupons: JSON.stringify(SEED_BASE.coupons),
  reviews: JSON.stringify(SEED_BASE.reviews),
  questions: JSON.stringify(SEED_BASE.questions),
  customers: JSON.stringify(SEED_BASE.customers),
  sellerApplications: JSON.stringify(SEED_BASE.sellerApplications),
  platformConfig: JSON.stringify(SEED_BASE.platformConfig),
};

function getKvConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function fetchKvNamespace(namespaceId: string): Promise<DemoNamespaceState | null> {
  const kv = getKvConfig();
  if (!kv) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(`devstore:demo:${namespaceId}`)}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string | null };
    if (!body?.result) return null;
    const parsed = JSON.parse(body.result) as DemoNamespaceState;
    if (parsed && parsed.namespaceId === namespaceId) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function saveKvNamespace(ns: DemoNamespaceState): Promise<void> {
  const kv = getKvConfig();
  if (!kv) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const key = encodeURIComponent(`devstore:demo:${ns.namespaceId}`);
    await fetch(`${kv.url}/set/${key}?EX=43200`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kv.token}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: JSON.stringify(ns),
      signal: controller.signal,
    });
  } catch {
    // Non-fatal: signed demoStateToken still guarantees cross-invocation continuity
  } finally {
    clearTimeout(timer);
  }
}

function compactNamespace(ns: DemoNamespaceState): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    namespaceId: ns.namespaceId,
    revision: ns.revision,
    createdAt: ns.createdAt,
    orders: ns.orders,
    sellerOrders: ns.sellerOrders,
    entitlements: ns.entitlements,
    transactions: ns.transactions,
    withdrawals: ns.withdrawals,
    disputes: ns.disputes,
    customerCart: ns.customerCart,
    customerWishlist: ns.customerWishlist,
    followedStoreIds: ns.followedStoreIds,
    customerAddresses: ns.customerAddresses,
    activityLogs: ns.activityLogs,
  };

  if (JSON.stringify(ns.departments) !== SEED_JSON.departments) compact.departments = ns.departments;
  if (JSON.stringify(ns.stores) !== SEED_JSON.stores) compact.stores = ns.stores;
  if (JSON.stringify(ns.products) !== SEED_JSON.products) compact.products = ns.products;
  if (JSON.stringify(ns.coupons) !== SEED_JSON.coupons) compact.coupons = ns.coupons;
  if (JSON.stringify(ns.reviews) !== SEED_JSON.reviews) compact.reviews = ns.reviews;
  if (JSON.stringify(ns.questions) !== SEED_JSON.questions) compact.questions = ns.questions;
  if (JSON.stringify(ns.customers) !== SEED_JSON.customers) compact.customers = ns.customers;
  if (JSON.stringify(ns.sellerApplications) !== SEED_JSON.sellerApplications) {
    compact.sellerApplications = ns.sellerApplications;
  }
  if (JSON.stringify(ns.platformConfig) !== SEED_JSON.platformConfig) {
    compact.platformConfig = ns.platformConfig;
  }

  return compact;
}

function expandNamespace(compact: Partial<DemoNamespaceState>, namespaceId: string): DemoNamespaceState {
  const base = createSeededDemoState(namespaceId);
  return {
    ...base,
    ...compact,
    namespaceId,
    revision: typeof compact.revision === 'number' && compact.revision >= 1 ? compact.revision : 1,
  };
}

export function signDemoStateToken(ns: DemoNamespaceState): string {
  const compressed = zlib.deflateRawSync(Buffer.from(JSON.stringify(compactNamespace(ns)), 'utf8'));
  const envelope: CompactDemoEnvelope = {
    v: 1,
    id: ns.namespaceId,
    rev: ns.revision,
    z: compressed.toString('base64url'),
    exp: Date.now() + DEMO_STATE_TTL_MS,
  };
  return signHmacToken(envelope);
}

export function verifyDemoStateToken(
  token: string | undefined,
  expectedNamespaceId: string
): DemoNamespaceState | null {
  if (!token || typeof token !== 'string') return null;
  const envelope = verifyHmacToken<CompactDemoEnvelope>(token);
  if (!envelope || envelope.v !== 1 || envelope.id !== expectedNamespaceId || !envelope.z) {
    return null;
  }

  try {
    const rawCompressed = Buffer.from(envelope.z, 'base64url');
    const inflated = zlib.inflateRawSync(rawCompressed, { maxOutputLength: MAX_INFLATED_BYTES });
    const parsed = JSON.parse(inflated.toString('utf8')) as Partial<DemoNamespaceState>;
    if (!parsed || parsed.namespaceId !== expectedNamespaceId) {
      return null;
    }
    return expandNamespace(parsed, expectedNamespaceId);
  } catch {
    return null;
  }
}

/**
 * Resolves the authoritative demo namespace across memory, optional external KV,
 * and server-signed compressed `x-demo-state` snapshots for Vercel multi-instance safety.
 */
export async function hydrateDemoNamespace(
  req: Request,
  namespaceId: string
): Promise<DemoNamespaceState> {
  const candidates: DemoNamespaceState[] = [];

  const mem = demoEngine.peekNamespace(namespaceId);
  if (mem) candidates.push(mem);

  const headerToken = req.headers['x-demo-state'];
  const rawStateToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const fromHeader = verifyDemoStateToken(rawStateToken, namespaceId);
  if (fromHeader) candidates.push(fromHeader);

  const fromKv = await fetchKvNamespace(namespaceId);
  if (fromKv) candidates.push(fromKv);

  if (candidates.length === 0) {
    return demoEngine.getOrCreateNamespace(namespaceId);
  }

  candidates.sort((a, b) => (b.revision || 1) - (a.revision || 1));
  const best = candidates[0];
  demoEngine.saveNamespace(best);
  return best;
}

/**
 * Increments state revision, saves to in-memory cache (+ optional KV), and returns
 * a freshly signed compact `demoStateToken` attached to `X-Demo-State`.
 */
export async function commitDemoNamespace(
  ns: DemoNamespaceState,
  res?: Response,
  options?: { bumpRevision?: boolean }
): Promise<string> {
  if (options?.bumpRevision !== false) {
    ns.revision = (ns.revision || 1) + 1;
  }
  demoEngine.saveNamespace(ns);
  await saveKvNamespace(ns);

  const token = signDemoStateToken(ns);
  if (res && !res.headersSent) {
    res.setHeader('X-Demo-State', token);
  }
  return token;
}
