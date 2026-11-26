import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { X, User, Store, ShieldCheck, LogOut, Loader2, AlertCircle } from 'lucide-react';
import { auth } from '../lib/firebase.ts';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { UserRole } from '../shared/types.ts';

export function AuthAndDemoModal() {
  const {
    authModalOpen,
    setAuthModalOpen,
    firebaseUser,
    signInWithGoogle,
    signOutLive,
    isDemoMode,
    demoRole,
    demoLoading,
    demoError,
    clearDemoError,
    enterDemoMode,
    exitDemoMode,
    integrations,
    notify,
  } = useMarketplace();

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  const [selectedRoleAttempt, setSelectedRoleAttempt] = useState<UserRole>('customer');

  if (!authModalOpen) return null;

  const handleSelectDemoRole = async (role: UserRole) => {
    setSelectedRoleAttempt(role);
    await enterDemoMode(role);
  };

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryStatus(null);
    try {
      await sendPasswordResetEmail(auth, recoveryEmail.trim());
      setRecoveryStatus(
        'If an email/password account exists for that address, Firebase Auth sent a recovery link. Google Sign-In users manage passwords via Google Account recovery.'
      );
      notify('Password recovery request submitted via Firebase Auth.', 'info');
    } catch (err) {
      setRecoveryStatus(
        err instanceof Error
          ? err.message
          : 'Unable to send Firebase password recovery link.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[1px]">
      <div className="bg-white border border-zinc-200 rounded-2xl max-w-lg w-full p-6 sm:p-7 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-900">
              DevStore Sign In &amp; Demo Mode
            </h2>
            <p className="text-xs text-zinc-600 mt-1">
              Sign in with Google for live persistence, or choose a Demo Mode role below in an isolated sandbox.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearDemoError();
              setAuthModalOpen(false);
            }}
            aria-label="Close modal"
            className="p-1 text-zinc-400 hover:text-zinc-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Demo Mode Role Picker */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700">
              Demo Mode (No Sign-Up)
            </span>
            {isDemoMode && (
              <button
                type="button"
                disabled={demoLoading}
                onClick={exitDemoMode}
                className="text-xs font-medium text-red-600 hover:underline cursor-pointer disabled:opacity-50"
              >
                Exit Demo Mode
              </button>
            )}
          </div>

          {demoError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-900 space-y-2"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold">Unable to start Demo Mode</p>
                  <p className="text-red-800">{demoError}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={() => handleSelectDemoRole(selectedRoleAttempt)}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={clearDemoError}
                  className="px-3 py-1.5 bg-white border border-red-200 text-red-900 font-medium rounded-lg cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2.5">
            {(
              [
                {
                  role: 'customer' as const,
                  title: 'Customer Demo',
                  desc: 'Browse catalog, test multi-vendor checkout, simulate Paystack/Flutterwave payments, and download digital assets.',
                  icon: User,
                },
                {
                  role: 'seller' as const,
                  title: 'Seller Demo',
                  desc: 'Manage Atelier Systems store, add/edit products, ship split orders, inspect ledger earnings, and request withdrawals.',
                  icon: Store,
                },
                {
                  role: 'admin' as const,
                  title: 'Admin Demo',
                  desc: 'Moderate products, approve sellers, review payouts, configure commissions & FX rates, resolve disputes, and audit activity.',
                  icon: ShieldCheck,
                },
              ] as const
            ).map(({ role, title, desc, icon: Icon }) => {
              const isStartingThis = demoLoading && selectedRoleAttempt === role;
              return (
                <button
                  key={role}
                  type="button"
                  disabled={demoLoading}
                  onClick={() => handleSelectDemoRole(role)}
                  className={`p-3.5 rounded-xl border text-left flex items-start gap-3 cursor-pointer ui-transition disabled:opacity-60 disabled:cursor-not-allowed ${
                    isDemoMode && demoRole === role
                      ? 'border-blue-600 bg-blue-50/50'
                      : 'border-zinc-200 hover:border-zinc-400 hover:bg-stone-50'
                  }`}
                >
                  <div className="p-2 bg-stone-100 rounded-lg text-zinc-900 shrink-0">
                    {isStartingThis ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">
                      {isStartingThis ? `Starting ${title}...` : title}
                    </p>
                    <p className="text-xs text-zinc-600 mt-0.5">{desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Firebase Authentication */}
        <div className="pt-4 border-t border-zinc-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700">
              Live Production Account
            </span>
            {!firebaseUser && (
              <button
                type="button"
                onClick={() => setRecoveryOpen((prev) => !prev)}
                className="text-xs text-blue-600 hover:underline font-medium cursor-pointer"
              >
                {recoveryOpen ? 'Hide Recovery' : 'Account / Password Recovery'}
              </button>
            )}
          </div>

          {firebaseUser ? (
            <div className="flex items-center justify-between gap-3 bg-stone-50 border border-zinc-200 rounded-xl p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">
                  {firebaseUser.displayName}
                </p>
                <p className="text-xs text-zinc-500 truncate">{firebaseUser.email}</p>
              </div>
              <button
                type="button"
                onClick={signOutLive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 text-xs font-semibold text-zinc-800 rounded-lg hover:bg-stone-100 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg cursor-pointer ui-transition"
              >
                Continue with Google
              </button>

              {recoveryOpen && (
                <form
                  onSubmit={handlePasswordRecovery}
                  className="bg-stone-50 border border-zinc-200 rounded-xl p-3.5 space-y-2.5 text-xs"
                >
                  <p className="font-semibold text-zinc-900">Firebase Account Recovery</p>
                  <p className="text-zinc-600">
                    Google Sign-In accounts recover passwords at{' '}
                    <span className="font-mono">myaccount.google.com</span>. If an email/password provider is enabled on your Firebase project, enter your email below:
                  </p>
                  {integrations && !integrations.email.configured && (
                    <p className="text-zinc-500">
                      Custom Resend email notifications are currently disabled (awaiting optional{' '}
                      <span className="font-mono">RESEND_API_KEY</span>); Firebase handles built-in identity recovery directly.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="email"
                      required
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="flex-1 border border-zinc-200 bg-white rounded-lg px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 bg-zinc-900 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Send Reset
                    </button>
                  </div>
                  {recoveryStatus && <p className="text-zinc-700">{recoveryStatus}</p>}
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
