import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  CreditCard,
  ShieldCheck,
  KeyRound,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { CurrencyCode, Order, PaymentProviderId } from '../shared/types.ts';
import { convertMinorAmount, getLicenseUnitPriceMinor } from '../shared/currency.ts';

interface LiveCheckoutSession {
  provider: PaymentProviderId;
  reference: string;
  orderId: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: CurrencyCode;
}

interface LiveVerificationResult {
  configured: boolean;
  verified: boolean;
  provider: PaymentProviderId;
  status: string;
  orderStatus?: 'pending' | 'processing' | 'cancelled';
  reference: string;
  orderId?: string;
  amountMinor?: number;
  currency?: CurrencyCode;
  providerTransactionId?: string;
  message?: string;
}

export function CheckoutView() {
  const {
    cart,
    products,
    coupons,
    addresses,
    addAddress,
    currency,
    formatPrice,
    platformConfig,
    integrations,
    isDemoMode,
    demoRole,
    enterDemoMode,
    simulateDemoCheckout,
    initializeLivePayment,
    verifyLivePayment,
    pendingPaymentCallback,
    clearPendingPaymentCallback,
    firebaseUser,
    authReady,
    setAuthModalOpen,
    setView,
    notify,
  } = useMarketplace();

  const [provider, setProvider] = useState<PaymentProviderId>('paystack');
  const [attemptNonce, setAttemptNonce] = useState<number>(() => Date.now());
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountPercent: number } | null>(
    null
  );
  const [selectedAddressId, setSelectedAddressId] = useState<string>(addresses[0]?.id || '');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddr, setNewAddr] = useState({
    label: 'Office',
    fullName: '',
    phone: '',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    countryCode: 'NG',
  });

  const [submitting, setSubmitting] = useState(false);
  const [verifyingCallback, setVerifyingCallback] = useState(false);
  const [liveCheckoutSession, setLiveCheckoutSession] = useState<LiveCheckoutSession | null>(null);
  const [lastResult, setLastResult] = useState<{
    order?: Order;
    paymentStatus?: string;
    liveVerification?: LiveVerificationResult;
    liveUnconfigured?: { provider: PaymentProviderId; missingEnvVars: string[]; message: string };
  } | null>(null);

  const handleSelectProvider = (nextProvider: PaymentProviderId) => {
    setProvider(nextProvider);
    setLiveCheckoutSession(null);
    setLastResult((prev) =>
      prev?.liveUnconfigured ? null : prev
    );
    setAttemptNonce(Date.now());
  };

  // Scope idempotency strictly by provider + currency + attempt + cart so switching
  // between Paystack and Flutterwave can never return a cached session from the other provider.
  const idempotencyKey = useMemo(() => {
    const cartSig = cart.map((c) => `${c.productId}:${c.quantity}:${c.selectedLicense || 'std'}`).join('_');
    return `CHK_${provider.toUpperCase()}_${currency}_${attemptNonce}_${cartSig}`;
  }, [attemptNonce, cart, currency, provider]);

  const runLiveVerification = useCallback(
    async (params: {
      provider: PaymentProviderId;
      reference: string;
      transactionId?: string;
      callbackStatus?: string;
    }) => {
      setVerifyingCallback(true);
      try {
        const verifiedRes = await verifyLivePayment(params);
        setLastResult({
          liveVerification: {
            ...verifiedRes,
            provider: verifiedRes.provider || params.provider,
          },
        });
        setLiveCheckoutSession(null);
        clearPendingPaymentCallback();
        notify(
          verifiedRes.verified
            ? `${params.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'} payment verified.`
            : `${params.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'} status: ${verifiedRes.status}.`,
          verifiedRes.verified ? 'success' : 'info'
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Payment verification failed.', 'error');
      } finally {
        setVerifyingCallback(false);
      }
    },
    [clearPendingPaymentCallback, notify, verifyLivePayment]
  );

  useEffect(() => {
    if (!pendingPaymentCallback || !authReady || !firebaseUser || verifyingCallback) {
      return;
    }
    setProvider(pendingPaymentCallback.provider);
    runLiveVerification(pendingPaymentCallback);
  }, [authReady, firebaseUser, pendingPaymentCallback, runLiveVerification, verifyingCallback]);

  const resolvedLines = useMemo(() => {
    return cart
      .map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) return null;
        const unitMinor =
          product.productType === 'digital'
            ? getLicenseUnitPriceMinor(
                product.priceMinor,
                item.selectedLicense,
                product.digitalMeta?.licensePricingMultiplier
              )
            : product.priceMinor;
        return {
          item,
          product,
          unitMinor,
          lineTotalMinor: unitMinor * item.quantity,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [cart, products]);

  const hasPhysicalItems = resolvedLines.some((l) => l.product.productType === 'physical');
  const subtotalMinor = resolvedLines.reduce((acc, l) => acc + l.lineTotalMinor, 0);
  const discountMinor = appliedCoupon
    ? Math.round((subtotalMinor * appliedCoupon.discountPercent) / 100)
    : 0;
  const shippingMinor = hasPhysicalItems ? (subtotalMinor >= 30000 ? 0 : 1500) : 0;
  const totalUsdMinor = Math.max(0, subtotalMinor - discountMinor + shippingMinor);
  const totalInCheckoutCurrencyMinor = convertMinorAmount(
    totalUsdMinor,
    'USD',
    currency,
    platformConfig.exchangeRates
  );

  const paystackCurrencyUnsupported = provider === 'paystack' && currency === 'EUR';

  const vendorGroups = useMemo(() => {
    const map = new Map<string, { storeName: string; totalMinor: number; count: number }>();
    for (const l of resolvedLines) {
      const curr = map.get(l.product.storeId);
      if (curr) {
        curr.totalMinor += l.lineTotalMinor;
        curr.count += l.item.quantity;
      } else {
        map.set(l.product.storeId, {
          storeName: l.product.storeName,
          totalMinor: l.lineTotalMinor,
          count: l.item.quantity,
        });
      }
    }
    return Array.from(map.values());
  }, [resolvedLines]);

  const handleApplyCoupon = () => {
    const found = coupons.find(
      (c) => c.active && c.code.toUpperCase() === couponInput.trim().toUpperCase()
    );
    if (!found) {
      notify('Coupon code not recognized or inactive.', 'error');
      return;
    }
    setAppliedCoupon({ code: found.code, discountPercent: found.discountPercent });
    notify(`Applied ${found.code} (${found.discountPercent}% off).`, 'success');
  };

  const handleDemoOutcome = async (outcome: 'success' | 'failed' | 'cancelled' | 'pending') => {
    setSubmitting(true);
    try {
      const activeAddr = addresses.find((a) => a.id === selectedAddressId) || addresses[0];
      const res = await simulateDemoCheckout({
        provider,
        outcome,
        couponCode: appliedCoupon?.code,
        shippingCity: activeAddr?.city || 'Lagos',
        shippingCountry: activeAddr?.countryCode || 'NG',
        idempotencyKey,
      });
      setLastResult({ order: res.order, paymentStatus: res.paymentStatus });
      notify(
        `Simulated ${provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'} outcome: ${res.paymentStatus.toUpperCase()}`,
        outcome === 'success' ? 'success' : 'info'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Checkout error.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLiveCheckout = async () => {
    if (!firebaseUser) {
      setAuthModalOpen(true);
      return;
    }
    if (paystackCurrencyUnsupported) {
      notify('Paystack supports NGN, USD, or GBP. Select Flutterwave for EUR or switch currency.', 'error');
      return;
    }
    setSubmitting(true);
    setLiveCheckoutSession(null);
    try {
      const orderId = `ord-live-${Date.now()}`;
      const res = await initializeLivePayment({
        provider,
        amountMinor: totalInCheckoutCurrencyMinor,
        orderId,
        idempotencyKey,
      });

      if (res.provider !== provider) {
        throw new Error(
          `Provider mismatch detected: expected ${provider}, received ${res.provider}.`
        );
      }

      if (!res.configured) {
        setLastResult({
          liveUnconfigured: {
            provider,
            missingEnvVars: res.missingEnvVars || [],
            message: res.message || `${provider} credentials are required for live checkout.`,
          },
        });
      } else if (res.authorizationUrl) {
        const host = new URL(res.authorizationUrl).hostname.toLowerCase();
        if (provider === 'flutterwave' && host.includes('paystack')) {
          throw new Error('Blocked invalid Paystack redirect returned during Flutterwave checkout.');
        }
        if (provider === 'paystack' && host.includes('flutterwave')) {
          throw new Error('Blocked invalid Flutterwave redirect returned during Paystack checkout.');
        }

        const session: LiveCheckoutSession = {
          provider,
          reference: res.reference,
          orderId: res.orderId || orderId,
          authorizationUrl: res.authorizationUrl,
          amountMinor: totalInCheckoutCurrencyMinor,
          currency,
        };
        setLiveCheckoutSession(session);

        // Redirect top-level browser tabs directly to the provider's hosted checkout URL;
        // inside embedded preview iframes, display the hosted link handoff card instead of window.open.
        try {
          if (window.self === window.top) {
            window.location.assign(res.authorizationUrl);
          }
        } catch {
          // Cross-origin frame: keep the hosted checkout handoff link visible
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Live payment initialization failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Dedicated DevStore Payment Callback / Verification Result View
  if (pendingPaymentCallback && !lastResult?.liveVerification) {
    const providerLabel =
      pendingPaymentCallback.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 space-y-5">
          <div className="flex items-center gap-3">
            <RefreshCw
              className={`w-6 h-6 text-blue-600 ${verifyingCallback ? 'animate-spin' : ''}`}
            />
            <div>
              <h1 className="font-display text-2xl font-bold text-zinc-900">
                Verifying {providerLabel} Payment
              </h1>
              <p className="text-xs font-mono text-zinc-500 mt-0.5">
                Ref: {pendingPaymentCallback.reference} · Provider: {providerLabel}
              </p>
            </div>
          </div>

          <p className="text-sm text-zinc-600">
            DevStore is verifying your {providerLabel} transaction directly with the{' '}
            {providerLabel} server API before updating your order status.
          </p>

          {!firebaseUser && authReady ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Sign In to Complete Verification
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPendingPaymentCallback();
                  setView('catalog');
                }}
                className="px-5 py-2.5 bg-white border border-zinc-200 text-zinc-800 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={verifyingCallback}
              onClick={() => runLiveVerification(pendingPaymentCallback)}
              className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
            >
              {verifyingCallback ? 'Verifying with Server...' : `Retry ${providerLabel} Verification`}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (lastResult?.liveVerification) {
    const lv = lastResult.liveVerification;
    const providerLabel = lv.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';
    const isPaid = lv.verified && lv.status === 'paid';
    const isPending = lv.status === 'pending';

    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            {isPaid ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            ) : isPending ? (
              <Clock className="w-7 h-7 text-amber-600" />
            ) : (
              <XCircle className="w-7 h-7 text-red-600" />
            )}
            <div>
              <h1 className="font-display text-2xl font-bold text-zinc-900">
                {isPaid
                  ? `${providerLabel} Payment Confirmed`
                  : lv.status === 'cancelled'
                  ? `${providerLabel} Payment Cancelled`
                  : isPending
                  ? `${providerLabel} Payment Pending`
                  : `${providerLabel} Payment Failed`}
              </h1>
              <p className="text-xs font-mono text-zinc-500 mt-0.5">
                Provider: {providerLabel} · Ref: {lv.reference}
                {lv.orderId ? ` · Order: ${lv.orderId}` : ''}
                {lv.providerTransactionId ? ` · Gateway Tx: ${lv.providerTransactionId}` : ''}
              </p>
            </div>
          </div>

          <div className="bg-stone-50 border border-zinc-200 rounded-xl p-4 text-xs text-zinc-700 space-y-1.5">
            <p className="font-semibold text-zinc-900">Server-Side Verification Summary</p>
            <p>
              Payment Status: <span className="font-mono font-semibold uppercase">{lv.status}</span>{' '}
              · Order Status:{' '}
              <span className="font-mono font-semibold uppercase">
                {lv.orderStatus || (isPaid ? 'processing' : 'cancelled')}
              </span>
            </p>
            {lv.message && <p className="text-zinc-600">{lv.message}</p>}
            <p className="text-zinc-500">
              Verified directly against {providerLabel} via{' '}
              <span className="font-mono">/api/payments/{lv.provider}/verify</span>.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setLastResult(null);
                setView('customer');
              }}
              className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              View Orders &amp; Downloads
            </button>
            <button
              type="button"
              onClick={() => {
                setLastResult(null);
                setView('checkout');
              }}
              className="px-5 py-2.5 bg-white border border-zinc-200 text-zinc-800 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Return to Checkout
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (lastResult?.order) {
    const st = lastResult.paymentStatus;
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            {st === 'paid' ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            ) : st === 'pending' ? (
              <Clock className="w-7 h-7 text-amber-600" />
            ) : (
              <XCircle className="w-7 h-7 text-red-600" />
            )}
            <div>
              <h1 className="font-display text-2xl font-bold text-zinc-900">
                {st === 'paid'
                  ? `Order ${lastResult.order.id} Confirmed`
                  : st === 'pending'
                  ? `Payment Pending Verification (${lastResult.order.id})`
                  : `Payment ${st?.toUpperCase()} (${lastResult.order.id})`}
              </h1>
              <p className="text-xs font-mono text-zinc-500 mt-0.5">
                Ref: {lastResult.order.paymentReference} · Provider:{' '}
                {lastResult.order.paymentProvider === 'flutterwave' ? 'Flutterwave' : 'Paystack'}
              </p>
            </div>
          </div>

          <div className="bg-stone-50 border border-zinc-200 rounded-xl p-4 text-xs text-zinc-700 space-y-1.5">
            <p className="font-semibold text-zinc-900">Simulated Multi-Vendor Settlement Summary</p>
            <p>
              Total charged:{' '}
              <span className="font-mono font-semibold">
                {formatPrice(lastResult.order.totalMinor, lastResult.order.currency)}
              </span>
            </p>
            <p>
              {st === 'paid'
                ? 'Seller split orders created, physical stock decremented, and digital entitlements unlocked in your Download Library.'
                : 'No inventory or digital licenses were released because payment did not settle.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setView('customer')}
              className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              View Order History &amp; Downloads
            </button>
            <button
              type="button"
              onClick={() => setView('catalog')}
              className="px-5 py-2.5 bg-white border border-zinc-200 text-zinc-800 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Continue Shopping
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900">
            Multi-Vendor Checkout
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            One unified customer checkout split automatically into seller-specific fulfilment orders.
          </p>
        </div>
      </div>

      {resolvedLines.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-zinc-900">Your cart is empty</p>
          <button
            type="button"
            onClick={() => setView('catalog')}
            className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Browse Products
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Shipping, Payment Provider & Simulation/Live Gate */}
          <div className="lg:col-span-7 space-y-6">
            {hasPhysicalItems && (
              <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-zinc-900">
                    International Shipping Address
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowNewAddress((s) => !s)}
                    className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                  >
                    {showNewAddress ? 'Cancel' : '+ Add New Address'}
                  </button>
                </div>

                {addresses.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {addresses.map((addr) => (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={() => setSelectedAddressId(addr.id)}
                        className={`p-3.5 rounded-xl border text-left text-xs space-y-1 cursor-pointer ${
                          (selectedAddressId || addresses[0]?.id) === addr.id
                            ? 'border-blue-600 bg-blue-50/40'
                            : 'border-zinc-200 hover:bg-stone-50'
                        }`}
                      >
                        <p className="font-semibold text-zinc-900">
                          {addr.label} · {addr.countryCode}
                        </p>
                        <p className="text-zinc-700">{addr.fullName}</p>
                        <p className="text-zinc-500">
                          {addr.line1}, {addr.city}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                {showNewAddress && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await addAddress(newAddr);
                      setShowNewAddress(false);
                    }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-100"
                  >
                    <input
                      required
                      placeholder="Label (e.g. Home)"
                      value={newAddr.label}
                      onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      required
                      placeholder="Full Name"
                      value={newAddr.fullName}
                      onChange={(e) => setNewAddr({ ...newAddr, fullName: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      required
                      placeholder="Street Address"
                      value={newAddr.line1}
                      onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })}
                      className="sm:col-span-2 border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      required
                      placeholder="City"
                      value={newAddr.city}
                      onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      required
                      placeholder="Country Code (NG, US, GB, DE)"
                      value={newAddr.countryCode}
                      onChange={(e) => setNewAddr({ ...newAddr, countryCode: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="sm:col-span-2 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Save Shipping Address
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Payment Provider Adapter Selection */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Select Payment Method ({currency})
                </h2>
                <span className="text-xs font-mono text-zinc-500">Isolated Gateways</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    {
                      id: 'paystack',
                      label: 'Pay with Paystack',
                      endpoint: '/api/payments/paystack/initialize',
                      desc: 'Cards, Bank Transfer, USSD, Apple Pay · NGN / USD / GBP',
                      enabled: platformConfig.paystackEnabled,
                      configured: integrations?.paystack.configured,
                      accentClass: 'border-emerald-600 bg-emerald-50/40',
                    },
                    {
                      id: 'flutterwave',
                      label: 'Pay with Flutterwave',
                      endpoint: '/api/payments/flutterwave/initialize',
                      desc: 'Global Cards, Mobile Money, Bank · NGN / USD / GBP / EUR',
                      enabled: platformConfig.flutterwaveEnabled,
                      configured: integrations?.flutterwave.configured,
                      accentClass: 'border-amber-600 bg-amber-50/40',
                    },
                  ] as const
                ).map((gw) => (
                  <button
                    key={gw.id}
                    type="button"
                    disabled={!gw.enabled}
                    onClick={() => handleSelectProvider(gw.id)}
                    aria-pressed={provider === gw.id}
                    className={`p-4 rounded-xl border text-left space-y-1.5 cursor-pointer ui-transition ${
                      provider === gw.id ? gw.accentClass : 'border-zinc-200 hover:bg-stone-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold text-zinc-900 flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 shrink-0" />
                        {gw.label}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-600 shrink-0">
                        {isDemoMode ? 'Demo Mode' : gw.configured ? 'Live Ready' : 'Env Required'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600">{gw.desc}</p>
                    <p className="text-[11px] font-mono text-zinc-500">{gw.endpoint}</p>
                  </button>
                ))}
              </div>

              {/* Demo Mode Simulator Controls vs Live Production Checkout */}
              {isDemoMode ? (
                demoRole !== 'customer' ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
                    <p className="text-xs text-zinc-800">
                      You are currently in <strong>{demoRole.toUpperCase()}</strong> Demo Mode view. Switch to Customer Demo to simulate checkout payments.
                    </p>
                    <button
                      type="button"
                      onClick={() => enterDemoMode('customer')}
                      className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      Customer Demo
                    </button>
                  </div>
                ) : (
                  <div className="bg-stone-50 border border-zinc-200 rounded-xl p-5 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span>
                        Demo Mode Payment Simulator ({provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'})
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600">
                      Demo Mode never invokes live Paystack or Flutterwave APIs. Simulate an outcome for{' '}
                      <strong>{provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'}</strong>:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDemoOutcome('success')}
                        className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Simulate Success
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDemoOutcome('pending')}
                        className="py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Simulate Pending
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDemoOutcome('failed')}
                        className="py-2.5 px-3 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Simulate Failed
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDemoOutcome('cancelled')}
                        className="py-2.5 px-3 bg-zinc-700 hover:bg-zinc-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Simulate Cancel
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-4 pt-2">
                  {paystackCurrencyUnsupported && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900">
                      Paystack supports <strong>NGN, USD, and GBP</strong>. Select{' '}
                      <strong>Pay with Flutterwave</strong> for EUR checkouts or switch your currency above.
                    </div>
                  )}

                  {lastResult?.liveUnconfigured &&
                    lastResult.liveUnconfigured.provider === provider && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-xs text-zinc-800">
                        <div className="flex items-center gap-2 font-semibold text-amber-900">
                          <KeyRound className="w-4 h-4" />
                          <span>
                            {provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'} Credentials Required
                          </span>
                        </div>
                        <p>{lastResult.liveUnconfigured.message}</p>
                        <p className="font-mono text-[11px] bg-white border border-amber-200 rounded p-2">
                          Required Secrets: {lastResult.liveUnconfigured.missingEnvVars.join(', ')}
                        </p>
                      </div>
                    )}

                  {liveCheckoutSession && liveCheckoutSession.provider === provider && (
                    <div className="bg-stone-50 border border-zinc-300 rounded-xl p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-900 uppercase tracking-wide">
                          {liveCheckoutSession.provider === 'flutterwave'
                            ? 'Flutterwave Hosted Checkout Ready'
                            : 'Paystack Checkout Session Ready'}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-600">
                          {liveCheckoutSession.reference}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600">
                        {liveCheckoutSession.provider === 'flutterwave'
                          ? 'Your transaction was initialized with Flutterwave (/v3/payments). Complete payment on Flutterwave hosted checkout (`data.link`), then DevStore will verify your transaction server-side.'
                          : 'Your transaction was initialized with Paystack (/transaction/initialize). Complete payment on Paystack checkout (`authorization_url`), then DevStore will verify your transaction server-side.'}
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        <a
                          href={liveCheckoutSession.authorizationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg ui-transition"
                        >
                          <span>
                            {liveCheckoutSession.provider === 'flutterwave'
                              ? 'Open Flutterwave Hosted Checkout'
                              : 'Open Paystack Checkout'}
                          </span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          disabled={verifyingCallback}
                          onClick={() =>
                            runLiveVerification({
                              provider: liveCheckoutSession.provider,
                              reference: liveCheckoutSession.reference,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white border border-zinc-300 hover:bg-stone-100 text-zinc-900 text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${verifyingCallback ? 'animate-spin' : ''}`}
                          />
                          Verify Payment Status
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={submitting || paystackCurrencyUnsupported}
                      onClick={handleLiveCheckout}
                      className="flex-1 py-3 px-5 bg-zinc-900 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg cursor-pointer ui-transition"
                    >
                      {submitting
                        ? `Initializing ${provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'}...`
                        : firebaseUser
                        ? `Pay ${formatPrice(totalUsdMinor, 'USD')} with ${
                            provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'
                          }`
                        : `Sign In to Pay with ${
                            provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'
                          }`}
                    </button>
                    <button
                      type="button"
                      onClick={() => enterDemoMode('customer')}
                      className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-zinc-900 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Enter Demo Mode
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Order Summary + Multi-Vendor Split Preview */}
          <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-2xl p-6 space-y-5">
            <h2 className="font-display text-base font-bold text-zinc-900">Order Breakdown</h2>

            <div className="space-y-3 divide-y divide-zinc-100">
              {resolvedLines.map(({ item, product, lineTotalMinor }, i) => (
                <div
                  key={`${item.productId}-${i}`}
                  className="pt-3 first:pt-0 flex justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-zinc-900">
                      {product.title} × {item.quantity}
                    </p>
                    <p className="text-zinc-500">
                      {product.storeName}
                      {item.selectedLicense ? ` · ${item.selectedLicense}` : ''}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-zinc-900 tabular-nums shrink-0">
                    {formatPrice(lineTotalMinor, product.currency)}
                  </span>
                </div>
              ))}
            </div>

            {/* Coupon Code */}
            <div className="flex gap-2 pt-2 border-t border-zinc-100">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Coupon code (try DEVSTORE15)"
                className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono uppercase"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-zinc-900 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Apply
              </button>
            </div>

            {/* Totals */}
            <div className="space-y-2 pt-3 border-t border-zinc-200 text-xs tabular-nums">
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal</span>
                <span className="font-mono">{formatPrice(subtotalMinor, 'USD')}</span>
              </div>
              {appliedCoupon && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount ({appliedCoupon.code})</span>
                  <span className="font-mono">−{formatPrice(discountMinor, 'USD')}</span>
                </div>
              )}
              <div className="flex justify-between text-zinc-600">
                <span>International Shipping</span>
                <span className="font-mono">
                  {shippingMinor === 0 ? 'Free' : formatPrice(shippingMinor, 'USD')}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-zinc-900 pt-2 border-t border-zinc-200">
                <span>Total</span>
                <span className="font-mono">{formatPrice(totalUsdMinor, 'USD')}</span>
              </div>
            </div>

            {/* Vendor Split Transparency */}
            <div className="bg-stone-50 border border-zinc-200 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
                <AlertCircle className="w-3.5 h-3.5 text-blue-600" />
                <span>
                  Multi-Vendor Order Split ({vendorGroups.length} seller
                  {vendorGroups.length === 1 ? '' : 's'})
                </span>
              </div>
              {vendorGroups.map((vg) => (
                <div key={vg.storeName} className="flex justify-between text-zinc-600 tabular-nums">
                  <span>
                    {vg.storeName} ({vg.count} item{vg.count === 1 ? '' : 's'})
                  </span>
                  <span className="font-mono">{formatPrice(vg.totalMinor, 'USD')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
