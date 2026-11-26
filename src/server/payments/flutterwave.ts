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

export class FlutterwaveAdapter implements PaymentProviderAdapter {
  readonly id = 'flutterwave' as const;
  readonly displayName = 'Flutterwave';
  readonly supportedCurrencies: CurrencyCode[] = ['NGN', 'USD', 'GBP', 'EUR'];

  getMissingEnvVars(): string[] {
    const missing: string[] = [];
    if (!process.env.FLUTTERWAVE_PUBLIC_KEY?.trim()) missing.push('FLUTTERWAVE_PUBLIC_KEY');
    if (!process.env.FLUTTERWAVE_SECRET_KEY?.trim()) missing.push('FLUTTERWAVE_SECRET_KEY');
    if (!process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim()) missing.push('FLUTTERWAVE_WEBHOOK_SECRET');
    return missing;
  }

  isConfigured(): boolean {
    return Boolean(process.env.FLUTTERWAVE_SECRET_KEY?.trim());
  }

  async initializePayment(input: InitializePaymentRequest): Promise<InitializePaymentResponse> {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY?.trim();
    if (!secretKey) {
      return {
        configured: false,
        provider: 'flutterwave',
        reference: input.reference,
        missingEnvVars: this.getMissingEnvVars(),
        message: 'Flutterwave checkout is not currently configured.',
      };
    }

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('Checkout amount must be greater than zero.');
    }
    if (!input.email || !input.email.includes('@')) {
      throw new Error('A valid customer email address is required for Flutterwave checkout.');
    }

    // Flutterwave expects major decimal units in `amount`
    const amountMajor = Number((input.amountMinor / 100).toFixed(2));

    const payloadBody: Record<string, unknown> = {
      tx_ref: input.reference,
      amount: amountMajor,
      currency: input.currency,
      redirect_url: input.callbackUrl,
      customer: {
        email: input.email.trim(),
        name: input.customerName?.trim() || 'DevStore Customer',
      },
      customizations: {
        title: 'DevStore Marketplace',
        description: 'Order Checkout',
      },
      meta: {
        ...input.metadata,
        provider: 'flutterwave',
        expectedAmountMinor: input.amountMinor,
        expectedCurrency: input.currency,
      },
    };

    if (input.splitSubaccounts?.length) {
      payloadBody.subaccounts = input.splitSubaccounts.map((s) => ({ id: s.subaccountCode }));
    }

    let res: Response;
    try {
      res = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadBody),
      });
    } catch (err) {
      console.error('[DevStore Flutterwave Initialize Network Error]', {
        reference: input.reference,
        currency: input.currency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Unable to reach Flutterwave right now. Please try again in a moment.');
    }

    const rawText = await res.text();
    let data: {
      status?: string;
      message?: string;
      data?: { link?: string };
    } = {};

    if (rawText) {
      try {
        data = JSON.parse(rawText) as typeof data;
      } catch {
        console.error('[DevStore Flutterwave Initialize Non-JSON Response]', {
          httpStatus: res.status,
          reference: input.reference,
          bodySnippet: rawText.slice(0, 300),
        });
        throw new Error('Flutterwave returned an unexpected response. Please try again shortly.');
      }
    }

    if (!res.ok || data.status !== 'success' || !data.data?.link) {
      console.error('[DevStore Flutterwave Initialize Rejected]', {
        httpStatus: res.status,
        reference: input.reference,
        currency: input.currency,
        amountMajor,
        gatewayStatus: data.status,
        gatewayMessage: data.message,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('Flutterwave checkout is temporarily unavailable. Please try another payment method.');
      }
      throw new Error(
        data.message && !data.message.toLowerCase().includes('key')
          ? data.message
          : 'Unable to start Flutterwave checkout. Please try again or switch payment methods.'
      );
    }

    if (!isValidCheckoutRedirectUrl('flutterwave', data.data.link)) {
      console.error('[DevStore Flutterwave Invalid Redirect URL]', {
        reference: input.reference,
        link: data.data.link,
      });
      throw new Error('Flutterwave returned an invalid checkout URL. Please try again.');
    }

    return {
      configured: true,
      provider: 'flutterwave',
      authorizationUrl: data.data.link,
      reference: input.reference,
    };
  }

  async verifyPayment(reference: string, transactionId?: string): Promise<VerifyPaymentResponse> {
    const mismatch = getCrossProviderReferenceError('flutterwave', reference);
    if (mismatch) {
      throw new CrossProviderMismatchError(mismatch);
    }

    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY?.trim();
    if (!secretKey) {
      return {
        configured: false,
        verified: false,
        provider: 'flutterwave',
        status: 'pending',
        reference,
        missingEnvVars: this.getMissingEnvVars(),
        message: 'Flutterwave verification is not currently configured.',
      };
    }

    const endpoint = transactionId
      ? `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`
      : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      });
    } catch (err) {
      console.error('[DevStore Flutterwave Verify Network Error]', {
        reference,
        transactionId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Unable to reach Flutterwave to confirm your payment. Please retry.');
    }

    const rawText = await res.text();
    let payload: {
      status?: string;
      message?: string;
      data?: {
        id?: number;
        tx_ref?: string;
        amount?: number;
        currency?: CurrencyCode;
        status?: string;
        meta?: {
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
        console.error('[DevStore Flutterwave Verify Non-JSON Response]', {
          httpStatus: res.status,
          reference,
          bodySnippet: rawText.slice(0, 300),
        });
        return {
          configured: true,
          verified: false,
          provider: 'flutterwave',
          status: 'pending',
          reference,
          message: 'Payment confirmation is pending. Please refresh status in a moment.',
        };
      }
    }

    if (!res.ok || payload.status !== 'success' || !payload.data) {
      console.error('[DevStore Flutterwave Verify Rejected]', {
        httpStatus: res.status,
        reference,
        transactionId,
        gatewayMessage: payload.message,
      });
      return {
        configured: true,
        verified: false,
        provider: 'flutterwave',
        status: 'failed',
        reference,
        message: payload.message || 'Flutterwave verification failed.',
      };
    }

    // Ensure returned tx_ref matches the requested reference when verifying by transactionId
    if (payload.data.tx_ref && payload.data.tx_ref !== reference) {
      return {
        configured: true,
        verified: false,
        provider: 'flutterwave',
        status: 'failed',
        reference,
        message: 'Transaction reference mismatch during verification.',
      };
    }

    const gatewayStatus = payload.data.status?.toLowerCase();
    const mappedStatus =
      gatewayStatus === 'successful'
        ? 'paid'
        : gatewayStatus === 'cancelled'
        ? 'cancelled'
        : gatewayStatus === 'failed'
        ? 'failed'
        : 'pending';

    return {
      configured: true,
      verified: mappedStatus === 'paid',
      provider: 'flutterwave',
      status: mappedStatus,
      reference: payload.data.tx_ref || reference,
      orderId:
        typeof payload.data.meta?.orderId === 'string'
          ? payload.data.meta.orderId
          : undefined,
      amountMinor: Math.round((payload.data.amount || 0) * 100),
      currency: payload.data.currency,
      expectedAmountMinor:
        typeof payload.data.meta?.expectedAmountMinor === 'number'
          ? payload.data.meta.expectedAmountMinor
          : undefined,
      expectedCurrency: payload.data.meta?.expectedCurrency,
      providerTransactionId: payload.data.id ? String(payload.data.id) : undefined,
      message: payload.message,
    };
  }

  verifyWebhookSignature(
    _rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): boolean {
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim();
    if (!expectedHash) return false;

    const headerVal = headers['verif-hash'];
    const signature = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!signature || typeof signature !== 'string') return false;

    const a = Buffer.from(signature.trim(), 'utf8');
    const b = Buffer.from(expectedHash, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(payload: unknown): ParsedWebhookEvent | null {
    const body = payload as {
      event?: string;
      'event.type'?: string;
      id?: number | string;
      txRef?: string;
      amount?: number;
      currency?: CurrencyCode;
      status?: string;
      data?: {
        id?: number | string;
        tx_ref?: string;
        flw_ref?: string;
        amount?: number;
        currency?: CurrencyCode;
        status?: string;
      };
    };

    if (!body || typeof body !== 'object') return null;

    const eventType = body.event || body['event.type'];
    const ref = body.data?.tx_ref || body.txRef;
    if (!eventType || !ref) return null;

    const rawStatus = body.data?.status || body.status;
    let status: ParsedWebhookEvent['status'] = 'pending';
    if (rawStatus === 'successful') status = 'paid';
    else if (rawStatus === 'failed') status = 'failed';
    else if (eventType.includes('refund')) status = 'refunded';

    const rawId = body.data?.id ?? body.id;
    const txId = rawId !== undefined && rawId !== null ? String(rawId) : undefined;
    const rawAmount = body.data?.amount ?? body.amount ?? 0;

    return {
      eventId: `flutterwave:${eventType}:${ref}:${txId ?? ''}`,
      provider: 'flutterwave',
      reference: String(ref),
      providerTransactionId: txId,
      status,
      amountMinor: Math.round(Number(rawAmount) * 100),
      currency: body.data?.currency || body.currency || 'USD',
      rawEventType: String(eventType),
    };
  }
}

/**
 * Isolated Flutterwave payment service with provider-scoped idempotency,
 * hosted `data.link` validation, dedicated transaction ledger registration,
 * and cross-provider verification guards.
 */
export class FlutterwavePaymentService {
  readonly adapter = new FlutterwaveAdapter();
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
    const scopedKey = params.idempotencyKey ? `flutterwave:${params.idempotencyKey}` : undefined;
    if (scopedKey && this.idempotency.has(scopedKey)) {
      const cached = this.idempotency.get<InitializePaymentResponse & { orderId: string }>(scopedKey)!;
      if (cached.provider === 'flutterwave') {
        return cached;
      }
    }

    const reference = generatePaymentReference('flutterwave', false);
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
        provider: 'flutterwave',
      },
    });

    if (result.configured) {
      paymentTransactionStore.createPendingTransaction({
        reference: result.reference,
        orderId: params.orderId,
        userId: params.userId,
        provider: 'flutterwave',
        currency: params.currency,
        amountMinor: params.amountMinor,
        authorizationUrl: result.authorizationUrl,
        callbackUrl: params.callbackUrl,
      });
    }

    const response = {
      ...result,
      provider: 'flutterwave' as const,
      orderId: params.orderId,
    };

    if (scopedKey && result.configured) {
      this.idempotency.record(scopedKey, response);
    }

    return response;
  }

  async verifyCheckout(params: {
    reference: string;
    transactionId?: string;
    callbackStatus?: string;
  }): Promise<VerifyPaymentResponse> {
    paymentTransactionStore.assertProviderOwnership('flutterwave', params.reference);

    const rawVerify = await this.adapter.verifyPayment(params.reference, params.transactionId);
    let finalVerify = rawVerify;

    // If user cancelled at Flutterwave hosted checkout (`status=cancelled` without a settled payment),
    // verify against Flutterwave first (already done above) and never let `status=successful` bypass verification.
    if (
      rawVerify.configured &&
      !rawVerify.verified &&
      rawVerify.status !== 'paid' &&
      params.callbackStatus?.toLowerCase() === 'cancelled'
    ) {
      finalVerify = {
        ...rawVerify,
        status: 'cancelled',
        message: 'Flutterwave payment was cancelled on hosted checkout.',
      };
    }

    return paymentTransactionStore.applyVerificationResult({
      provider: 'flutterwave',
      reference: params.reference,
      verifyResult: finalVerify,
    });
  }
}

export const flutterwaveService = new FlutterwavePaymentService();
