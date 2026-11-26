import type { PaymentProviderId } from '../../shared/types.js';
import { getEmailProviderStatus } from '../email/resendAdapter.js';
import { getStorageStatus } from '../storage/privateDownloads.js';
import { flutterwaveService, FlutterwavePaymentService } from './flutterwave.js';
import { paystackService, PaystackPaymentService } from './paystack.js';
import { CrossProviderMismatchError, paymentTransactionStore } from './transactions.js';
import { IdempotencyRegistry, type PaymentProviderAdapter, type ParsedWebhookEvent } from './types.js';

export const paymentProviders: Record<PaymentProviderId, PaymentProviderAdapter> = {
  paystack: paystackService.adapter,
  flutterwave: flutterwaveService.adapter,
};

export interface WebhookReconciliationRecord {
  eventId: string;
  provider: PaymentProviderId;
  reference: string;
  webhookStatus: ParsedWebhookEvent['status'];
  verifiedAgainstGatewayApi: boolean;
  gatewayVerificationStatus?: string;
  amountMinor: number;
  currency: string;
  processedAt: string;
  verificationNote: string;
}

export const webhookIdempotency = new IdempotencyRegistry();
export const webhookAuditLog: WebhookReconciliationRecord[] = [];

export {
  paystackService,
  flutterwaveService,
  paymentTransactionStore,
  CrossProviderMismatchError,
};

export function getPaymentProvider(id: PaymentProviderId): PaymentProviderAdapter {
  const provider = paymentProviders[id];
  if (!provider) {
    throw new Error(`Unsupported payment provider: ${id}`);
  }
  return provider;
}

export function getPaymentService(
  id: PaymentProviderId
): PaystackPaymentService | FlutterwavePaymentService {
  if (id === 'paystack') return paystackService;
  if (id === 'flutterwave') return flutterwaveService;
  throw new Error(`Unsupported payment provider: ${id}`);
}

/**
 * Processes an authenticated webhook event with idempotency protection and
 * server-to-server transaction verification against the provider API when configured.
 */
export async function processVerifiedWebhookEvent(
  adapter: PaymentProviderAdapter,
  event: ParsedWebhookEvent
): Promise<{ duplicate: boolean; record: WebhookReconciliationRecord }> {
  if (webhookIdempotency.has(event.eventId)) {
    const existing = webhookIdempotency.get<WebhookReconciliationRecord>(event.eventId)!;
    return { duplicate: true, record: existing };
  }

  let verifiedAgainstGatewayApi = false;
  let gatewayVerificationStatus: string | undefined;
  let verificationNote = 'Webhook signature verified.';

  const existingTx = paymentTransactionStore.getByReference(event.reference);
  if (existingTx && existingTx.provider !== event.provider) {
    verificationNote = `Ignored webhook: transaction ${event.reference} belongs to ${existingTx.provider}, not ${event.provider}.`;
  } else if (adapter.isConfigured()) {
    try {
      const verification = await adapter.verifyPayment(
        event.reference,
        event.providerTransactionId
      );
      verifiedAgainstGatewayApi = verification.verified;
      gatewayVerificationStatus = verification.status;

      if (
        event.status === 'paid' &&
        verification.verified &&
        typeof verification.amountMinor === 'number' &&
        verification.amountMinor !== event.amountMinor
      ) {
        verifiedAgainstGatewayApi = false;
        verificationNote = `Amount mismatch during gateway verification (webhook=${event.amountMinor}, gateway=${verification.amountMinor}).`;
      } else {
        verificationNote = verification.verified
          ? 'Webhook signature and server-to-server gateway verification both succeeded.'
          : `Gateway verification returned status: ${verification.status}.`;
      }
    } catch (err) {
      verificationNote = `Gateway re-verification error: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`;
    }
  } else {
    verificationNote = `Webhook signature verified; server-to-server gateway API verification skipped until ${adapter.getMissingEnvVars().join(', ')} is configured.`;
  }

  paymentTransactionStore.applyWebhookEvent({
    event,
    verifiedAgainstGatewayApi,
  });

  const record: WebhookReconciliationRecord = {
    eventId: event.eventId,
    provider: event.provider,
    reference: event.reference,
    webhookStatus: event.status,
    verifiedAgainstGatewayApi,
    gatewayVerificationStatus,
    amountMinor: event.amountMinor,
    currency: event.currency,
    processedAt: new Date().toISOString(),
    verificationNote,
  };

  webhookIdempotency.record(event.eventId, record);
  webhookAuditLog.unshift(record);
  if (webhookAuditLog.length > 100) {
    webhookAuditLog.length = 100;
  }

  return { duplicate: false, record };
}

export function getIntegrationsStatus() {
  const emailStatus = getEmailProviderStatus();
  const storageStatus = getStorageStatus();
  const fxUrl = process.env.EXCHANGE_RATE_API_URL?.trim();

  return {
    paystack: {
      configured: paystackService.adapter.isConfigured(),
      webhookConfigured: Boolean(
        process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || process.env.PAYSTACK_SECRET_KEY?.trim()
      ),
      missingEnvVars: paystackService.adapter.getMissingEnvVars(),
      supportedCurrencies: paystackService.adapter.supportedCurrencies,
    },
    flutterwave: {
      configured: flutterwaveService.adapter.isConfigured(),
      webhookConfigured: Boolean(process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim()),
      missingEnvVars: flutterwaveService.adapter.getMissingEnvVars(),
      supportedCurrencies: flutterwaveService.adapter.supportedCurrencies,
    },
    email: emailStatus,
    currency: {
      mode: fxUrl ? 'external_api' : 'manual',
      externalApiConfigured: Boolean(fxUrl),
      optional: true,
      missingEnvVars: fxUrl ? [] : ['EXCHANGE_RATE_API_URL', 'EXCHANGE_RATE_API_KEY'],
    },
    storage: storageStatus,
  };
}
