import crypto from 'crypto';
import type {
  CartItem,
  Coupon,
  CurrencyCode,
  DemoActivityLog,
  DemoCustomerAccount,
  Department,
  DigitalEntitlement,
  Dispute,
  LedgerTransaction,
  Order,
  PaymentProviderId,
  PaymentStatus,
  PlatformConfig,
  Product,
  ProductQuestion,
  ProductReview,
  SellerApplication,
  SellerFulfilmentStatus,
  SellerOrder,
  ShippingAddress,
  Store,
  UserRole,
  WithdrawalRequest,
} from '../../shared/types.ts';
import {
  SEED_COUPONS,
  SEED_DEMO_CUSTOMERS,
  SEED_DEMO_ENTITLEMENTS,
  SEED_DEMO_ORDERS,
  SEED_DEMO_SELLER_APPLICATIONS,
  SEED_DEMO_SELLER_ORDERS,
  SEED_DEMO_TRANSACTIONS,
  SEED_DEMO_WITHDRAWALS,
  SEED_DEMO_DISPUTES,
  SEED_DEPARTMENTS,
  SEED_PLATFORM_CONFIG,
  SEED_PRODUCTS,
  SEED_QUESTIONS,
  SEED_REVIEWS,
  SEED_STORES,
} from '../../shared/catalogData.ts';
import { buildMultiVendorOrderSplit, generatePaymentReference } from '../payments/types.ts';
import { calculateCommissionSplit } from '../../shared/currency.ts';

export interface DemoNamespaceState {
  namespaceId: string;
  createdAt: number;
  departments: Department[];
  stores: Store[];
  products: Product[];
  coupons: Coupon[];
  reviews: ProductReview[];
  questions: ProductQuestion[];
  customers: DemoCustomerAccount[];
  sellerApplications: SellerApplication[];
  orders: Order[];
  sellerOrders: SellerOrder[];
  entitlements: DigitalEntitlement[];
  transactions: LedgerTransaction[];
  withdrawals: WithdrawalRequest[];
  disputes: Dispute[];
  platformConfig: PlatformConfig;
  customerCart: CartItem[];
  customerWishlist: string[];
  followedStoreIds: string[];
  customerAddresses: ShippingAddress[];
  activityLogs: DemoActivityLog[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSeededDemoState(namespaceId: string): DemoNamespaceState {
  return {
    namespaceId,
    createdAt: Date.now(),
    departments: clone(SEED_DEPARTMENTS),
    stores: clone(SEED_STORES),
    products: clone(SEED_PRODUCTS),
    coupons: clone(SEED_COUPONS),
    reviews: clone(SEED_REVIEWS),
    questions: clone(SEED_QUESTIONS),
    customers: clone(SEED_DEMO_CUSTOMERS),
    sellerApplications: clone(SEED_DEMO_SELLER_APPLICATIONS),
    orders: clone(SEED_DEMO_ORDERS),
    sellerOrders: clone(SEED_DEMO_SELLER_ORDERS),
    entitlements: clone(SEED_DEMO_ENTITLEMENTS),
    transactions: clone(SEED_DEMO_TRANSACTIONS),
    withdrawals: clone(SEED_DEMO_WITHDRAWALS),
    disputes: clone(SEED_DEMO_DISPUTES),
    platformConfig: clone(SEED_PLATFORM_CONFIG),
    customerCart: [
      {
        productId: 'prod-kanso-75-keyboard',
        quantity: 1,
        selectedVariation: 'Linear Tactile 45g · Raw Silver',
      },
      {
        productId: 'prod-isometric-dev-icons',
        quantity: 1,
        selectedLicense: 'commercial',
      },
    ],
    customerWishlist: ['prod-titanium-field-chrono', 'prod-saas-ui-kit'],
    followedStoreIds: ['store-atelier-systems'],
    customerAddresses: [
      {
        id: 'addr-demo-1',
        label: 'Lagos Studio',
        fullName: 'Tunde Adeyemi',
        phone: '+234 803 555 0192',
        line1: '14 Admiralty Way, Lekki Phase 1',
        city: 'Lagos',
        state: 'Lagos',
        postalCode: '105102',
        countryCode: 'NG',
        isDefault: true,
      },
      {
        id: 'addr-demo-2',
        label: 'London Office',
        fullName: 'Tunde Adeyemi',
        phone: '+44 20 7946 0182',
        line1: '28 Clerkenwell Road',
        city: 'London',
        state: 'Greater London',
        postalCode: 'EC1M 5PS',
        countryCode: 'GB',
        isDefault: false,
      },
    ],
    activityLogs: [
      {
        id: 'dlog-init',
        role: 'admin',
        action: 'sandbox_initialized',
        detail: 'Isolated demo sandbox provisioned with seeded multi-vendor state.',
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

class DemoEngine {
  private readonly namespaces = new Map<string, DemoNamespaceState>();
  private readonly MAX_NAMESPACES = 200;

  getOrCreateNamespace(namespaceId: string): DemoNamespaceState {
    const existing = this.namespaces.get(namespaceId);
    if (existing) return existing;

    // Evict oldest namespace if capacity exceeded to prevent memory exhaustion
    if (this.namespaces.size >= this.MAX_NAMESPACES) {
      const oldestKey = this.namespaces.keys().next().value;
      if (oldestKey) this.namespaces.delete(oldestKey);
    }

    const fresh = createSeededDemoState(namespaceId);
    this.namespaces.set(namespaceId, fresh);
    return fresh;
  }

  resetNamespace(namespaceId: string): DemoNamespaceState {
    const fresh = createSeededDemoState(namespaceId);
    fresh.activityLogs.unshift({
      id: `dlog-${Date.now()}`,
      role: 'customer',
      action: 'demo_reset',
      detail: 'Demo workspace reset to initial seeded state.',
      createdAt: new Date().toISOString(),
    });
    this.namespaces.set(namespaceId, fresh);
    return fresh;
  }

  appendLog(ns: DemoNamespaceState, role: UserRole, action: string, detail: string) {
    ns.activityLogs.unshift({
      id: `dlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      role,
      action,
      detail,
      createdAt: new Date().toISOString(),
    });
    if (ns.activityLogs.length > 60) {
      ns.activityLogs = ns.activityLogs.slice(0, 60);
    }
  }

  /**
   * Computes isolated seller earnings balances from verified ledger / sellerOrder records.
   * Sellers may ONLY withdraw settled/delivered earnings minus approved/pending withdrawals.
   */
  computeSellerBalances(ns: DemoNamespaceState, sellerId: string) {
    const orders = ns.sellerOrders.filter((o) => o.sellerId === sellerId);
    let grossSalesMinor = 0;
    let commissionMinor = 0;
    let availableGrossNetMinor = 0;
    let pendingNetMinor = 0;

    for (const o of orders) {
      if (o.fulfilmentStatus === 'cancelled' || o.fulfilmentStatus === 'refunded') continue;
      grossSalesMinor += o.grossMinor;
      commissionMinor += o.commissionMinor;
      if (o.fulfilmentStatus === 'delivered') {
        availableGrossNetMinor += o.netEarningsMinor;
      } else {
        pendingNetMinor += o.netEarningsMinor;
      }
    }

    const committedWithdrawals = ns.withdrawals
      .filter((w) => w.sellerId === sellerId && w.status !== 'rejected')
      .reduce((acc, w) => acc + w.amountMinor, 0);

    const availableBalanceMinor = Math.max(0, availableGrossNetMinor - committedWithdrawals);

    return {
      grossSalesMinor,
      commissionMinor,
      netEarningsMinor: availableGrossNetMinor + pendingNetMinor,
      pendingEarningsMinor: pendingNetMinor,
      availableBalanceMinor,
      withdrawnOrPendingMinor: committedWithdrawals,
    };
  }

  simulateCheckoutAndPayment(
    ns: DemoNamespaceState,
    params: {
      provider: PaymentProviderId;
      outcome: 'success' | 'failed' | 'cancelled' | 'pending';
      currency: CurrencyCode;
      couponCode?: string;
      shippingCity?: string;
      shippingCountry?: string;
      idempotencyKey?: string;
    }
  ): { order: Order; sellerOrders: SellerOrder[]; entitlements: DigitalEntitlement[]; paymentStatus: PaymentStatus } {
    if (ns.customerCart.length === 0) {
      throw new Error('Cart is empty.');
    }

    const providerScopedKey = params.idempotencyKey
      ? `${params.provider}:${params.idempotencyKey}`
      : undefined;

    if (providerScopedKey) {
      const existingOrder = ns.orders.find(
        (o) =>
          o.paymentProvider === params.provider &&
          o.paymentReference.includes(`_${providerScopedKey}`)
      );
      if (existingOrder) {
        return {
          order: existingOrder,
          sellerOrders: ns.sellerOrders.filter((so) => so.parentOrderId === existingOrder.id),
          entitlements: ns.entitlements.filter((e) => e.orderId === existingOrder.id),
          paymentStatus: existingOrder.paymentStatus,
        };
      }
    }

    const productsById = new Map(ns.products.map((p) => [p.id, p]));
    let discountPercent = 0;
    let normalizedCoupon: string | undefined;
    if (params.couponCode?.trim()) {
      const found = ns.coupons.find(
        (c) => c.active && c.code.toUpperCase() === params.couponCode!.trim().toUpperCase()
      );
      if (!found) {
        throw new Error(`Coupon "${params.couponCode}" is invalid or inactive.`);
      }
      discountPercent = found.discountPercent;
      normalizedCoupon = found.code;
    }

    const split = buildMultiVendorOrderSplit({
      cartItems: ns.customerCart,
      productsById,
      commissionRateBps: ns.platformConfig.commissionRateBps,
      discountPercent,
      checkoutCurrency: params.currency,
    });

    const now = new Date().toISOString();
    const orderId = `ord-demo-${Date.now()}`;
    const paymentReference = generatePaymentReference(params.provider, true);

    const paymentStatus: PaymentStatus =
      params.outcome === 'success'
        ? 'paid'
        : params.outcome === 'failed'
        ? 'failed'
        : params.outcome === 'cancelled'
        ? 'cancelled'
        : 'pending';

    const orderStatus =
      paymentStatus === 'paid'
        ? 'processing'
        : paymentStatus === 'cancelled' || paymentStatus === 'failed'
        ? 'cancelled'
        : 'pending';

    const order: Order = {
      id: orderId,
      customerId: 'demo-customer-1',
      currency: params.currency,
      subtotalMinor: split.subtotalMinor,
      discountMinor: split.discountMinor,
      shippingMinor: split.shippingMinor,
      totalMinor: split.totalMinor,
      couponCode: normalizedCoupon,
      paymentProvider: params.provider,
      paymentReference,
      paymentStatus,
      status: orderStatus,
      shippingCity: params.shippingCity || 'Lagos',
      shippingCountry: params.shippingCountry || 'NG',
      items: split.orderItems,
      createdAt: now,
    };

    const createdSellerOrders: SellerOrder[] = [];
    const createdEntitlements: DigitalEntitlement[] = [];

    if (paymentStatus === 'paid' || paymentStatus === 'pending') {
      for (let i = 0; i < split.sellerOrders.length; i++) {
        const so = split.sellerOrders[i];
        const allDigital = so.items.every((item) => item.productType === 'digital');
        const sellerOrder: SellerOrder = {
          ...so,
          id: `sord-demo-${Date.now()}-${i + 1}`,
          parentOrderId: orderId,
          customerId: 'demo-customer-1',
          customerName: 'Tunde Adeyemi',
          fulfilmentStatus:
            paymentStatus === 'paid' && allDigital ? 'delivered' : 'pending',
          createdAt: now,
        };
        createdSellerOrders.push(sellerOrder);
        ns.sellerOrders.unshift(sellerOrder);

        if (paymentStatus === 'paid') {
          ns.transactions.unshift({
            id: `tx-demo-${Date.now()}-crd-${i}`,
            orderId,
            sellerId: so.sellerId,
            userId: so.sellerId,
            type: 'seller_credit',
            provider: 'ledger',
            reference: `CRD_${paymentReference}_${i + 1}`,
            currency: params.currency,
            amountMinor: so.netEarningsMinor,
            status: allDigital ? 'completed' : 'pending',
            note: `Net earnings for order ${orderId} (${so.storeName})`,
            createdAt: now,
          });
          ns.transactions.unshift({
            id: `tx-demo-${Date.now()}-fee-${i}`,
            orderId,
            sellerId: so.sellerId,
            userId: 'platform',
            type: 'commission',
            provider: 'ledger',
            reference: `FEE_${paymentReference}_${i + 1}`,
            currency: params.currency,
            amountMinor: so.commissionMinor,
            status: 'completed',
            note: `Marketplace commission (${(so.commissionRateBps / 100).toFixed(1)}%)`,
            createdAt: now,
          });
        }
      }
    }

    if (paymentStatus === 'paid') {
      // Reserve/deduct inventory & grant digital entitlements
      for (const item of split.orderItems) {
        const product = productsById.get(item.productId);
        if (!product) continue;
        product.salesCount += item.quantity;
        if (product.productType === 'physical') {
          product.stockQty = Math.max(0, product.stockQty - item.quantity);
        } else if (product.digitalMeta) {
          const expiry = new Date(
            Date.now() + product.digitalMeta.downloadExpiryDays * 86400_000
          ).toISOString();
          const entitlement: DigitalEntitlement = {
            id: `ent-demo-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
            customerId: 'demo-customer-1',
            orderId,
            productId: product.id,
            productTitle: product.title,
            sellerId: product.sellerId,
            storeName: product.storeName,
            licenseType: item.selectedLicense || 'personal',
            version: product.digitalMeta.version,
            downloadsUsed: 0,
            maxDownloads: product.digitalMeta.downloadLimit,
            expiresAt: expiry,
            assetKey: product.digitalMeta.assetKey,
            fileFormat: product.digitalMeta.fileFormat,
            createdAt: now,
          };
          createdEntitlements.push(entitlement);
          ns.entitlements.unshift(entitlement);
        }
      }
      ns.customerCart = [];
    }

    ns.orders.unshift(order);
    ns.transactions.unshift({
      id: `tx-demo-${Date.now()}-chg`,
      orderId,
      userId: 'demo-customer-1',
      type: 'charge',
      provider: params.provider,
      reference: paymentReference,
      currency: params.currency,
      amountMinor: split.totalMinor,
      status:
        paymentStatus === 'paid'
          ? 'completed'
          : paymentStatus === 'pending'
          ? 'pending'
          : 'failed',
      note: `Simulated ${params.provider} checkout (${params.outcome})`,
      createdAt: now,
    });

    this.appendLog(
      ns,
      'customer',
      'simulated_checkout',
      `Order ${orderId} (${params.provider}, ${paymentStatus}) across ${split.sellerOrders.length} vendor(s).`
    );

    return {
      order,
      sellerOrders: createdSellerOrders,
      entitlements: createdEntitlements,
      paymentStatus,
    };
  }

  updateSellerOrderStatus(
    ns: DemoNamespaceState,
    sellerOrderId: string,
    sellerId: string,
    status: SellerFulfilmentStatus,
    trackingNumber?: string,
    carrier?: string
  ): SellerOrder {
    const so = ns.sellerOrders.find((o) => o.id === sellerOrderId && o.sellerId === sellerId);
    if (!so) throw new Error('Seller order not found.');

    if (so.fulfilmentStatus === 'refunded') {
      throw new Error('Refunded orders cannot be modified.');
    }

    so.fulfilmentStatus = status;
    if (trackingNumber) so.trackingNumber = trackingNumber;
    if (carrier) so.carrier = carrier;

    // Recompute parent order status
    const parent = ns.orders.find((o) => o.id === so.parentOrderId);
    if (parent) {
      const siblings = ns.sellerOrders.filter((s) => s.parentOrderId === parent.id);
      if (siblings.every((s) => s.fulfilmentStatus === 'delivered')) {
        parent.status = 'delivered';
      } else if (siblings.some((s) => s.fulfilmentStatus === 'shipped')) {
        parent.status = 'shipped';
      } else if (siblings.every((s) => s.fulfilmentStatus === 'cancelled')) {
        parent.status = 'cancelled';
      }
    }

    if (status === 'delivered') {
      const tx = ns.transactions.find(
        (t) => t.orderId === so.parentOrderId && t.sellerId === sellerId && t.type === 'seller_credit'
      );
      if (tx) tx.status = 'completed';
    }

    this.appendLog(ns, 'seller', 'seller_order_updated', `${sellerOrderId} marked ${status}.`);
    return so;
  }

  requestSellerWithdrawal(
    ns: DemoNamespaceState,
    sellerId: string,
    input: {
      amountMinor: number;
      bankName: string;
      accountNumberLast4: string;
      accountName: string;
    }
  ): WithdrawalRequest {
    const balances = this.computeSellerBalances(ns, sellerId);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('Withdrawal amount must be a positive integer in minor units.');
    }
    if (input.amountMinor > balances.availableBalanceMinor) {
      throw new Error(
        `Insufficient available balance. Pending or unearned funds cannot be withdrawn (available: ${balances.availableBalanceMinor}).`
      );
    }

    const store = ns.stores.find((s) => s.ownerId === sellerId);
    if (!store) throw new Error('Seller store not found.');

    const withdrawal: WithdrawalRequest = {
      id: `wdr-demo-${Date.now()}`,
      sellerId,
      storeId: store.id,
      storeName: store.name,
      currency: 'USD',
      amountMinor: input.amountMinor,
      bankName: input.bankName.trim(),
      accountNumberLast4: input.accountNumberLast4.slice(-4),
      accountName: input.accountName.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    ns.withdrawals.unshift(withdrawal);
    this.appendLog(
      ns,
      'seller',
      'withdrawal_requested',
      `Requested withdrawal ${withdrawal.id} for ${withdrawal.amountMinor} minor units.`
    );
    return withdrawal;
  }

  recalculateAllDemoCommissions(ns: DemoNamespaceState, newRateBps: number) {
    ns.platformConfig.commissionRateBps = Math.min(3500, Math.max(0, Math.round(newRateBps)));
    // Historical settled orders keep original rates; future orders use updated rate.
    const { commissionMinor } = calculateCommissionSplit(10000, ns.platformConfig.commissionRateBps);
    this.appendLog(
      ns,
      'admin',
      'commission_updated',
      `Updated demo commission rate to ${(ns.platformConfig.commissionRateBps / 100).toFixed(1)}% (${commissionMinor} minor per $100).`
    );
  }
}

export const demoEngine = new DemoEngine();
