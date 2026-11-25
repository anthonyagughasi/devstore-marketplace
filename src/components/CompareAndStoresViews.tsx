import { ShieldCheck, Star, UserPlus, UserCheck, X } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { SafeImage } from './SafeImage.tsx';

export function CompareView() {
  const { products, compareIds, toggleCompare, formatPrice, addToCart, setView } = useMarketplace();
  const comparedProducts = products.filter((p) => compareIds.includes(p.id));

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900">
            Product Comparison
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Compare pricing, ratings, licensing, and seller policies side by side.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setView('catalog')}
          className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
        >
          Browse Catalog
        </button>
      </div>

      {comparedProducts.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-zinc-900">No products selected for comparison</p>
          <p className="text-sm text-zinc-600">
            Click the Compare icon on up to 3 product cards to evaluate specifications side by side.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="p-4 text-xs font-semibold text-zinc-500 w-44">Attribute</th>
                {comparedProducts.map((p) => (
                  <th key={p.id} className="p-4 min-w-[220px] align-top">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-display font-semibold text-zinc-900">{p.title}</span>
                      <button
                        type="button"
                        onClick={() => toggleCompare(p.id)}
                        className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-xs">
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Preview</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4">
                    <SafeImage
                      src={p.imageUrls[0]}
                      alt={p.title}
                      className="w-full aspect-[4/3] object-cover rounded-lg border border-zinc-200"
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Price</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4 font-mono font-semibold text-zinc-900 tabular-nums">
                    {formatPrice(p.priceMinor, p.currency)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Type</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4 capitalize text-zinc-800">
                    {p.productType} ({p.categorySlug})
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Seller</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4 text-zinc-800">
                    {p.storeName}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Rating</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4 tabular-nums">
                    {p.ratingAvg.toFixed(1)} ★ ({p.reviewCount})
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-4 font-semibold text-zinc-600">Action</td>
                {comparedProducts.map((p) => (
                  <td key={p.id} className="p-4">
                    <button
                      type="button"
                      onClick={() => addToCart(p, 1)}
                      className="px-3.5 py-2 bg-zinc-900 hover:bg-blue-600 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Add to Cart
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function StoresDirectoryView() {
  const { stores, products, followedStoreIds, toggleFollowStore, openProduct } = useMarketplace();

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900">
          Verified International Sellers
        </h1>
        <p className="text-sm text-zinc-600 mt-1">
          Follow independent hardware studios and digital creators to track new releases and policies.
        </p>
      </div>

      <div className="space-y-6">
        {stores
          .filter((s) => s.status === 'active')
          .map((store) => {
            const isFollowed = followedStoreIds.includes(store.id);
            const storeProducts = products.filter(
              (p) => p.storeId === store.id && p.approvalStatus === 'approved'
            );

            return (
              <div
                key={store.id}
                className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <SafeImage
                      src={store.logoUrl}
                      alt={store.name}
                      className="w-16 h-16 rounded-xl object-cover border border-zinc-200 shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-display text-xl font-bold text-zinc-900">
                          {store.name}
                        </h2>
                        {store.verified && <ShieldCheck className="w-4 h-4 text-blue-600" />}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mt-1 tabular-nums">
                        <span>Country: {store.countryCode}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-zinc-800 font-medium">
                          <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />
                          {store.ratingAvg.toFixed(1)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{store.followerCount.toLocaleString()} followers</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleFollowStore(store.id)}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ui-transition ${
                      isFollowed
                        ? 'bg-stone-100 text-zinc-900 border border-zinc-300'
                        : 'bg-zinc-900 text-white hover:bg-blue-600'
                    }`}
                  >
                    {isFollowed ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    {isFollowed ? 'Following' : 'Follow Store'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-600 bg-stone-50 border border-zinc-200 rounded-xl p-4">
                  <div>
                    <span className="font-semibold text-zinc-900 block mb-1">Store Overview</span>
                    {store.description}
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-900 block mb-1">Shipping &amp; Return Policy</span>
                    {store.shippingSummary} — {store.policies}
                  </div>
                </div>

                {storeProducts.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {storeProducts.slice(0, 4).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => openProduct(p)}
                        className="text-left border border-zinc-200 rounded-xl p-3 hover:border-zinc-400 cursor-pointer ui-transition"
                      >
                        <SafeImage
                          src={p.imageUrls[0]}
                          alt={p.title}
                          className="w-full aspect-[4/3] object-cover rounded-lg mb-2"
                        />
                        <p className="text-xs font-semibold text-zinc-900 line-clamp-1">{p.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 capitalize">{p.productType}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}
