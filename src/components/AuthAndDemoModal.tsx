import { useState } from 'react';
import {
  X,
  User,
  Store,
  ShieldCheck,
  LogOut,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowLeft,
} from 'lucide-react';
import { useMarketplace } from '../context/MarketplaceContext.tsx';
import type { UserRole } from '../shared/types.ts';

type AuthMode = 'signin' | 'register' | 'forgot';

export function AuthAndDemoModal() {
  const {
    authModalOpen,
    setAuthModalOpen,
    firebaseUser,
    signInWithGoogle,
    registerWithEmailPassword,
    signInWithEmailPassword,
    requestPasswordReset,
    signOutLive,
    isDemoMode,
    demoRole,
    demoLoading,
    demoError,
    clearDemoError,
    enterDemoMode,
    exitDemoMode,
  } = useMarketplace();

  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState<string | null>(null);
  const [selectedRoleAttempt, setSelectedRoleAttempt] = useState<UserRole>('customer');

  if (!authModalOpen) return null;

  const switchMode = (next: AuthMode) => {
    setAuthMode(next);
    setAuthError(null);
    setResetConfirmation(null);
  };

  const handleClose = () => {
    clearDemoError();
    setAuthError(null);
    setResetConfirmation(null);
    setAuthModalOpen(false);
  };

  const handleSelectDemoRole = async (role: UserRole) => {
    setSelectedRoleAttempt(role);
    await enterDemoMode(role);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      await signInWithEmailPassword(email, password);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in right now. Please try again.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setAuthError('Please enter your full name.');
      return;
    }
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setAuthSubmitting(true);
    try {
      await registerWithEmailPassword(trimmedName, email, password);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to create your account right now. Please try again.'
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setResetConfirmation(null);
    setAuthSubmitting(true);
    try {
      await requestPasswordReset(email);
      setResetConfirmation(
        'If an account exists with this email address, you will receive instructions to reset your password.'
      );
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Unable to process your password reset request right now. Please try again.'
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google sign-in could not be completed. Please try again.'
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[1px]">
      <div className="bg-white border border-zinc-200 rounded-2xl max-w-lg w-full p-6 sm:p-7 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-900">
              Welcome to DevStore
            </h2>
            <p className="text-xs text-zinc-600 mt-1">
              Welcome to DevStore. Sign in or create an account to explore the marketplace.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="p-1 text-zinc-400 hover:text-zinc-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Account Authentication */}
        <div className="space-y-4">
          {firebaseUser ? (
            <div className="flex items-center justify-between gap-3 bg-stone-50 border border-zinc-200 rounded-xl p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">
                  {firebaseUser.displayName || 'DevStore Customer'}
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
            <div className="space-y-4">
              {authMode !== 'forgot' && (
                <div className="grid grid-cols-2 bg-stone-100 p-1 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className={`py-2 rounded-lg cursor-pointer ui-transition ${
                      authMode === 'signin'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className={`py-2 rounded-lg cursor-pointer ui-transition ${
                      authMode === 'register'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              )}

              {authError && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-900 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {authMode === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-3">
                  <div>
                    <label htmlFor="auth-signin-email" className="block text-xs font-semibold text-zinc-700 mb-1">
                      Email Address
                    </label>
                    <input
                      id="auth-signin-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="auth-signin-password" className="block text-xs font-semibold text-zinc-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="auth-signin-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 pr-9 text-xs focus:outline-none focus:border-zinc-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer ui-transition flex items-center justify-center gap-2"
                  >
                    {authSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {authSubmitting ? 'Signing In...' : 'Sign In'}
                  </button>

                  <p className="text-center text-xs text-zinc-600">
                    New to DevStore?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      Create Account
                    </button>
                  </p>
                </form>
              )}

              {authMode === 'register' && (
                <form onSubmit={handleRegister} className="space-y-3">
                  <div>
                    <label htmlFor="auth-register-name" className="block text-xs font-semibold text-zinc-700 mb-1">
                      Full Name
                    </label>
                    <input
                      id="auth-register-name"
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                    />
                  </div>

                  <div>
                    <label htmlFor="auth-register-email" className="block text-xs font-semibold text-zinc-700 mb-1">
                      Email Address
                    </label>
                    <input
                      id="auth-register-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="auth-register-password" className="block text-xs font-semibold text-zinc-700 mb-1">
                        Password
                      </label>
                      <input
                        id="auth-register-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min. 8 characters"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="auth-register-confirm" className="block text-xs font-semibold text-zinc-700 mb-1">
                        Confirm Password
                      </label>
                      <input
                        id="auth-register-confirm"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Use at least 8 characters.</span>
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
                    >
                      {showPassword ? 'Hide passwords' : 'Show passwords'}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer ui-transition flex items-center justify-center gap-2"
                  >
                    {authSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {authSubmitting ? 'Creating Account...' : 'Create Account'}
                  </button>

                  <p className="text-center text-xs text-zinc-600">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </p>
                </form>
              )}

              {authMode === 'forgot' && (
                <form onSubmit={handlePasswordRecovery} className="space-y-3 bg-stone-50 border border-zinc-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900">Forgot Password</h3>
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back to Sign In
                    </button>
                  </div>

                  <p className="text-xs text-zinc-600">
                    Enter your account email address and we will send you a link to reset your password.
                  </p>

                  <div>
                    <label htmlFor="auth-forgot-email" className="block text-xs font-semibold text-zinc-700 mb-1">
                      Email Address
                    </label>
                    <input
                      id="auth-forgot-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full border border-zinc-200 bg-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer ui-transition flex items-center justify-center gap-2"
                  >
                    {authSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {authSubmitting ? 'Sending Reset Link...' : 'Send Reset Link'}
                  </button>

                  {resetConfirmation && (
                    <div
                      role="status"
                      className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex items-start gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{resetConfirmation}</span>
                    </div>
                  )}
                </form>
              )}

              {authMode !== 'forgot' && (
                <>
                  <div className="relative flex items-center py-0.5">
                    <div className="flex-grow border-t border-zinc-200" />
                    <span className="shrink mx-3 text-[11px] uppercase tracking-wider text-zinc-400">
                      or
                    </span>
                    <div className="flex-grow border-t border-zinc-200" />
                  </div>

                  <button
                    type="button"
                    disabled={authSubmitting}
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 bg-white border border-zinc-300 hover:bg-stone-50 disabled:opacity-60 text-zinc-900 text-xs font-semibold rounded-lg cursor-pointer ui-transition"
                  >
                    Continue with Google
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Explore DevStore Demo Role Picker */}
        <div className="pt-4 border-t border-zinc-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700">
                Explore DevStore
              </span>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Preview shopping, selling, and marketplace tools with sample data.
              </p>
            </div>
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
                  <p className="font-semibold">Unable to start preview</p>
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

          <div className="grid grid-cols-1 gap-2">
            {(
              [
                {
                  role: 'customer' as const,
                  title: 'Customer Demo',
                  desc: 'Browse the catalog, test checkout, and download digital products.',
                  icon: User,
                },
                {
                  role: 'seller' as const,
                  title: 'Seller Demo',
                  desc: 'Manage Atelier Systems store, update products, ship orders, and track earnings.',
                  icon: Store,
                },
                {
                  role: 'admin' as const,
                  title: 'Admin Demo',
                  desc: 'Approve sellers, review products and payouts, and manage marketplace settings.',
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
                  className={`p-3 rounded-xl border text-left flex items-start gap-3 cursor-pointer ui-transition disabled:opacity-60 disabled:cursor-not-allowed ${
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
      </div>
    </div>
  );
}
