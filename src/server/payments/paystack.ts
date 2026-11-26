import crypto from 'crypto';
import type { CurrencyCode } from '../../shared/types.js';
import {
  CrossProviderMismatchError,
  paymentTransactionStore,
} from './transactions.js';
import {
  generatePaymentReference,
  getCrossProviderReferenceError,
  IdempotencyRegistry,
  isValidCheckoutRedirectUrl,
  type InitializePaymentRequest,
  type InitializePaymentResponse,
  type ParsedWebhookEvent,
  type PaymentProviderAdapter,
  type VerifyPaymentResponse,
} from './types.js';

export class PaystackAdapter implements PaymentProviderAdapter {
  readonly id = 'paystack' as const;
  readonly displayName = 'Paystack';
  readonly supportedCurrencies: CurrencyCode[] = ['NGN', 'USD', 'GBP'];

  getMissingEnvVars(): string[] {
    const missing: string[] = [];
    if (!process.env.PAYSTACK_PUBLIC_KEY?.trim()) missing.push('PAYSTACK_PUBLIC_KEY');
    if (!process.env.PAYSTACK_SECRET_KEY?.trim()) missing.push('PAYSTACK_SECRET_KEY');
    if (!process.env.PAYSTACK_WEBHOOK_SECRET?.trim()) missing.push('PAYSTACK_WEBHOOK_SECRET');
    return missing;
  }

  isConfigured(): boolean {
    return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  }

  async initializePayment(input: InitializePaymentRequest): Promise<InitializePaymentResponse> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      return {
        configured: false,
        provider: 'paystack',
        reference: input.reference,
        missingEnvVars: this.getMissingEnvVars(),
        message: 'Paystack checkout is not currently configured.',
      };
    }

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('Checkout amount must be greater than zero.');
    }
    if (!input.email || !input.email.includes('@')) {
      throw new Error('A valid customer email address is required for Paystack checkout.');
    }

    let res: Response;
    try {
      res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: input.email.trim(),
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: {
            ...input.metadata,
            provider: 'paystack',
            expectedAmountMinor: input.amountMinor,
            expectedCurrency: input.currency,
            ...(input.splitSubaccounts?.length ? { splitSubaccounts: input.splitSubaccounts } : {}),
          },
        }),
      });
    } catch (err) {
      console.error('[DevStore Paystack Initialize Network Error]', {
        reference: input.reference,
        currency: input.currency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Unable to reach Paystack right now. Please try again in a moment.');
    }

    const rawText = await res.text();
    let data: {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    } = {};

    if (rawText) {
      try {
        data = JSON.parse(rawText) as typeof data;
      } catch {
        console.error('[DevStore Paystack Initialize Non-JSON Response]', {
          httpStatus: res.status,
          reference: input.reference,
          bodySnippet: rawText.slice(0, 300),
        });
        throw new Error('Paystack returned an unexpected response. Please try again shortly.');
      }
    }

    if (!res.ok || !data.status || !data.data?.authorization_url) {
      console.error('[DevStore Paystack Initialize Rejected]', {
        httpStatus: res.status,
        reference: input.reference,
        currency: input.currency,
        amountMinor: input.amountMinor,
        gatewayMessage: data.message,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('Paystack checkout is temporarily unavailable. Please try another payment method.');
      }
      throw new Error(
        data.message && !data.message.toLowerCase().includes('key')
          ? data.message
          : 'Unable to start Paystack checkout. Please try again or switch payment methods.'
      );
    }

    if (!isValidCheckoutRedirectUrl('paystack', data.data.authorization_url)) {
      console.error('[DevStore Paystack Invalid Redirect URL]', {
        reference: input.reference,
        authorizationUrl: data.data.authorization_url,
      });
      throw new Error('Paystack returned an invalid checkout URL. Please try again.');
    }

    return {
      configured: true,
      provider: 'paystack',
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference || input.reference,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResponse> {
    const mismatch = getCrossProviderReferenceError('paystack', reference);
    if (mismatch) {
      throw new CrossProviderMismatchError(mismatch);
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      return {
        configured: false,
        verified: false,
        provider: 'paystack',
        status: 'pending',
        reference,
        missingEnvVars: this.getMissingEnvVars(),
        message: 'Paystack verification is not currently configured.',
      };
    }

    let res: Response;
    try {
      res = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        }
      );
    } catch (err) {
      console.error('[DevStore Paystack Verify Network Error]', {
        reference,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Unable to reach Paystack to confirm your payment. Please retry.');
    }

    const rawText = await res.text();
    let payload: {
      status?: boolean;
      message?: string;
      data?: {
        id?: number;
        status?: string;
        amount?: number;
        currency?: CurrencyCode;
        reference?: string;
        metadata?: {
          orderId?: string;
          expectedAmountMinor?: number;
          expectedCurrency?: CurrencyCode;
        };
      };
    } = {};

    if (rawText) {
      try {
        payload = JSON.parse(rawText) as typeof payload;
      } catch {
        console.error('[DevStore Paystack Verify Non-JSON Response]', {
          httpStatus: res.status,
          reference,
          bodySnippet: rawText.slice(0, 300),
        });
        return {
          configured: true,
          verified: false,
          provider: 'paystack',
          status: 'pending',
          reference,
          message: 'Payment confirmation is pending. Please refresh status in a moment.',
        };
      }
    }

    if (!res.ok || !payload.status || !payload.data) {
      console.error('[DevStore Paystack Verify Rejected]', {
        httpStatus: res.status,
        reference,
        gatewayMessage: payload.message,
      });
      return {
        configured: true,
        verified: false,
        provider: 'paystack',
        status: 'failed',
        reference,
        message: payload.message || 'Paystack verification failed.',
      };
    }

    const gatewayStatus = payload.data.status?.toLowerCase();
    const mappedStatus =
      gatewayStatus === 'success'
        ? 'paid'
        : gatewayStatus === 'abandoned'
        ? 'cancelled'
        : gatewayStatus === 'failed' || gatewayStatus === 'reversed'
        ? 'failed'
        : 'pending';

    return {
      configured: true,
      verified: mappedStatus === 'paid',
      provider: 'paystack',
      status: mappedStatus,
      reference: payload.data.reference || reference,
      orderId:
        typeof payload.data.metadata?.orderId === 'string'
          ? payload.data.metadata.orderId
          : undefined,
      amountMinor: payload.data.amount,
      currency: payload.data.currency,
      expectedAmountMinor:
        typeof payload.data.metadata?.expectedAmountMinor === 'number'
          ? payload.data.metadata.expectedAmountMinor
          : undefined,
      expectedCurrency: payload.data.metadata?.expectedCurrency,
      providerTransactionId: payload.data.id ? String(payload.data.id) : undefined,
      message: payload.message,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): boolean {
    const secret =
      process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret || !rawBody) return false;

    const signatureHeader = headers['x-paystack-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature || typeof signature !== 'string') return false;

    const expected = crypto.createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex');
    const a = Buffer.from(signature.trim().toLowerCase(), 'utf8');
    const b = Buffer.from(expected.toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(payload: unknown): ParsedWebhookEvent | null {
    const body = payload as {
      event?: string;
      data?: {
        id?: number | string;
        reference?: string;
        amount?: number;
        currency?: CurrencyCode;
        status?: string;
      };
    };

    if (!body || typeof body !== 'object' || !body.event || !body.data?.reference) return null;

    let status: ParsedWebhookEvent['status'] = 'pending';
    if (body.event === 'charge.success' || body.data.status === 'success') status = 'paid';
    else if (body.event === 'charge.failed' || body.data.status === 'failed') status = 'failed';
    else if (body.event.startsWith('refund.')) status = 'refunded';

    const txId = body.data.id !== undefined && body.data.id !== null ? String(body.data.id) : undefined;

    return {
      eventId: `paystack:${body.event}:${body.data.reference}:${txId ?? ''}`,
      provider: 'paystack',
      reference: String(body.data.reference),
      providerTransactionId: txId,
      status,
      amountMinor: Math.round(Number(body.data.amount ?? 0)),
      currency: body.data.currency || 'NGN',
      rawEventType: String(body.event),
    };
  }
}

/**
 * Isolated Paystack payment service with provider-scoped idempotency,
 * dedicated transaction ledger registration, and cross-provider verification guards.
 */
export class PaystackPaymentService {
  readonly adapter = new PaystackAdapter();
  private readonly idempotency = new IdempotencyRegistry();

  async initializeCheckout(params: {
    userId: string;
    orderId: string;
    email: string;
    customerName?: string;
    amountMinor: number;
    currency: CurrencyCode;
    callbackUrl: string;
    idempotencyKey?: string;
  }): Promise<InitializePaymentResponse & { orderId: string }> {
    const scopedKey = params.idempotencyKey ? `paystack:${params.idempotencyKey}` : undefined;
    if (scopedKey && this.idempotency.has(scopedKey)) {
      const cached = this.idempotency.get<InitializePaymentResponse & { orderId: string }>(scopedKey)!;
      if (cached.provider === 'paystack') {
        return cached;
      }
    }

    const reference = generatePaymentReference('paystack', false);
    const result = await this.adapter.initializePayment({
      reference,
      email: params.email,
      customerName: params.customerName,
      amountMinor: params.amountMinor,
      currency: params.currency,
      callbackUrl: params.callbackUrl,
      metadata: {
        uid: params.userId,
        orderId: params.orderId,
        provider: 'paystack',
      },
    });

    if (result.configured) {
      paymentTransactionStore.createPendingTransaction({
        reference: result.reference,
        orderId: params.orderId,
        userId: params.userId,
        provider: 'paystack',
        currency: params.currency,
        amountMinor: params.amountMinor,
        authorizationUrl: result.authorizationUrl,
        callbackUrl: params.callbackUrl,
      });
    }

    const response = {
      ...result,
      provider: 'paystack' as const,
      orderId: params.orderId,
    };

    if (scopedKey && result.configured) {
      this.idempotency.record(scopedKey, response);
    }

    return response;
  }

  async verifyCheckout(params: {
    reference: string;
    callbackStatus?: string;
  }): Promise<VerifyPaymentResponse> {
    paymentTransactionStore.assertProviderOwnership('paystack', params.reference);

    const rawVerify = await this.adapter.verifyPayment(params.reference);
    let finalVerify = rawVerify;

    if (
      rawVerify.configured &&
      !rawVerify.verified &&
      rawVerify.status === 'failed' &&
      params.callbackStatus?.toLowerCase() === 'cancelled'
    ) {
      finalVerify = {
        ...rawVerify,
        status: 'cancelled',
        message: 'Paystack payment was cancelled before completion.',
      };
    }

    return paymentTransactionStore.applyVerificationResult({
      provider: 'paystack',
      reference: params.reference,
      verifyResult: finalVerify,
    });
  }

  resetIdempotencyForTests(): void {
    // Recreate isn't needed if tests use distinct keys, kept for symmetry
  }
}

export const paystackService = new PaystackPaymentService();
