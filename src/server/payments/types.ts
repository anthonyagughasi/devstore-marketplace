import crypto from 'crypto';
import type {
  CartItem,
  CurrencyCode,
  OrderItemSummary,
  PaymentProviderId,
  Product,
  SellerOrder,
} from '../../shared/types.ts';
import { calculateCommissionSplit, getLicenseUnitPriceMinor } from '../../shared/currency.ts';

export interface InitializePaymentRequest {
  reference: string;
  email: string;
  amountMinor: number;
  currency: CurrencyCode;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  splitSubaccounts?: { subaccountCode: string; shareMinor: number }[];
}

export interface InitializePaymentResponse {
  configured: boolean;
  provider: PaymentProviderId;
  authorizationUrl?: string;
  reference: string;
  missingEnvVars?: string[];
  message?: string;
}

export type PaymentTransactionStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'abandoned';

export interface VerifyPaymentResponse {
  configured: boolean;
  verified: boolean;
  provider?: PaymentProviderId;
  status: PaymentTransactionStatus;
  orderStatus?: 'pending' | 'processing' | 'cancelled';
  reference: string;
  orderId?: string;
  amountMinor?: number;
  currency?: CurrencyCode;
  providerTransactionId?: string;
  missingEnvVars?: string[];
  message?: string;
}

export interface PaymentTransactionRecord {
  reference: string;
  orderId: string;
  userId: string;
  provider: PaymentProviderId;
  currency: CurrencyCode;
  amountMinor: number;
  status: PaymentTransactionStatus;
  orderStatus: 'pending' | 'processing' | 'cancelled';
  authorizationUrl?: string;
  providerTransactionId?: string;
  callbackUrl?: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  verificationNote?: string;
}

export interface ParsedWebhookEvent {
  eventId: string;
  provider: PaymentProviderId;
  reference: string;
  providerTransactionId?: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  amountMinor: number;
  currency: CurrencyCode;
  rawEventType: string;
}

export interface PaymentProviderAdapter {
  readonly id: PaymentProviderId;
  readonly displayName: string;
  readonly supportedCurrencies: CurrencyCode[];
  isConfigured(): boolean;
  getMissingEnvVars(): string[];
  initializePayment(input: InitializePaymentRequest): Promise<InitializePaymentResponse>;
  verifyPayment(reference: string, transactionId?: string): Promise<VerifyPaymentResponse>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhookEvent(payload: unknown): ParsedWebhookEvent | null;
}

export function getCrossProviderReferenceError(
  expectedProvider: PaymentProviderId,
  reference: string
): string | null {
  const normalized = reference.trim().toUpperCase();
  if (expectedProvider === 'paystack' && normalized.startsWith('FLW_')) {
    return 'Cross-provider mismatch: Flutterwave reference cannot be processed by Paystack.';
  }
  if (expectedProvider === 'flutterwave' && normalized.startsWith('PSK_')) {
    return 'Cross-provider mismatch: Paystack reference cannot be processed by Flutterwave.';
  }
  return null;
}

export function isValidCheckoutRedirectUrl(
  expectedProvider: PaymentProviderId,
  urlString: string
): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (expectedProvider === 'flutterwave' && host.includes('paystack')) return false;
    if (expectedProvider === 'paystack' && host.includes('flutterwave')) return false;
    return true;
  } catch {
    return false;
  }
}

export interface MultiVendorSplitResult {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  orderItems: OrderItemSummary[];
  sellerOrders: Omit<SellerOrder, 'id' | 'parentOrderId' | 'customerId' | 'customerName' | 'createdAt'>[];
}

/**
 * Computes deterministic, precision-safe multi-vendor split orders and commissions.
 * Supports physical & digital products in a single checkout with seller-level isolation.
 */
export function buildMultiVendorOrderSplit(params: {
  cartItems: CartItem[];
  productsById: Map<string, Product>;
  commissionRateBps: number;
  discountPercent?: number;
  checkoutCurrency: CurrencyCode;
}): MultiVendorSplitResult {
  const { cartItems, productsById, commissionRateBps, discountPercent = 0, checkoutCurrency } = params;

  const orderItems: OrderItemSummary[] = [];
  const bySeller = new Map<string, { storeId: string; storeName: string; items: OrderItemSummary[] }>();

  let subtotalMinor = 0;
  let hasPhysicalItem = false;

  for (const cartItem of cartItems) {
    const product = productsById.get(cartItem.productId);
    if (!product || product.approvalStatus !== 'approved') {
      throw new Error(`Product ${cartItem.productId} is unavailable.`);
    }

    const qty = Math.max(1, Math.min(50, Math.floor(cartItem.quantity)));
    if (product.productType === 'physical') {
      hasPhysicalItem = true;
      if (product.stockQty < qty) {
        throw new Error(`Insufficient stock for "${product.title}" (${product.stockQty} left).`);
      }
    }

    const unitPriceMinor =
      product.productType === 'digital'
        ? getLicenseUnitPriceMinor(
            product.priceMinor,
            cartItem.selectedLicense,
            product.digitalMeta?.licensePricingMultiplier
          )
        : product.priceMinor;

    const lineTotalMinor = unitPriceMinor * qty;
    subtotalMinor += lineTotalMinor;

    const summary: OrderItemSummary = {
      productId: product.id,
      title: product.title,
      productType: product.productType,
      sellerId: product.sellerId,
      storeId: product.storeId,
      storeName: product.storeName,
      quantity: qty,
      unitPriceMinor,
      lineTotalMinor,
      selectedVariation: cartItem.selectedVariation,
      selectedLicense: product.productType === 'digital' ? (cartItem.selectedLicense || 'personal') : undefined,
      imageUrl: product.imageUrls[0] || '',
    };
    orderItems.push(summary);

    const existingSellerBucket = bySeller.get(product.sellerId);
    if (existingSellerBucket) {
      existingSellerBucket.items.push(summary);
    } else {
      bySeller.set(product.sellerId, {
        storeId: product.storeId,
        storeName: product.storeName,
        items: [summary],
      });
    }
  }

  const safeDiscountPercent = Math.min(90, Math.max(0, discountPercent));
  const discountMinor = Math.round((subtotalMinor * safeDiscountPercent) / 100);
  const shippingMinor = hasPhysicalItem ? (subtotalMinor >= 30000 ? 0 : 1500) : 0;
  const totalMinor = Math.max(0, subtotalMinor - discountMinor + shippingMinor);

  const sellerOrders: MultiVendorSplitResult['sellerOrders'] = [];
  for (const [sellerId, bucket] of bySeller.entries()) {
    const sellerSubtotal = bucket.items.reduce((acc, item) => acc + item.lineTotalMinor, 0);
    const sellerDiscountShare =
      subtotalMinor > 0 ? Math.round((sellerSubtotal / subtotalMinor) * discountMinor) : 0;
    const grossMinor = Math.max(0, sellerSubtotal - sellerDiscountShare);
    const { commissionMinor, netEarningsMinor } = calculateCommissionSplit(grossMinor, commissionRateBps);

    sellerOrders.push({
      sellerId,
      storeId: bucket.storeId,
      storeName: bucket.storeName,
      currency: checkoutCurrency,
      grossMinor,
      commissionRateBps,
      commissionMinor,
      netEarningsMinor,
      fulfilmentStatus: 'pending',
      items: bucket.items,
    });
  }

  return {
    subtotalMinor,
    discountMinor,
    shippingMinor,
    totalMinor,
    orderItems,
    sellerOrders,
  };
}

/**
 * In-memory idempotency ledger preventing duplicate webhook processing & double order creation.
 */
export class IdempotencyRegistry {
  private readonly processedKeys = new Map<string, { processedAt: number; result: unknown }>();

  has(key: string): boolean {
    return this.processedKeys.has(key);
  }

  get<T>(key: string): T | undefined {
    return this.processedKeys.get(key)?.result as T | undefined;
  }

  record(key: string, result: unknown): void {
    this.processedKeys.set(key, { processedAt: Date.now(), result });
  }
}

export function generatePaymentReference(provider: PaymentProviderId, isDemo: boolean): string {
  const prefix = provider === 'paystack' ? 'PSK' : 'FLW';
  const envTag = isDemo ? 'DEMO' : 'LIVE';
  const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}_${envTag}_${Date.now()}_${rand}`;
}
