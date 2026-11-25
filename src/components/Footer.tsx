import { useState } from 'react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';

export function Footer() {
  const { setView, enterDemoMode, notify } = useMarketplace();
  const [email, setEmail] = useState('');

  return (
    <footer className="bg-white border-t border-zinc-200 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-4 space-y-3">
          <p className="font-display text-lg font-bold text-zinc-900">DevStore</p>
          <p className="text-xs text-zinc-600 leading-relaxed max-w-xs">
            International multi-vendor marketplace connecting physical hardware studios, digital creators, and global buyers.
          </p>
        </div>

        <div className="md:col-span-2 space-y-2 text-xs">
          <p className="font-semibold text-zinc-900">Departments</p>
          <button type="button" onClick={() => setView('catalog')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            All Physical Goods
          </button>
          <button type="button" onClick={() => setView('digital')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            Digital Products
          </button>
          <button type="button" onClick={() => setView('stores')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            Verified Sellers
          </button>
        </div>

        <div className="md:col-span-2 space-y-2 text-xs">
          <p className="font-semibold text-zinc-900">Demo Mode</p>
          <button type="button" onClick={() => enterDemoMode('customer')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            Customer Demo
          </button>
          <button type="button" onClick={() => enterDemoMode('seller')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            Seller Demo
          </button>
          <button type="button" onClick={() => enterDemoMode('admin')} className="block text-zinc-600 hover:text-zinc-900 cursor-pointer">
            Admin Demo
          </button>
        </div>

        <div className="md:col-span-4 space-y-2">
          <p className="text-xs font-semibold text-zinc-900">Marketplace Updates</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return;
              setEmail('');
              notify('Subscribed to DevStore release highlights.', 'success');
            }}
            className="flex gap-2"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 cursor-pointer"
            >
              Subscribe
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-zinc-100 py-4 px-4 sm:px-6 text-xs text-zinc-500 max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <span>© {new Date().getFullYear()} DevStore International Marketplace.</span>
        <span className="font-mono">Multi-Currency · Paystack · Flutterwave · Private Digital Vault</span>
      </div>
    </footer>
  );
}
