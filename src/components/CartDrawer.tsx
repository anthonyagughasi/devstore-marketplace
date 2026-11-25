import { Trash2, X, ShoppingBag } from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import { getLicenseUnitPriceMinor } from '../shared/currency.ts';
import { SafeImage } from './SafeImage.tsx';

export function CartDrawer() {
  const {
    cart,
    products,
    cartDrawerOpen,
    setCartDrawerOpen,
    updateCartQuantity,
    removeFromCart,
    formatPrice,
    setView,
  } = useMarketplace();

  if (!cartDrawerOpen) return null;

  const resolvedItems = cart
    .map((item, idx) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return null;
      const unitMinor =
        product.productType === 'digital'
          ? getLicenseUnitPriceMinor(
              product.priceMinor,
              item.selectedLicense,
              product.digitalMeta?.licensePricingMultiplier
            )
          : product.priceMinor;
      return {
        idx,
        item,
        product,
        unitMinor,
        lineTotalMinor: unitMinor * item.quantity,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const subtotalMinor = resolvedItems.reduce((acc, r) => acc + r.lineTotalMinor, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]">
      <div className="w-full max-w-md bg-white h-full flex flex-col border-l border-zinc-200 shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-zinc-900" />
            <h2 className="font-display text-base font-bold text-zinc-900">
              Shopping Cart ({resolvedItems.reduce((a, r) => a + r.item.quantity, 0)})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setCartDrawerOpen(false)}
            aria-label="Close cart"
            className="p-1.5 text-zinc-500 hover:text-zinc-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {resolvedItems.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <p className="text-sm font-semibold text-zinc-900">Your cart is empty</p>
              <p className="text-xs text-zinc-500">
                Add physical gear or licensed digital assets from multiple vendors in one cart.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCartDrawerOpen(false);
                  setView('catalog');
                }}
                className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Explore Products
              </button>
            </div>
          ) : (
            resolvedItems.map(({ idx, item, product, lineTotalMinor }) => (
              <div
                key={`${item.productId}-${idx}`}
                className="flex gap-3.5 pb-4 border-b border-zinc-100"
              >
                <SafeImage
                  src={product.imageUrls[0]}
                  alt={product.title}
                  className="w-20 h-16 object-cover rounded-lg border border-zinc-200 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-zinc-900 line-clamp-1">{product.title}</p>
                  <p className="text-xs text-zinc-500">
                    {product.storeName}
                    {item.selectedLicense ? ` · ${item.selectedLicense} license` : ''}
                    {item.selectedVariation ? ` · ${item.selectedVariation}` : ''}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center border border-zinc-200 rounded bg-stone-50">
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(idx, item.quantity - 1)}
                        className="px-2 py-0.5 text-xs font-semibold cursor-pointer"
                      >
                        −
                      </button>
                      <span className="px-2 text-xs font-mono tabular-nums">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(idx, item.quantity + 1)}
                        className="px-2 py-0.5 text-xs font-semibold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 tabular-nums">
                        {formatPrice(lineTotalMinor, product.currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFromCart(idx)}
                        aria-label="Remove item"
                        className="text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {resolvedItems.length > 0 && (
          <div className="p-5 border-t border-zinc-200 bg-stone-50 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">Estimated Subtotal</span>
              <span className="font-mono font-bold text-zinc-900 tabular-nums">
                {formatPrice(subtotalMinor, 'USD')}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Multi-vendor order splitting &amp; Paystack / Flutterwave checkout calculated on next step.
            </p>
            <button
              type="button"
              onClick={() => {
                setCartDrawerOpen(false);
                setView('checkout');
              }}
              className="w-full py-3 bg-zinc-900 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg cursor-pointer ui-transition"
            >
              Proceed to Checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
