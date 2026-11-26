import { useMemo, useState } from 'react';
import { Code2, ExternalLink, Lock, FileCode2, Download } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { DIGITAL_SUBCATEGORIES } from '../shared/catalogData.ts';
import { ProductCard } from './ProductCard.tsx';

export function DigitalDepartmentView() {
  const { products, setView, isDemoMode, demoLoading, openDemoSelector } = useMarketplace();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  const digitalProducts = useMemo(() => {
    return products.filter((p) => {
      if (p.approvalStatus !== 'approved' || p.productType !== 'digital') return false;
      if (selectedCategory !== 'all' && p.categorySlug !== selectedCategory) return false;
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.categorySlug.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, searchText, selectedCategory]);

  return (
    <div>
      {/* Dedicated Digital Department Identity Banner */}
      <section className="bg-zinc-900 text-stone-100 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center gap-2 text-xs font-mono text-blue-400">
              <Code2 className="w-4 h-4" />
              <span>DEVSTORE DIGITAL DEPARTMENT</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
              Production templates, UI systems, source code, and developer resources.
            </h1>
            <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
              Every digital listing supports Personal, Commercial, and Extended licensing, versioned updates for previous buyers, and private time-limited download authorization.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              {isDemoMode ? (
                <button
                  type="button"
                  onClick={() => setView('customer')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Open My Download Library
                </button>
              ) : (
                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={openDemoSelector}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Explore Demo Download Library
                </button>
              )}
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Lock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Private asset vault · HMAC signed download URLs</span>
              </div>
            </div>
          </div>

          {/* License Tier Reference Panel */}
          <div className="lg:col-span-4 bg-zinc-800/70 border border-zinc-700 rounded-xl p-5 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-300">
              Standard Digital Licensing
            </h2>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
                <span className="font-semibold text-white">Personal License</span>
                <span className="text-zinc-400">1x base · Single personal project</span>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
                <span className="font-semibold text-white">Commercial License</span>
                <span className="text-zinc-400">2.5x · Unlimited client builds</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Extended License</span>
                <span className="text-zinc-400">5x · SaaS / Multi-seat org rights</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 17 Digital Categories + Filter Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <FileCode2 className="w-4 h-4 text-blue-600" />
            <span>Browse 17 Digital Categories</span>
          </div>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter digital assets by keyword..."
            className="w-full sm:w-72 px-3.5 py-2 bg-white border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-blue-600"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ui-transition ${
              selectedCategory === 'all'
                ? 'bg-zinc-900 text-white'
                : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-stone-100'
            }`}
          >
            All Digital Assets
          </button>
          {DIGITAL_SUBCATEGORIES.map((cat) => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => setSelectedCategory(cat.slug)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ui-transition ${
                selectedCategory === cat.slug
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-stone-100'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {digitalProducts.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-zinc-900">
              No digital listings currently published in this subcategory.
            </p>
            <p className="text-xs text-zinc-600">
              Switch to All Digital Assets or submit a new digital product in the Seller Demo dashboard.
            </p>
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Show All Digital Assets
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {digitalProducts.map((product) => (
              <div key={product.id} className="space-y-2">
                <ProductCard product={product} />
                {product.digitalMeta && (
                  <div className="px-1 flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-mono">
                      {product.digitalMeta.fileFormat} · {product.digitalMeta.fileSizeLabel}
                    </span>
                    {product.digitalMeta.liveDemoUrl && (
                      <a
                        href={product.digitalMeta.liveDemoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        Live Preview
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
