import { useState } from 'react';
import { Download, Package, Heart, MapPin, ShieldAlert, Store as StoreIcon } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { ProductCard } from './ProductCard.tsx';

export function CustomerPortal() {
  const {
    isDemoMode,
    demoLoading,
    openDemoSelector,
    firebaseUser,
    setAuthModalOpen,
    orders,
    sellerOrders,
    entitlements,
    wishlist,
    products,
    addresses,
    disputes,
    formatPrice,
    downloadDigitalAsset,
    openDispute,
    submitLiveSellerApplication,
    notify,
  } = useMarketplace();

  const [tab, setTab] = useState<'orders' | 'downloads' | 'wishlist' | 'addresses' | 'seller-apply'>(
    'orders'
  );
  const [disputeTargetId, setDisputeTargetId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDetails, setDisputeDetails] = useState('');

  const [sellerApp, setSellerApp] = useState({
    businessName: '',
    countryCode: 'NG',
    categoryFocus: 'Electronics & Digital Tools',
    description: '',
  });

  if (!isDemoMode && !firebaseUser) {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-zinc-900">
            Customer Orders &amp; Digital Download Library
          </h1>
          <p className="text-sm text-zinc-600 max-w-lg mx-auto">
            Sign in or create an account to view your orders and digital library, or explore Customer Demo with sample data.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Sign In / Create Account
            </button>
            <button
              type="button"
              disabled={demoLoading}
              onClick={openDemoSelector}
              className="px-5 py-2.5 bg-blue-600 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
            >
              Enter Demo Mode
            </button>
          </div>
        </div>
      </section>
    );
  }

  const wishlistProducts = products.filter((p) => wishlist.includes(p.id));

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900">
            {isDemoMode ? 'Customer Demo · Demo Mode' : firebaseUser?.displayName || 'My Account'}
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Track multi-vendor shipments, download licensed digital assets, and manage saved addresses.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 bg-white border border-zinc-200 p-1 rounded-xl">
          {(
            [
              { id: 'orders', label: `Orders (${orders.length})`, icon: Package },
              { id: 'downloads', label: `Downloads (${entitlements.length})`, icon: Download },
              { id: 'wishlist', label: `Wishlist (${wishlistProducts.length})`, icon: Heart },
              { id: 'addresses', label: `Addresses (${addresses.length})`, icon: MapPin },
              { id: 'seller-apply', label: 'Become a Seller', icon: StoreIcon },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ui-transition ${
                tab === id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders & Multi-Vendor Tracking */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center text-sm text-zinc-600">
              No orders placed yet. Add items to your cart and simulate checkout to test multi-vendor order splitting.
            </div>
          ) : (
            orders.map((order) => {
              const children = sellerOrders.filter((s) => s.parentOrderId === order.id);
              return (
                <div
                  key={order.id}
                  className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                    <div>
                      <p className="font-mono text-sm font-bold text-zinc-900">{order.id}</p>
                      <p className="text-xs text-zinc-500">
                        {new Date(order.createdAt).toLocaleDateString()} · {order.paymentProvider.toUpperCase()} ({order.paymentStatus}) · Ref {order.paymentReference}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-mono text-base font-bold text-zinc-900">
                        {formatPrice(order.totalMinor, order.currency)}
                      </p>
                      <p className="text-xs capitalize text-zinc-600">Order Status: {order.status}</p>
                    </div>
                  </div>

                  {/* Individual Seller Split Fulfilments */}
                  <div className="space-y-3">
                    {children.map((so) => (
                      <div
                        key={so.id}
                        className="bg-stone-50 border border-zinc-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-zinc-900">
                            Vendor Shipment: {so.storeName} ({so.id})
                          </p>
                          <p className="text-xs text-zinc-600">
                            {so.items.map((i) => `${i.title} × ${i.quantity}`).join(', ')}
                          </p>
                          {so.trackingNumber && (
                            <p className="text-xs font-mono text-blue-700">
                              Tracking: {so.carrier || 'Courier'} · {so.trackingNumber}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono capitalize text-zinc-800 bg-white border border-zinc-200 px-2.5 py-1 rounded">
                            {so.fulfilmentStatus.replace('_', ' ')}
                          </span>
                          {isDemoMode && so.fulfilmentStatus !== 'refunded' && (
                            <button
                              type="button"
                              onClick={() => setDisputeTargetId(so.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Request Refund / Dispute
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {disputes.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-3">
              <h2 className="font-display text-base font-bold text-zinc-900">Active Disputes</h2>
              {disputes.map((d) => (
                <div key={d.id} className="text-xs border-t border-zinc-100 pt-3 flex justify-between gap-4">
                  <div>
                    <p className="font-semibold text-zinc-900">
                      {d.reason} ({d.sellerOrderId})
                    </p>
                    <p className="text-zinc-600">{d.details}</p>
                    {d.resolutionNote && (
                      <p className="text-emerald-700 mt-1">Resolution: {d.resolutionNote}</p>
                    )}
                  </div>
                  <span className="font-mono capitalize text-zinc-700 shrink-0">
                    {d.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {disputeTargetId && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await openDispute(disputeTargetId, disputeReason, disputeDetails);
                setDisputeTargetId(null);
                setDisputeReason('');
                setDisputeDetails('');
              }}
              className="bg-white border border-zinc-300 rounded-2xl p-6 space-y-3"
            >
              <h3 className="text-sm font-bold text-zinc-900">
                Open Return / Refund Request ({disputeTargetId})
              </h3>
              <input
                required
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Reason (e.g. Damaged on arrival / Wrong variation)"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <textarea
                required
                rows={3}
                value={disputeDetails}
                onChange={(e) => setDisputeDetails(e.target.value)}
                placeholder="Provide order details for seller and admin review..."
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Submit Dispute
                </button>
                <button
                  type="button"
                  onClick={() => setDisputeTargetId(null)}
                  className="px-4 py-2 bg-stone-100 text-zinc-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Digital Download Library */}
      {tab === 'downloads' && (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-zinc-900">
                My Digital Library
              </h2>
              <p className="text-xs text-zinc-500">
                Download your purchased digital products, licenses, and updates anytime.
              </p>
            </div>
          </div>

          {entitlements.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              No digital purchases yet. Purchase a digital template or resource to unlock instant downloads.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {entitlements.map((ent) => (
                <div
                  key={ent.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <p className="font-display text-sm font-bold text-zinc-900">
                      {ent.productTitle}
                    </p>
                    <p className="text-xs text-zinc-600">
                      {ent.storeName} · <span className="capitalize">{ent.licenseType}</span> License · v{ent.version} · {ent.fileFormat}
                    </p>
                    <p className="text-xs font-mono text-zinc-500 tabular-nums">
                      Downloads used: {ent.downloadsUsed}/{ent.maxDownloads} · Expires{' '}
                      {new Date(ent.expiresAt).toLocaleDateString()}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={ent.downloadsUsed >= ent.maxDownloads}
                    onClick={() => downloadDigitalAsset(ent)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-blue-600 disabled:bg-zinc-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {ent.downloadsUsed >= ent.maxDownloads ? 'Limit Reached' : 'Download Package'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wishlist */}
      {tab === 'wishlist' && (
        <div>
          {wishlistProducts.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center text-sm text-zinc-500">
              Your wishlist is empty.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {wishlistProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shipping Addresses */}
      {tab === 'addresses' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {addresses.map((addr) => (
            <div key={addr.id} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-1 text-xs">
              <p className="font-bold text-sm text-zinc-900">
                {addr.label} ({addr.countryCode})
              </p>
              <p className="text-zinc-800">{addr.fullName}</p>
              <p className="text-zinc-600">
                {addr.line1}, {addr.city}, {addr.state} {addr.postalCode}
              </p>
              <p className="text-zinc-500 font-mono">{addr.phone}</p>
            </div>
          ))}
        </div>
      )}

      {/* Seller Onboarding Application */}
      {tab === 'seller-apply' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (isDemoMode) {
              notify('Switch to Seller Demo or Admin Demo from the top bar to test seller onboarding!', 'info');
              return;
            }
            await submitLiveSellerApplication(sellerApp);
            setSellerApp({
              businessName: '',
              countryCode: 'NG',
              categoryFocus: 'Electronics & Digital Tools',
              description: '',
            });
          }}
          className="bg-white border border-zinc-200 rounded-2xl p-6 max-w-2xl space-y-4"
        >
          <h2 className="font-display text-lg font-bold text-zinc-900">
            Apply for a DevStore Seller Storefront
          </h2>
          <p className="text-xs text-zinc-600">
            Sell physical hardware or licensed digital products internationally with automated multi-vendor order splitting.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              required
              placeholder="Business / Studio Name"
              value={sellerApp.businessName}
              onChange={(e) => setSellerApp({ ...sellerApp, businessName: e.target.value })}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
            />
            <input
              required
              placeholder="Country Code (e.g. NG, US, GB)"
              value={sellerApp.countryCode}
              onChange={(e) => setSellerApp({ ...sellerApp, countryCode: e.target.value })}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
            />
          </div>
          <input
            required
            placeholder="Primary Category Focus"
            value={sellerApp.categoryFocus}
            onChange={(e) => setSellerApp({ ...sellerApp, categoryFocus: e.target.value })}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
          />
          <textarea
            required
            rows={4}
            placeholder="Describe your products, fulfilment regions, or digital licensing experience..."
            value={sellerApp.description}
            onChange={(e) => setSellerApp({ ...sellerApp, description: e.target.value })}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-blue-600 cursor-pointer"
          >
            Submit Seller Application
          </button>
        </form>
      )}
    </section>
  );
}
