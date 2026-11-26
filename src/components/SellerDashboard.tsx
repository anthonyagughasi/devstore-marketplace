import { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Wallet,
  Store as StoreIcon,
  BarChart3,
  Plus,
  Trash2,
  Edit3,
  MessageSquare,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { DIGITAL_SUBCATEGORIES } from '../shared/catalogData.ts';
import type { Product, SellerFulfilmentStatus } from '../shared/types.ts';

type SellerSection = 'overview' | 'products' | 'orders' | 'finance' | 'store' | 'analytics';

export function SellerDashboard() {
  const {
    isDemoMode,
    demoRole,
    demoLoading,
    enterDemoMode,
    openDemoSelector,
    firebaseUser,
    liveRole,
    stores,
    products,
    departments,
    sellerOrders,
    sellerBalances,
    transactions,
    withdrawals,
    questions,
    formatPrice,
    createDemoProduct,
    updateDemoProduct,
    deleteDemoProduct,
    updateDemoSellerOrder,
    requestDemoWithdrawal,
    updateDemoStore,
    answerQuestion,
    notify,
  } = useMarketplace();

  const [section, setSection] = useState<SellerSection>('overview');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newProd, setNewProd] = useState({
    title: '',
    description: '',
    productType: 'physical' as 'physical' | 'digital',
    departmentSlug: 'electronics',
    categorySlug: 'hardware',
    priceUsd: '129',
    stockQty: '25',
    version: '1.0.0',
    liveDemoUrl: '',
  });

  const [trackingInputs, setTrackingInputs] = useState<Record<string, { carrier: string; tracking: string }>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [withdrawalForm, setWithdrawalForm] = useState({
    amountUsd: '25',
    bankName: 'Wise / Mercury Business',
    accountNumberLast4: '4819',
    accountName: 'Atelier Systems Ltd',
  });

  const activeSellerId = isDemoMode ? 'demo-seller-1' : firebaseUser?.uid || '';
  const myStore = useMemo(
    () => stores.find((s) => s.ownerId === activeSellerId) || stores.find((s) => s.ownerId === 'demo-seller-1'),
    [activeSellerId, stores]
  );

  const [storeDraft, setStoreDraft] = useState({
    name: myStore?.name || '',
    description: myStore?.description || '',
    policies: myStore?.policies || '',
    shippingSummary: myStore?.shippingSummary || '',
  });

  const myProducts = useMemo(
    () => products.filter((p) => p.sellerId === activeSellerId),
    [activeSellerId, products]
  );
  const myOrders = useMemo(
    () => sellerOrders.filter((o) => o.sellerId === activeSellerId),
    [activeSellerId, sellerOrders]
  );
  const myWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.sellerId === activeSellerId),
    [activeSellerId, withdrawals]
  );
  const myTransactions = useMemo(
    () => transactions.filter((t) => t.sellerId === activeSellerId),
    [activeSellerId, transactions]
  );
  const myQuestions = useMemo(
    () => questions.filter((q) => myStore && q.storeId === myStore.id),
    [myStore, questions]
  );

  // Guard: require Seller Demo or verified Seller role
  if (!isDemoMode && liveRole !== 'seller' && liveRole !== 'admin') {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-zinc-900">Seller Dashboard</h1>
          <p className="text-sm text-zinc-600 max-w-lg mx-auto">
            Your live account is currently a customer account. Submit a seller onboarding application in your Customer Portal, or enter Demo Mode (Seller Demo) right now to explore inventory, order fulfilment, and payout tools.
          </p>
          <button
            type="button"
            disabled={demoLoading}
            onClick={openDemoSelector}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
          >
            Enter Demo Mode
          </button>
        </div>
      </section>
    );
  }

  if (isDemoMode && demoRole !== 'seller') {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-zinc-900">Switch to Seller Demo</h1>
          <p className="text-sm text-zinc-600">
            You are viewing the <strong>{demoRole.toUpperCase()}</strong> Demo Mode role. Switch to Seller Demo to manage products, process split orders, and request withdrawals.
          </p>
          <button
            type="button"
            disabled={demoLoading}
            onClick={() => enterDemoMode('seller')}
            className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
          >
            Seller Demo
          </button>
        </div>
      </section>
    );
  }

  const pendingOrdersCount = myOrders.filter((o) => o.fulfilmentStatus === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 240px Sidebar Navigation */}
        <aside className="lg:col-span-3 bg-white border border-zinc-200 rounded-2xl p-4 space-y-1">
          <div className="px-3 py-2 border-b border-zinc-100 mb-2">
            <p className="text-xs font-mono uppercase text-zinc-400">Seller Studio</p>
            <p className="font-display text-sm font-bold text-zinc-900 truncate mt-0.5">
              {myStore?.name || 'Atelier Systems & Craft'}
            </p>
          </div>
          {(
            [
              { id: 'overview', label: 'Overview', icon: LayoutDashboard },
              { id: 'products', label: `Products (${myProducts.length})`, icon: Package },
              { id: 'orders', label: `Orders (${myOrders.length})`, icon: ShoppingCart },
              { id: 'finance', label: 'Finance & Withdrawals', icon: Wallet },
              { id: 'store', label: 'Store Profile', icon: StoreIcon },
              { id: 'analytics', label: 'Analytics & Q&A', icon: BarChart3 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ui-transition ${
                section === id
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-stone-100 hover:text-zinc-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </aside>

        {/* Main Workspace Viewport */}
        <main className="lg:col-span-9 space-y-6">
          {/* Overview */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Gross Sales', value: formatPrice(sellerBalances.grossSalesMinor, 'USD') },
                  { label: 'Available Balance', value: formatPrice(sellerBalances.availableBalanceMinor, 'USD') },
                  { label: 'Pending Earnings', value: formatPrice(sellerBalances.pendingEarningsMinor, 'USD') },
                  { label: 'Total Orders', value: String(myOrders.length) },
                  { label: 'Products Listed', value: String(myProducts.length) },
                  { label: 'Pending Orders', value: String(pendingOrdersCount) },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white border border-zinc-200 rounded-xl p-5">
                    <p className="text-xs text-zinc-500">{kpi.label}</p>
                    <p className="font-mono text-2xl font-bold text-zinc-900 mt-1 tabular-nums">
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Recent Seller Fulfilment Queue
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-zinc-500">
                        <th className="py-2.5 pr-4">Order</th>
                        <th className="py-2.5 pr-4">Buyer</th>
                        <th className="py-2.5 pr-4">Status</th>
                        <th className="py-2.5 text-right">Net Earnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 tabular-nums">
                      {myOrders.slice(0, 5).map((o) => (
                        <tr key={o.id} className="h-10">
                          <td className="py-2 pr-4 font-mono font-semibold text-zinc-900">{o.id}</td>
                          <td className="py-2 pr-4 text-zinc-700">{o.customerName}</td>
                          <td className="py-2 pr-4 capitalize text-zinc-700">
                            {o.fulfilmentStatus.replace('_', ' ')}
                          </td>
                          <td className="py-2 text-right font-mono font-semibold text-zinc-900">
                            {formatPrice(o.netEarningsMinor, o.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Product Management */}
          {section === 'products' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-zinc-900">Product Catalog</h2>
                <button
                  type="button"
                  onClick={() => setShowAddProduct((s) => !s)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-blue-600 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Product
                </button>
              </div>

              {showAddProduct && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await createDemoProduct({
                      title: newProd.title,
                      description: newProd.description,
                      productType: newProd.productType,
                      departmentSlug:
                        newProd.productType === 'digital' ? 'digital-products' : newProd.departmentSlug,
                      categorySlug: newProd.categorySlug,
                      priceMinor: Math.round(Number(newProd.priceUsd) * 100),
                      stockQty: Number(newProd.stockQty),
                      digitalMeta:
                        newProd.productType === 'digital'
                          ? {
                              version: newProd.version,
                              liveDemoUrl: newProd.liveDemoUrl || undefined,
                              licensePricingMultiplier: { personal: 1, commercial: 2.5, extended: 5 },
                              downloadLimit: 10,
                              downloadExpiryDays: 365,
                              assetKey: 'velox-checkout-starter-v1.8.2',
                              fileFormat: 'ZIP Archive',
                              fileSizeLabel: '14 MB',
                              changelog: 'Initial release',
                            }
                          : undefined,
                    });
                    setShowAddProduct(false);
                    setNewProd({
                      title: '',
                      description: '',
                      productType: 'physical',
                      departmentSlug: 'electronics',
                      categorySlug: 'hardware',
                      priceUsd: '129',
                      stockQty: '25',
                      version: '1.0.0',
                      liveDemoUrl: '',
                    });
                  }}
                  className="bg-white border border-zinc-200 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-zinc-900">Create New Listing</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      required
                      placeholder="Product Title"
                      value={newProd.title}
                      onChange={(e) => setNewProd({ ...newProd, title: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    <select
                      value={newProd.productType}
                      onChange={(e) =>
                        setNewProd({ ...newProd, productType: e.target.value as 'physical' | 'digital' })
                      }
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    >
                      <option value="physical">Physical Product</option>
                      <option value="digital">Digital Asset</option>
                    </select>
                    <select
                      value={newProd.productType === 'digital' ? newProd.categorySlug : newProd.departmentSlug}
                      onChange={(e) =>
                        newProd.productType === 'digital'
                          ? setNewProd({ ...newProd, categorySlug: e.target.value })
                          : setNewProd({ ...newProd, departmentSlug: e.target.value })
                      }
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    >
                      {newProd.productType === 'digital'
                        ? DIGITAL_SUBCATEGORIES.map((c) => (
                            <option key={c.slug} value={c.slug}>
                              {c.name}
                            </option>
                          ))
                        : departments
                            .filter((d) => !d.isDigital)
                            .map((d) => (
                              <option key={d.slug} value={d.slug}>
                                {d.name}
                              </option>
                            ))}
                    </select>
                    <input
                      required
                      type="number"
                      min="1"
                      placeholder="Price (USD)"
                      value={newProd.priceUsd}
                      onChange={(e) => setNewProd({ ...newProd, priceUsd: e.target.value })}
                      className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                    />
                    {newProd.productType === 'physical' ? (
                      <input
                        required
                        type="number"
                        min="0"
                        placeholder="Stock Quantity"
                        value={newProd.stockQty}
                        onChange={(e) => setNewProd({ ...newProd, stockQty: e.target.value })}
                        className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                      />
                    ) : (
                      <input
                        placeholder="Version (e.g. 1.0.0)"
                        value={newProd.version}
                        onChange={(e) => setNewProd({ ...newProd, version: e.target.value })}
                        className="border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                      />
                    )}
                  </div>
                  <textarea
                    required
                    rows={3}
                    placeholder="Detailed product description..."
                    value={newProd.description}
                    onChange={(e) => setNewProd({ ...newProd, description: e.target.value })}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Submit Product for Approval
                  </button>
                </form>
              )}

              {editingProduct && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await updateDemoProduct(editingProduct.id, {
                      title: editingProduct.title,
                      priceMinor: editingProduct.priceMinor,
                      stockQty: editingProduct.stockQty,
                    });
                    setEditingProduct(null);
                  }}
                  className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-zinc-900">Edit Listing: {editingProduct.title}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      value={editingProduct.title}
                      onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })}
                      className="border border-zinc-200 bg-white rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      type="number"
                      value={Math.round(editingProduct.priceMinor / 100)}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          priceMinor: Math.max(100, Number(e.target.value) * 100),
                        })
                      }
                      className="border border-zinc-200 bg-white rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      type="number"
                      value={editingProduct.stockQty}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          stockQty: Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="border border-zinc-200 bg-white rounded-lg px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProduct(null)}
                      className="px-4 py-2 bg-white border border-zinc-200 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-zinc-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500">
                      <th className="p-3.5">Product</th>
                      <th className="p-3.5">Type</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5 text-right">Stock</th>
                      <th className="p-3.5 text-right">Price</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 tabular-nums">
                    {myProducts.map((p) => (
                      <tr key={p.id}>
                        <td className="p-3.5 font-semibold text-zinc-900">{p.title}</td>
                        <td className="p-3.5 capitalize text-zinc-600">{p.productType}</td>
                        <td className="p-3.5 font-mono capitalize text-zinc-700">{p.approvalStatus}</td>
                        <td className="p-3.5 text-right font-mono">{p.stockQty}</td>
                        <td className="p-3.5 text-right font-mono font-semibold">
                          {formatPrice(p.priceMinor, p.currency)}
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingProduct(p)}
                              aria-label="Edit product"
                              className="p-1.5 text-zinc-600 hover:text-zinc-900 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteDemoProduct(p.id)}
                              aria-label="Delete product"
                              className="p-1.5 text-zinc-500 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Seller Orders & Tracking */}
          {section === 'orders' && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-bold text-zinc-900">Vendor Orders &amp; Fulfilment</h2>
              {myOrders.map((o) => {
                const tr = trackingInputs[o.id] || {
                  carrier: o.carrier || 'DHL Express',
                  tracking: o.trackingNumber || '',
                };
                return (
                  <div key={o.id} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-bold text-zinc-900">
                          {o.id} · Parent {o.parentOrderId}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Customer: {o.customerName} · {o.items.map((i) => `${i.title} × ${i.quantity}`).join(', ')}
                        </p>
                      </div>
                      <span className="font-mono text-xs capitalize px-2.5 py-1 bg-stone-100 rounded">
                        {o.fulfilmentStatus.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100 text-xs">
                      <input
                        placeholder="Carrier (e.g. DHL Express)"
                        value={tr.carrier}
                        onChange={(e) =>
                          setTrackingInputs({ ...trackingInputs, [o.id]: { ...tr, carrier: e.target.value } })
                        }
                        className="border border-zinc-200 rounded-lg px-2.5 py-1.5"
                      />
                      <input
                        placeholder="Tracking number"
                        value={tr.tracking}
                        onChange={(e) =>
                          setTrackingInputs({ ...trackingInputs, [o.id]: { ...tr, tracking: e.target.value } })
                        }
                        className="border border-zinc-200 rounded-lg px-2.5 py-1.5 font-mono"
                      />
                      {(
                        [
                          { status: 'accepted', label: 'Accept' },
                          { status: 'shipped', label: 'Mark Shipped' },
                          { status: 'delivered', label: 'Mark Delivered' },
                          { status: 'cancelled', label: 'Cancel' },
                        ] as { status: SellerFulfilmentStatus; label: string }[]
                      ).map((act) => (
                        <button
                          key={act.status}
                          type="button"
                          onClick={() =>
                            updateDemoSellerOrder(o.id, act.status, tr.tracking, tr.carrier)
                          }
                          className="px-3 py-1.5 bg-zinc-900 hover:bg-blue-600 text-white font-semibold rounded-lg cursor-pointer"
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Finance & Withdrawals */}
          {section === 'finance' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Gross Sales', val: formatPrice(sellerBalances.grossSalesMinor, 'USD') },
                  { label: 'Commission Paid', val: formatPrice(sellerBalances.commissionMinor, 'USD') },
                  { label: 'Pending Settlements', val: formatPrice(sellerBalances.pendingEarningsMinor, 'USD') },
                  { label: 'Available to Withdraw', val: formatPrice(sellerBalances.availableBalanceMinor, 'USD') },
                ].map((b) => (
                  <div key={b.label} className="bg-white border border-zinc-200 rounded-xl p-4">
                    <p className="text-xs text-zinc-500">{b.label}</p>
                    <p className="font-mono text-lg font-bold text-zinc-900 mt-1 tabular-nums">{b.val}</p>
                  </div>
                ))}
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await requestDemoWithdrawal({
                      amountMinor: Math.round(Number(withdrawalForm.amountUsd) * 100),
                      bankName: withdrawalForm.bankName,
                      accountNumberLast4: withdrawalForm.accountNumberLast4,
                      accountName: withdrawalForm.accountName,
                    });
                  } catch (err) {
                    notify(err instanceof Error ? err.message : 'Withdrawal rejected.', 'error');
                  }
                }}
                className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4"
              >
                <div>
                  <h3 className="font-display text-base font-bold text-zinc-900">
                    Request Seller Withdrawal
                  </h3>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Server validation blocks withdrawing pending, unearned, or refunded balances. Approved by Marketplace Admin.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="Amount (USD)"
                    value={withdrawalForm.amountUsd}
                    onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amountUsd: e.target.value })}
                    className="border border-zinc-200 rounded-lg px-3 py-2 font-mono"
                  />
                  <input
                    required
                    placeholder="Bank Name"
                    value={withdrawalForm.bankName}
                    onChange={(e) => setWithdrawalForm({ ...withdrawalForm, bankName: e.target.value })}
                    className="border border-zinc-200 rounded-lg px-3 py-2"
                  />
                  <input
                    required
                    maxLength={4}
                    placeholder="Last 4 digits"
                    value={withdrawalForm.accountNumberLast4}
                    onChange={(e) =>
                      setWithdrawalForm({ ...withdrawalForm, accountNumberLast4: e.target.value })
                    }
                    className="border border-zinc-200 rounded-lg px-3 py-2 font-mono"
                  />
                  <input
                    required
                    placeholder="Account Holder"
                    value={withdrawalForm.accountName}
                    onChange={(e) =>
                      setWithdrawalForm({ ...withdrawalForm, accountName: e.target.value })
                    }
                    className="border border-zinc-200 rounded-lg px-3 py-2"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-zinc-900 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Submit Withdrawal Request
                </button>
              </form>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3">
                <h3 className="font-display text-base font-bold text-zinc-900">
                  Withdrawal History &amp; Ledger
                </h3>
                <div className="space-y-2 text-xs">
                  {myWithdrawals.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between border-b border-zinc-100 pb-2 tabular-nums"
                    >
                      <span>
                        {w.bankName} (•••• {w.accountNumberLast4}) — {w.status.toUpperCase()}
                      </span>
                      <span className="font-mono font-semibold">
                        {formatPrice(w.amountMinor, w.currency)}
                      </span>
                    </div>
                  ))}
                  {myTransactions.slice(0, 6).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between text-zinc-600 pt-1 tabular-nums"
                    >
                      <span>
                        [{tx.type}] {tx.note}
                      </span>
                      <span className="font-mono">
                        {formatPrice(tx.amountMinor, tx.currency)} ({tx.status})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Store Profile */}
          {section === 'store' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await updateDemoStore(storeDraft);
              }}
              className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4"
            >
              <h2 className="font-display text-lg font-bold text-zinc-900">Storefront Settings</h2>
              <input
                value={storeDraft.name}
                onChange={(e) => setStoreDraft({ ...storeDraft, name: e.target.value })}
                placeholder="Store Name"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <textarea
                rows={3}
                value={storeDraft.description}
                onChange={(e) => setStoreDraft({ ...storeDraft, description: e.target.value })}
                placeholder="Store description"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <input
                value={storeDraft.shippingSummary}
                onChange={(e) => setStoreDraft({ ...storeDraft, shippingSummary: e.target.value })}
                placeholder="Shipping regions & delivery SLA"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <textarea
                rows={2}
                value={storeDraft.policies}
                onChange={(e) => setStoreDraft({ ...storeDraft, policies: e.target.value })}
                placeholder="Return & warranty policies"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Save Store Profile
              </button>
            </form>
          )}

          {/* Analytics & Q&A */}
          {section === 'analytics' && (
            <div className="space-y-6">
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Best-Selling Product Performance
                </h2>
                <div className="space-y-3">
                  {myProducts
                    .slice()
                    .sort((a, b) => b.salesCount - a.salesCount)
                    .map((p) => {
                      const pct = Math.min(100, Math.round((p.salesCount / 900) * 100));
                      return (
                        <div key={p.id} className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-semibold text-zinc-900">{p.title}</span>
                            <span className="font-mono tabular-nums text-zinc-600">
                              {p.salesCount} units sold
                            </span>
                          </div>
                          <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-zinc-700" />
                  <h3 className="font-display text-base font-bold text-zinc-900">
                    Customer Questions
                  </h3>
                </div>
                {myQuestions.map((q) => (
                  <div key={q.id} className="border-t border-zinc-100 pt-3 space-y-2 text-xs">
                    <p className="font-semibold text-zinc-900">
                      {q.authorName}: {q.question}
                    </p>
                    {q.answer ? (
                      <p className="text-zinc-600">Answered: {q.answer}</p>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          value={replyDrafts[q.id] || ''}
                          onChange={(e) => setReplyDrafts({ ...replyDrafts, [q.id]: e.target.value })}
                          placeholder="Write seller reply..."
                          className="flex-1 border border-zinc-200 rounded-lg px-3 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!replyDrafts[q.id]?.trim()) return;
                            await answerQuestion(q.id, replyDrafts[q.id]);
                          }}
                          className="px-3 py-1.5 bg-zinc-900 text-white font-semibold rounded-lg cursor-pointer"
                        >
                          Reply
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
