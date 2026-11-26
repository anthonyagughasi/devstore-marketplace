import { ArrowRight, Globe2, ShieldCheck, Layers, CreditCard } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { CatalogSection } from './CatalogSection.tsx';
import { ProductCard } from './ProductCard.tsx';
import { SafeImage } from './SafeImage.tsx';

export function StorefrontHome() {
  const {
    setView,
    isDemoMode,
    demoLoading,
    openDemoSelector,
    products,
    stores,
    recentlyViewedIds,
    openProduct,
  } = useMarketplace();

  const recentlyViewed = recentlyViewedIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div>
      {/* Storefront Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-zinc-200 rounded-2xl p-8 sm:p-10">
            <div className="space-y-5">
              <p className="text-xs font-mono uppercase tracking-wider text-blue-600 font-semibold">
                International Multi-Vendor Marketplace
              </p>
              <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-zinc-900 tracking-tight leading-[1.1] text-balance">
                Physical craft and licensed digital tools in one global marketplace.
              </h1>
              <p className="text-base text-zinc-600 leading-relaxed max-w-xl">
                Shop verified international hardware studios, architectural home goods, and production-ready templates with multi-currency checkout and instant digital downloads.
              </p>
            </div>

            <div className="pt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setView('catalog')}
                className="inline-flex items-center gap-2 px-5 py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
              >
                Browse Marketplace
                <ArrowRight className="w-4 h-4" />
              </button>

              {!isDemoMode ? (
                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={openDemoSelector}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition disabled:opacity-50"
                >
                  Explore Demo
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setView('digital')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
                  >
                    Explore Digital Department
                  </button>
                  <button
                    type="button"
                    onClick={openDemoSelector}
                    className="inline-flex items-center px-4 py-3 text-sm font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Switch Demo Role
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl overflow-hidden border border-zinc-200 bg-stone-100 min-h-[320px]">
            <SafeImage
              src="/src/assets/images/hero_marketplace_showcase_1795615501315.jpg"
              alt="DevStore curated hardware and digital UI workstation"
              fallbackLabel="DevStore Flagship Showcase"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* 4-Column Marketplace Pillars Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[
            {
              icon: Globe2,
              title: 'Multi-Currency Ready',
              detail: 'Display & settle in USD, NGN, GBP, and EUR',
            },
            {
              icon: CreditCard,
              title: 'Paystack & Flutterwave',
              detail: 'Multi-vendor order splitting in one checkout',
            },
            {
              icon: Layers,
              title: 'Digital Licensing',
              detail: 'Personal, Commercial & Extended license tiers',
            },
            {
              icon: ShieldCheck,
              title: 'Explore DevStore',
              detail: 'Try Customer, Seller, and Admin views with sample data',
            },
          ].map(({ icon: Icon, title, detail }) => (
            <div
              key={title}
              className="bg-white border border-zinc-200 rounded-xl p-4 flex items-start gap-3"
            >
              <div className="p-2 bg-stone-100 rounded-lg text-zinc-800 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
                <p className="text-xs text-zinc-600 mt-0.5">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Searchable & Filterable Catalog */}
      <CatalogSection compact />

      {/* Dedicated Digital Department Spotlight */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-zinc-900 text-stone-100 rounded-2xl p-8 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <p className="text-xs font-mono uppercase tracking-wider text-blue-400">
              Dedicated Digital Department
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-balance">
              17 specialized digital asset categories with controlled license delivery.
            </h2>
            <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-2xl">
              Explore Next.js templates, WordPress plugins, Figma UI kits, isometric icon suites, source code, and technical handbooks. Every digital purchase unlocks instant downloads and version updates in your account library.
            </p>
            <div className="pt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setView('digital')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg cursor-pointer ui-transition"
              >
                Open Digital Marketplace
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl overflow-hidden border border-zinc-700 aspect-[4/3]">
            <SafeImage
              src="/src/assets/images/digital_ui_kit_preview_1795615501746.jpg"
              alt="Digital UI Kit showcase"
              fallbackLabel="Digital Marketplace"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Verified International Sellers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-zinc-900">
              Featured Verified Sellers
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              Independent studios shipping physical hardware and digital tools worldwide.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView('stores')}
            className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap cursor-pointer"
          >
            View all stores
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {stores
            .filter((s) => s.status === 'active')
            .slice(0, 3)
            .map((store) => (
              <div
                key={store.id}
                className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <SafeImage
                    src={store.logoUrl}
                    alt={store.name}
                    className="w-12 h-12 rounded-lg object-cover border border-zinc-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-zinc-900 truncate">
                      {store.name}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {store.countryCode} · ★ {store.ratingAvg.toFixed(1)} · {store.followerCount.toLocaleString()} followers
                    </p>
                  </div>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2">
                  {store.description}
                </p>
                <button
                  type="button"
                  onClick={() => setView('stores')}
                  className="text-xs font-semibold text-zinc-900 hover:text-blue-600 text-left cursor-pointer"
                >
                  Inspect storefront &amp; policies →
                </button>
              </div>
            ))}
        </div>
      </section>

      {/* Recently Viewed (if user browsed products) */}
      {recentlyViewed.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-4">
          <h2 className="font-display text-xl font-bold text-zinc-900">Recently Viewed</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recentlyViewed.slice(0, 3).map((prod) => (
              <ProductCard key={prod.id} product={prod} />
            ))}
          </div>
          {recentlyViewed.length > 3 && (
            <button
              type="button"
              onClick={() => openProduct(recentlyViewed[0])}
              className="text-xs text-blue-600 hover:underline cursor-pointer"
            >
              Return to last viewed product
            </button>
          )}
        </section>
      )}
    </div>
  );
}
