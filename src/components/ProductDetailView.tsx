import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Heart,
  ShieldCheck,
  Star,
  Truck,
  BookOpen,
  GitCompare,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { LicenseType } from '../shared/types.ts';
import { getLicenseUnitPriceMinor } from '../shared/currency.ts';
import { SafeImage } from './SafeImage.tsx';
import { ProductCard } from './ProductCard.tsx';

export function ProductDetailView() {
  const {
    products,
    stores,
    selectedProductSlug,
    setView,
    formatPrice,
    addToCart,
    wishlist,
    toggleWishlist,
    compareIds,
    toggleCompare,
    reviews,
    questions,
    submitReview,
    submitQuestion,
    isDemoMode,
  } = useMarketplace();

  const product = useMemo(
    () => products.find((p) => p.slug === selectedProductSlug) || products[0],
    [products, selectedProductSlug]
  );

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [selectedVariation, setSelectedVariation] = useState<string>('');
  const [selectedLicense, setSelectedLicense] = useState<LicenseType>('personal');
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<'overview' | 'reviews' | 'qa'>('overview');

  // Review form state
  const [revRating, setRevRating] = useState(5);
  const [revTitle, setRevTitle] = useState('');
  const [revComment, setRevComment] = useState('');

  // Q&A form state
  const [newQuestion, setNewQuestion] = useState('');

  useEffect(() => {
    setActiveImageIdx(0);
    setQuantity(1);
    setSelectedLicense('personal');
    if (product?.variations?.length) {
      setSelectedVariation(
        product.variations.map((v) => v.options[0]).filter(Boolean).join(' · ')
      );
    } else {
      setSelectedVariation('');
    }
  }, [product]);

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <p className="text-zinc-600">Product not found.</p>
      </div>
    );
  }

  const store = stores.find((s) => s.id === product.storeId);
  const productReviews = reviews.filter((r) => r.productId === product.id);
  const productQuestions = questions.filter((q) => q.productId === product.id);
  const relatedProducts = products
    .filter(
      (p) =>
        p.id !== product.id &&
        p.approvalStatus === 'approved' &&
        (p.departmentSlug === product.departmentSlug || p.productType === product.productType)
    )
    .slice(0, 3);

  const activeUnitPriceMinor =
    product.productType === 'digital'
      ? getLicenseUnitPriceMinor(
          product.priceMinor,
          selectedLicense,
          product.digitalMeta?.licensePricingMultiplier
        )
      : product.priceMinor;

  const isWishlisted = wishlist.includes(product.id);
  const isCompared = compareIds.includes(product.id);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <button
        type="button"
        onClick={() => setView(product.productType === 'digital' ? 'digital' : 'catalog')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {product.productType === 'digital' ? 'Digital Marketplace' : 'Catalog'}
      </button>

      {/* Main Split: Sticky Gallery Left + Contiguous Purchase Module Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-3">
          <div className="aspect-[4/3] bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <SafeImage
              src={product.imageUrls[activeImageIdx] || product.imageUrls[0]}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          </div>
          {product.imageUrls.length > 1 && (
            <div className="flex items-center gap-3">
              {product.imageUrls.map((url, idx) => (
                <button
                  key={url + idx}
                  type="button"
                  onClick={() => setActiveImageIdx(idx)}
                  className={`w-20 h-16 rounded-lg overflow-hidden border cursor-pointer ${
                    activeImageIdx === idx ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-zinc-200'
                  }`}
                >
                  <SafeImage src={url} alt={`${product.title} thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-2xl p-6 sm:p-7 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="uppercase tracking-wide font-semibold">{product.brand}</span>
              <span aria-hidden="true">·</span>
              <span>{product.storeName}</span>
              {product.storeVerified && <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />}
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight text-balance">
              {product.title}
            </h1>

            <div className="flex items-center gap-3 text-xs text-zinc-600 tabular-nums">
              <span className="inline-flex items-center gap-1 font-semibold text-zinc-900">
                <Star className="w-3.5 h-3.5 text-amber-500" fill="currentColor" />
                {product.ratingAvg > 0 ? product.ratingAvg.toFixed(1) : 'New'}
              </span>
              <span>{productReviews.length} reviews</span>
              <span aria-hidden="true">·</span>
              <span>{product.salesCount} sold</span>
            </div>
          </div>

          <div className="py-4 border-y border-zinc-100 flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2.5 tabular-nums">
              <span className="font-mono text-2xl font-bold text-zinc-900">
                {formatPrice(activeUnitPriceMinor, product.currency)}
              </span>
              {product.compareAtPriceMinor && product.compareAtPriceMinor > product.priceMinor && (
                <span className="font-mono text-sm text-zinc-400 line-through">
                  {formatPrice(product.compareAtPriceMinor, product.currency)}
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-zinc-600">
              {product.productType === 'digital'
                ? `v${product.digitalMeta?.version || '1.0'} · Instant delivery`
                : product.stockQty > 0
                ? `${product.stockQty} units ready to ship`
                : 'Out of stock'}
            </span>
          </div>

          {/* Variations (Physical) or License Selector (Digital) */}
          {product.productType === 'physical' && product.variations.length > 0 && (
            <div className="space-y-3">
              {product.variations.map((v) => (
                <div key={v.name} className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 block">{v.name}</label>
                  <div className="flex flex-wrap gap-2">
                    {v.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSelectedVariation(opt)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ui-transition ${
                          selectedVariation.includes(opt)
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-stone-50 text-zinc-800 border-zinc-200 hover:bg-stone-100'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {product.productType === 'digital' && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-zinc-700 block">Select License Tier</span>
              <div className="grid grid-cols-1 gap-2">
                {(
                  [
                    { id: 'personal', label: 'Personal License', desc: '1 personal or portfolio project' },
                    { id: 'commercial', label: 'Commercial License', desc: 'Unlimited client builds (up to 5 seats)' },
                    { id: 'extended', label: 'Extended License', desc: 'SaaS / commercial redistribution rights' },
                  ] as const
                ).map((lic) => {
                  const licPrice = getLicenseUnitPriceMinor(
                    product.priceMinor,
                    lic.id,
                    product.digitalMeta?.licensePricingMultiplier
                  );
                  return (
                    <button
                      key={lic.id}
                      type="button"
                      onClick={() => setSelectedLicense(lic.id)}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer ui-transition ${
                        selectedLicense === lic.id
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-zinc-200 hover:bg-stone-50'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-semibold text-zinc-900">{lic.label}</p>
                        <p className="text-xs text-zinc-500">{lic.desc}</p>
                      </div>
                      <span className="font-mono text-xs font-semibold text-zinc-900 tabular-nums">
                        {formatPrice(licPrice, product.currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity + Primary CTAs */}
          <div className="flex items-center gap-3 pt-1">
            {product.productType === 'physical' && (
              <div className="flex items-center border border-zinc-200 rounded-lg bg-stone-50">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-3 py-2.5 text-sm font-semibold text-zinc-700 cursor-pointer"
                >
                  −
                </button>
                <span className="px-3 text-sm font-mono tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(product.stockQty, q + 1))}
                  className="px-3 py-2.5 text-sm font-semibold text-zinc-700 cursor-pointer"
                >
                  +
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={product.productType === 'physical' && product.stockQty <= 0}
              onClick={() =>
                addToCart(
                  product,
                  quantity,
                  selectedVariation || undefined,
                  product.productType === 'digital' ? selectedLicense : undefined
                )
              }
              className="flex-1 py-3 px-5 bg-zinc-900 hover:bg-blue-600 disabled:bg-zinc-300 text-white text-sm font-semibold rounded-lg cursor-pointer ui-transition"
            >
              Add to Cart
            </button>

            <button
              type="button"
              onClick={() => toggleWishlist(product.id)}
              aria-label="Toggle wishlist"
              className={`p-3 rounded-lg border cursor-pointer ${
                isWishlisted ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-stone-50'
              }`}
            >
              <Heart className="w-4 h-4" fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>

            <button
              type="button"
              onClick={() => toggleCompare(product.id)}
              aria-label="Compare product"
              className={`p-3 rounded-lg border cursor-pointer ${
                isCompared ? 'bg-blue-600 text-white border-blue-600' : 'border-zinc-200 text-zinc-700 hover:bg-stone-50'
              }`}
            >
              <GitCompare className="w-4 h-4" />
            </button>
          </div>

          {/* Delivery / Digital Metadata */}
          <div className="bg-stone-50 border border-zinc-200 rounded-xl p-4 space-y-2 text-xs text-zinc-700">
            {product.productType === 'physical' ? (
              <>
                <div className="flex items-center gap-2 font-medium text-zinc-900">
                  <Truck className="w-4 h-4 text-zinc-700" />
                  <span>{store?.shippingSummary || 'Tracked international courier shipping'}</span>
                </div>
                <p className="text-zinc-600">{store?.policies}</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 font-medium text-zinc-900">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>
                    {product.digitalMeta?.fileFormat} · {product.digitalMeta?.fileSizeLabel} · Up to{' '}
                    {product.digitalMeta?.downloadLimit} downloads
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  {product.digitalMeta?.liveDemoUrl && (
                    <a
                      href={product.digitalMeta.liveDemoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 font-medium hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Live Demo
                    </a>
                  )}
                  {product.digitalMeta?.docsUrl && (
                    <a
                      href={product.digitalMeta.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 font-medium hover:underline"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      Documentation
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Product Tabs: Overview / Reviews / Q&A */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-6 border-b border-zinc-200">
          {[
            { id: 'overview', label: 'Description & Details' },
            { id: 'reviews', label: `Reviews (${productReviews.length})` },
            { id: 'qa', label: `Questions & Answers (${productQuestions.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`pb-3 text-sm font-semibold border-b-2 -mb-px cursor-pointer ui-transition ${
                activeTab === tab.id
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4 max-w-3xl">
            <p className="text-sm sm:text-base text-zinc-700 leading-relaxed">{product.description}</p>
            {product.digitalMeta?.changelog && (
              <div className="bg-stone-50 border border-zinc-200 rounded-xl p-4">
                <p className="text-xs font-mono font-semibold text-zinc-900">
                  Release Changelog (v{product.digitalMeta.version})
                </p>
                <p className="text-xs text-zinc-600 mt-1">{product.digitalMeta.changelog}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'reviews' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-4">
              {productReviews.length === 0 ? (
                <p className="text-sm text-zinc-500">No reviews yet. Be the first to review this item.</p>
              ) : (
                productReviews.map((rev) => (
                  <div key={rev.id} className="border-b border-zinc-100 pb-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span className="font-semibold text-zinc-900">
                        {rev.authorName} {rev.verifiedPurchase ? '· Verified Buyer' : ''}
                      </span>
                      <span className="font-mono">{rev.rating}/5 ★</span>
                    </div>
                    <h4 className="text-sm font-semibold text-zinc-900">{rev.title}</h4>
                    <p className="text-sm text-zinc-600">{rev.comment}</p>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await submitReview(product.id, revRating, revTitle, revComment);
                setRevTitle('');
                setRevComment('');
              }}
              className="lg:col-span-5 bg-stone-50 border border-zinc-200 rounded-xl p-5 space-y-3"
            >
              <h4 className="text-sm font-semibold text-zinc-900">Write a Review</h4>
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-700 block">Rating</label>
                <select
                  value={revRating}
                  onChange={(e) => setRevRating(Number(e.target.value))}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs"
                >
                  <option value={5}>5 Stars — Exceptional</option>
                  <option value={4}>4 Stars — Very Good</option>
                  <option value={3}>3 Stars — Solid</option>
                  <option value={2}>2 Stars — Fair</option>
                  <option value={1}>1 Star — Poor</option>
                </select>
              </div>
              <input
                type="text"
                required
                value={revTitle}
                onChange={(e) => setRevTitle(e.target.value)}
                placeholder="Summary headline"
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <textarea
                required
                rows={3}
                value={revComment}
                onChange={(e) => setRevComment(e.target.value)}
                placeholder="Share build quality, shipping, or documentation notes..."
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="w-full py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                {isDemoMode ? 'Post Demo Review' : 'Submit Review'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'qa' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-4">
              {productQuestions.length === 0 ? (
                <p className="text-sm text-zinc-500">No questions asked yet.</p>
              ) : (
                productQuestions.map((qa) => (
                  <div key={qa.id} className="border-b border-zinc-100 pb-4 space-y-1.5">
                    <p className="text-xs text-zinc-500">Asked by {qa.authorName}</p>
                    <p className="text-sm font-semibold text-zinc-900">Q: {qa.question}</p>
                    {qa.answer ? (
                      <p className="text-sm text-zinc-700">A: {qa.answer}</p>
                    ) : (
                      <p className="text-xs text-zinc-400">Awaiting seller response</p>
                    )}
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newQuestion.trim()) return;
                await submitQuestion(product.id, newQuestion);
                setNewQuestion('');
              }}
              className="lg:col-span-5 bg-stone-50 border border-zinc-200 rounded-xl p-5 space-y-3"
            >
              <h4 className="text-sm font-semibold text-zinc-900">Ask the Seller</h4>
              <textarea
                required
                rows={3}
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Ask about compatibility, shipping regions, or licensing..."
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="w-full py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                Post Question
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-zinc-900">Related Products</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {relatedProducts.map((rel) => (
              <ProductCard key={rel.id} product={rel} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
