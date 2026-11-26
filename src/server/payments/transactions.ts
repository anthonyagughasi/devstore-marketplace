import type { CurrencyCode, PaymentProviderId } from '../../shared/types.js';
import {
  getCrossProviderReferenceError,
  type ParsedWebhookEvent,
  type PaymentTransactionRecord,
  type PaymentTransactionStatus,
  type VerifyPaymentResponse,
} from './types.js';

export class CrossProviderMismatchError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CrossProviderMismatchError';
  }
}

export interface OrderPaymentStatusRecord {
  orderId: string;
  userId: string;
  provider: PaymentProviderId;
  reference: string;
  currency: CurrencyCode;
  amountMinor: number;
  paymentStatus: PaymentTransactionStatus;
  orderStatus: 'pending' | 'processing' | 'cancelled';
  updatedAt: string;
}

/**
 * Authoritative server-side payment & order verification store.
 * Every payment transaction records the selected provider (`paystack` | `flutterwave`),
 * preventing cross-provider callback verification and ensuring order status transitions
 * occur ONLY after server-side gateway verification succeeds.
 */
export class PaymentTransactionStore {
  private readonly transactionsByRef = new Map<string, PaymentTransactionRecord>();
  private readonly ordersById = new Map<string, OrderPaymentStatusRecord>();

  createPendingTransaction(input: {
    reference: string;
    orderId: string;
    userId: string;
    provider: PaymentProviderId;
    currency: CurrencyCode;
    amountMinor: number;
    authorizationUrl?: string;
    callbackUrl?: string;
  }): PaymentTransactionRecord {
    const now = new Date().toISOString();
    const record: PaymentTransactionRecord = {
      reference: input.reference,
      orderId: input.orderId,
      userId: input.userId,
      provider: input.provider,
      currency: input.currency,
      amountMinor: input.amountMinor,
      status: 'pending',
      orderStatus: 'pending',
      authorizationUrl: input.authorizationUrl,
      callbackUrl: input.callbackUrl,
      createdAt: now,
      updatedAt: now,
    };

    this.transactionsByRef.set(input.reference, record);
    this.ordersById.set(input.orderId, {
      orderId: input.orderId,
      userId: input.userId,
      provider: input.provider,
      reference: input.reference,
      currency: input.currency,
      amountMinor: input.amountMinor,
      paymentStatus: 'pending',
      orderStatus: 'pending',
      updatedAt: now,
    });

    return record;
  }

  getByReference(reference: string): PaymentTransactionRecord | undefined {
    return this.transactionsByRef.get(reference);
  }

  getOrderStatus(orderId: string): OrderPaymentStatusRecord | undefined {
    return this.ordersById.get(orderId);
  }

  assertProviderOwnership(expectedProvider: PaymentProviderId, reference: string): void {
    const prefixErr = getCrossProviderReferenceError(expectedProvider, reference);
    if (prefixErr) {
      throw new CrossProviderMismatchError(prefixErr);
    }

    const existing = this.transactionsByRef.get(reference);
    if (existing && existing.provider !== expectedProvider) {
      throw new CrossProviderMismatchError(
        `Cross-provider mismatch: transaction ${reference} belongs to ${existing.provider}, not ${expectedProvider}.`
      );
    }
  }

  applyVerificationResult(params: {
    provider: PaymentProviderId;
    reference: string;
    verifyResult: VerifyPaymentResponse;
  }): VerifyPaymentResponse {
    const { provider, reference, verifyResult } = params;
    this.assertProviderOwnership(provider, reference);

    const existing = this.transactionsByRef.get(reference);
    const now = new Date().toISOString();

    let verified = verifyResult.verified;
    let status: PaymentTransactionStatus = verifyResult.status;
    let message = verifyResult.message;

    const expectedAmount =
      existing?.amountMinor ?? verifyResult.expectedAmountMinor;
    const expectedCurrency =
      existing?.currency ?? verifyResult.expectedCurrency;

    if (verified && status === 'paid' && (typeof expectedAmount === 'number' || expectedCurrency)) {
      const amountMatches =
        typeof expectedAmount !== 'number' ||
        typeof verifyResult.amountMinor !== 'number' ||
        verifyResult.amountMinor === expectedAmount;
      const currencyMatches =
        !expectedCurrency ||
        !verifyResult.currency ||
        verifyResult.currency.toUpperCase() === expectedCurrency.toUpperCase();

      if (!amountMatches || !currencyMatches) {
        verified = false;
        status = 'failed';
        message = `Payment verification rejected due to amount/currency mismatch (expected ${expectedAmount ?? 'unknown'} ${expectedCurrency ?? 'unknown'}, got ${verifyResult.amountMinor ?? 'unknown'} ${verifyResult.currency ?? 'unknown'}).`;
      }
    }

    const orderStatus: 'pending' | 'processing' | 'cancelled' =
      verified && status === 'paid'
        ? 'processing'
        : status === 'failed' || status === 'cancelled' || status === 'abandoned'
        ? 'cancelled'
        : 'pending';

    if (existing) {
      existing.status = status;
      existing.orderStatus = orderStatus;
      existing.updatedAt = now;
      existing.providerTransactionId =
        verifyResult.providerTransactionId || existing.providerTransactionId;
      existing.verificationNote = message;
      if (verified && status === 'paid') {
        existing.verifiedAt = now;
      }

      const orderRec = this.ordersById.get(existing.orderId);
      if (orderRec) {
        orderRec.paymentStatus = status;
        orderRec.orderStatus = orderStatus;
        orderRec.updatedAt = now;
      }
    }

    return {
      ...verifyResult,
      provider,
      verified,
      status,
      orderStatus,
      orderId: existing?.orderId || verifyResult.orderId,
      message,
    };
  }

  applyWebhookEvent(params: {
    event: ParsedWebhookEvent;
    verifiedAgainstGatewayApi: boolean;
  }): void {
    const { event, verifiedAgainstGatewayApi } = params;
    const existing = this.transactionsByRef.get(event.reference);
    if (!existing || existing.provider !== event.provider) return;

    const now = new Date().toISOString();
    let nextStatus: PaymentTransactionStatus = existing.status;
    let nextOrderStatus: 'pending' | 'processing' | 'cancelled' = existing.orderStatus;

    if (event.status === 'paid' && verifiedAgainstGatewayApi) {
      if (
        event.amountMinor === existing.amountMinor &&
        event.currency.toUpperCase() === existing.currency.toUpperCase()
      ) {
        nextStatus = 'paid';
        nextOrderStatus = 'processing';
        existing.verifiedAt = now;
      } else {
        nextStatus = 'failed';
        nextOrderStatus = 'cancelled';
      }
    } else if (event.status === 'failed') {
      nextStatus = 'failed';
      nextOrderStatus = 'cancelled';
    }

    existing.status = nextStatus;
    existing.orderStatus = nextOrderStatus;
    existing.updatedAt = now;
    if (event.providerTransactionId) {
      existing.providerTransactionId = event.providerTransactionId;
    }

    const orderRec = this.ordersById.get(existing.orderId);
    if (orderRec) {
      orderRec.paymentStatus = nextStatus;
      orderRec.orderStatus = nextOrderStatus;
      orderRec.updatedAt = now;
    }
  }

  resetForTests(): void {
    this.transactionsByRef.clear();
    this.ordersById.clear();
  }
}

export const paymentTransactionStore = new PaymentTransactionStore();
