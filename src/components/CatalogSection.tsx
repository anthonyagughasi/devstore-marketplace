import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { ProductCard } from './ProductCard.tsx';

type SortMode = 'featured' | 'price-asc' | 'price-desc' | 'rating' | 'newest';

export function CatalogSection({ compact = false }: { compact?: boolean }) {
  const {
    products,
    departments,
    stores,
    selectedDepartmentSlug,
    setSelectedDepartmentSlug,
    searchQuery,
    setSearchQuery,
    openProduct,
  } = useMarketplace();

  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'physical' | 'digital'>('all');
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [minRating, setMinRating] = useState<number>(0);
  const [maxPriceUsd, setMaxPriceUsd] = useState<number>(500);
  const [sortBy, setSortBy] = useState<SortMode>('featured');
  const [page, setPage] = useState<number>(1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const approvedProducts = useMemo(
    () => products.filter((p) => p.approvalStatus === 'approved'),
    [products]
  );

  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return approvedProducts
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.categorySlug.toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [approvedProducts, searchQuery]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = approvedProducts.filter((p) => {
      if (selectedDepartmentSlug !== 'all' && p.departmentSlug !== selectedDepartmentSlug) {
        return false;
      }
      if (productTypeFilter !== 'all' && p.productType !== productTypeFilter) return false;
      if (selectedStoreId !== 'all' && p.storeId !== selectedStoreId) return false;
      if (minRating > 0 && p.ratingAvg < minRating) return false;
      if (p.priceMinor > maxPriceUsd * 100) return false;
      if (q) {
        const hay = `${p.title} ${p.description} ${p.brand} ${p.storeName} ${p.categorySlug}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'price-asc') list = [...list].sort((a, b) => a.priceMinor - b.priceMinor);
    else if (sortBy === 'price-desc') list = [...list].sort((a, b) => b.priceMinor - a.priceMinor);
    else if (sortBy === 'rating') list = [...list].sort((a, b) => b.ratingAvg - a.ratingAvg);
    else if (sortBy === 'newest')
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else list = [...list].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || b.salesCount - a.salesCount);

    return list;
  }, [
    approvedProducts,
    maxPriceUsd,
    minRating,
    productTypeFilter,
    searchQuery,
    selectedDepartmentSlug,
    selectedStoreId,
    sortBy,
  ]);

  const pageSize = compact ? 6 : 9;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const resetFilters = () => {
    setSelectedDepartmentSlug('all');
    setProductTypeFilter('all');
    setSelectedStoreId('all');
    setMinRating(0);
    setMaxPriceUsd(500);
    setSearchQuery('');
    setPage(1);
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      {/* Header + Search Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight">
            Global Marketplace Catalog
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Filter verified physical hardware and licensed digital assets across 10 departments.
          </p>
        </div>

        <div className="relative w-full lg:w-96">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search keyboards, UI kits, audio, books..."
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {showSuggestions && searchSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-30 divide-y divide-zinc-100">
              {searchSuggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={() => openProduct(item)}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-stone-50 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <span className="text-sm font-medium text-zinc-900 truncate">{item.title}</span>
                  <span className="text-xs text-zinc-500 whitespace-nowrap">{item.brand}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Department Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        <button
          type="button"
          onClick={() => {
            setSelectedDepartmentSlug('all');
            setPage(1);
          }}
          className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ui-transition ${
            selectedDepartmentSlug === 'all'
              ? 'bg-zinc-900 text-white'
              : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-stone-100'
          }`}
        >
          All Departments
        </button>
        {departments
          .filter((d) => d.active)
          .map((dept) => (
            <button
              key={dept.id}
              type="button"
              onClick={() => {
                setSelectedDepartmentSlug(dept.slug);
                setPage(1);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ui-transition ${
                selectedDepartmentSlug === dept.slug
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-stone-100'
              }`}
            >
              {dept.name}
            </button>
          ))}
      </div>

      {/* Multi-Faceted Filter Bar */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
          </span>

          <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
            {(['all', 'physical', 'digital'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setProductTypeFilter(t);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize cursor-pointer ui-transition ${
                  productTypeFilter === t ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by seller"
            value={selectedStoreId}
            onChange={(e) => {
              setSelectedStoreId(e.target.value);
              setPage(1);
            }}
            className="bg-stone-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-800 cursor-pointer"
          >
            <option value="all">All Verified Sellers</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by minimum rating"
            value={minRating}
            onChange={(e) => {
              setMinRating(Number(e.target.value));
              setPage(1);
            }}
            className="bg-stone-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-800 cursor-pointer"
          >
            <option value={0}>Any Rating</option>
            <option value={4.5}>4.5★ &amp; above</option>
            <option value={4.8}>4.8★ &amp; above</option>
          </select>

          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <span className="whitespace-nowrap">Max ${maxPriceUsd}</span>
            <input
              type="range"
              min={30}
              max={500}
              step={10}
              value={maxPriceUsd}
              onChange={(e) => {
                setMaxPriceUsd(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Maximum USD price"
              className="w-24 accent-blue-600 cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 tabular-nums">
            {filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
          </span>
          <select
            aria-label="Sort products"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortMode)}
            className="bg-stone-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-800 cursor-pointer"
          >
            <option value="featured">Sort: Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="rating">Highest Rated</option>
            <option value="newest">Newest Arrivals</option>
          </select>
        </div>
      </div>

      {/* Product Grid */}
      {pagedProducts.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-zinc-900">No products match your current filters</p>
          <p className="text-sm text-zinc-600">
            Try clearing your search query or expanding the department and price limits.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 cursor-pointer"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pagedProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
            <button
              key={pNum}
              type="button"
              onClick={() => setPage(pNum)}
              className={`w-9 h-9 rounded-lg text-xs font-mono font-semibold cursor-pointer ui-transition ${
                safePage === pNum
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-stone-100'
              }`}
            >
              {pNum}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
