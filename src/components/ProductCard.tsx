import { Heart, Plus, GitCompare, Star } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { Product } from '../shared/types.ts';
import { SafeImage } from './SafeImage.tsx';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { openProduct, formatPrice, addToCart, wishlist, toggleWishlist, compareIds, toggleCompare } =
    useMarketplace();

  const isWishlisted = wishlist.includes(product.id);
  const isCompared = compareIds.includes(product.id);
  const hasDiscount =
    product.compareAtPriceMinor && product.compareAtPriceMinor > product.priceMinor;

  return (
    <article className="group bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-md ui-transition">
      <div className="relative aspect-[4/3] bg-stone-100 overflow-hidden">
        <button
          type="button"
          onClick={() => openProduct(product)}
          className="w-full h-full block cursor-pointer text-left"
        >
          <SafeImage
            src={product.imageUrls[0]}
            alt={product.title}
            fallbackLabel={product.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] ui-transition"
          />
        </button>

        {/* Single quiet top-left tag if applicable */}
        {(product.badges[0] || product.productType === 'digital') && (
          <span className="absolute top-3 left-3 bg-white/95 text-zinc-900 border border-zinc-200 px-2.5 py-0.5 rounded text-xs font-medium">
            {product.badges[0] || 'Digital Asset'}
          </span>
        )}

        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleCompare(product.id)}
            aria-label={`Compare ${product.title}`}
            title="Compare"
            className={`p-2 rounded-lg border cursor-pointer ui-transition ${
              isCompared
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white/95 text-zinc-700 border-zinc-200 hover:bg-white'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => toggleWishlist(product.id)}
            aria-label={`Save ${product.title} to wishlist`}
            title="Wishlist"
            className={`p-2 rounded-lg border cursor-pointer ui-transition ${
              isWishlisted
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white/95 text-zinc-700 border-zinc-200 hover:bg-white'
            }`}
          >
            <Heart className="w-3.5 h-3.5" fill={isWishlisted ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1 justify-between gap-3">
        <div className="space-y-1.5">
          {/* Unboxed clean metadata with typographic separator */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 truncate">
            <span className="uppercase tracking-wide font-medium">{product.brand || product.categorySlug}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{product.storeName}</span>
          </div>

          <button
            type="button"
            onClick={() => openProduct(product)}
            className="text-left block w-full cursor-pointer"
          >
            <h3 className="font-display text-base font-semibold text-zinc-900 leading-snug line-clamp-2 hover:text-blue-600 ui-transition">
              {product.title}
            </h3>
          </button>

          <div className="flex items-center gap-2 text-xs text-zinc-500 tabular-nums">
            <span className="inline-flex items-center gap-1 text-zinc-800 font-medium">
              <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />
              {product.ratingAvg > 0 ? product.ratingAvg.toFixed(1) : 'New'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{product.reviewCount} reviews</span>
            <span aria-hidden="true">·</span>
            <span>
              {product.productType === 'digital'
                ? product.digitalMeta?.version
                  ? `v${product.digitalMeta.version}`
                  : 'Instant download'
                : product.stockQty > 0
                ? `${product.stockQty} in stock`
                : 'Out of stock'}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t border-zinc-100 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="font-mono text-base font-semibold text-zinc-900">
              {formatPrice(product.priceMinor, product.currency)}
            </span>
            {hasDiscount && (
              <span className="font-mono text-xs text-zinc-400 line-through">
                {formatPrice(product.compareAtPriceMinor!, product.currency)}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={product.productType === 'physical' && product.stockQty <= 0}
            onClick={() =>
              addToCart(
                product,
                1,
                product.variations[0]?.options[0],
                product.productType === 'digital' ? 'personal' : undefined
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-blue-600 disabled:bg-zinc-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ui-transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>
    </article>
  );
}
