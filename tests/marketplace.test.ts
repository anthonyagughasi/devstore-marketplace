import crypto from 'crypto';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { demoEngine } from '../src/server/demo/demoEngine.js';
import { paymentTransactionStore } from '../src/server/payments/index.js';
import { buildMultiVendorOrderSplit } from '../src/server/payments/types.js';
import { getAdminAuth, resolvePrivateAssetPath, signHmacToken } from '../src/server/security.js';
import { SEED_PRODUCTS } from '../src/shared/catalogData.js';
import {
  calculateCommissionSplit,
  convertMinorAmount,
  getLicenseUnitPriceMinor,
} from '../src/shared/currency.js';
import type { Product } from '../src/shared/types.js';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  process.env.SESSION_SIGNING_SECRET = 'test-signing-secret-for-vitest-suite-2026';
  process.env.PAYSTACK_WEBHOOK_SECRET = 'test-paystack-webhook-secret';
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'test-flutterwave-webhook-hash';

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function startDemoSession(role: 'customer' | 'seller' | 'admin', existingNamespaceId?: string) {
  const res = await fetch(`${baseUrl}/api/demo/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, existingNamespaceId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    demoToken: string;
    demoStateToken: string;
    namespaceId: string;
    role: string;
    expiresAt: string;
  };
}

describe('DevStore Core Currency, Commission & Multi-Vendor Splitting', () => {
  it('calculates basis-point commissions with zero rounding leakage', () => {
    const split = calculateCommissionSplit(19999, 1000); // 10%
    expect(split.commissionMinor + split.netEarningsMinor).toBe(19999);
    expect(split.commissionMinor).toBe(2000);
    expect(split.netEarningsMinor).toBe(17999);

    const splitOdd = calculateCommissionSplit(333, 1250); // 12.5%
    expect(splitOdd.commissionMinor + splitOdd.netEarningsMinor).toBe(333);
  });

  it('converts currencies cleanly and computes digital license multipliers', () => {
    expect(convertMinorAmount(10000, 'USD', 'USD')).toBe(10000);
    expect(convertMinorAmount(10000, 'USD', 'NGN')).toBe(15800000);

    const base = 7900;
    expect(getLicenseUnitPriceMinor(base, 'personal')).toBe(7900);
    expect(getLicenseUnitPriceMinor(base, 'commercial', { personal: 1, commercial: 2.5, extended: 5 })).toBe(19750);
    expect(getLicenseUnitPriceMinor(base, 'extended', { personal: 1, commercial: 2.5, extended: 5 })).toBe(39500);
  });

  it('splits mixed physical & digital multi-vendor carts accurately and blocks out-of-stock orders', () => {
    const productsById = new Map<string, Product>(SEED_PRODUCTS.map((p) => [p.id, { ...p }]));
    const keyboard = SEED_PRODUCTS.find((p) => p.id === 'prod-kanso-75-keyboard')!;
    const iconPack = SEED_PRODUCTS.find((p) => p.id === 'prod-isometric-dev-icons')!;

    expect(keyboard.sellerId).not.toBe(iconPack.sellerId);

    const split = buildMultiVendorOrderSplit({
      cartItems: [
        { productId: keyboard.id, quantity: 1 },
        { productId: iconPack.id, quantity: 2, selectedLicense: 'commercial' },
      ],
      productsById,
      commissionRateBps: 1000,
      discountPercent: 10,
      checkoutCurrency: 'USD',
    });

    expect(split.sellerOrders.length).toBe(2);
    for (const so of split.sellerOrders) {
      expect(so.commissionMinor + so.netEarningsMinor).toBe(so.grossMinor);
    }

    expect(() =>
      buildMultiVendorOrderSplit({
        cartItems: [{ productId: keyboard.id, quantity: 9999 }],
        productsById,
        commissionRateBps: 1000,
        checkoutCurrency: 'USD',
      })
    ).toThrow(/Insufficient stock/);
  });
});

describe('DevStore Production Auth Isolation & Payment Webhook Security', () => {
  it('blocks unauthenticated and demo tokens from accessing production payment/email endpoints', async () => {
    const demo = await startDemoSession('admin');

    const unauthPay = await fetch(`${baseUrl}/api/payments/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'paystack', amountMinor: 5000, currency: 'NGN' }),
    });
    expect(unauthPay.status).toBe(401);

    const demoHeaderPay = await fetch(`${baseUrl}/api/payments/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': demo.demoToken,
      },
      body: JSON.stringify({ provider: 'paystack', amountMinor: 5000, currency: 'NGN' }),
    });
    expect(demoHeaderPay.status).toBe(403);

    const demoBearerEmail = await fetch(`${baseUrl}/api/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${demo.demoToken}`,
      },
      body: JSON.stringify({
        to: 'user@example.com',
        event: 'new_order',
        subject: 'Test',
        htmlBody: '<p>Test</p>',
      }),
    });
    expect(demoBearerEmail.status).toBe(403);
  });

  it('verifies Paystack HMAC-SHA512 webhook signatures and enforces idempotency', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 881234,
        reference: 'PSK_LIVE_IDEM_1',
        amount: 250000,
        currency: 'NGN',
        status: 'success',
      },
    });

    const badRes = await fetch(`${baseUrl}/api/webhooks/paystack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': 'tampered-signature',
      },
      body: payload,
    });
    expect(badRes.status).toBe(401);

    const validSig = crypto
      .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET!)
      .update(payload)
      .digest('hex');

    const firstRes = await fetch(`${baseUrl}/api/webhooks/paystack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': validSig,
      },
      body: payload,
    });
    expect(firstRes.status).toBe(200);
    const firstJson = (await firstRes.json()) as { duplicate: boolean };
    expect(firstJson.duplicate).toBe(false);

    const dupRes = await fetch(`${baseUrl}/api/webhooks/paystack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': validSig,
      },
      body: payload,
    });
    expect(dupRes.status).toBe(200);
    const dupJson = (await dupRes.json()) as { duplicate: boolean };
    expect(dupJson.duplicate).toBe(true);
  });

  it('verifies Flutterwave verif-hash header and rejects duplicates', async () => {
    const payload = JSON.stringify({
      event: 'charge.completed',
      data: {
        id: 44192,
        tx_ref: 'FLW_LIVE_IDEM_1',
        amount: 99.5,
        currency: 'USD',
        status: 'successful',
      },
    });

    const badRes = await fetch(`${baseUrl}/api/webhooks/flutterwave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'verif-hash': 'wrong-hash',
      },
      body: payload,
    });
    expect(badRes.status).toBe(401);

    const okRes = await fetch(`${baseUrl}/api/webhooks/flutterwave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'verif-hash': process.env.FLUTTERWAVE_WEBHOOK_SECRET!,
      },
      body: payload,
    });
    expect(okRes.status).toBe(200);
    const first = (await okRes.json()) as { duplicate: boolean };
    expect(first.duplicate).toBe(false);

    const secondRes = await fetch(`${baseUrl}/api/webhooks/flutterwave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'verif-hash': process.env.FLUTTERWAVE_WEBHOOK_SECRET!,
      },
      body: payload,
    });
    const second = (await secondRes.json()) as { duplicate: boolean };
    expect(second.duplicate).toBe(true);
  });
  it('routes Paystack and Flutterwave checkouts separately, never opens Paystack for Flutterwave, and enforces server-side verification', async () => {
    paymentTransactionStore.resetForTests();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack_mock';
    process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_mock';

    const adminAuthInstance = await getAdminAuth();
    const verifySpy = vi.spyOn(adminAuthInstance, 'verifyIdToken').mockResolvedValue({
      uid: 'live-buyer-1',
      email: 'buyer@devstore.example.com',
      aud: 'test',
      auth_time: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' },
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/test',
      sub: 'live-buyer-1',
    } as never);

    const realFetch = globalThis.fetch;
    const outboundCalls: Array<{ url: string; body?: unknown }> = [];

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();

        if (urlStr.startsWith('https://api.paystack.co/transaction/initialize')) {
          const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
          outboundCalls.push({ url: urlStr, body: parsedBody });
          return new Response(
            JSON.stringify({
              status: true,
              message: 'Authorization URL created',
              data: {
                authorization_url: `https://checkout.paystack.com/${parsedBody.reference}`,
                reference: parsedBody.reference,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.flutterwave.com/v3/payments')) {
          const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
          outboundCalls.push({ url: urlStr, body: parsedBody });
          return new Response(
            JSON.stringify({
              status: 'success',
              message: 'Hosted Link',
              data: {
                link: `https://checkout.flutterwave.com/v3/hosted/pay/${parsedBody.tx_ref}`,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.paystack.co/transaction/verify/')) {
          const ref = decodeURIComponent(urlStr.split('/').pop() || '');
          const tx = paymentTransactionStore.getByReference(ref);
          const scenario = ref.includes('FAIL')
            ? 'failed'
            : ref.includes('CANCEL')
            ? 'abandoned'
            : 'success';

          return new Response(
            JSON.stringify({
              status: true,
              message: 'Verification successful',
              data: {
                id: 900123,
                reference: ref,
                amount: tx?.amountMinor ?? 15000,
                currency: tx?.currency ?? 'USD',
                status: scenario,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.flutterwave.com/v3/transactions/')) {
          const parsedUrl = new URL(urlStr);
          const txRefParam = parsedUrl.searchParams.get('tx_ref');
          const flwTxId = urlStr.includes('/verify_by_reference')
            ? undefined
            : urlStr.split('/transactions/')[1]?.split('/')[0];

          const flwInitCalls = outboundCalls
            .filter((c) => c.url.includes('flutterwave.com/v3/payments'))
            .map((c) => c.body as { tx_ref?: string });

          const effectiveRef =
            txRefParam ||
            (flwTxId === '777222'
              ? flwInitCalls[0]?.tx_ref
              : flwInitCalls[flwInitCalls.length - 1]?.tx_ref) ||
            `FLW_MOCK_${flwTxId || '0'}`;

          const storedTx = paymentTransactionStore.getByReference(effectiveRef);
          const flwStatus =
            flwTxId === '777111'
              ? 'successful'
              : flwTxId === '777222'
              ? 'failed'
              : flwTxId === '777333'
              ? 'cancelled'
              : 'failed';

          return new Response(
            JSON.stringify({
              status: flwTxId ? 'success' : 'error',
              message: flwTxId ? 'Transaction fetched successfully' : 'No transaction was found for this id',
              data: flwTxId
                ? {
                    id: Number(flwTxId),
                    tx_ref: storedTx?.reference || effectiveRef,
                    amount: Number((((storedTx?.amountMinor ?? 25000) as number) / 100).toFixed(2)),
                    currency: storedTx?.currency || 'USD',
                    status: flwStatus,
                  }
                : undefined,
            }),
            { status: flwTxId ? 200 : 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return realFetch(input, init);
      });

    try {
      const sharedIdempotencyAttempt = 'CHK_SHARED_CART_BUG_REPRO';

      // 1. Initialize Paystack checkout first
      const pskInitRes = await realFetch(`${baseUrl}/api/payments/paystack/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 15000,
          currency: 'NGN',
          orderId: 'ord-psk-1',
          idempotencyKey: sharedIdempotencyAttempt,
        }),
      });
      expect(pskInitRes.status).toBe(200);
      const pskInit = (await pskInitRes.json()) as {
        configured: boolean;
        provider: string;
        reference: string;
        orderId: string;
        authorizationUrl: string;
      };
      expect(pskInit.configured).toBe(true);
      expect(pskInit.provider).toBe('paystack');
      expect(pskInit.reference.startsWith('PSK_LIVE_')).toBe(true);
      expect(pskInit.authorizationUrl).toContain('checkout.paystack.com');

      // 2. Now select Flutterwave even with the SAME base idempotencyKey -> MUST NOT return Paystack!
      const flwInitRes = await realFetch(`${baseUrl}/api/payments/flutterwave/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 25000,
          currency: 'USD',
          orderId: 'ord-flw-1',
          idempotencyKey: sharedIdempotencyAttempt,
        }),
      });
      expect(flwInitRes.status).toBe(200);
      const flwInit = (await flwInitRes.json()) as {
        configured: boolean;
        provider: string;
        reference: string;
        orderId: string;
        authorizationUrl: string;
      };
      expect(flwInit.configured).toBe(true);
      expect(flwInit.provider).toBe('flutterwave');
      expect(flwInit.reference.startsWith('FLW_LIVE_')).toBe(true);
      expect(flwInit.authorizationUrl).toContain('checkout.flutterwave.com');
      expect(flwInit.authorizationUrl).not.toContain('paystack');

      // Verify Flutterwave outbound payload carried provider=flutterwave callback URL
      const flwOutbound = outboundCalls.find((c) => c.url.includes('flutterwave.com/v3/payments'))
        ?.body as { redirect_url?: string };
      expect(flwOutbound?.redirect_url).toContain('provider=flutterwave');

      // 3. Before server verification, both orders & transactions remain strictly 'pending'
      const preTxRes = await realFetch(
        `${baseUrl}/api/payments/transactions/${encodeURIComponent(flwInit.reference)}`,
        { headers: { Authorization: 'Bearer live-firebase-token' } }
      );
      expect(preTxRes.status).toBe(200);
      const preTx = (await preTxRes.json()) as {
        transaction: { provider: string; status: string };
        order: { orderStatus: string; paymentStatus: string };
      };
      expect(preTx.transaction.provider).toBe('flutterwave');
      expect(preTx.transaction.status).toBe('pending');
      expect(preTx.order.orderStatus).toBe('pending');

      // 4. Cross-provider isolation: Paystack verify MUST reject FLW reference, Flutterwave verify MUST reject PSK reference
      const wrongPskVerify = await realFetch(`${baseUrl}/api/payments/paystack/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: flwInit.reference }),
      });
      expect(wrongPskVerify.status).toBe(400);

      const wrongFlwVerify = await realFetch(`${baseUrl}/api/payments/flutterwave/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: pskInit.reference }),
      });
      expect(wrongFlwVerify.status).toBe(400);

      // 5. Successful Paystack server verification transitions Paystack order to 'processing' / 'paid'
      const pskOkRes = await realFetch(`${baseUrl}/api/payments/paystack/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: pskInit.reference }),
      });
      expect(pskOkRes.status).toBe(200);
      const pskOk = (await pskOkRes.json()) as {
        verified: boolean;
        status: string;
        orderStatus: string;
        provider: string;
      };
      expect(pskOk.provider).toBe('paystack');
      expect(pskOk.verified).toBe(true);
      expect(pskOk.status).toBe('paid');
      expect(pskOk.orderStatus).toBe('processing');

      // 6. Spoofed frontend callbackStatus='successful' CANNOT mark Flutterwave paid when gateway fails
      const flwSpoofRes = await realFetch(`${baseUrl}/api/payments/flutterwave/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          reference: flwInit.reference,
          transactionId: '777222', // Mock returns 'failed'
          callbackStatus: 'successful',
        }),
      });
      expect(flwSpoofRes.status).toBe(200);
      const flwSpoof = (await flwSpoofRes.json()) as {
        verified: boolean;
        status: string;
        orderStatus: string;
      };
      expect(flwSpoof.verified).toBe(false);
      expect(flwSpoof.status).toBe('failed');
      expect(flwSpoof.orderStatus).toBe('cancelled');

      // 7. Cancelled Flutterwave callback marks transaction & order 'cancelled'
      const flwCancelInitRes = await realFetch(`${baseUrl}/api/payments/flutterwave/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 12000,
          currency: 'USD',
          orderId: 'ord-flw-cancel',
          idempotencyKey: 'CHK_FLW_CANCEL_1',
        }),
      });
      const flwCancelInit = (await flwCancelInitRes.json()) as { reference: string };
      const flwCancelRes = await realFetch(`${baseUrl}/api/payments/flutterwave/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          reference: flwCancelInit.reference,
          callbackStatus: 'cancelled',
        }),
      });
      expect(flwCancelRes.status).toBe(200);
      const flwCancel = (await flwCancelRes.json()) as {
        verified: boolean;
        status: string;
        orderStatus: string;
      };
      expect(flwCancel.verified).toBe(false);
      expect(flwCancel.status).toBe('cancelled');
      expect(flwCancel.orderStatus).toBe('cancelled');

      // 8. Successful Flutterwave verification transitions order to 'processing' / 'paid'
      const flwSuccessInitRes = await realFetch(`${baseUrl}/api/payments/flutterwave/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 31000,
          currency: 'EUR',
          orderId: 'ord-flw-success',
          idempotencyKey: 'CHK_FLW_OK_1',
        }),
      });
      const flwSuccessInit = (await flwSuccessInitRes.json()) as { reference: string };
      const flwSuccessRes = await realFetch(`${baseUrl}/api/payments/flutterwave/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          reference: flwSuccessInit.reference,
          transactionId: '777111',
        }),
      });
      expect(flwSuccessRes.status).toBe(200);
      const flwSuccess = (await flwSuccessRes.json()) as {
        verified: boolean;
        status: string;
        orderStatus: string;
        provider: string;
      };
      expect(flwSuccess.provider).toBe('flutterwave');
      expect(flwSuccess.verified).toBe(true);
      expect(flwSuccess.status).toBe('paid');
      expect(flwSuccess.orderStatus).toBe('processing');
    } finally {
      verifySpy.mockRestore();
      fetchSpy.mockRestore();
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.FLUTTERWAVE_SECRET_KEY;
    }
  });
});

describe('DevStore Demo Mode RBAC, Flows & Sandbox Isolation', () => {
  it('enforces server-side role checks in Demo Mode', async () => {
    const customerDemo = await startDemoSession('customer');
    const sellerDemo = await startDemoSession('seller', customerDemo.namespaceId);

    // Customer cannot create seller products
    const custCreateProd = await fetch(`${baseUrl}/api/demo/seller/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': customerDemo.demoToken,
      },
      body: JSON.stringify({
        title: 'Unauthorized Item',
        description: 'Should be blocked',
        priceMinor: 5000,
      }),
    });
    expect(custCreateProd.status).toBe(403);

    // Seller cannot mutate admin config
    const sellerEditConfig = await fetch(`${baseUrl}/api/demo/admin/config`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': sellerDemo.demoToken,
      },
      body: JSON.stringify({ commissionRateBps: 0 }),
    });
    expect(sellerEditConfig.status).toBe(403);
  });

  it('supports seller product CRUD + admin moderation + namespace isolation', async () => {
    const sellerA = await startDemoSession('seller');
    const adminA = await startDemoSession('admin', sellerA.namespaceId);
    const otherNamespace = await startDemoSession('customer');

    // Create product in namespace A
    const createRes = await fetch(`${baseUrl}/api/demo/seller/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': sellerA.demoToken,
      },
      body: JSON.stringify({
        title: 'Studio Calibration Mic',
        description: 'Measurement condenser microphone for room calibration.',
        priceMinor: 12900,
        stockQty: 15,
        productType: 'physical',
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { product: Product };
    expect(created.product.approvalStatus).toBe('pending');

    // Update stock
    const patchRes = await fetch(`${baseUrl}/api/demo/seller/products/${created.product.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': sellerA.demoToken,
      },
      body: JSON.stringify({ stockQty: 20 }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { product: Product };
    expect(patched.product.stockQty).toBe(20);

    // Admin approves product in namespace A
    const approveRes = await fetch(`${baseUrl}/api/demo/admin/products/${created.product.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': adminA.demoToken,
      },
      body: JSON.stringify({ approvalStatus: 'approved', isFeatured: true }),
    });
    expect(approveRes.status).toBe(200);

    // Verify namespace B cannot see namespace A's created product
    const stateBRes = await fetch(`${baseUrl}/api/demo/state`, {
      headers: { 'x-demo-token': otherNamespace.demoToken },
    });
    const stateB = (await stateBRes.json()) as { state: { products: Product[] } };
    expect(stateB.state.products.some((p) => p.id === created.product.id)).toBe(false);
  });

  it('simulates failed/cancelled/pending/success payments, inventory decrement & digital entitlements', async () => {
    const cust = await startDemoSession('customer');

    // Failed simulation preserves cart & stock
    const failRes = await fetch(`${baseUrl}/api/demo/payments/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': cust.demoToken,
      },
      body: JSON.stringify({
        provider: 'paystack',
        outcome: 'failed',
        currency: 'USD',
      }),
    });
    expect(failRes.status).toBe(200);
    const failJson = (await failRes.json()) as {
      paymentStatus: string;
      state: { customerCart: unknown[] };
    };
    expect(failJson.paymentStatus).toBe('failed');
    expect(failJson.state.customerCart.length).toBeGreaterThan(0);

    // Successful simulation creates multi-vendor split orders, clears cart, updates inventory, grants digital entitlement
    const okRes = await fetch(`${baseUrl}/api/demo/payments/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': cust.demoToken,
      },
      body: JSON.stringify({
        provider: 'flutterwave',
        outcome: 'success',
        currency: 'USD',
      }),
    });
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as {
      paymentStatus: string;
      sellerOrders: unknown[];
      entitlements: { id: string }[];
      state: { customerCart: unknown[] };
    };
    expect(okJson.paymentStatus).toBe('paid');
    expect(okJson.sellerOrders.length).toBe(2);
    expect(okJson.entitlements.length).toBe(1);
    expect(okJson.state.customerCart.length).toBe(0);
  });

  it('blocks withdrawing pending/unearned funds while permitting available balance withdrawals', async () => {
    const seller = await startDemoSession('seller');
    const stateRes = await fetch(`${baseUrl}/api/demo/state`, {
      headers: { 'x-demo-token': seller.demoToken },
    });
    const stateJson = (await stateRes.json()) as {
      sellerBalances: { availableBalanceMinor: number; pendingEarningsMinor: number };
    };

    const excessiveAmount = stateJson.sellerBalances.availableBalanceMinor + 50000;
    const failWithdraw = await fetch(`${baseUrl}/api/demo/seller/withdrawals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': seller.demoToken,
      },
      body: JSON.stringify({
        amountMinor: excessiveAmount,
        bankName: 'Mercury Bank',
        accountNumberLast4: '4819',
        accountName: 'Atelier Systems LLC',
      }),
    });
    expect(failWithdraw.status).toBe(400);

    const validAmount = Math.min(2500, stateJson.sellerBalances.availableBalanceMinor);
    expect(validAmount).toBeGreaterThan(0);
    const okWithdraw = await fetch(`${baseUrl}/api/demo/seller/withdrawals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': seller.demoToken,
      },
      body: JSON.stringify({
        amountMinor: validAmount,
        bankName: 'Mercury Bank',
        accountNumberLast4: '4819',
        accountName: 'Atelier Systems LLC',
      }),
    });
    expect(okWithdraw.status).toBe(200);
  });

  it('enforces signed digital download tokens, blocks tampered/expired tokens & prevents path traversal', async () => {
    const cust = await startDemoSession('customer');

    // Path traversal guard
    expect(resolvePrivateAssetPath('/tmp/private_assets', '../etc/passwd')).toBeNull();
    expect(resolvePrivateAssetPath('/tmp/private_assets', 'valid-file.dat')).toContain('valid-file.dat');

    // Issue signed token for seeded entitlement
    const tokenRes = await fetch(`${baseUrl}/api/demo/downloads/issue-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': cust.demoToken,
      },
      body: JSON.stringify({ entitlementId: 'ent-demo-1' }),
    });
    expect(tokenRes.status).toBe(200);
    const issued = (await tokenRes.json()) as { downloadUrl: string };

    // Download via signed URL
    const dlRes = await fetch(`${baseUrl}${issued.downloadUrl}`);
    expect(dlRes.status).toBe(200);
    const content = await dlRes.text();
    expect(content).toContain('meridian-saas-ui-kit');

    // Tampered token rejected
    const badDl = await fetch(`${baseUrl}/api/downloads/file/tampered.token`);
    expect(badDl.status).toBe(403);

    // Expired token rejected
    const expiredToken = signHmacToken({
      entitlementId: 'ent-demo-1',
      assetKey: 'meridian-saas-ui-kit-v3.4.0',
      licenseType: 'commercial',
      isDemo: true,
      namespaceId: cust.namespaceId,
      exp: Date.now() - 5000,
    });
    const expDl = await fetch(`${baseUrl}/api/downloads/file/${encodeURIComponent(expiredToken)}`);
    expect(expDl.status).toBe(403);
  });

  it('resets isolated demo workspace cleanly back to seeded defaults', async () => {
    const cust = await startDemoSession('customer');
    await fetch(`${baseUrl}/api/demo/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': cust.demoToken,
      },
      body: JSON.stringify({ items: [] }),
    });

    const resetRes = await fetch(`${baseUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { 'x-demo-token': cust.demoToken },
    });
    expect(resetRes.status).toBe(200);
    const resetJson = (await resetRes.json()) as {
      state: { customerCart: unknown[] };
    };
    expect(resetJson.state.customerCart.length).toBe(2);
  });

  it('gracefully disables external email without Resend credentials and captures dev-only previews', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;

    const { sendTransactionalEmail, clearDevEmailPreviews } = await import(
      '../src/server/email/resendAdapter.js'
    );
    clearDevEmailPreviews();

    const result = await sendTransactionalEmail({
      to: 'buyer@example.com',
      event: 'payment_confirmation',
      templateVars: { orderId: 'ord-test-1', reference: 'PSK_TEST_1' },
      isDemoContext: false,
    });

    expect(result.sent).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.status).toBe('disabled_unconfigured');

    const prevRes = await fetch(`${baseUrl}/api/dev/email-previews`);
    expect(prevRes.status).toBe(200);
    const prevJson = (await prevRes.json()) as {
      previews: Array<{ subject: string; status: string }>;
    };
    expect(prevJson.previews.length).toBeGreaterThan(0);
    expect(prevJson.previews[0].status).toBe('disabled_unconfigured');
    expect(prevJson.previews[0].subject).toContain('ord-test-1');
  });

  it('supports optional FX API and allows admin to configure manual exchange rates and currencies', async () => {
    const rateRes = await fetch(`${baseUrl}/api/currency/rates`);
    expect(rateRes.status).toBe(200);
    const rateJson = (await rateRes.json()) as { mode: string; rates: Record<string, number> };
    expect(rateJson.mode).toBe('manual');
    expect(rateJson.rates.USD).toBe(1);

    const admin = await startDemoSession('admin');
    const cfgRes = await fetch(`${baseUrl}/api/demo/admin/config`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': admin.demoToken,
      },
      body: JSON.stringify({
        supportedCurrencies: ['USD', 'NGN'],
        exchangeRates: { USD: 1, NGN: 1625, GBP: 0.8, EUR: 0.93 },
      }),
    });
    expect(cfgRes.status).toBe(200);
    const cfgJson = (await cfgRes.json()) as {
      platformConfig: { supportedCurrencies: string[]; exchangeRates: Record<string, number> };
    };
    expect(cfgJson.platformConfig.supportedCurrencies).toEqual(['USD', 'NGN']);
    expect(cfgJson.platformConfig.exchangeRates.NGN).toBe(1625);
  });

  it('generates SigV4 presigned URLs for private S3-compatible storage when configured and stays optional otherwise', async () => {
    const { S3CompatibleStorageAdapter } = await import('../src/server/storage/s3Storage.js');
    const s3 = new S3CompatibleStorageAdapter();

    // Initially unconfigured
    expect(s3.isConfigured()).toBe(false);
    expect(s3.getMissingEnvVars()).toContain('S3_BUCKET');

    // Temporarily configure S3-compatible vars and verify SigV4 URL structure
    process.env.S3_BUCKET = 'devstore-private-assets';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ENDPOINT = 'https://s3.us-east-1.amazonaws.com';
    process.env.S3_ACCESS_KEY_ID = 'AKIATESTKEYEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-test-key-for-sigv4-signing';

    try {
      expect(s3.isConfigured()).toBe(true);
      const url = s3.createPresignedDownloadUrl('meridian-saas-ui-kit-v3.4.0', 180, 'kit.zip');
      expect(url).toBeTruthy();
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(url).toContain('X-Amz-Signature=');
      expect(url).toContain('response-content-disposition=attachment');
    } finally {
      delete process.env.S3_BUCKET;
      delete process.env.S3_REGION;
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_ACCESS_KEY;
    }
  });

  it('persists Demo Mode state across cold Vercel serverless instances and always emits JSON errors', async () => {
    // 1. Missing body defaults cleanly to Customer Demo JSON response
    const emptyBodyRes = await fetch(`${baseUrl}/api/demo/session`, {
      method: 'POST',
    });
    expect(emptyBodyRes.status).toBe(200);
    expect(emptyBodyRes.headers.get('content-type')).toContain('application/json');
    const session = (await emptyBodyRes.json()) as {
      demoToken: string;
      demoStateToken: string;
      namespaceId: string;
      role: string;
    };
    expect(session.role).toBe('customer');
    expect(session.demoStateToken).toBeTruthy();

    // 2. Update cart in instance A
    const cartRes = await fetch(`${baseUrl}/api/demo/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-token': session.demoToken,
        'x-demo-state': session.demoStateToken,
      },
      body: JSON.stringify({
        items: [{ productId: 'prod-kanso-75-keyboard', quantity: 3 }],
      }),
    });
    expect(cartRes.status).toBe(200);
    const cartJson = (await cartRes.json()) as {
      cart: Array<{ productId: string; quantity: number }>;
      demoStateToken: string;
    };
    expect(cartJson.cart).toEqual([{ productId: 'prod-kanso-75-keyboard', quantity: 3 }]);
    expect(cartJson.demoStateToken).toBeTruthy();

    // 3. Evict in-memory cache to simulate a brand-new cold Vercel serverless container
    demoEngine.deleteNamespace(session.namespaceId);

    const freshApp = createApp();
    let freshServer!: Server;
    let freshBaseUrl = '';
    await new Promise<void>((resolve) => {
      freshServer = freshApp.listen(0, '127.0.0.1', () => {
        const addr = freshServer.address();
        if (addr && typeof addr === 'object') {
          freshBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    try {
      const restoredRes = await fetch(`${freshBaseUrl}/api/demo/state`, {
        headers: {
          'x-demo-token': session.demoToken,
          'x-demo-state': cartJson.demoStateToken,
        },
      });
      expect(restoredRes.status).toBe(200);
      const restored = (await restoredRes.json()) as {
        state: { customerCart: Array<{ productId: string; quantity: number }> };
      };
      expect(restored.state.customerCart).toEqual([
        { productId: 'prod-kanso-75-keyboard', quantity: 3 },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        freshServer.close((err) => (err ? reject(err) : resolve()));
      });
    }

    // 4. Malformed JSON and unknown /api routes always return structured JSON errors (never HTML/plain text)
    const malformedRes = await fetch(`${baseUrl}/api/demo/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"role":',
    });
    expect(malformedRes.status).toBe(400);
    expect(malformedRes.headers.get('content-type')).toContain('application/json');
    const malformedJson = (await malformedRes.json()) as { error: string };
    expect(malformedJson.error).toBeTruthy();

    const missingRouteRes = await fetch(`${baseUrl}/api/demo/nonexistent-route`);
    expect(missingRouteRes.status).toBe(404);
    expect(missingRouteRes.headers.get('content-type')).toContain('application/json');
    const missingRouteJson = (await missingRouteRes.json()) as { error: string };
    expect(missingRouteJson.error).toBeTruthy();
  });
});

describe('DevStore Payment Initialization Hardening & Serverless Continuity', () => {
  it('handles non-JSON and 401 upstream gateway errors safely without exposing secrets', async () => {
    paymentTransactionStore.resetForTests();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_secret_must_never_leak';
    process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_must_never_leak';

    const adminAuthInstance = await getAdminAuth();
    const verifySpy = vi.spyOn(adminAuthInstance, 'verifyIdToken').mockResolvedValue({
      uid: 'live-buyer-hardening',
      email: 'hardening@devstore.example.com',
      aud: 'test',
      auth_time: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'password' },
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/test',
      sub: 'live-buyer-hardening',
    } as never);

    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();

        if (urlStr.startsWith('https://api.paystack.co/transaction/initialize')) {
          return new Response('<html><body>502 Bad Gateway</body></html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (urlStr.startsWith('https://api.flutterwave.com/v3/payments')) {
          return new Response(
            JSON.stringify({
              status: 'error',
              message: 'Invalid authorization key',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return realFetch(input, init);
      });

    try {
      const pskRes = await realFetch(`${baseUrl}/api/payments/paystack/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 15000,
          currency: 'NGN',
          orderId: 'ord-psk-html-err',
          idempotencyKey: 'CHK_PSK_HTML_ERR',
        }),
      });
      expect(pskRes.status).toBe(502);
      expect(pskRes.headers.get('content-type')).toContain('application/json');
      const pskErr = (await pskRes.json()) as { error: string };
      expect(pskErr.error).not.toContain('<html>');
      expect(pskErr.error).not.toContain('sk_test_secret_must_never_leak');

      const flwRes = await realFetch(`${baseUrl}/api/payments/flutterwave/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 25000,
          currency: 'USD',
          orderId: 'ord-flw-401-err',
          idempotencyKey: 'CHK_FLW_401_ERR',
        }),
      });
      expect(flwRes.status).toBe(502);
      expect(flwRes.headers.get('content-type')).toContain('application/json');
      const flwErr = (await flwRes.json()) as { error: string };
      expect(flwErr.error).toBeTruthy();
      expect(flwErr.error).not.toContain('FLWSECK_TEST_must_never_leak');
    } finally {
      verifySpy.mockRestore();
      fetchSpy.mockRestore();
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.FLUTTERWAVE_SECRET_KEY;
    }
  });

  it('normalizes APP_URL without scheme, respects Vercel proxy headers, and verifies across cold serverless containers', async () => {
    paymentTransactionStore.resetForTests();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack_cold';
    process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_cold';
    const prevAppUrl = process.env.APP_URL;

    const adminAuthInstance = await getAdminAuth();
    const verifySpy = vi.spyOn(adminAuthInstance, 'verifyIdToken').mockResolvedValue({
      uid: 'live-buyer-cold',
      email: 'cold@devstore.example.com',
      aud: 'test',
      auth_time: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'password' },
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/test',
      sub: 'live-buyer-cold',
    } as never);

    const realFetch = globalThis.fetch;
    const capturedPayloads: Array<{ provider: string; body: Record<string, any> }> = [];
    const metadataByRef = new Map<string, Record<string, any>>();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();

        if (urlStr.startsWith('https://api.paystack.co/transaction/initialize')) {
          const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
          capturedPayloads.push({ provider: 'paystack', body: parsedBody });
          metadataByRef.set(parsedBody.reference, parsedBody.metadata || {});
          return new Response(
            JSON.stringify({
              status: true,
              data: {
                authorization_url: `https://checkout.paystack.com/${parsedBody.reference}`,
                reference: parsedBody.reference,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.flutterwave.com/v3/payments')) {
          const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
          capturedPayloads.push({ provider: 'flutterwave', body: parsedBody });
          metadataByRef.set(parsedBody.tx_ref, parsedBody.meta || {});
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                link: `https://checkout.flutterwave.com/v3/hosted/pay/${parsedBody.tx_ref}`,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.paystack.co/transaction/verify/')) {
          const ref = decodeURIComponent(urlStr.split('/').pop() || '');
          const meta = metadataByRef.get(ref) || {};
          // Simulate tampered under-payment when ref contains UNDERPAID
          const returnedAmount = ref.includes('UNDERPAID') ? 100 : 18500;
          return new Response(
            JSON.stringify({
              status: true,
              data: {
                id: 3001,
                reference: ref,
                amount: returnedAmount,
                currency: 'NGN',
                status: 'success',
                metadata: meta,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.startsWith('https://api.flutterwave.com/v3/transactions/')) {
          const flwTxId = urlStr.split('/transactions/')[1]?.split('/')[0];
          const flwInit = capturedPayloads.find((p) => p.provider === 'flutterwave')?.body;
          const ref = flwInit?.tx_ref || 'FLW_COLD_1';
          const meta = metadataByRef.get(ref) || {};
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                id: Number(flwTxId),
                tx_ref: ref,
                amount: 240,
                currency: 'USD',
                status: 'successful',
                meta,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return realFetch(input, init);
      });

    try {
      // 1. Test APP_URL normalization without https:// scheme
      process.env.APP_URL = 'devstore-app.vercel.app';
      const pskInitRes = await realFetch(`${baseUrl}/api/payments/paystack/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({
          amountMinor: 18500,
          currency: 'NGN',
          orderId: 'ord-cold-psk-1',
          idempotencyKey: 'CHK_COLD_PSK_1',
          customerName: 'Ada Lovelace',
        }),
      });
      expect(pskInitRes.status).toBe(200);
      const pskInit = (await pskInitRes.json()) as { reference: string };
      const pskOutbound = capturedPayloads.find((p) => p.provider === 'paystack')?.body;
      expect(pskOutbound?.callback_url).toBe('https://devstore-app.vercel.app/?payment_callback=1&provider=paystack');

      // 2. Test Vercel proxy header origin resolution when APP_URL is unset
      delete process.env.APP_URL;
      const flwInitRes = await realFetch(`${baseUrl}/api/payments/flutterwave/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'preview-devstore.vercel.app',
        },
        body: JSON.stringify({
          amountMinor: 24000,
          currency: 'USD',
          orderId: 'ord-cold-flw-1',
          idempotencyKey: 'CHK_COLD_FLW_1',
          customerName: 'Ada Lovelace',
        }),
      });
      expect(flwInitRes.status).toBe(200);
      const flwInit = (await flwInitRes.json()) as { reference: string };
      const flwOutbound = capturedPayloads.find((p) => p.provider === 'flutterwave')?.body;
      expect(flwOutbound?.redirect_url).toBe('https://preview-devstore.vercel.app/?payment_callback=1&provider=flutterwave');
      expect(flwOutbound?.customer?.name).toBe('Ada Lovelace');

      // 3. Evict in-memory transaction store to simulate a cold serverless container during redirect back
      paymentTransactionStore.resetForTests();

      const pskVerifyCold = await realFetch(`${baseUrl}/api/payments/paystack/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: pskInit.reference }),
      });
      expect(pskVerifyCold.status).toBe(200);
      const pskVerifyData = (await pskVerifyCold.json()) as {
        verified: boolean;
        status: string;
        orderId: string;
        orderStatus: string;
      };
      expect(pskVerifyData.verified).toBe(true);
      expect(pskVerifyData.status).toBe('paid');
      expect(pskVerifyData.orderId).toBe('ord-cold-psk-1');
      expect(pskVerifyData.orderStatus).toBe('processing');

      const flwVerifyCold = await realFetch(`${baseUrl}/api/payments/flutterwave/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: flwInit.reference, transactionId: '888111' }),
      });
      expect(flwVerifyCold.status).toBe(200);
      const flwVerifyData = (await flwVerifyCold.json()) as {
        verified: boolean;
        status: string;
        orderId: string;
        orderStatus: string;
      };
      expect(flwVerifyData.verified).toBe(true);
      expect(flwVerifyData.status).toBe('paid');
      expect(flwVerifyData.orderId).toBe('ord-cold-flw-1');
      expect(flwVerifyData.orderStatus).toBe('processing');

      // 4. Reject underpaid tampering even on cold container using gateway metadata expectedAmountMinor
      paymentTransactionStore.resetForTests();
      const underpaidRes = await realFetch(`${baseUrl}/api/payments/paystack/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: `PSK_UNDERPAID_${Date.now()}` }),
      });
      // Inject metadata manually for direct cold reference test
      metadataByRef.set('PSK_LIVE_UNDERPAID_CHECK', {
        orderId: 'ord-underpaid',
        expectedAmountMinor: 18500,
        expectedCurrency: 'NGN',
      });
      const underpaidMetaRes = await realFetch(`${baseUrl}/api/payments/paystack/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer live-firebase-token',
        },
        body: JSON.stringify({ reference: 'PSK_LIVE_UNDERPAID_CHECK' }),
      });
      expect(underpaidMetaRes.status).toBe(200);
      const underpaidJson = (await underpaidMetaRes.json()) as {
        verified: boolean;
        status: string;
        orderStatus: string;
      };
      expect(underpaidRes.status).toBe(200);
      expect(underpaidJson.verified).toBe(false);
      expect(underpaidJson.status).toBe('failed');
      expect(underpaidJson.orderStatus).toBe('cancelled');
    } finally {
      verifySpy.mockRestore();
      fetchSpy.mockRestore();
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.FLUTTERWAVE_SECRET_KEY;
      if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
      else delete process.env.APP_URL;
    }
  });
});


