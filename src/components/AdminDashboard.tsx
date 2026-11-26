import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Store as StoreIcon,
  PackageCheck,
  Wallet,
  Tags,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';

type AdminSection =
  | 'overview'
  | 'customers'
  | 'sellers'
  | 'products'
  | 'orders'
  | 'finance'
  | 'marketing'
  | 'config';

export function AdminDashboard() {
  const {
    isDemoMode,
    demoRole,
    demoLoading,
    enterDemoMode,
    openDemoSelector,
    liveRole,
    demoCustomers,
    stores,
    sellerApplications,
    products,
    orders,
    disputes,
    withdrawals,
    transactions,
    departments,
    coupons,
    platformConfig,
    integrations,
    demoActivityLogs,
    formatPrice,
    updateDemoCustomerStatus,
    updateDemoSellerStatus,
    reviewDemoApplication,
    moderateDemoProduct,
    reviewDemoWithdrawal,
    resolveDemoDispute,
    createDemoDepartment,
    updateDemoPlatformConfig,
    createDemoCoupon,
  } = useMarketplace();

  const [section, setSection] = useState<AdminSection>('overview');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDesc, setNewDeptDesc] = useState('');
  const [newDeptDigital, setNewDeptDigital] = useState(false);
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponPct, setNewCouponPct] = useState('10');
  const [commissionPct, setCommissionPct] = useState(
    String(platformConfig.commissionRateBps / 100)
  );
  const [ngnRate, setNgnRate] = useState(String(platformConfig.exchangeRates?.NGN ?? 1580));
  const [gbpRate, setGbpRate] = useState(String(platformConfig.exchangeRates?.GBP ?? 0.79));
  const [eurRate, setEurRate] = useState(String(platformConfig.exchangeRates?.EUR ?? 0.92));
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<{
    subject: string;
    htmlBody: string;
    status: string;
  } | null>(null);

  if (!isDemoMode && liveRole !== 'admin') {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-zinc-900">
            Administrator Console
          </h1>
          <p className="text-sm text-zinc-600 max-w-lg mx-auto">
            Administrator controls are restricted to authorized store administrators. Enter Admin Demo to preview moderation, payouts, and marketplace settings.
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

  if (isDemoMode && demoRole !== 'admin') {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-zinc-900">
            Switch to Admin Demo
          </h1>
          <p className="text-sm text-zinc-600">
            You are currently exploring the <strong>{demoRole.toUpperCase()}</strong> Demo Mode role. Switch to Admin Demo to moderate listings, review withdrawals, and configure commissions.
          </p>
          <button
            type="button"
            disabled={demoLoading}
            onClick={() => enterDemoMode('admin')}
            className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
          >
            Admin Demo
          </button>
        </div>
      </section>
    );
  }

  const grossSalesMinor = orders
    .filter((o) => o.paymentStatus === 'paid')
    .reduce((acc, o) => acc + o.totalMinor, 0);
  const commissionMinor = transactions
    .filter((t) => t.type === 'commission')
    .reduce((acc, t) => acc + t.amountMinor, 0);
  const pendingProductsCount = products.filter((p) => p.approvalStatus === 'pending').length;
  const pendingWithdrawalsCount = withdrawals.filter((w) => w.status === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside className="lg:col-span-3 bg-white border border-zinc-200 rounded-2xl p-4 space-y-1">
          <div className="px-3 py-2 border-b border-zinc-100 mb-2">
            <p className="text-xs font-mono uppercase text-zinc-400">Marketplace Governance</p>
            <p className="font-display text-sm font-bold text-zinc-900 mt-0.5">
              DevStore Admin Console
            </p>
          </div>
          {(
            [
              { id: 'overview', label: 'Overview & KPIs', icon: LayoutDashboard },
              { id: 'customers', label: `Customers (${demoCustomers.length})`, icon: Users },
              { id: 'sellers', label: `Sellers & Apps (${sellerApplications.length})`, icon: StoreIcon },
              { id: 'products', label: `Moderation (${pendingProductsCount})`, icon: PackageCheck },
              { id: 'orders', label: `Orders & Disputes (${disputes.length})`, icon: ShieldAlert },
              { id: 'finance', label: `Finance & Payouts (${pendingWithdrawalsCount})`, icon: Wallet },
              { id: 'marketing', label: 'Categories & Coupons', icon: Tags },
              { id: 'config', label: 'Config & Audit Logs', icon: Settings },
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

        <main className="lg:col-span-9 space-y-6">
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Gross Sales', val: formatPrice(grossSalesMinor, 'USD') },
                  { label: 'Platform Commissions', val: formatPrice(commissionMinor, 'USD') },
                  { label: 'Pending Approvals', val: String(pendingProductsCount) },
                  { label: 'Pending Withdrawals', val: String(pendingWithdrawalsCount) },
                  { label: 'Total Customers', val: String(demoCustomers.length) },
                  { label: 'Active Stores', val: String(stores.filter((s) => s.status === 'active').length) },
                  { label: 'Catalog Listings', val: String(products.length) },
                  { label: 'Total Orders', val: String(orders.length) },
                ].map((k) => (
                  <div key={k.label} className="bg-white border border-zinc-200 rounded-xl p-4">
                    <p className="text-xs text-zinc-500">{k.label}</p>
                    <p className="font-mono text-xl font-bold text-zinc-900 mt-1 tabular-nums">{k.val}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3">
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Recent Store &amp; Demo Activity
                </h2>
                <div className="space-y-2 text-xs">
                  {demoActivityLogs.slice(0, 8).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-2"
                    >
                      <span className="text-zinc-800">
                        <span className="font-mono uppercase text-zinc-500 mr-2">[{log.role}]</span>
                        {log.detail}
                      </span>
                      <span className="font-mono text-zinc-400 shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'customers' && (
            <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-zinc-900">Customer Accounts</h2>
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search customers..."
                  className="border border-zinc-200 rounded-lg px-3 py-1.5 text-xs"
                />
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500">
                    <th className="py-2">Customer</th>
                    <th className="py-2">Country</th>
                    <th className="py-2 text-right">Orders</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 tabular-nums">
                  {demoCustomers
                    .filter((c) =>
                      `${c.name} ${c.email}`.toLowerCase().includes(customerSearch.toLowerCase())
                    )
                    .map((c) => (
                      <tr key={c.id} className="h-11">
                        <td className="py-2">
                          <p className="font-semibold text-zinc-900">{c.name}</p>
                          <p className="text-zinc-500">{c.email}</p>
                        </td>
                        <td className="py-2">{c.countryCode}</td>
                        <td className="py-2 text-right font-mono">{c.ordersCount}</td>
                        <td className="py-2 capitalize font-mono">{c.status}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              updateDemoCustomerStatus(
                                c.id,
                                c.status === 'active' ? 'suspended' : 'active'
                              )
                            }
                            className="px-3 py-1 border border-zinc-200 rounded-lg font-semibold hover:bg-stone-100 cursor-pointer"
                          >
                            {c.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'sellers' && (
            <div className="space-y-6">
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-zinc-900">
                  Seller Onboarding Applications
                </h2>
                {sellerApplications.map((app) => (
                  <div
                    key={app.id}
                    className="border border-zinc-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1">
                      <p className="font-bold text-sm text-zinc-900">
                        {app.businessName} ({app.countryCode})
                      </p>
                      <p className="text-zinc-600">
                        Applicant: {app.applicantName} · {app.categoryFocus}
                      </p>
                      <p className="text-zinc-500">{app.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono capitalize px-2 py-1 bg-stone-100 rounded">
                        {app.status}
                      </span>
                      {app.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => reviewDemoApplication(app.id, 'approved', 'Verified')}
                            className="px-3 py-1.5 bg-emerald-600 text-white font-semibold rounded-lg cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewDemoApplication(app.id, 'rejected', 'Incomplete')}
                            className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-zinc-900">Verified Stores</h2>
                <div className="space-y-3 text-xs">
                  {stores.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3"
                    >
                      <div>
                        <p className="font-semibold text-zinc-900">
                          {s.name} ({s.countryCode})
                        </p>
                        <p className="text-zinc-500">
                          Status: {s.status} · Verified: {s.verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => updateDemoSellerStatus(s.id, { verified: !s.verified })}
                          className="px-3 py-1.5 border border-zinc-200 rounded-lg font-semibold cursor-pointer"
                        >
                          {s.verified ? 'Unverify' : 'Verify Badge'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateDemoSellerStatus(s.id, {
                              status: s.status === 'active' ? 'suspended' : 'active',
                            })
                          }
                          className="px-3 py-1.5 bg-zinc-900 text-white rounded-lg font-semibold cursor-pointer"
                        >
                          {s.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'products' && (
            <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-lg font-bold text-zinc-900">Product Moderation</h2>
              <div className="divide-y divide-zinc-100 text-xs">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-zinc-900">{p.title}</p>
                      <p className="text-zinc-500">
                        {p.storeName} · {p.productType} · {formatPrice(p.priceMinor, p.currency)} ·{' '}
                        <span className="font-mono uppercase">{p.approvalStatus}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => moderateDemoProduct(p.id, { approvalStatus: 'approved' })}
                        className="px-3 py-1.5 bg-emerald-600 text-white font-semibold rounded-lg cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => moderateDemoProduct(p.id, { approvalStatus: 'rejected' })}
                        className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg cursor-pointer"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => moderateDemoProduct(p.id, { isFeatured: !p.isFeatured })}
                        className="px-3 py-1.5 border border-zinc-200 rounded-lg font-semibold cursor-pointer"
                      >
                        {p.isFeatured ? 'Unfeature' : 'Feature'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'orders' && (
            <div className="space-y-6">
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-zinc-900">Disputes &amp; Refunds</h2>
                {disputes.map((d) => (
                  <div
                    key={d.id}
                    className="border border-zinc-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-zinc-900">
                        {d.reason} ({d.sellerOrderId})
                      </p>
                      <p className="text-zinc-600">{d.details}</p>
                      <p className="font-mono text-zinc-500 mt-1">Status: {d.status}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          resolveDemoDispute(d.id, 'resolved_refund', 'Full refund issued by admin.')
                        }
                        className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg cursor-pointer"
                      >
                        Issue Refund
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          resolveDemoDispute(d.id, 'resolved_closed', 'Resolved with carrier tracking.')
                        }
                        className="px-3 py-1.5 bg-zinc-900 text-white font-semibold rounded-lg cursor-pointer"
                      >
                        Close Dispute
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'finance' && (
            <div className="space-y-6">
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-zinc-900">
                  Seller Withdrawal Queue
                </h2>
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="border border-zinc-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-zinc-900">
                        {w.storeName} — {formatPrice(w.amountMinor, w.currency)}
                      </p>
                      <p className="text-zinc-600">
                        {w.bankName} (•••• {w.accountNumberLast4}) · {w.accountName} ·{' '}
                        <span className="font-mono uppercase">{w.status}</span>
                      </p>
                    </div>
                    {w.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => reviewDemoWithdrawal(w.id, 'approved', 'Approved by finance')}
                          className="px-3 py-1.5 bg-emerald-600 text-white font-semibold rounded-lg cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewDemoWithdrawal(w.id, 'rejected', 'Verification needed')}
                          className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'marketing' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await createDemoDepartment(newDeptName, newDeptDesc, newDeptDigital);
                  setNewDeptName('');
                  setNewDeptDesc('');
                }}
                className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3"
              >
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Create Department ({departments.length})
                </h2>
                <input
                  required
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Department Name"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                />
                <input
                  value={newDeptDesc}
                  onChange={(e) => setNewDeptDesc(e.target.value)}
                  placeholder="Short description"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={newDeptDigital}
                    onChange={(e) => setNewDeptDigital(e.target.checked)}
                  />
                  Digital Products Department
                </label>
                <button
                  type="submit"
                  className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Add Department
                </button>
              </form>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await createDemoCoupon(newCouponCode, Number(newCouponPct));
                  setNewCouponCode('');
                }}
                className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3"
              >
                <h2 className="font-display text-base font-bold text-zinc-900">
                  Promotional Coupons ({coupons.length})
                </h2>
                <div className="flex gap-2">
                  <input
                    required
                    value={newCouponCode}
                    onChange={(e) => setNewCouponCode(e.target.value)}
                    placeholder="CODE25"
                    className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono uppercase"
                  />
                  <input
                    required
                    type="number"
                    min="1"
                    max="90"
                    value={newCouponPct}
                    onChange={(e) => setNewCouponPct(e.target.value)}
                    className="w-20 border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Create Coupon
                </button>
                <div className="pt-2 space-y-1 text-xs font-mono text-zinc-600">
                  {coupons.map((c) => (
                    <div key={c.id}>
                      {c.code} — {c.discountPercent}% off
                    </div>
                  ))}
                </div>
              </form>
            </div>
          )}

          {section === 'config' && (
            <div className="space-y-6">
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-zinc-900">
                  Marketplace Commission &amp; Gateway Settings
                </h2>
                <div className="flex flex-wrap items-end gap-3 text-xs">
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">
                      Global Commission Rate (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="35"
                      value={commissionPct}
                      onChange={(e) => setCommissionPct(e.target.value)}
                      className="border border-zinc-200 rounded-lg px-3 py-2 font-mono w-32"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateDemoPlatformConfig({
                        commissionRateBps: Math.round(Number(commissionPct) * 100),
                      })
                    }
                    className="px-4 py-2 bg-zinc-900 text-white font-semibold rounded-lg cursor-pointer"
                  >
                    Update Commission
                  </button>
                </div>

                <div className="flex flex-wrap gap-4 pt-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={platformConfig.paystackEnabled}
                      onChange={(e) =>
                        updateDemoPlatformConfig({ paystackEnabled: e.target.checked })
                      }
                    />
                    Enable Paystack Adapter
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={platformConfig.flutterwaveEnabled}
                      onChange={(e) =>
                        updateDemoPlatformConfig({ flutterwaveEnabled: e.target.checked })
                      }
                    />
                    Enable Flutterwave Adapter
                  </label>
                </div>
              </div>

              {/* Configurable Supported Currencies & Manual Exchange Rates */}
              <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-zinc-900">
                      Supported Currencies &amp; Manual Exchange Rates
                    </h3>
                    <p className="text-zinc-500 mt-0.5">
                      Use manual store exchange rates or an automatic rate feed. Existing orders keep their original currency.
                    </p>
                  </div>
                  <span className="font-mono text-[11px] px-2.5 py-1 bg-stone-100 rounded text-zinc-700">
                    Mode: {platformConfig.exchangeRateMode === 'external_api' ? 'External API' : 'Manual Rates'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-4">
                  {(['USD', 'NGN', 'GBP', 'EUR'] as const).map((code) => {
                    const active = (platformConfig.supportedCurrencies || ['USD']).includes(code);
                    return (
                      <label key={code} className="flex items-center gap-2 font-mono">
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={code === 'USD'}
                          onChange={(e) => {
                            const curr = platformConfig.supportedCurrencies || ['USD'];
                            const next = e.target.checked
                              ? Array.from(new Set([...curr, code]))
                              : curr.filter((c) => c !== code);
                            updateDemoPlatformConfig({
                              supportedCurrencies: next.length ? next : ['USD'],
                            });
                          }}
                        />
                        {code}
                      </label>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">
                      1 USD → NGN
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={ngnRate}
                      onChange={(e) => setNgnRate(e.target.value)}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">
                      1 USD → GBP
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={gbpRate}
                      onChange={(e) => setGbpRate(e.target.value)}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">
                      1 USD → EUR
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={eurRate}
                      onChange={(e) => setEurRate(e.target.value)}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    updateDemoPlatformConfig({
                      exchangeRates: {
                        USD: 1,
                        NGN: Number(ngnRate) || 1580,
                        GBP: Number(gbpRate) || 0.79,
                        EUR: Number(eurRate) || 0.92,
                      },
                    })
                  }
                  className="px-4 py-2 bg-zinc-900 text-white font-semibold rounded-lg cursor-pointer"
                >
                  Save Manual Exchange Rates
                </button>
              </div>

              {/* External Integration Readiness Summary */}
              {integrations && (
                <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3 text-xs">
                  <h3 className="font-display text-base font-bold text-zinc-900">
                    Store Services &amp; Payment Status
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="border border-zinc-200 rounded-lg p-3">
                      <p className="font-bold text-zinc-900">Paystack Checkout</p>
                      <p className="text-zinc-600 mt-1">
                        {integrations.paystack.configured
                          ? 'Active & Ready'
                          : 'Awaiting configuration'}
                      </p>
                    </div>
                    <div className="border border-zinc-200 rounded-lg p-3">
                      <p className="font-bold text-zinc-900">Flutterwave Checkout</p>
                      <p className="text-zinc-600 mt-1">
                        {integrations.flutterwave.configured
                          ? 'Active & Ready'
                          : 'Awaiting configuration'}
                      </p>
                    </div>
                    <div className="border border-zinc-200 rounded-lg p-3">
                      <p className="font-bold text-zinc-900">Email Notifications (Optional)</p>
                      <p className="text-zinc-600 mt-1">
                        {integrations.email.configured
                          ? 'Transactional Email Active'
                          : 'Disabled (Optional)'}
                      </p>
                    </div>
                    {integrations.currency && (
                      <div className="border border-zinc-200 rounded-lg p-3">
                        <p className="font-bold text-zinc-900">Currency Exchange Rates</p>
                        <p className="text-zinc-600 mt-1">
                          {integrations.currency.externalApiConfigured
                            ? 'Automatic Rate Feed Active'
                            : 'Manual Store Rates Active'}
                        </p>
                      </div>
                    )}
                    {integrations.storage && (
                      <div className="border border-zinc-200 rounded-lg p-3 sm:col-span-2">
                        <p className="font-bold text-zinc-900">Digital File Delivery</p>
                        <p className="text-zinc-600 mt-1">
                          {integrations.storage.configured
                            ? 'External Cloud Storage Active'
                            : 'Standard Store Delivery Active'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Preview Email Notification Templates */}
              {isDemoMode && (
                <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold text-zinc-900">
                        Notification Template Preview
                      </h3>
                      <p className="text-zinc-500 mt-0.5">
                        Inspect rendered order and payment notifications in preview mode without sending external emails.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch('/api/dev/email-previews');
                        if (res.ok) {
                          const data = (await res.json()) as {
                            previews: Array<{ subject: string; htmlBody: string; status: string }>;
                          };
                          if (data.previews[0]) {
                            setEmailPreviewHtml(data.previews[0]);
                            return;
                          }
                        }
                        setEmailPreviewHtml({
                          subject: 'Payment Confirmed for Order ord-demo-1042',
                          htmlBody:
                            'Payment verified. Digital licenses are unlocked in your Download Library.',
                          status: 'preview_only',
                        });
                      }}
                      className="px-3.5 py-2 border border-zinc-200 rounded-lg font-semibold hover:bg-stone-100 cursor-pointer"
                    >
                      Preview Sample Notification
                    </button>
                  </div>
                  {emailPreviewHtml && (
                    <div className="bg-stone-50 border border-zinc-200 rounded-lg p-4 space-y-1">
                      <p className="font-semibold text-zinc-900">
                        Subject: {emailPreviewHtml.subject}
                      </p>
                      <p className="font-mono text-[11px] text-amber-800">
                        Delivery Status: {emailPreviewHtml.status} (External send skipped)
                      </p>
                      <p className="text-zinc-700 pt-1">{emailPreviewHtml.htmlBody}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
