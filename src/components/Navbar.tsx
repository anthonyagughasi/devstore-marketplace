import { useState } from 'react';
import {
  ShoppingBag,
  Menu,
  X,
  RotateCcw,
  LogOut,
  ShieldCheck,
  Store as StoreIcon,
  User as UserIcon,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { CurrencyCode, UserRole } from '../shared/types.ts';

export function Navbar() {
  const {
    view,
    setView,
    currency,
    setCurrency,
    platformConfig,
    isDemoMode,
    demoRole,
    demoLoading,
    enterDemoMode,
    exitDemoMode,
    resetDemoData,
    firebaseUser,
    liveRole,
    setAuthModalOpen,
    cart,
    setCartDrawerOpen,
    compareIds,
  } = useMarketplace();

  const [bannerVisible, setBannerVisible] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const activeRole: UserRole = isDemoMode ? demoRole : liveRole;

  const handleRoleWorkspaceClick = () => {
    if (activeRole === 'seller') setView('seller');
    else if (activeRole === 'admin') setView('admin');
    else setView('customer');
    setMobileMenuOpen(false);
  };

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-zinc-200">
      {/* Slim Dismissible Announcement Bar */}
      {bannerVisible && !isDemoMode && (
        <div className="bg-zinc-900 text-stone-100 text-xs px-4 py-1.5 flex items-center justify-between gap-4">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
            <p className="truncate">{platformConfig.flashSaleBannerText}</p>
            <div className="flex items-center gap-3 shrink-0">
              <label htmlFor="currency-select" className="sr-only">
                Currency
              </label>
              <select
                id="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="bg-zinc-800 text-stone-100 border border-zinc-700 rounded px-2 py-0.5 text-xs font-mono cursor-pointer"
              >
                {(platformConfig.supportedCurrencies || ['USD', 'NGN', 'GBP', 'EUR']).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setBannerVisible(false)}
                aria-label="Dismiss announcement"
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Demo Mode Indicator Bar */}
      {isDemoMode && (
        <div className="bg-amber-50 border-b border-amber-200 text-zinc-900 px-4 py-1.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap">
                Demo Mode
              </span>
              <span className="text-zinc-400 hidden sm:inline">/</span>
              <span className="text-zinc-700 truncate hidden md:inline">
                Isolated sandbox — all orders, payments, and payouts are simulated.
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center bg-white border border-amber-200 rounded-md p-0.5">
                {(
                  [
                    { id: 'customer', label: 'Customer', icon: UserIcon },
                    { id: 'seller', label: 'Seller', icon: StoreIcon },
                    { id: 'admin', label: 'Admin', icon: ShieldCheck },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={demoLoading}
                    onClick={() => enterDemoMode(id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ui-transition ${
                      demoRole === id
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-700 hover:bg-stone-100'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Demo currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="bg-white border border-amber-200 rounded px-2 py-1 text-xs font-mono cursor-pointer"
              >
                {(platformConfig.supportedCurrencies || ['USD', 'NGN', 'GBP', 'EUR']).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={demoLoading}
                onClick={resetDemoData}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-amber-200 rounded text-xs font-medium text-zinc-800 hover:bg-stone-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>

              <button
                type="button"
                onClick={exitDemoMode}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-900 text-white rounded text-xs font-medium hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3 h-3" />
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean 3-Zone Top Bar */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setView('home')}
          className="font-display text-xl font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {platformConfig.marketplaceName}
        </button>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600">
          <button
            type="button"
            onClick={() => setView('catalog')}
            className={`hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              view === 'catalog' ? 'text-zinc-900 underline underline-offset-4' : ''
            }`}
          >
            Marketplace
          </button>
          <button
            type="button"
            onClick={() => setView('digital')}
            className={`hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              view === 'digital' ? 'text-zinc-900 underline underline-offset-4' : ''
            }`}
          >
            Digital Assets
          </button>
          <button
            type="button"
            onClick={() => setView('stores')}
            className={`hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              view === 'stores' ? 'text-zinc-900 underline underline-offset-4' : ''
            }`}
          >
            Sellers
          </button>
          <button
            type="button"
            onClick={() => setView('compare')}
            className={`hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              view === 'compare' ? 'text-zinc-900 underline underline-offset-4' : ''
            }`}
          >
            Compare{compareIds.length > 0 ? ` (${compareIds.length})` : ''}
          </button>
          <button
            type="button"
            onClick={handleRoleWorkspaceClick}
            className={`hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              view === 'customer' || view === 'seller' || view === 'admin'
                ? 'text-zinc-900 underline underline-offset-4'
                : ''
            }`}
          >
            {activeRole === 'seller'
              ? 'Seller Hub'
              : activeRole === 'admin'
              ? 'Admin Console'
              : 'Orders & Library'}
          </button>
        </nav>

        {/* Zone 3: Primary Action Cluster */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            aria-label="Open shopping cart"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition tabular-nums"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Cart ({cartCount})</span>
          </button>

          {isDemoMode ? (
            <button
              type="button"
              onClick={handleRoleWorkspaceClick}
              className="hidden sm:inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
            >
              Open {demoRole === 'admin' ? 'Admin' : demoRole === 'seller' ? 'Seller' : 'Customer'} View
            </button>
          ) : firebaseUser ? (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="hidden sm:inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition max-w-[160px] truncate"
            >
              {firebaseUser.displayName?.split(' ')[0] || 'Account'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="hidden sm:inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
            >
              Sign In / Explore Demo
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="md:hidden p-2 text-zinc-700 hover:bg-stone-100 rounded-lg cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-200 bg-white px-4 py-4 space-y-2">
          {[
            { label: 'Marketplace', target: 'catalog' as const },
            { label: 'Digital Assets', target: 'digital' as const },
            { label: 'Verified Sellers', target: 'stores' as const },
            { label: `Compare (${compareIds.length})`, target: 'compare' as const },
          ].map((item) => (
            <button
              key={item.target}
              type="button"
              onClick={() => {
                setView(item.target);
                setMobileMenuOpen(false);
              }}
              className="block w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-800 hover:bg-stone-100 rounded-lg cursor-pointer"
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRoleWorkspaceClick}
            className="block w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-800 hover:bg-stone-100 rounded-lg cursor-pointer"
          >
            {activeRole === 'seller'
              ? 'Seller Dashboard'
              : activeRole === 'admin'
              ? 'Admin Console'
              : 'Customer Orders & Library'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthModalOpen(true);
              setMobileMenuOpen(false);
            }}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-zinc-900 rounded-lg cursor-pointer"
          >
            {isDemoMode ? 'Demo Mode / Account' : 'Sign In / Explore Demo'}
          </button>
        </div>
      )}
    </div>
  );
}
