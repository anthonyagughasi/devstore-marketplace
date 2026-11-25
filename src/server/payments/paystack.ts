import crypto from 'crypto';
import type { CurrencyCode } from '../../shared/types.ts';
import {
  CrossProviderMismatchError,
  paymentTransactionStore,
} from './transactions.ts';
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
} from './types.ts';

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
        message: 'Paystack credentials are not yet configured in environment secrets.',
      };
    }

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: {
          ...input.metadata,
          provider: 'paystack',
          splitSubaccounts: input.splitSubaccounts,
        },
      }),
    });

    const data = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    };

    if (!res.ok || !data.status || !data.data?.authorization_url) {
      throw new Error(data.message || 'Paystack initialization failed.');
    }

    if (!isValidCheckoutRedirectUrl('paystack', data.data.authorization_url)) {
      throw new Error('Paystack returned an invalid checkout redirect URL.');
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
        message: 'Paystack secret key is missing.',
      };
    }

    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    const payload = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        id?: number;
        status?: string;
        amount?: number;
        currency?: CurrencyCode;
        reference?: string;
      };
    };

    if (!res.ok || !payload.status || !payload.data) {
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
      amountMinor: payload.data.amount,
      currency: payload.data.currency,
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
