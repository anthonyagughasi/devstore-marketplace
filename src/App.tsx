import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { MarketplaceProvider, useMarketplace } from './context/MarketplaceContext.tsx';
import { Navbar } from './components/Navbar.tsx';
import { StorefrontHome } from './components/StorefrontHome.tsx';
import { CatalogSection } from './components/CatalogSection.tsx';
import { DigitalDepartmentView } from './components/DigitalDepartmentView.tsx';
import { ProductDetailView } from './components/ProductDetailView.tsx';
import { CompareView, StoresDirectoryView } from './components/CompareAndStoresViews.tsx';
import { CartDrawer } from './components/CartDrawer.tsx';
import { CheckoutView } from './components/CheckoutView.tsx';
import { CustomerPortal } from './components/CustomerPortal.tsx';
import { SellerDashboard } from './components/SellerDashboard.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AuthAndDemoModal } from './components/AuthAndDemoModal.tsx';
import { Footer } from './components/Footer.tsx';

function DevStoreShell() {
  const { view, toasts } = useMarketplace();

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-zinc-900">
      <Navbar />

      <main className="flex-1">
        {view === 'home' && <StorefrontHome />}
        {view === 'catalog' && <CatalogSection />}
        {view === 'digital' && <DigitalDepartmentView />}
        {view === 'product' && <ProductDetailView />}
        {view === 'stores' && <StoresDirectoryView />}
        {view === 'compare' && <CompareView />}
        {view === 'checkout' && <CheckoutView />}
        {view === 'customer' && <CustomerPortal />}
        {view === 'seller' && <SellerDashboard />}
        {view === 'admin' && <AdminDashboard />}
      </main>

      <Footer />
      <CartDrawer />
      <AuthAndDemoModal />

      {/* Non-blocking Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto px-4 py-3 rounded-xl border shadow-lg text-xs font-medium ${
                t.tone === 'error'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : t.tone === 'success'
                  ? 'bg-zinc-900 border-zinc-800 text-white'
                  : 'bg-white border-zinc-200 text-zinc-900'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MarketplaceProvider>
        <DevStoreShell />
      </MarketplaceProvider>
    </ErrorBoundary>
  );
}
