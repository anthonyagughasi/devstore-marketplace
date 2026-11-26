import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  createRateLimiter,
  requireDemoSession,
  requireProductionAuth,
  signHmacToken,
  type AuthenticatedRequest,
  type SignedTokenPayload,
} from './security.js';
import {
  CrossProviderMismatchError,
  flutterwaveService,
  getIntegrationsStatus,
  getPaymentProvider,
  paymentTransactionStore,
  paystackService,
  processVerifiedWebhookEvent,
  webhookAuditLog,
} from './payments/index.js';
import {
  getDevEmailPreviews,
  sendTransactionalEmail,
  type TransactionalEmailEvent,
} from './email/resendAdapter.js';
import {
  ensurePrivateSampleAssets,
  issueSignedDownloadToken,
  readPrivateAssetForDownload,
  verifySignedDownloadToken,
} from './storage/privateDownloads.js';
import { validateExchangeRates } from '../shared/currency.js';
import { demoEngine } from './demo/demoEngine.js';
import { commitDemoNamespace, hydrateDemoNamespace } from './demo/demoPersistence.js';
import { SEED_PRODUCTS } from '../shared/catalogData.js';
import type {
  CurrencyCode,
  PaymentProviderId,
  Product,
  SellerFulfilmentStatus,
  UserRole,
} from '../shared/types.js';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

const VALID_CURRENCIES: CurrencyCode[] = ['USD', 'NGN', 'GBP', 'EUR'];
const VALID_ROLES: UserRole[] = ['customer', 'seller', 'admin'];

function isSafeHttpsUrl(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveRequestOrigin(req: Request): string {
  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl) {
    const normalized = /^https?:\/\//i.test(configuredAppUrl)
      ? configuredAppUrl
      : `https://${configuredAppUrl}`;
    try {
      return new URL(normalized).origin;
    } catch {
      // Fall back to proxy/host headers below
    }
  }

  const forwardedHostRaw = req.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw)
    ? forwardedHostRaw[0]
    : forwardedHostRaw?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');

  const forwardedProtoRaw = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? forwardedProtoRaw[0]
    : forwardedProtoRaw?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'https';

  if (host) {
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

function buildProviderCallbackUrl(
  req: Request,
  provider: PaymentProviderId,
  requestedUrl?: string
): string {
  const defaultOrigin = resolveRequestOrigin(req);

  let base = defaultOrigin;
  if (requestedUrl && requestedUrl !== 'null') {
    try {
      const parsed = new URL(requestedUrl);
      const isLocalDev =
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      if (parsed.protocol === 'https:' || isLocalDev) {
        base = parsed.toString();
      }
    } catch {
      base = defaultOrigin;
    }
  }

  const target = new URL(base);
  target.searchParams.set('payment_callback', '1');
  target.searchParams.set('provider', provider);
  return target.toString();
}

/**
 * Extracts raw string and parsed JSON safely across both Node/Express middleware
 * and Vercel serverless environments where req.body may arrive pre-parsed or as Buffer/string.
 */
function extractWebhookPayload(req: RawBodyRequest): {
  rawBody: string;
  parsedBody: unknown;
} {
  if (typeof req.rawBody === 'string' && req.rawBody.length > 0) {
    let parsed: unknown = req.body;
    if (parsed === undefined || typeof parsed === 'string') {
      try {
        parsed = JSON.parse(req.rawBody);
      } catch {
        parsed = null;
      }
    }
    return { rawBody: req.rawBody, parsedBody: parsed };
  }

  if (Buffer.isBuffer(req.body)) {
    const rawBody = req.body.toString('utf8');
    try {
      return { rawBody, parsedBody: JSON.parse(rawBody) };
    } catch {
      return { rawBody, parsedBody: null };
    }
  }

  if (typeof req.body === 'string') {
    try {
      return { rawBody: req.body, parsedBody: JSON.parse(req.body) };
    } catch {
      return { rawBody: req.body, parsedBody: null };
    }
  }

  if (req.body && typeof req.body === 'object') {
    return { rawBody: JSON.stringify(req.body), parsedBody: req.body };
  }

  return { rawBody: '', parsedBody: null };
}

export function createApp() {
  ensurePrivateSampleAssets();

  const app = express();
  app.set('trust proxy', 1);

  // If the hosting runtime (e.g., serverless adapter) already parsed req.body,
  // prevent express.json() from re-reading a drained request stream.
  app.use((req, _res, next) => {
    if (req.body !== undefined && !(req as unknown as { _body?: boolean })._body) {
      (req as unknown as { _body: boolean })._body = true;
    }
    next();
  });

  // Capture raw body for payment webhook HMAC verification
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf.toString('utf8');
      },
    })
  );

  // Convert malformed JSON body errors cleanly into JSON 400 responses
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON request payload.' });
    }
    return next(err);
  });

  const demoRateLimiter = createRateLimiter(120, 60_000);
  const authApiLimiter = createRateLimiter(90, 60_000);

  // =========================================================================
  // SEO: robots.txt & sitemap.xml
  // =========================================================================
  app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /private_assets/\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const urls = [
      `${baseUrl}/`,
      `${baseUrl}/digital`,
      ...SEED_PRODUCTS.filter((p) => p.approvalStatus === 'approved').map(
        (p) => `${baseUrl}/product/${p.slug}`
      ),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
  });

  // =========================================================================
  // Public Health & Integration Readiness (No Secrets Exposed)
  // =========================================================================
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'devstore-api' });
  });

  app.get('/api/config/integrations', (_req, res) => {
    res.json(getIntegrationsStatus());
  });

  // =========================================================================
  // Production Payment Endpoints (Strictly Blocked for Demo Sessions)
  // Separate Paystack and Flutterwave routes prevent cross-provider leakage.
  // =========================================================================
  async function handleProviderInitialize(
    provider: PaymentProviderId,
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        amountMinor?: number;
        currency?: CurrencyCode;
        email?: string;
        customerName?: string;
        callbackUrl?: string;
        orderId?: string;
        idempotencyKey?: string;
      };
      const { amountMinor, currency, email, customerName, callbackUrl, orderId, idempotencyKey } = body;

      if (!Number.isInteger(amountMinor) || (amountMinor ?? 0) <= 0) {
        return res.status(400).json({ error: 'Order total must be greater than zero.' });
      }
      if (!currency || !VALID_CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: 'Selected currency is not supported for checkout.' });
      }

      const candidateEmail = (email || req.prodUser?.email || '').trim();
      const resolvedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)
        ? candidateEmail
        : 'customer@devstore.example.com';

      const resolvedName =
        (typeof customerName === 'string' && customerName.trim()) ||
        (typeof req.prodUser?.name === 'string' && req.prodUser.name.trim()) ||
        undefined;

      const resolvedOrderId =
        typeof orderId === 'string' && orderId.trim()
          ? orderId.trim().slice(0, 80)
          : `ord-live-${Date.now()}`;
      const resolvedCallback = buildProviderCallbackUrl(req, provider, callbackUrl);

      if (provider === 'paystack') {
        if (!paystackService.adapter.supportedCurrencies.includes(currency)) {
          return res.status(400).json({
            error: `Paystack supports ${paystackService.adapter.supportedCurrencies.join(', ')}. Choose Flutterwave for ${currency}.`,
          });
        }
        const result = await paystackService.initializeCheckout({
          userId: req.prodUser!.uid,
          orderId: resolvedOrderId,
          email: resolvedEmail,
          customerName: resolvedName,
          amountMinor: amountMinor!,
          currency,
          callbackUrl: resolvedCallback,
          idempotencyKey,
        });
        return res.json(result);
      }

      const result = await flutterwaveService.initializeCheckout({
        userId: req.prodUser!.uid,
        orderId: resolvedOrderId,
        email: resolvedEmail,
        customerName: resolvedName,
        amountMinor: amountMinor!,
        currency,
        callbackUrl: resolvedCallback,
        idempotencyKey,
      });
      return res.json(result);
    } catch (err) {
      const providerLabel = provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';
      console.error(`[DevStore ${providerLabel} Initialize Failure]`, {
        uid: req.prodUser?.uid,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : `Unable to start ${providerLabel} checkout right now. Please try again.`,
      });
    }
  }

  async function handleProviderVerify(
    provider: PaymentProviderId,
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        reference?: string;
        transactionId?: string;
        callbackStatus?: string;
      };
      const { reference, transactionId, callbackStatus } = body;
      if (!reference || typeof reference !== 'string' || !reference.trim()) {
        return res.status(400).json({ error: 'Payment reference is required.' });
      }

      const verification =
        provider === 'paystack'
          ? await paystackService.verifyCheckout({
              reference: reference.trim(),
              callbackStatus,
            })
          : await flutterwaveService.verifyCheckout({
              reference: reference.trim(),
              transactionId,
              callbackStatus,
            });

      return res.json(verification);
    } catch (err) {
      if (err instanceof CrossProviderMismatchError) {
        return res.status(400).json({ error: err.message });
      }
      const providerLabel = provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';
      console.error(`[DevStore ${providerLabel} Verify Failure]`, {
        uid: req.prodUser?.uid,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : `Unable to confirm ${providerLabel} payment right now. Please try again.`,
      });
    }
  }

  // Dedicated Paystack endpoints
  app.post(
    '/api/payments/paystack/initialize',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => handleProviderInitialize('paystack', req, res)
  );

  app.post(
    '/api/payments/paystack/verify',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => handleProviderVerify('paystack', req, res)
  );

  // Dedicated Flutterwave endpoints
  app.post(
    '/api/payments/flutterwave/initialize',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => handleProviderInitialize('flutterwave', req, res)
  );

  app.post(
    '/api/payments/flutterwave/verify',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => handleProviderVerify('flutterwave', req, res)
  );

  // Authenticated transaction status lookup
  app.get(
    '/api/payments/transactions/:reference',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const tx = paymentTransactionStore.getByReference(req.params.reference);
      if (!tx) {
        return res.status(404).json({ error: 'Payment transaction not found.' });
      }
      if (tx.userId !== req.prodUser!.uid) {
        return res.status(403).json({ error: 'Forbidden: transaction belongs to another user.' });
      }
      return res.json({
        transaction: tx,
        order: paymentTransactionStore.getOrderStatus(tx.orderId),
      });
    }
  );

  // Legacy unified routes dispatch strictly to the requested provider service
  app.post(
    '/api/payments/initialize',
    authApiLimiter,
    requireProductionAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { provider } = req.body as { provider?: PaymentProviderId };
      if (provider !== 'paystack' && provider !== 'flutterwave') {
        return res.status(400).json({ error: 'Invalid payment provider.' });
      }
      return handleProviderInitialize(provider, req, res);
    }
  );

  app.post(
    '/api/payments/verify',
    authApiLimiter,
    requireProductionAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { provider } = req.body as { provider?: PaymentProviderId };
      if (provider !== 'paystack' && provider !== 'flutterwave') {
        return res.status(400).json({ error: 'Invalid payment provider.' });
      }
      return handleProviderVerify(provider, req, res);
    }
  );

  // =========================================================================
  // Payment Provider Webhooks (Vercel-Ready Raw Body + Signature + Idempotency + Re-Verify)
  // =========================================================================
  app.post('/api/webhooks/paystack', async (req: RawBodyRequest, res: Response) => {
    try {
      const adapter = getPaymentProvider('paystack');
      const { rawBody, parsedBody } = extractWebhookPayload(req);

      if (!adapter.verifyWebhookSignature(rawBody, req.headers)) {
        return res.status(401).json({ error: 'Invalid or unconfigured Paystack webhook signature.' });
      }

      const event = adapter.parseWebhookEvent(parsedBody);
      if (!event) {
        return res.status(400).json({ error: 'Malformed Paystack webhook payload.' });
      }

      const { duplicate, record } = await processVerifiedWebhookEvent(adapter, event);
      return res.status(200).json({
        received: true,
        duplicate,
        eventId: event.eventId,
        event,
        reconciliation: record,
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Paystack webhook processing error.',
      });
    }
  });

  app.post('/api/webhooks/flutterwave', async (req: RawBodyRequest, res: Response) => {
    try {
      const adapter = getPaymentProvider('flutterwave');
      const { rawBody, parsedBody } = extractWebhookPayload(req);

      if (!adapter.verifyWebhookSignature(rawBody, req.headers)) {
        return res.status(401).json({ error: 'Invalid or unconfigured Flutterwave webhook signature.' });
      }

      const event = adapter.parseWebhookEvent(parsedBody);
      if (!event) {
        return res.status(400).json({ error: 'Malformed Flutterwave webhook payload.' });
      }

      const { duplicate, record } = await processVerifiedWebhookEvent(adapter, event);
      return res.status(200).json({
        received: true,
        duplicate,
        eventId: event.eventId,
        event,
        reconciliation: record,
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Flutterwave webhook processing error.',
      });
    }
  });

  app.get('/api/webhooks/reconciliations', authApiLimiter, requireProductionAuth, (_req, res) => {
    res.json({ records: webhookAuditLog.slice(0, 25) });
  });

  // =========================================================================
  // Currency Exchange Rate Configuration Endpoint (External API Optional)
  // =========================================================================
  app.get('/api/currency/rates', async (_req: Request, res: Response) => {
    const fxUrl = process.env.EXCHANGE_RATE_API_URL?.trim();
    const fxKey = process.env.EXCHANGE_RATE_API_KEY?.trim();

    if (fxUrl && isSafeHttpsUrl(fxUrl)) {
      try {
        const parsed = new URL(fxUrl);
        if (
          parsed.hostname !== 'localhost' &&
          parsed.hostname !== '127.0.0.1' &&
          !parsed.hostname.startsWith('169.254.')
        ) {
          const upstream = await fetch(parsed.toString(), {
            headers: fxKey ? { Authorization: `Bearer ${fxKey}` } : {},
          });
          if (upstream.ok) {
            const data = (await upstream.json()) as {
              rates?: Partial<Record<CurrencyCode, number>>;
            };
            if (data.rates) {
              return res.json({
                mode: 'external_api',
                externalApiConfigured: true,
                rates: validateExchangeRates(data.rates),
              });
            }
          }
        }
      } catch {
        // Fall through cleanly to manual baseline rates if upstream FX endpoint fails
      }
    }

    return res.json({
      mode: 'manual',
      externalApiConfigured: false,
      rates: validateExchangeRates({}),
    });
  });

  // =========================================================================
  // Optional Email Abstraction & Development Notification Previews
  // =========================================================================
  app.post(
    '/api/email/send',
    authApiLimiter,
    requireProductionAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { to, event, subject, htmlBody, templateVars } = req.body as {
        to?: string;
        event?: TransactionalEmailEvent;
        subject?: string;
        htmlBody?: string;
        templateVars?: Record<string, string>;
      };
      if (!to || !event) {
        return res.status(400).json({ error: 'Recipient (to) and email event are required.' });
      }
      const result = await sendTransactionalEmail({
        to,
        event,
        subject,
        htmlBody,
        templateVars,
        isDemoContext: false,
      });
      if (result.status === 'delivery_failed') {
        return res.status(502).json(result);
      }
      // Return 200 when gracefully disabled (unconfigured) with sent=false, never claiming sent=true
      return res.status(200).json(result);
    }
  );

  app.get('/api/dev/email-previews', (req: AuthenticatedRequest, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Development email previews are disabled in production environments.',
      });
    }
    return res.json({
      developmentOnly: true,
      previews: getDevEmailPreviews(),
    });
  });

  app.post(
    '/api/demo/email/preview',
    demoRateLimiter,
    requireDemoSession(),
    async (req: AuthenticatedRequest, res: Response) => {
      const { to, event, templateVars } = req.body as {
        to?: string;
        event?: TransactionalEmailEvent;
        templateVars?: Record<string, string>;
      };
      if (!event) {
        return res.status(400).json({ error: 'Transactional email event is required.' });
      }
      const result = await sendTransactionalEmail({
        to: to || 'demo-recipient@devstore.example.com',
        event,
        templateVars,
        isDemoContext: true,
      });
      return res.json({
        result,
        previews: getDevEmailPreviews(),
      });
    }
  );

  // =========================================================================
  // Production Signed Digital Download Token Issuer & File Streamer
  // =========================================================================
  app.post(
    '/api/downloads/issue-token',
    authApiLimiter,
    requireProductionAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const { entitlementId, assetKey, licenseType } = req.body as {
        entitlementId?: string;
        assetKey?: string;
        licenseType?: string;
      };
      if (!entitlementId || !assetKey) {
        return res.status(400).json({ error: 'Entitlement ID and asset key are required.' });
      }
      const issued = issueSignedDownloadToken({
        entitlementId,
        assetKey,
        licenseType: licenseType || 'personal',
        isDemo: false,
        namespaceId: req.prodUser!.uid,
        ttlSeconds: 180,
      });
      return res.json({
        ...issued,
        downloadUrl: `/api/downloads/file/${encodeURIComponent(issued.token)}`,
      });
    }
  );

  app.get('/api/downloads/file/:token', async (req: Request, res: Response) => {
    try {
      const token = req.params.token;
      const payload = verifySignedDownloadToken(token);
      if (!payload) {
        return res.status(403).json({ error: 'Download link is invalid or expired.' });
      }

      if (payload.isDemo) {
        const ns = await hydrateDemoNamespace(req, payload.namespaceId);
        const ent = ns.entitlements.find((e) => e.id === payload.entitlementId);
        if (!ent) {
          return res.status(404).json({ error: 'Demo digital entitlement not found.' });
        }
        if (ent.downloadsUsed >= ent.maxDownloads) {
          return res.status(403).json({ error: 'Maximum download limit reached for this license.' });
        }
        if (Date.now() > new Date(ent.expiresAt).getTime()) {
          return res.status(403).json({ error: 'Download entitlement window has expired.' });
        }
        ent.downloadsUsed += 1;
        demoEngine.appendLog(
          ns,
          'customer',
          'digital_download',
          `Downloaded ${ent.productTitle} (${ent.downloadsUsed}/${ent.maxDownloads})`
        );
        await commitDemoNamespace(ns, res);
      }

      const asset = await readPrivateAssetForDownload(payload.assetKey, { isDemo: payload.isDemo });
      if (!asset) {
        return res.status(404).json({ error: 'Digital asset unavailable.' });
      }

      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(asset.buffer);
    } catch (err) {
      console.error('[DevStore Download Error]', err);
      return res.status(500).json({ error: 'Unable to prepare digital download.' });
    }
  });

  // =========================================================================
  // Demo Mode API (100% Isolated Sandbox + Rate Limited)
  // =========================================================================
  app.post('/api/demo/session', demoRateLimiter, async (req: Request, res: Response) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        role?: UserRole;
        existingNamespaceId?: string;
      };
      const targetRole: UserRole = body.role && VALID_ROLES.includes(body.role) ? body.role : 'customer';

      const namespaceId =
        body.existingNamespaceId && /^[a-zA-Z0-9_-]{8,64}$/.test(body.existingNamespaceId)
          ? body.existingNamespaceId
          : `demo_${crypto.randomBytes(8).toString('hex')}`;

      const ns = await hydrateDemoNamespace(req, namespaceId);
      demoEngine.appendLog(ns, targetRole, 'role_selected', `Switched demo perspective to ${targetRole}.`);
      const demoStateToken = await commitDemoNamespace(ns, res);

      const tokenPayload: SignedTokenPayload = {
        sub: `demo-${targetRole}`,
        isDemo: true,
        role: targetRole,
        namespaceId,
        exp: Date.now() + 1000 * 60 * 60 * 12, // 12h
      };
      const demoToken = signHmacToken(tokenPayload);

      return res.json({
        demoToken,
        demoStateToken,
        namespaceId,
        role: targetRole,
        expiresAt: new Date(tokenPayload.exp).toISOString(),
      });
    } catch (err) {
      console.error('[DevStore Demo Session Error]', err);
      return res.status(500).json({ error: 'Unable to initialize demo session. Please try again.' });
    }
  });

  app.get(
    '/api/demo/state',
    demoRateLimiter,
    requireDemoSession(),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const demoStateToken = await commitDemoNamespace(ns, res, { bumpRevision: false });
        const sellerBalances = demoEngine.computeSellerBalances(ns, 'demo-seller-1');
        return res.json({
          role: req.demoSession!.role,
          namespaceId: ns.namespaceId,
          state: ns,
          sellerBalances,
          demoStateToken,
        });
      } catch (err) {
        console.error('[DevStore Demo State Error]', err);
        return res.status(500).json({ error: 'Unable to load demo workspace state.' });
      }
    }
  );

  app.post(
    '/api/demo/reset',
    demoRateLimiter,
    requireDemoSession(),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const current = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        demoEngine.saveNamespace(current);
        const ns = demoEngine.resetNamespace(req.demoSession!.namespaceId);
        const demoStateToken = await commitDemoNamespace(ns, res, { bumpRevision: false });
        const sellerBalances = demoEngine.computeSellerBalances(ns, 'demo-seller-1');
        return res.json({
          role: req.demoSession!.role,
          namespaceId: ns.namespaceId,
          state: ns,
          sellerBalances,
          demoStateToken,
        });
      } catch (err) {
        console.error('[DevStore Demo Reset Error]', err);
        return res.status(500).json({ error: 'Unable to reset demo workspace.' });
      }
    }
  );

  // Demo Customer Mutations
  app.post(
    '/api/demo/cart',
    demoRateLimiter,
    requireDemoSession(['customer', 'seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          items?: typeof ns.customerCart;
        };
        if (!Array.isArray(body.items)) {
          return res.status(400).json({ error: 'items array required.' });
        }
        ns.customerCart = body.items.slice(0, 40).map((item) => ({
          productId: String(item.productId),
          quantity: Math.max(1, Math.min(50, Math.floor(Number(item.quantity) || 1))),
          selectedVariation: item.selectedVariation ? String(item.selectedVariation).slice(0, 100) : undefined,
          selectedLicense: item.selectedLicense,
        }));
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ cart: ns.customerCart, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Cart Error]', err);
        return res.status(500).json({ error: 'Unable to update demo cart.' });
      }
    }
  );

  app.post(
    '/api/demo/wishlist/toggle',
    demoRateLimiter,
    requireDemoSession(['customer', 'seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          productId?: string;
        };
        const productId = body.productId;
        if (!productId) return res.status(400).json({ error: 'productId required.' });
        if (ns.customerWishlist.includes(productId)) {
          ns.customerWishlist = ns.customerWishlist.filter((id) => id !== productId);
        } else {
          ns.customerWishlist.push(productId);
        }
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ wishlist: ns.customerWishlist, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Wishlist Error]', err);
        return res.status(500).json({ error: 'Unable to update demo wishlist.' });
      }
    }
  );

  app.post(
    '/api/demo/follow/toggle',
    demoRateLimiter,
    requireDemoSession(['customer', 'seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          storeId?: string;
        };
        const storeId = body.storeId;
        if (!storeId) return res.status(400).json({ error: 'storeId required.' });
        const store = ns.stores.find((s) => s.id === storeId);
        if (!store) return res.status(404).json({ error: 'Store not found.' });

        if (ns.followedStoreIds.includes(storeId)) {
          ns.followedStoreIds = ns.followedStoreIds.filter((id) => id !== storeId);
          store.followerCount = Math.max(0, store.followerCount - 1);
        } else {
          ns.followedStoreIds.push(storeId);
          store.followerCount += 1;
        }
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ followedStoreIds: ns.followedStoreIds, stores: ns.stores, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Follow Error]', err);
        return res.status(500).json({ error: 'Unable to update followed stores.' });
      }
    }
  );

  app.post(
    '/api/demo/addresses',
    demoRateLimiter,
    requireDemoSession(['customer', 'seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { label, fullName, phone, line1, city, state, postalCode, countryCode } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as Record<string, string>;
        if (!label || !fullName || !line1 || !city || !countryCode) {
          return res.status(400).json({ error: 'Missing required address fields.' });
        }
        ns.customerAddresses.push({
          id: `addr-demo-${Date.now()}`,
          label: label.slice(0, 50),
          fullName: fullName.slice(0, 100),
          phone: (phone || '+1 555 0100').slice(0, 32),
          line1: line1.slice(0, 160),
          city: city.slice(0, 80),
          state: (state || '').slice(0, 80),
          postalCode: (postalCode || '').slice(0, 24),
          countryCode: countryCode.slice(0, 4).toUpperCase(),
          isDefault: ns.customerAddresses.length === 0,
        });
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ addresses: ns.customerAddresses, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Address Error]', err);
        return res.status(500).json({ error: 'Unable to save demo shipping address.' });
      }
    }
  );

  app.post(
    '/api/demo/payments/simulate',
    demoRateLimiter,
    requireDemoSession(['customer']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { provider, outcome, currency, couponCode, shippingCity, shippingCountry, idempotencyKey } =
          (req.body && typeof req.body === 'object' ? req.body : {}) as {
            provider: PaymentProviderId;
            outcome: 'success' | 'failed' | 'cancelled' | 'pending';
            currency: CurrencyCode;
            couponCode?: string;
            shippingCity?: string;
            shippingCountry?: string;
            idempotencyKey?: string;
          };

        if (provider !== 'paystack' && provider !== 'flutterwave') {
          return res.status(400).json({ error: 'Invalid provider.' });
        }
        if (!['success', 'failed', 'cancelled', 'pending'].includes(outcome)) {
          return res.status(400).json({ error: 'Invalid simulated outcome.' });
        }
        if (!VALID_CURRENCIES.includes(currency)) {
          return res.status(400).json({ error: 'Unsupported currency.' });
        }

        const result = demoEngine.simulateCheckoutAndPayment(ns, {
          provider,
          outcome,
          currency,
          couponCode,
          shippingCity,
          shippingCountry,
          idempotencyKey,
        });

        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({
          simulated: true,
          ...result,
          state: ns,
          sellerBalances: demoEngine.computeSellerBalances(ns, 'demo-seller-1'),
          demoStateToken,
        });
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Demo checkout simulation failed.',
        });
      }
    }
  );

  app.post(
    '/api/demo/downloads/issue-token',
    demoRateLimiter,
    requireDemoSession(['customer']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { entitlementId } = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          entitlementId?: string;
        };
        const ent = ns.entitlements.find((e) => e.id === entitlementId);
        if (!ent) {
          return res.status(404).json({ error: 'Digital purchase entitlement not found.' });
        }
        if (ent.downloadsUsed >= ent.maxDownloads) {
          return res.status(403).json({ error: 'Download limit reached for this license.' });
        }

        const issued = issueSignedDownloadToken({
          entitlementId: ent.id,
          assetKey: ent.assetKey,
          licenseType: ent.licenseType,
          isDemo: true,
          namespaceId: ns.namespaceId,
          ttlSeconds: 180,
        });

        const demoStateToken = await commitDemoNamespace(ns, res, { bumpRevision: false });
        return res.json({
          ...issued,
          downloadUrl: `/api/downloads/file/${encodeURIComponent(issued.token)}`,
          demoStateToken,
        });
      } catch (err) {
        console.error('[DevStore Demo Download Token Error]', err);
        return res.status(500).json({ error: 'Unable to issue demo download token.' });
      }
    }
  );

  app.post(
    '/api/demo/reviews',
    demoRateLimiter,
    requireDemoSession(['customer']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { productId, rating, title, comment } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          productId?: string;
          rating?: number;
          title?: string;
          comment?: string;
        };
        const product = ns.products.find((p) => p.id === productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!rating || rating < 1 || rating > 5 || !title || !comment) {
          return res.status(400).json({ error: 'Valid rating, title, and comment required.' });
        }

        const review = {
          id: `rev-demo-${Date.now()}`,
          productId: product.id,
          storeId: product.storeId,
          authorId: 'demo-customer-1',
          authorName: 'Tunde Adeyemi (Demo)',
          rating: Math.round(rating),
          title: title.slice(0, 120),
          comment: comment.slice(0, 1200),
          verifiedPurchase: ns.orders.some(
            (o) => o.paymentStatus === 'paid' && o.items.some((i) => i.productId === product.id)
          ),
          createdAt: new Date().toISOString(),
        };
        ns.reviews.unshift(review);
        const prodReviews = ns.reviews.filter((r) => r.productId === product.id);
        product.reviewCount = prodReviews.length;
        product.ratingAvg = Number(
          (prodReviews.reduce((a, b) => a + b.rating, 0) / prodReviews.length).toFixed(1)
        );
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ reviews: ns.reviews, product, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Review Error]', err);
        return res.status(500).json({ error: 'Unable to submit demo review.' });
      }
    }
  );

  app.post(
    '/api/demo/questions',
    demoRateLimiter,
    requireDemoSession(['customer', 'seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { productId, question, questionId, answer } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          productId?: string;
          question?: string;
          questionId?: string;
          answer?: string;
        };
        if (req.demoSession!.role === 'seller' && questionId && answer) {
          const q = ns.questions.find((item) => item.id === questionId);
          if (!q) return res.status(404).json({ error: 'Question not found.' });
          q.answer = answer.slice(0, 800);
          const demoStateToken = await commitDemoNamespace(ns, res);
          return res.json({ questions: ns.questions, demoStateToken });
        }
        const product = ns.products.find((p) => p.id === productId);
        if (!product || !question) {
          return res.status(400).json({ error: 'Product and question are required.' });
        }
        ns.questions.unshift({
          id: `qa-demo-${Date.now()}`,
          productId: product.id,
          storeId: product.storeId,
          authorId: 'demo-customer-1',
          authorName: 'Tunde Adeyemi',
          question: question.slice(0, 500),
          createdAt: new Date().toISOString(),
        });
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ questions: ns.questions, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Q&A Error]', err);
        return res.status(500).json({ error: 'Unable to save question.' });
      }
    }
  );

  app.post(
    '/api/demo/disputes',
    demoRateLimiter,
    requireDemoSession(['customer']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { sellerOrderId, reason, details } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          sellerOrderId?: string;
          reason?: string;
          details?: string;
        };
        const so = ns.sellerOrders.find((o) => o.id === sellerOrderId);
        if (!so || !reason || !details) {
          return res.status(400).json({ error: 'Valid order, reason, and details required.' });
        }
        const dispute = {
          id: `dsp-demo-${Date.now()}`,
          orderId: so.parentOrderId,
          sellerOrderId: so.id,
          customerId: so.customerId,
          sellerId: so.sellerId,
          reason: reason.slice(0, 140),
          details: details.slice(0, 1000),
          status: 'open' as const,
          createdAt: new Date().toISOString(),
        };
        ns.disputes.unshift(dispute);
        so.fulfilmentStatus = 'refund_requested';
        demoEngine.appendLog(ns, 'customer', 'dispute_opened', `Opened dispute ${dispute.id} on ${so.id}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ disputes: ns.disputes, sellerOrders: ns.sellerOrders, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Dispute Error]', err);
        return res.status(500).json({ error: 'Unable to open demo dispute.' });
      }
    }
  );

  // Demo Seller Mutations (Strictly Enforced Role: 'seller')
  app.post(
    '/api/demo/seller/products',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<Product>;
        if (!body.title || !body.description || !body.priceMinor || body.priceMinor <= 0) {
          return res.status(400).json({ error: 'Title, description, and positive price are required.' });
        }
        if (body.digitalMeta?.liveDemoUrl && !isSafeHttpsUrl(body.digitalMeta.liveDemoUrl)) {
          return res.status(400).json({ error: 'Live demo URL must use https://.' });
        }

        const store = ns.stores.find((s) => s.ownerId === 'demo-seller-1')!;
        const isDigital = body.productType === 'digital';
        const newProduct: Product = {
          id: `prod-demo-${Date.now()}`,
          sellerId: 'demo-seller-1',
          storeId: store.id,
          storeName: store.name,
          storeVerified: store.verified,
          departmentSlug: isDigital ? 'digital-products' : body.departmentSlug || 'electronics',
          categorySlug: body.categorySlug || (isDigital ? 'nextjs-templates' : 'hardware'),
          productType: isDigital ? 'digital' : 'physical',
          title: body.title.slice(0, 140),
          slug: `${body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
          description: body.description.slice(0, 4000),
          brand: (body.brand || store.name).slice(0, 80),
          currency: 'USD',
          priceMinor: Math.round(body.priceMinor),
          compareAtPriceMinor: body.compareAtPriceMinor ? Math.round(body.compareAtPriceMinor) : undefined,
          stockQty: isDigital ? 999 : Math.max(0, Math.round(body.stockQty ?? 10)),
          imageUrls: [
            body.imageUrls?.[0] ||
              (isDigital
                ? '/src/assets/images/digital_ui_kit_preview_1795615501746.jpg'
                : '/src/assets/images/product_mechanical_keyboard_1795615500409.jpg'),
          ],
          variations: body.variations || [],
          badges: ['Submitted'],
          isFlashDeal: Boolean(body.isFlashDeal),
          isFeatured: false,
          approvalStatus: 'pending',
          ratingAvg: 0,
          reviewCount: 0,
          salesCount: 0,
          digitalMeta: isDigital
            ? {
                version: body.digitalMeta?.version || '1.0.0',
                liveDemoUrl: body.digitalMeta?.liveDemoUrl,
                docsUrl: body.digitalMeta?.docsUrl,
                licensePricingMultiplier: { personal: 1, commercial: 2.5, extended: 5 },
                downloadLimit: body.digitalMeta?.downloadLimit ?? 10,
                downloadExpiryDays: body.digitalMeta?.downloadExpiryDays ?? 365,
                assetKey: 'velox-checkout-starter-v1.8.2',
                fileFormat: body.digitalMeta?.fileFormat || 'ZIP Archive',
                fileSizeLabel: body.digitalMeta?.fileSizeLabel || '12.4 MB',
                changelog: 'Initial release.',
              }
            : undefined,
          createdAt: new Date().toISOString(),
        };

        ns.products.unshift(newProduct);
        demoEngine.appendLog(ns, 'seller', 'product_submitted', `Submitted "${newProduct.title}" for approval.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ product: newProduct, products: ns.products, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Seller Product Create Error]', err);
        return res.status(500).json({ error: 'Unable to create demo product.' });
      }
    }
  );

  app.patch(
    '/api/demo/seller/products/:id',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const product = ns.products.find((p) => p.id === req.params.id && p.sellerId === 'demo-seller-1');
        if (!product) return res.status(404).json({ error: 'Seller product not found.' });

        const { title, priceMinor, stockQty, description } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as Partial<Product>;
        if (title) product.title = title.slice(0, 140);
        if (description) product.description = description.slice(0, 4000);
        if (typeof priceMinor === 'number' && priceMinor > 0) product.priceMinor = Math.round(priceMinor);
        if (typeof stockQty === 'number' && stockQty >= 0) product.stockQty = Math.round(stockQty);

        demoEngine.appendLog(ns, 'seller', 'product_updated', `Updated listing "${product.title}".`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ product, products: ns.products, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Seller Product Update Error]', err);
        return res.status(500).json({ error: 'Unable to update demo product.' });
      }
    }
  );

  app.delete(
    '/api/demo/seller/products/:id',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const idx = ns.products.findIndex((p) => p.id === req.params.id && p.sellerId === 'demo-seller-1');
        if (idx === -1) return res.status(404).json({ error: 'Seller product not found.' });
        const [removed] = ns.products.splice(idx, 1);
        demoEngine.appendLog(ns, 'seller', 'product_deleted', `Deleted demo listing "${removed.title}".`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ products: ns.products, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Seller Product Delete Error]', err);
        return res.status(500).json({ error: 'Unable to delete demo product.' });
      }
    }
  );

  app.patch(
    '/api/demo/seller/orders/:id',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { status, trackingNumber, carrier } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          status: SellerFulfilmentStatus;
          trackingNumber?: string;
          carrier?: string;
        };
        const updated = demoEngine.updateSellerOrderStatus(
          ns,
          req.params.id,
          'demo-seller-1',
          status,
          trackingNumber,
          carrier
        );
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({
          sellerOrder: updated,
          state: ns,
          sellerBalances: demoEngine.computeSellerBalances(ns, 'demo-seller-1'),
          demoStateToken,
        });
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed.' });
      }
    }
  );

  app.post(
    '/api/demo/seller/withdrawals',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { amountMinor, bankName, accountNumberLast4, accountName } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          amountMinor: number;
          bankName: string;
          accountNumberLast4: string;
          accountName: string;
        };
        const withdrawal = demoEngine.requestSellerWithdrawal(ns, 'demo-seller-1', {
          amountMinor,
          bankName,
          accountNumberLast4,
          accountName,
        });
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({
          withdrawal,
          state: ns,
          sellerBalances: demoEngine.computeSellerBalances(ns, 'demo-seller-1'),
          demoStateToken,
        });
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Withdrawal failed.' });
      }
    }
  );

  app.patch(
    '/api/demo/seller/store',
    demoRateLimiter,
    requireDemoSession(['seller']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const store = ns.stores.find((s) => s.ownerId === 'demo-seller-1');
        if (!store) return res.status(404).json({ error: 'Store not found.' });
        const { name, description, policies, shippingSummary } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as Partial<typeof store>;
        if (name) store.name = name.slice(0, 100);
        if (description) store.description = description.slice(0, 1000);
        if (policies) store.policies = policies.slice(0, 1200);
        if (shippingSummary) store.shippingSummary = shippingSummary.slice(0, 300);
        demoEngine.appendLog(ns, 'seller', 'store_updated', `Updated storefront settings for ${store.name}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ store, stores: ns.stores, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Seller Store Error]', err);
        return res.status(500).json({ error: 'Unable to update demo store settings.' });
      }
    }
  );

  // Demo Administrator Mutations (Strictly Enforced Role: 'admin')
  app.patch(
    '/api/demo/admin/customers/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const cust = ns.customers.find((c) => c.id === req.params.id);
        if (!cust) return res.status(404).json({ error: 'Demo customer not found.' });
        const { status } = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          status: 'active' | 'suspended';
        };
        if (status !== 'active' && status !== 'suspended') {
          return res.status(400).json({ error: 'Invalid status.' });
        }
        cust.status = status;
        demoEngine.appendLog(ns, 'admin', 'customer_status', `Set customer ${cust.email} to ${status}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ customers: ns.customers, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Customer Error]', err);
        return res.status(500).json({ error: 'Unable to update demo customer status.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/sellers/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const store = ns.stores.find((s) => s.id === req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found.' });
        const { status, verified } = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          status?: 'active' | 'suspended';
          verified?: boolean;
        };
        if (status === 'active' || status === 'suspended') store.status = status;
        if (typeof verified === 'boolean') store.verified = verified;
        demoEngine.appendLog(ns, 'admin', 'seller_moderated', `Updated store ${store.name} (${store.status}).`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ stores: ns.stores, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Seller Error]', err);
        return res.status(500).json({ error: 'Unable to update demo store.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/applications/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const appRecord = ns.sellerApplications.find((a) => a.id === req.params.id);
        if (!appRecord) return res.status(404).json({ error: 'Seller application not found.' });
        const { status, reviewNote } = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          status: 'approved' | 'rejected';
          reviewNote?: string;
        };
        if (status !== 'approved' && status !== 'rejected') {
          return res.status(400).json({ error: 'Invalid status.' });
        }
        appRecord.status = status;
        appRecord.reviewNote = reviewNote?.slice(0, 400);

        if (status === 'approved' && !ns.stores.some((s) => s.ownerId === appRecord.applicantId)) {
          ns.stores.push({
            id: `store-${appRecord.applicantId}`,
            ownerId: appRecord.applicantId,
            name: appRecord.businessName,
            slug: appRecord.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: appRecord.description,
            logoUrl: '/src/assets/images/product_audio_headphones_1795615501048.jpg',
            bannerUrl: '/src/assets/images/hero_marketplace_showcase_1795615501315.jpg',
            countryCode: appRecord.countryCode,
            policies: 'Standard 14-day DevStore international return guarantee.',
            shippingSummary: 'International Courier Shipping',
            verified: true,
            status: 'active',
            ratingAvg: 5.0,
            followerCount: 1,
            createdAt: new Date().toISOString(),
          });
        }
        demoEngine.appendLog(ns, 'admin', 'application_reviewed', `${appRecord.businessName} ${status}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ sellerApplications: ns.sellerApplications, stores: ns.stores, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Application Error]', err);
        return res.status(500).json({ error: 'Unable to review seller application.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/products/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const product = ns.products.find((p) => p.id === req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const { approvalStatus, isFeatured } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          approvalStatus?: 'approved' | 'rejected' | 'pending';
          isFeatured?: boolean;
        };
        if (approvalStatus) {
          product.approvalStatus = approvalStatus;
          product.badges = approvalStatus === 'approved' ? ['Verified'] : ['Rejected'];
        }
        if (typeof isFeatured === 'boolean') product.isFeatured = isFeatured;
        demoEngine.appendLog(
          ns,
          'admin',
          'product_moderated',
          `Product "${product.title}" marked ${product.approvalStatus}.`
        );
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ products: ns.products, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Product Error]', err);
        return res.status(500).json({ error: 'Unable to moderate product.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/withdrawals/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const w = ns.withdrawals.find((item) => item.id === req.params.id);
        if (!w) return res.status(404).json({ error: 'Withdrawal request not found.' });
        const { status, adminNote } = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          status: 'approved' | 'rejected' | 'paid';
          adminNote?: string;
        };
        if (!['approved', 'rejected', 'paid'].includes(status)) {
          return res.status(400).json({ error: 'Invalid withdrawal status.' });
        }
        w.status = status;
        w.adminNote = adminNote?.slice(0, 300);
        if (status === 'approved' || status === 'paid') {
          ns.transactions.unshift({
            id: `tx-demo-${Date.now()}`,
            sellerId: w.sellerId,
            userId: w.sellerId,
            type: 'withdrawal',
            provider: 'manual_settlement',
            reference: `WDR_${w.id}`,
            currency: w.currency,
            amountMinor: w.amountMinor,
            status: status === 'paid' ? 'completed' : 'pending',
            note: `Admin ${status} withdrawal for ${w.storeName}`,
            createdAt: new Date().toISOString(),
          });
        }
        demoEngine.appendLog(ns, 'admin', 'withdrawal_reviewed', `Withdrawal ${w.id} marked ${status}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({
          withdrawals: ns.withdrawals,
          transactions: ns.transactions,
          sellerBalances: demoEngine.computeSellerBalances(ns, 'demo-seller-1'),
          demoStateToken,
        });
      } catch (err) {
        console.error('[DevStore Demo Admin Withdrawal Error]', err);
        return res.status(500).json({ error: 'Unable to process withdrawal.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/disputes/:id',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const dispute = ns.disputes.find((d) => d.id === req.params.id);
        if (!dispute) return res.status(404).json({ error: 'Dispute not found.' });
        const { status, resolutionNote } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          status: 'under_review' | 'resolved_refund' | 'resolved_closed';
          resolutionNote?: string;
        };
        dispute.status = status;
        dispute.resolutionNote = resolutionNote?.slice(0, 500);
        if (status === 'resolved_refund') {
          const so = ns.sellerOrders.find((s) => s.id === dispute.sellerOrderId);
          if (so) so.fulfilmentStatus = 'refunded';
        }
        demoEngine.appendLog(ns, 'admin', 'dispute_resolved', `Dispute ${dispute.id} updated to ${status}.`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ disputes: ns.disputes, sellerOrders: ns.sellerOrders, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Dispute Error]', err);
        return res.status(500).json({ error: 'Unable to update dispute.' });
      }
    }
  );

  app.post(
    '/api/demo/admin/departments',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { name, description, isDigital } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as {
          name?: string;
          description?: string;
          isDigital?: boolean;
        };
        if (!name || name.trim().length < 2) {
          return res.status(400).json({ error: 'Department name required.' });
        }
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        ns.departments.push({
          id: `dept-${Date.now()}`,
          name: name.trim().slice(0, 80),
          slug,
          description: (description || '').slice(0, 300),
          isDigital: Boolean(isDigital),
          sortOrder: ns.departments.length + 1,
          active: true,
        });
        demoEngine.appendLog(ns, 'admin', 'department_created', `Created category "${name.trim()}".`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ departments: ns.departments, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Department Error]', err);
        return res.status(500).json({ error: 'Unable to create department.' });
      }
    }
  );

  app.patch(
    '/api/demo/admin/config',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const {
          marketplaceName,
          defaultCurrency,
          supportedCurrencies,
          exchangeRates,
          commissionRateBps,
          paystackEnabled,
          flutterwaveEnabled,
          flashSaleBannerText,
        } = (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<typeof ns.platformConfig>;
        if (marketplaceName) ns.platformConfig.marketplaceName = marketplaceName.slice(0, 60);
        if (defaultCurrency && VALID_CURRENCIES.includes(defaultCurrency)) {
          ns.platformConfig.defaultCurrency = defaultCurrency;
        }
        if (Array.isArray(supportedCurrencies)) {
          const filtered = supportedCurrencies.filter((c) => VALID_CURRENCIES.includes(c));
          if (filtered.length > 0) {
            ns.platformConfig.supportedCurrencies = Array.from(new Set(filtered));
          }
        }
        if (exchangeRates && typeof exchangeRates === 'object') {
          ns.platformConfig.exchangeRates = validateExchangeRates(exchangeRates);
          ns.platformConfig.exchangeRateMode = 'manual';
          ns.platformConfig.exchangeRateUpdatedAt = new Date().toISOString();
          demoEngine.appendLog(
            ns,
            'admin',
            'exchange_rates_updated',
            `Updated manual FX rates: 1 USD = ${ns.platformConfig.exchangeRates.NGN} NGN, ${ns.platformConfig.exchangeRates.GBP} GBP, ${ns.platformConfig.exchangeRates.EUR} EUR.`
          );
        }
        if (typeof commissionRateBps === 'number') {
          demoEngine.recalculateAllDemoCommissions(ns, commissionRateBps);
        }
        if (typeof paystackEnabled === 'boolean') ns.platformConfig.paystackEnabled = paystackEnabled;
        if (typeof flutterwaveEnabled === 'boolean') ns.platformConfig.flutterwaveEnabled = flutterwaveEnabled;
        if (typeof flashSaleBannerText === 'string') {
          ns.platformConfig.flashSaleBannerText = flashSaleBannerText.slice(0, 200);
        }
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ platformConfig: ns.platformConfig, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Config Error]', err);
        return res.status(500).json({ error: 'Unable to update demo platform configuration.' });
      }
    }
  );

  app.post(
    '/api/demo/admin/coupons',
    demoRateLimiter,
    requireDemoSession(['admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const ns = await hydrateDemoNamespace(req, req.demoSession!.namespaceId);
        const { code, discountPercent } = (
          req.body && typeof req.body === 'object' ? req.body : {}
        ) as { code?: string; discountPercent?: number };
        if (!code || !discountPercent || discountPercent < 1 || discountPercent > 90) {
          return res.status(400).json({ error: 'Valid coupon code and 1-90% discount required.' });
        }
        const cleanCode = code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
        ns.coupons.unshift({
          id: `cpn-${Date.now()}`,
          code: cleanCode,
          discountPercent: Math.round(discountPercent),
          active: true,
        });
        demoEngine.appendLog(ns, 'admin', 'coupon_created', `Created coupon ${cleanCode} (${discountPercent}% off).`);
        const demoStateToken = await commitDemoNamespace(ns, res);
        return res.json({ coupons: ns.coupons, demoStateToken });
      } catch (err) {
        console.error('[DevStore Demo Admin Coupon Error]', err);
        return res.status(500).json({ error: 'Unable to create coupon.' });
      }
    }
  );

  // Guaranteed JSON 404 for unknown /api/* routes (never fall through to HTML SPA or plain text)
  app.use('/api', (_req: Request, res: Response) => {
    return res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global Express JSON error middleware (prevents HTML/plain-text error pages on /api/*)
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    console.error(`[DevStore API Error] ${req.method} ${req.path}`, err);
    if (res.headersSent) {
      return next(err);
    }
    const statusCandidate =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode)
        : 500;
    const status = Number.isInteger(statusCandidate) && statusCandidate >= 400 && statusCandidate < 600
      ? statusCandidate
      : 500;
    return res.status(status).json({
      error: status >= 500 ? 'Internal server error. Please try again.' : 'Request could not be processed.',
    });
  });

  return app;
}
