import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase.ts';
import {
  fetchWithFirebaseAuth,
  parseApiResponse,
} from '../lib/authenticatedFetch.ts';
import type {
  CartItem,
  Coupon,
  CurrencyCode,
  DemoActivityLog,
  DemoCustomerAccount,
  Department,
  DigitalEntitlement,
  Dispute,
  LedgerTransaction,
  LicenseType,
  Order,
  PaymentProviderId,
  PlatformConfig,
  Product,
  ProductQuestion,
  ProductReview,
  SellerApplication,
  SellerFulfilmentStatus,
  SellerOrder,
  ShippingAddress,
  Store,
  UserRole,
  WithdrawalRequest,
} from '../shared/types.ts';
import {
  SEED_COUPONS,
  SEED_DEPARTMENTS,
  SEED_PLATFORM_CONFIG,
  SEED_PRODUCTS,
  SEED_QUESTIONS,
  SEED_REVIEWS,
  SEED_STORES,
} from '../shared/catalogData.ts';
import { convertMinorAmount, formatMoney } from '../shared/currency.ts';

export type AppView =
  | 'home'
  | 'catalog'
  | 'digital'
  | 'product'
  | 'stores'
  | 'checkout'
  | 'customer'
  | 'seller'
  | 'admin'
  | 'compare';

export interface SellerBalances {
  grossSalesMinor: number;
  commissionMinor: number;
  netEarningsMinor: number;
  pendingEarningsMinor: number;
  availableBalanceMinor: number;
  withdrawnOrPendingMinor: number;
}

export interface IntegrationsStatus {
  paystack: {
    configured: boolean;
    webhookConfigured?: boolean;
    missingEnvVars: string[];
    supportedCurrencies: CurrencyCode[];
  };
  flutterwave: {
    configured: boolean;
    webhookConfigured?: boolean;
    missingEnvVars: string[];
    supportedCurrencies: CurrencyCode[];
  };
  email: {
    provider: string;
    configured: boolean;
    optional?: boolean;
    missingEnvVars: string[];
    devPreviewEnabled?: boolean;
  };
  currency?: {
    mode: 'manual' | 'external_api';
    externalApiConfigured: boolean;
    optional: boolean;
    missingEnvVars: string[];
  };
  storage?: {
    mode: 'local_dev' | 's3' | 'unconfigured_serverless';
    configured: boolean;
    optional: boolean;
    providerLabel: string;
    missingEnvVars: string[];
    vercelCompatible: boolean;
  };
}

interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
}

interface MarketplaceContextValue {
  view: AppView;
  setView: (view: AppView) => void;
  selectedProductSlug: string | null;
  openProduct: (product: Product) => void;
  selectedDepartmentSlug: string;
  setSelectedDepartmentSlug: (slug: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  formatPrice: (amountMinor: number, sourceCurrency?: CurrencyCode) => string;

  // Auth & Role State
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  liveRole: UserRole;
  isDemoMode: boolean;
  demoRole: UserRole;
  demoNamespaceId: string | null;
  demoLoading: boolean;
  demoError: string | null;
  clearDemoError: () => void;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  openDemoSelector: () => void;
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;

  // Demo Mode Controls
  enterDemoMode: (role: UserRole) => Promise<void>;
  exitDemoMode: () => void;
  resetDemoData: () => Promise<void>;

  // Live Auth Controls
  signInWithGoogle: () => Promise<void>;
  registerWithEmailPassword: (fullName: string, email: string, password: string) => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  signOutLive: () => Promise<void>;

  // Marketplace Data
  departments: Department[];
  stores: Store[];
  products: Product[];
  coupons: Coupon[];
  reviews: ProductReview[];
  questions: ProductQuestion[];
  platformConfig: PlatformConfig;
  integrations: IntegrationsStatus | null;

  // Customer State
  cart: CartItem[];
  wishlist: string[];
  followedStoreIds: string[];
  compareIds: string[];
  recentlyViewedIds: string[];
  addresses: ShippingAddress[];
  orders: Order[];
  entitlements: DigitalEntitlement[];
  disputes: Dispute[];

  // Seller & Admin State
  sellerOrders: SellerOrder[];
  sellerBalances: SellerBalances;
  transactions: LedgerTransaction[];
  withdrawals: WithdrawalRequest[];
  sellerApplications: SellerApplication[];
  demoCustomers: DemoCustomerAccount[];
  demoActivityLogs: DemoActivityLog[];

  // Actions
  addToCart: (product: Product, quantity?: number, variation?: string, license?: LicenseType) => Promise<void>;
  updateCartQuantity: (index: number, quantity: number) => Promise<void>;
  removeFromCart: (index: number) => Promise<void>;
  toggleWishlist: (productId: string) => Promise<void>;
  toggleFollowStore: (storeId: string) => Promise<void>;
  toggleCompare: (productId: string) => void;
  addAddress: (addr: Omit<ShippingAddress, 'id' | 'isDefault'>) => Promise<void>;

  // Checkout & Payments
  pendingPaymentCallback: {
    provider: PaymentProviderId;
    reference: string;
    transactionId?: string;
    callbackStatus?: string;
  } | null;
  clearPendingPaymentCallback: () => void;
  simulateDemoCheckout: (params: {
    provider: PaymentProviderId;
    outcome: 'success' | 'failed' | 'cancelled' | 'pending';
    couponCode?: string;
    shippingCity?: string;
    shippingCountry?: string;
    idempotencyKey?: string;
  }) => Promise<{ order: Order; paymentStatus: string }>;
  initializeLivePayment: (params: {
    provider: PaymentProviderId;
    amountMinor: number;
    orderId: string;
    idempotencyKey: string;
  }) => Promise<{
    configured: boolean;
    provider: PaymentProviderId;
    reference: string;
    orderId?: string;
    authorizationUrl?: string;
    missingEnvVars?: string[];
    message?: string;
  }>;
  verifyLivePayment: (params: {
    provider: PaymentProviderId;
    reference: string;
    transactionId?: string;
    callbackStatus?: string;
  }) => Promise<{
    configured: boolean;
    verified: boolean;
    provider?: PaymentProviderId;
    status: string;
    orderStatus?: 'pending' | 'processing' | 'cancelled';
    reference: string;
    orderId?: string;
    amountMinor?: number;
    currency?: CurrencyCode;
    providerTransactionId?: string;
    message?: string;
  }>;
  submitLiveSellerApplication: (input: {
    businessName: string;
    countryCode: string;
    categoryFocus: string;
    description: string;
  }) => Promise<void>;

  // Digital Downloads
  downloadDigitalAsset: (entitlement: DigitalEntitlement) => Promise<void>;

  // Reviews, Q&A & Disputes
  submitReview: (productId: string, rating: number, title: string, comment: string) => Promise<void>;
  submitQuestion: (productId: string, question: string) => Promise<void>;
  answerQuestion: (questionId: string, answer: string) => Promise<void>;
  openDispute: (sellerOrderId: string, reason: string, details: string) => Promise<void>;

  // Seller Mutations
  createDemoProduct: (payload: Partial<Product>) => Promise<void>;
  updateDemoProduct: (id: string, payload: Partial<Product>) => Promise<void>;
  deleteDemoProduct: (id: string) => Promise<void>;
  updateDemoSellerOrder: (
    sellerOrderId: string,
    status: SellerFulfilmentStatus,
    trackingNumber?: string,
    carrier?: string
  ) => Promise<void>;
  requestDemoWithdrawal: (input: {
    amountMinor: number;
    bankName: string;
    accountNumberLast4: string;
    accountName: string;
  }) => Promise<void>;
  updateDemoStore: (payload: Partial<Store>) => Promise<void>;

  // Admin Mutations
  updateDemoCustomerStatus: (customerId: string, status: 'active' | 'suspended') => Promise<void>;
  updateDemoSellerStatus: (storeId: string, payload: { status?: 'active' | 'suspended'; verified?: boolean }) => Promise<void>;
  reviewDemoApplication: (appId: string, status: 'approved' | 'rejected', reviewNote?: string) => Promise<void>;
  moderateDemoProduct: (productId: string, payload: { approvalStatus?: 'approved' | 'rejected'; isFeatured?: boolean }) => Promise<void>;
  reviewDemoWithdrawal: (withdrawalId: string, status: 'approved' | 'rejected' | 'paid', adminNote?: string) => Promise<void>;
  resolveDemoDispute: (disputeId: string, status: 'under_review' | 'resolved_refund' | 'resolved_closed', resolutionNote?: string) => Promise<void>;
  createDemoDepartment: (name: string, description: string, isDigital: boolean) => Promise<void>;
  updateDemoPlatformConfig: (payload: Partial<PlatformConfig>) => Promise<void>;
  createDemoCoupon: (code: string, discountPercent: number) => Promise<void>;

  // Toast Notifications
  toasts: ToastMessage[];
  notify: (text: string, tone?: ToastMessage['tone']) => void;
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

const EMPTY_BALANCES: SellerBalances = {
  grossSalesMinor: 0,
  commissionMinor: 0,
  netEarningsMinor: 0,
  pendingEarningsMinor: 0,
  availableBalanceMinor: 0,
  withdrawnOrPendingMinor: 0,
};

const DEMO_STATE_STORAGE_KEY = 'devstore_demo_state_v1';

function mapAuthErrorMessage(
  err: unknown,
  flow: 'signin' | 'register' | 'reset' | 'google'
): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Please choose a stronger password with at least 8 characters.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please check your details and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes before trying again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support for assistance.';
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is not enabled in the project authentication settings yet. Please enable Email/Password sign-in or continue with Google.';
    case 'auth/network-request-failed':
      return 'Network connection interrupted. Please check your connection and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Sign-in window was blocked by your browser. Please allow popups and try again.';
    default:
      if (flow === 'register') return 'Unable to create your account right now. Please try again.';
      if (flow === 'reset') return 'Unable to process your password reset request right now. Please try again.';
      if (flow === 'google') return 'Google sign-in could not be completed. Please try again.';
      return 'Unable to sign in right now. Please try again.';
  }
}

export function MarketplaceProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<AppView>('home');
  const [selectedProductSlug, setSelectedProductSlug] = useState<string | null>(null);
  const [selectedDepartmentSlug, setSelectedDepartmentSlug] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [liveRole, setLiveRole] = useState<UserRole>('customer');

  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoRole, setDemoRole] = useState<UserRole>('customer');
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [demoNamespaceId, setDemoNamespaceId] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const demoStateTokenRef = useRef<string | null>(null);
  const demoSessionLockRef = useRef<boolean>(false);
  const pendingRegistrationRef = useRef<{ email: string; displayName: string } | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingPaymentCallback, setPendingPaymentCallback] = useState<{
    provider: PaymentProviderId;
    reference: string;
    transactionId?: string;
    callbackStatus?: string;
  } | null>(null);

  const clearPendingPaymentCallback = useCallback(() => {
    setPendingPaymentCallback(null);
  }, []);

  // Live catalog & state
  const [departments, setDepartments] = useState<Department[]>(SEED_DEPARTMENTS);
  const [stores, setStores] = useState<Store[]>(SEED_STORES);
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS.filter((p) => p.approvalStatus === 'approved'));
  const [coupons, setCoupons] = useState<Coupon[]>(SEED_COUPONS);
  const [reviews, setReviews] = useState<ProductReview[]>(SEED_REVIEWS);
  const [questions, setQuestions] = useState<ProductQuestion[]>(SEED_QUESTIONS);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(SEED_PLATFORM_CONFIG);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);

  // Customer, Seller, Admin states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [followedStoreIds, setFollowedStoreIds] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [entitlements, setEntitlements] = useState<DigitalEntitlement[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [sellerBalances, setSellerBalances] = useState<SellerBalances>(EMPTY_BALANCES);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [sellerApplications, setSellerApplications] = useState<SellerApplication[]>([]);
  const [demoCustomers, setDemoCustomers] = useState<DemoCustomerAccount[]>([]);
  const [demoActivityLogs, setDemoActivityLogs] = useState<DemoActivityLog[]>([]);

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const formatPrice = useCallback(
    (amountMinor: number, sourceCurrency: CurrencyCode = 'USD') => {
      const converted = convertMinorAmount(
        amountMinor,
        sourceCurrency,
        currency,
        platformConfig.exchangeRates
      );
      return formatMoney(converted, currency);
    },
    [currency, platformConfig.exchangeRates]
  );

  // Keep active currency aligned if administrator modifies supportedCurrencies
  useEffect(() => {
    const allowed = platformConfig.supportedCurrencies;
    if (allowed?.length && !allowed.includes(currency)) {
      setCurrency(allowed[0]);
    }
  }, [currency, platformConfig.supportedCurrencies]);

  // Boot: parse payment callback URL params, check Firestore connectivity & integration readiness
  useEffect(() => {
    try {
      const search = new URLSearchParams(window.location.search);
      const refParam = search.get('reference') || search.get('trxref') || search.get('tx_ref');
      const providerParam = search.get('provider');
      const isCallback = search.get('payment_callback') === '1' || Boolean(refParam);

      if (isCallback && refParam) {
        const inferredProvider: PaymentProviderId | null =
          providerParam === 'paystack' || providerParam === 'flutterwave'
            ? providerParam
            : refParam.toUpperCase().startsWith('FLW_')
            ? 'flutterwave'
            : refParam.toUpperCase().startsWith('PSK_')
            ? 'paystack'
            : null;

        if (inferredProvider) {
          setPendingPaymentCallback({
            provider: inferredProvider,
            reference: refParam,
            transactionId: search.get('transaction_id') || undefined,
            callbackStatus: search.get('status') || undefined,
          });
          setView('checkout');
          window.history.replaceState({}, '', '/');
        }
      }
    } catch {
      // Ignore malformed query string
    }

    testFirestoreConnection();
    fetch('/api/config/integrations')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setIntegrations(data);
      })
      .catch(() => {});
  }, []);

  // Load live public products from Firestore (merged cleanly with seeded catalog)
  const loadLivePublicCatalog = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'products'), where('approvalStatus', '==', 'approved'))
      );
      if (!snap.empty) {
        const remoteProducts: Product[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            sellerId: data.sellerId,
            storeId: data.storeId,
            storeName: data.brand || 'Verified Seller',
            storeVerified: true,
            departmentSlug: data.departmentSlug,
            categorySlug: data.categorySlug,
            productType: data.productType,
            title: data.title,
            slug: data.slug,
            description: data.description,
            brand: data.brand || '',
            currency: data.currency || 'USD',
            priceMinor: data.priceMinor,
            compareAtPriceMinor: data.compareAtPriceMinor,
            stockQty: data.stockQty,
            imageUrls: data.imageUrls || [],
            variations: [],
            badges: data.badges || [],
            isFlashDeal: Boolean(data.isFlashDeal),
            isFeatured: Boolean(data.isFeatured),
            approvalStatus: data.approvalStatus,
            ratingAvg: data.ratingAvg || 0,
            reviewCount: data.reviewCount || 0,
            salesCount: data.salesCount || 0,
            createdAt: new Date().toISOString(),
          };
        });
        const mergedMap = new Map(SEED_PRODUCTS.filter((p) => p.approvalStatus === 'approved').map((p) => [p.id, p]));
        for (const rp of remoteProducts) mergedMap.set(rp.id, rp);
        setProducts(Array.from(mergedMap.values()));
      }
    } catch {
      // Keep baseline catalog if Firestore rules or offline state occurs
    }
  }, []);

  useEffect(() => {
    if (!isDemoMode) {
      loadLivePublicCatalog();
    }
  }, [isDemoMode, loadLivePublicCatalog]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const pendingReg = pendingRegistrationRef.current;
          const resolvedDisplayName =
            (pendingReg && user.email?.toLowerCase() === pendingReg.email
              ? pendingReg.displayName
              : user.displayName?.trim()) || 'DevStore Customer';

          // Ensure public-safe user doc & private PII doc exist
          const userRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userRef);
          const isBootAdmin =
            user.email?.toLowerCase() === 'anthonyagughasi@gmail.com' && user.emailVerified;

          if (!snap.exists()) {
            try {
              await setDoc(userRef, {
                uid: user.uid,
                displayName: resolvedDisplayName,
                role: 'customer',
                accountStatus: 'active',
                avatarUrl: user.photoURL || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              await setDoc(doc(db, 'users', user.uid, 'private', 'info'), {
                ownerId: user.uid,
                email: user.email || '',
                phone: user.phoneNumber || '',
                defaultCurrency: 'USD',
                updatedAt: serverTimestamp(),
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`);
            }
            setLiveRole(isBootAdmin ? 'admin' : 'customer');
          } else {
            const data = snap.data();
            const roleVal = data.role as UserRole;
            if (
              pendingReg &&
              user.email?.toLowerCase() === pendingReg.email &&
              data.displayName !== pendingReg.displayName
            ) {
              try {
                await updateDoc(userRef, {
                  displayName: pendingReg.displayName,
                  updatedAt: serverTimestamp(),
                });
              } catch (err) {
                console.error('Display name sync warning:', err);
              }
            }
            setLiveRole(isBootAdmin ? 'admin' : roleVal || 'customer');
          }
        } catch (err) {
          console.error('Auth sync error:', err);
        }
      } else {
        setLiveRole('customer');
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Helper to hydrate full demo state from server response
  const applyDemoPayload = useCallback(
    (payload: { role: UserRole; namespaceId: string; state: any; sellerBalances: SellerBalances }) => {
      const s = payload.state;
      setDemoRole(payload.role);
      setDemoNamespaceId(payload.namespaceId);
      setDepartments(s.departments);
      setStores(s.stores);
      setProducts(s.products);
      setCoupons(s.coupons);
      setReviews(s.reviews);
      setQuestions(s.questions);
      setPlatformConfig(s.platformConfig);
      setCart(s.customerCart || []);
      setWishlist(s.customerWishlist || []);
      setFollowedStoreIds(s.followedStoreIds || []);
      setAddresses(s.customerAddresses || []);
      setOrders(s.orders || []);
      setEntitlements(s.entitlements || []);
      setDisputes(s.disputes || []);
      setSellerOrders(s.sellerOrders || []);
      setSellerBalances(payload.sellerBalances || EMPTY_BALANCES);
      setTransactions(s.transactions || []);
      setWithdrawals(s.withdrawals || []);
      setSellerApplications(s.sellerApplications || []);
      setDemoCustomers(s.customers || []);
      setDemoActivityLogs(s.activityLogs || []);
    },
    []
  );

  const clearDemoError = useCallback(() => setDemoError(null), []);

  const openDemoSelector = useCallback(() => {
    setDemoError(null);
    setAuthModalOpen(true);
  }, []);

  const captureDemoStateToken = useCallback((tokenCandidate?: string | null, res?: Response) => {
    const resolved = tokenCandidate || res?.headers.get('x-demo-state') || null;
    if (resolved) {
      demoStateTokenRef.current = resolved;
      try {
        sessionStorage.setItem(DEMO_STATE_STORAGE_KEY, resolved);
      } catch {
        // Ignore storage restrictions
      }
    }
  }, []);

  const demoFetch = useCallback(
    async (
      path: string,
      method = 'GET',
      body?: unknown,
      overrideToken?: string,
      overrideStateToken?: string | null
    ) => {
      const token = overrideToken || demoToken;
      if (!token) throw new Error('Preview session is not active.');

      const stateToken =
        overrideStateToken !== undefined
          ? overrideStateToken
          : demoStateTokenRef.current ||
            (() => {
              try {
                return sessionStorage.getItem(DEMO_STATE_STORAGE_KEY);
              } catch {
                return null;
              }
            })();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-demo-token': token,
      };
      if (stateToken) {
        headers['x-demo-state'] = stateToken;
      }

      const res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await parseApiResponse<Record<string, any>>(res, 'Demo request failed');
      captureDemoStateToken(data.demoStateToken, res);
      return data;
    },
    [captureDemoStateToken, demoToken]
  );

  const enterDemoMode = useCallback(
    async (targetRole: UserRole) => {
      if (demoSessionLockRef.current) return;
      demoSessionLockRef.current = true;
      setDemoLoading(true);
      setDemoError(null);
      try {
        const currentStateToken =
          demoStateTokenRef.current ||
          (() => {
            try {
              return sessionStorage.getItem(DEMO_STATE_STORAGE_KEY);
            } catch {
              return null;
            }
          })();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (currentStateToken && demoNamespaceId) {
          headers['x-demo-state'] = currentStateToken;
        }

        const res = await fetch('/api/demo/session', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            role: targetRole,
            existingNamespaceId: demoNamespaceId,
          }),
        });
        const sessionData = await parseApiResponse<{
          demoToken: string;
          demoStateToken?: string;
          namespaceId: string;
          role: UserRole;
        }>(res, 'Unable to start demo session');

        captureDemoStateToken(sessionData.demoStateToken, res);

        const statePayload = await demoFetch(
          '/api/demo/state',
          'GET',
          undefined,
          sessionData.demoToken,
          sessionData.demoStateToken || demoStateTokenRef.current
        );

        setDemoToken(sessionData.demoToken);
        setIsDemoMode(true);
        applyDemoPayload(
          statePayload as {
            role: UserRole;
            namespaceId: string;
            state: any;
            sellerBalances: SellerBalances;
          }
        );
        setAuthModalOpen(false);

        if (targetRole === 'seller') setView('seller');
        else if (targetRole === 'admin') setView('admin');
        else if (view === 'seller' || view === 'admin') setView('home');

        const demoLabel =
          targetRole === 'admin'
            ? 'Admin Demo'
            : targetRole === 'seller'
            ? 'Seller Demo'
            : 'Customer Demo';
        notify(`Entered ${demoLabel}. Exploring with sample store data.`, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start demo session.';
        setDemoError(message);
        notify(message, 'error');
      } finally {
        demoSessionLockRef.current = false;
        setDemoLoading(false);
      }
    },
    [applyDemoPayload, captureDemoStateToken, demoFetch, demoNamespaceId, notify, view]
  );

  const exitDemoMode = useCallback(() => {
    setIsDemoMode(false);
    setDemoToken(null);
    setDemoNamespaceId(null);
    setDemoError(null);
    demoStateTokenRef.current = null;
    try {
      sessionStorage.removeItem(DEMO_STATE_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions
    }
    setDemoRole('customer');
    setDepartments(SEED_DEPARTMENTS);
    setStores(SEED_STORES);
    setProducts(SEED_PRODUCTS.filter((p) => p.approvalStatus === 'approved'));
    setCoupons(SEED_COUPONS);
    setReviews(SEED_REVIEWS);
    setQuestions(SEED_QUESTIONS);
    setPlatformConfig(SEED_PLATFORM_CONFIG);
    setCart([]);
    setWishlist([]);
    setOrders([]);
    setSellerOrders([]);
    setEntitlements([]);
    setWithdrawals([]);
    setTransactions([]);
    setSellerApplications([]);
    setDisputes([]);
    setSellerBalances(EMPTY_BALANCES);
    setView('home');
    loadLivePublicCatalog();
    notify('Exited Demo Mode. Returned to storefront.', 'info');
  }, [loadLivePublicCatalog, notify]);

  const resetDemoData = useCallback(async () => {
    if (!isDemoMode) return;
    setDemoLoading(true);
    try {
      const payload = await demoFetch('/api/demo/reset', 'POST');
      applyDemoPayload(
        payload as {
          role: UserRole;
          namespaceId: string;
          state: any;
          sellerBalances: SellerBalances;
        }
      );
      notify('Demo store restored to initial sample data.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Reset failed.', 'error');
    } finally {
      setDemoLoading(false);
    }
  }, [applyDemoPayload, demoFetch, isDemoMode, notify]);

  const signInWithGoogle = useCallback(async () => {
    try {
      if (isDemoMode) {
        exitDemoMode();
      }
      await signInWithPopup(auth, googleAuthProvider);
      setAuthModalOpen(false);
      notify('Signed in with Google.', 'success');
    } catch (err) {
      const message = mapAuthErrorMessage(err, 'google');
      notify(message, 'error');
      throw new Error(message);
    }
  }, [exitDemoMode, isDemoMode, notify]);

  const registerWithEmailPassword = useCallback(
    async (fullName: string, email: string, password: string) => {
      const trimmedName = fullName.trim();
      const trimmedEmail = email.trim().toLowerCase();
      if (trimmedName.length < 2 || trimmedName.length > 100) {
        throw new Error('Please enter your full name (2 to 100 characters).');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long.');
      }

      if (isDemoMode) {
        exitDemoMode();
      }

      pendingRegistrationRef.current = { email: trimmedEmail, displayName: trimmedName };
      try {
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        await updateProfile(cred.user, { displayName: trimmedName });
        await cred.user.getIdToken(true);

        const userRef = doc(db, 'users', cred.user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: cred.user.uid,
            displayName: trimmedName,
            role: 'customer',
            accountStatus: 'active',
            avatarUrl: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'users', cred.user.uid, 'private', 'info'), {
            ownerId: cred.user.uid,
            email: trimmedEmail,
            phone: '',
            defaultCurrency: 'USD',
            updatedAt: serverTimestamp(),
          });
        } else if (snap.data().displayName !== trimmedName) {
          await updateDoc(userRef, {
            displayName: trimmedName,
            updatedAt: serverTimestamp(),
          });
        }

        setLiveRole('customer');
        setAuthModalOpen(false);
        notify(`Welcome to DevStore, ${trimmedName.split(' ')[0]}!`, 'success');
      } catch (err) {
        console.error('Account registration error:', err);
        const message = mapAuthErrorMessage(err, 'register');
        throw new Error(message);
      } finally {
        pendingRegistrationRef.current = null;
      }
    },
    [exitDemoMode, isDemoMode, notify]
  );

  const signInWithEmailPassword = useCallback(
    async (email: string, password: string) => {
      const trimmedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      if (!password) {
        throw new Error('Please enter your password.');
      }

      if (isDemoMode) {
        exitDemoMode();
      }

      try {
        const cred = await firebaseSignInWithEmailAndPassword(auth, trimmedEmail, password);
        await cred.user.getIdToken(true);
        setAuthModalOpen(false);
        notify('Signed in successfully.', 'success');
      } catch (err) {
        console.error('Email sign-in error:', err);
        const message = mapAuthErrorMessage(err, 'signin');
        throw new Error(message);
      }
    },
    [exitDemoMode, isDemoMode, notify]
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Please enter a valid email address.');
    }
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : '';
      // Never disclose whether an account exists for the supplied address
      if (code === 'auth/user-not-found') {
        return;
      }
      console.error('Password reset error:', err);
      throw new Error(mapAuthErrorMessage(err, 'reset'));
    }
  }, []);

  const signOutLive = useCallback(async () => {
    await signOut(auth);
    setView('home');
    notify('Signed out.', 'info');
  }, [notify]);

  const openProduct = useCallback((product: Product) => {
    setSelectedProductSlug(product.slug);
    setRecentlyViewedIds((prev) => [product.id, ...prev.filter((id) => id !== product.id)].slice(0, 6));
    setView('product');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const syncDemoCart = useCallback(
    async (nextCart: CartItem[]) => {
      setCart(nextCart);
      if (isDemoMode) {
        try {
          await demoFetch('/api/demo/cart', 'POST', { items: nextCart });
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Cart sync failed.', 'error');
        }
      }
    },
    [demoFetch, isDemoMode, notify]
  );

  const addToCart = useCallback(
    async (product: Product, quantity = 1, variation?: string, license?: LicenseType) => {
      const next = [...cart];
      const targetLicense = product.productType === 'digital' ? license || 'personal' : undefined;
      const existingIdx = next.findIndex(
        (i) =>
          i.productId === product.id &&
          i.selectedVariation === variation &&
          i.selectedLicense === targetLicense
      );
      if (existingIdx >= 0) {
        next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + quantity };
      } else {
        next.push({
          productId: product.id,
          quantity,
          selectedVariation: variation,
          selectedLicense: targetLicense,
        });
      }
      await syncDemoCart(next);
      notify(`Added "${product.title}" to cart.`, 'success');
    },
    [cart, notify, syncDemoCart]
  );

  const updateCartQuantity = useCallback(
    async (index: number, quantity: number) => {
      if (quantity <= 0) {
        const next = cart.filter((_, i) => i !== index);
        await syncDemoCart(next);
        return;
      }
      const next = cart.map((item, i) => (i === index ? { ...item, quantity } : item));
      await syncDemoCart(next);
    },
    [cart, syncDemoCart]
  );

  const removeFromCart = useCallback(
    async (index: number) => {
      const next = cart.filter((_, i) => i !== index);
      await syncDemoCart(next);
    },
    [cart, syncDemoCart]
  );

  const toggleWishlist = useCallback(
    async (productId: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/wishlist/toggle', 'POST', { productId });
        setWishlist(data.wishlist);
        notify(
          data.wishlist.includes(productId) ? 'Saved to wishlist.' : 'Removed from wishlist.',
          'info'
        );
        return;
      }
      setWishlist((prev) => {
        const exists = prev.includes(productId);
        const next = exists ? prev.filter((id) => id !== productId) : [...prev, productId];
        notify(exists ? 'Removed from wishlist.' : 'Saved to wishlist.', 'info');
        return next;
      });
    },
    [demoFetch, isDemoMode, notify]
  );

  const toggleFollowStore = useCallback(
    async (storeId: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/follow/toggle', 'POST', { storeId });
        setFollowedStoreIds(data.followedStoreIds);
        setStores(data.stores);
        notify('Updated followed stores.', 'info');
        return;
      }
      setFollowedStoreIds((prev) =>
        prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]
      );
      notify('Updated followed stores.', 'info');
    },
    [demoFetch, isDemoMode, notify]
  );

  const toggleCompare = useCallback(
    (productId: string) => {
      setCompareIds((prev) => {
        if (prev.includes(productId)) {
          return prev.filter((id) => id !== productId);
        }
        if (prev.length >= 3) {
          notify('Compare supports up to 3 products at once.', 'info');
          return [...prev.slice(1), productId];
        }
        notify('Added to comparison tray.', 'info');
        return [...prev, productId];
      });
    },
    [notify]
  );

  const addAddress = useCallback(
    async (addr: Omit<ShippingAddress, 'id' | 'isDefault'>) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/addresses', 'POST', addr);
        setAddresses(data.addresses);
        notify('Shipping address saved to demo profile.', 'success');
        return;
      }
      if (firebaseUser) {
        const addrId = `addr-${Date.now()}`;
        const ref = doc(db, 'users', firebaseUser.uid, 'addresses', addrId);
        try {
          await setDoc(ref, {
            ownerId: firebaseUser.uid,
            ...addr,
            isDefault: addresses.length === 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setAddresses((prev) => [
            ...prev,
            { id: addrId, ...addr, isDefault: prev.length === 0 },
          ]);
          notify('Shipping address saved.', 'success');
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${firebaseUser.uid}/addresses`);
        }
      } else {
        setAddresses((prev) => [
          ...prev,
          { id: `addr-${Date.now()}`, ...addr, isDefault: prev.length === 0 },
        ]);
      }
    },
    [addresses.length, demoFetch, firebaseUser, isDemoMode, notify]
  );

  const simulateDemoCheckout = useCallback(
    async (params: {
      provider: PaymentProviderId;
      outcome: 'success' | 'failed' | 'cancelled' | 'pending';
      couponCode?: string;
      shippingCity?: string;
      shippingCountry?: string;
      idempotencyKey?: string;
    }) => {
      const data = await demoFetch('/api/demo/payments/simulate', 'POST', {
        ...params,
        currency,
      });
      applyDemoPayload({
        role: demoRole,
        namespaceId: demoNamespaceId!,
        state: data.state,
        sellerBalances: data.sellerBalances,
      });
      return { order: data.order as Order, paymentStatus: data.paymentStatus as string };
    },
    [applyDemoPayload, currency, demoFetch, demoNamespaceId, demoRole]
  );

  const initializeLivePayment = useCallback(
    async (params: {
      provider: PaymentProviderId;
      amountMinor: number;
      orderId: string;
      idempotencyKey: string;
    }) => {
      const endpoint =
        params.provider === 'flutterwave'
          ? '/api/payments/flutterwave/initialize'
          : '/api/payments/paystack/initialize';
      const providerLabel = params.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';

      return fetchWithFirebaseAuth<
        Awaited<ReturnType<MarketplaceContextValue['initializeLivePayment']>>
      >({
        url: endpoint,
        authInstance: auth,
        buildBody: (activeUser) => ({
          amountMinor: params.amountMinor,
          orderId: params.orderId,
          idempotencyKey: params.idempotencyKey,
          currency,
          email: activeUser.email,
          customerName: activeUser.displayName || undefined,
          callbackUrl: window.location.origin,
        }),
        fallbackError: `${providerLabel} checkout is currently unavailable`,
        missingAuthMessage: 'Please sign in or create an account before proceeding to payment.',
      });
    },
    [currency]
  );

  const verifyLivePayment = useCallback(
    async (params: {
      provider: PaymentProviderId;
      reference: string;
      transactionId?: string;
      callbackStatus?: string;
    }) => {
      const endpoint =
        params.provider === 'flutterwave'
          ? '/api/payments/flutterwave/verify'
          : '/api/payments/paystack/verify';
      const providerLabel = params.provider === 'flutterwave' ? 'Flutterwave' : 'Paystack';

      return fetchWithFirebaseAuth<
        Awaited<ReturnType<MarketplaceContextValue['verifyLivePayment']>>
      >({
        url: endpoint,
        authInstance: auth,
        buildBody: () => ({
          reference: params.reference,
          transactionId: params.transactionId,
          callbackStatus: params.callbackStatus,
        }),
        fallbackError: `${providerLabel} payment confirmation could not be completed`,
        missingAuthMessage: 'Please sign in to confirm your payment status.',
      });
    },
    []
  );

  const submitLiveSellerApplication = useCallback(
    async (input: {
      businessName: string;
      countryCode: string;
      categoryFocus: string;
      description: string;
    }) => {
      if (!firebaseUser) {
        throw new Error('Please sign in to submit a seller application.');
      }
      const appId = `app-${Date.now()}`;
      try {
        await setDoc(doc(db, 'sellerApplications', appId), {
          applicantId: firebaseUser.uid,
          businessName: input.businessName,
          countryCode: input.countryCode,
          categoryFocus: input.categoryFocus,
          description: input.description,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        notify('Seller onboarding application submitted for review.', 'success');
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `sellerApplications/${appId}`);
      }
    },
    [firebaseUser, notify]
  );

  const downloadDigitalAsset = useCallback(
    async (entitlement: DigitalEntitlement) => {
      try {
        if (isDemoMode) {
          const data = await demoFetch('/api/demo/downloads/issue-token', 'POST', {
            entitlementId: entitlement.id,
          });
          const stateToken =
            demoStateTokenRef.current ||
            (() => {
              try {
                return sessionStorage.getItem(DEMO_STATE_STORAGE_KEY);
              } catch {
                return null;
              }
            })();
          const fileRes = await fetch(data.downloadUrl, {
            headers: stateToken ? { 'x-demo-state': stateToken } : undefined,
          });
          if (!fileRes.ok) {
            await parseApiResponse(fileRes, 'Download failed');
            throw new Error('Download failed.');
          }
          captureDemoStateToken(null, fileRes);
          const blob = await fileRes.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${entitlement.assetKey}.${entitlement.fileFormat.includes('PDF') ? 'md' : 'zip'}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);

          // Refresh demo state so downloadsUsed counter updates
          const refreshed = await demoFetch('/api/demo/state');
          applyDemoPayload(refreshed as {
            role: UserRole;
            namespaceId: string;
            state: any;
            sellerBalances: SellerBalances;
          });
          notify(`Downloaded ${entitlement.productTitle}.`, 'success');
          return;
        }

        const data = await fetchWithFirebaseAuth<{ downloadUrl: string }>({
          url: '/api/downloads/issue-token',
          authInstance: auth,
          buildBody: () => ({
            entitlementId: entitlement.id,
            assetKey: entitlement.assetKey,
            licenseType: entitlement.licenseType,
          }),
          fallbackError: 'Unable to start download',
          missingAuthMessage: 'Please sign in to access your digital downloads.',
        });
        const fileRes = await fetch(data.downloadUrl);
        if (!fileRes.ok) {
          await parseApiResponse(fileRes, 'Download is temporarily unavailable');
          throw new Error('Download is temporarily unavailable.');
        }
        const blob = await fileRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${entitlement.assetKey}.${entitlement.fileFormat.includes('PDF') ? 'md' : 'zip'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Download failed.', 'error');
      }
    },
    [applyDemoPayload, captureDemoStateToken, demoFetch, isDemoMode, notify]
  );

  const submitReview = useCallback(
    async (productId: string, rating: number, title: string, comment: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/reviews', 'POST', {
          productId,
          rating,
          title,
          comment,
        });
        setReviews(data.reviews);
        setProducts((prev) => prev.map((p) => (p.id === data.product.id ? data.product : p)));
        notify('Review published.', 'success');
        return;
      }
      notify('Sign in or enter Customer Demo to submit a review.', 'info');
    },
    [demoFetch, isDemoMode, notify]
  );

  const submitQuestion = useCallback(
    async (productId: string, question: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/questions', 'POST', { productId, question });
        setQuestions(data.questions);
        notify('Question posted to seller.', 'success');
      }
    },
    [demoFetch, isDemoMode, notify]
  );

  const answerQuestion = useCallback(
    async (questionId: string, answer: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/questions', 'POST', { questionId, answer });
        setQuestions(data.questions);
        notify('Seller reply published.', 'success');
      }
    },
    [demoFetch, isDemoMode, notify]
  );

  const openDispute = useCallback(
    async (sellerOrderId: string, reason: string, details: string) => {
      if (isDemoMode) {
        const data = await demoFetch('/api/demo/disputes', 'POST', {
          sellerOrderId,
          reason,
          details,
        });
        setDisputes(data.disputes);
        setSellerOrders(data.sellerOrders);
        notify('Return/refund dispute opened.', 'success');
      }
    },
    [demoFetch, isDemoMode, notify]
  );

  const createDemoProduct = useCallback(
    async (payload: Partial<Product>) => {
      const data = await demoFetch('/api/demo/seller/products', 'POST', payload);
      setProducts(data.products);
      notify('Product submitted for admin moderation.', 'success');
    },
    [demoFetch, notify]
  );

  const updateDemoProduct = useCallback(
    async (id: string, payload: Partial<Product>) => {
      const data = await demoFetch(`/api/demo/seller/products/${id}`, 'PATCH', payload);
      setProducts(data.products);
      notify('Product listing updated.', 'success');
    },
    [demoFetch, notify]
  );

  const deleteDemoProduct = useCallback(
    async (id: string) => {
      const data = await demoFetch(`/api/demo/seller/products/${id}`, 'DELETE');
      setProducts(data.products);
      notify('Demo product deleted.', 'info');
    },
    [demoFetch, notify]
  );

  const updateDemoSellerOrder = useCallback(
    async (
      sellerOrderId: string,
      status: SellerFulfilmentStatus,
      trackingNumber?: string,
      carrier?: string
    ) => {
      const data = await demoFetch(`/api/demo/seller/orders/${sellerOrderId}`, 'PATCH', {
        status,
        trackingNumber,
        carrier,
      });
      applyDemoPayload({
        role: demoRole,
        namespaceId: demoNamespaceId!,
        state: data.state,
        sellerBalances: data.sellerBalances,
      });
      notify(`Order updated to ${status}.`, 'success');
    },
    [applyDemoPayload, demoFetch, demoNamespaceId, demoRole, notify]
  );

  const requestDemoWithdrawal = useCallback(
    async (input: {
      amountMinor: number;
      bankName: string;
      accountNumberLast4: string;
      accountName: string;
    }) => {
      const data = await demoFetch('/api/demo/seller/withdrawals', 'POST', input);
      applyDemoPayload({
        role: demoRole,
        namespaceId: demoNamespaceId!,
        state: data.state,
        sellerBalances: data.sellerBalances,
      });
      notify('Withdrawal request submitted for admin approval.', 'success');
    },
    [applyDemoPayload, demoFetch, demoNamespaceId, demoRole, notify]
  );

  const updateDemoStore = useCallback(
    async (payload: Partial<Store>) => {
      const data = await demoFetch('/api/demo/seller/store', 'PATCH', payload);
      setStores(data.stores);
      notify('Store profile updated.', 'success');
    },
    [demoFetch, notify]
  );

  const updateDemoCustomerStatus = useCallback(
    async (customerId: string, status: 'active' | 'suspended') => {
      const data = await demoFetch(`/api/demo/admin/customers/${customerId}`, 'PATCH', { status });
      setDemoCustomers(data.customers);
      notify(`Customer account marked ${status}.`, 'info');
    },
    [demoFetch, notify]
  );

  const updateDemoSellerStatus = useCallback(
    async (storeId: string, payload: { status?: 'active' | 'suspended'; verified?: boolean }) => {
      const data = await demoFetch(`/api/demo/admin/sellers/${storeId}`, 'PATCH', payload);
      setStores(data.stores);
      notify('Seller store updated.', 'success');
    },
    [demoFetch, notify]
  );

  const reviewDemoApplication = useCallback(
    async (appId: string, status: 'approved' | 'rejected', reviewNote?: string) => {
      const data = await demoFetch(`/api/demo/admin/applications/${appId}`, 'PATCH', {
        status,
        reviewNote,
      });
      setSellerApplications(data.sellerApplications);
      setStores(data.stores);
      notify(`Seller application ${status}.`, 'success');
    },
    [demoFetch, notify]
  );

  const moderateDemoProduct = useCallback(
    async (
      productId: string,
      payload: { approvalStatus?: 'approved' | 'rejected'; isFeatured?: boolean }
    ) => {
      const data = await demoFetch(`/api/demo/admin/products/${productId}`, 'PATCH', payload);
      setProducts(data.products);
      notify('Product moderation saved.', 'success');
    },
    [demoFetch, notify]
  );

  const reviewDemoWithdrawal = useCallback(
    async (withdrawalId: string, status: 'approved' | 'rejected' | 'paid', adminNote?: string) => {
      const data = await demoFetch(`/api/demo/admin/withdrawals/${withdrawalId}`, 'PATCH', {
        status,
        adminNote,
      });
      setWithdrawals(data.withdrawals);
      setTransactions(data.transactions);
      setSellerBalances(data.sellerBalances);
      notify(`Withdrawal marked ${status}.`, 'success');
    },
    [demoFetch, notify]
  );

  const resolveDemoDispute = useCallback(
    async (
      disputeId: string,
      status: 'under_review' | 'resolved_refund' | 'resolved_closed',
      resolutionNote?: string
    ) => {
      const data = await demoFetch(`/api/demo/admin/disputes/${disputeId}`, 'PATCH', {
        status,
        resolutionNote,
      });
      setDisputes(data.disputes);
      setSellerOrders(data.sellerOrders);
      notify(`Dispute updated (${status}).`, 'success');
    },
    [demoFetch, notify]
  );

  const createDemoDepartment = useCallback(
    async (name: string, description: string, isDigital: boolean) => {
      const data = await demoFetch('/api/demo/admin/departments', 'POST', {
        name,
        description,
        isDigital,
      });
      setDepartments(data.departments);
      notify(`Created department "${name}".`, 'success');
    },
    [demoFetch, notify]
  );

  const updateDemoPlatformConfig = useCallback(
    async (payload: Partial<PlatformConfig>) => {
      const data = await demoFetch('/api/demo/admin/config', 'PATCH', payload);
      setPlatformConfig(data.platformConfig);
      notify('Marketplace configuration updated.', 'success');
    },
    [demoFetch, notify]
  );

  const createDemoCoupon = useCallback(
    async (code: string, discountPercent: number) => {
      const data = await demoFetch('/api/demo/admin/coupons', 'POST', { code, discountPercent });
      setCoupons(data.coupons);
      notify(`Coupon ${code.toUpperCase()} created.`, 'success');
    },
    [demoFetch, notify]
  );

  const value = useMemo<MarketplaceContextValue>(
    () => ({
      view,
      setView,
      selectedProductSlug,
      openProduct,
      selectedDepartmentSlug,
      setSelectedDepartmentSlug,
      searchQuery,
      setSearchQuery,
      currency,
      setCurrency,
      formatPrice,
      firebaseUser,
      authReady,
      liveRole,
      isDemoMode,
      demoRole,
      demoNamespaceId,
      demoLoading,
      demoError,
      clearDemoError,
      authModalOpen,
      setAuthModalOpen,
      openDemoSelector,
      cartDrawerOpen,
      setCartDrawerOpen,
      enterDemoMode,
      exitDemoMode,
      resetDemoData,
      signInWithGoogle,
      registerWithEmailPassword,
      signInWithEmailPassword,
      requestPasswordReset,
      signOutLive,
      departments,
      stores,
      products,
      coupons,
      reviews,
      questions,
      platformConfig,
      integrations,
      cart,
      wishlist,
      followedStoreIds,
      compareIds,
      recentlyViewedIds,
      addresses,
      orders,
      entitlements,
      disputes,
      sellerOrders,
      sellerBalances,
      transactions,
      withdrawals,
      sellerApplications,
      demoCustomers,
      demoActivityLogs,
      addToCart,
      updateCartQuantity,
      removeFromCart,
      toggleWishlist,
      toggleFollowStore,
      toggleCompare,
      addAddress,
      pendingPaymentCallback,
      clearPendingPaymentCallback,
      simulateDemoCheckout,
      initializeLivePayment,
      verifyLivePayment,
      submitLiveSellerApplication,
      downloadDigitalAsset,
      submitReview,
      submitQuestion,
      answerQuestion,
      openDispute,
      createDemoProduct,
      updateDemoProduct,
      deleteDemoProduct,
      updateDemoSellerOrder,
      requestDemoWithdrawal,
      updateDemoStore,
      updateDemoCustomerStatus,
      updateDemoSellerStatus,
      reviewDemoApplication,
      moderateDemoProduct,
      reviewDemoWithdrawal,
      resolveDemoDispute,
      createDemoDepartment,
      updateDemoPlatformConfig,
      createDemoCoupon,
      toasts,
      notify,
    }),
    [
      addresses,
      addAddress,
      addToCart,
      answerQuestion,
      authModalOpen,
      authReady,
      cart,
      cartDrawerOpen,
      clearDemoError,
      clearPendingPaymentCallback,
      compareIds,
      coupons,
      createDemoCoupon,
      createDemoDepartment,
      createDemoProduct,
      currency,
      deleteDemoProduct,
      demoActivityLogs,
      demoCustomers,
      demoError,
      demoLoading,
      demoNamespaceId,
      demoRole,
      departments,
      disputes,
      downloadDigitalAsset,
      enterDemoMode,
      entitlements,
      exitDemoMode,
      firebaseUser,
      followedStoreIds,
      formatPrice,
      initializeLivePayment,
      integrations,
      isDemoMode,
      liveRole,
      moderateDemoProduct,
      notify,
      openDemoSelector,
      openDispute,
      openProduct,
      orders,
      pendingPaymentCallback,
      platformConfig,
      products,
      questions,
      recentlyViewedIds,
      registerWithEmailPassword,
      removeFromCart,
      requestDemoWithdrawal,
      requestPasswordReset,
      resetDemoData,
      resolveDemoDispute,
      reviewDemoApplication,
      reviewDemoWithdrawal,
      reviews,
      searchQuery,
      selectedDepartmentSlug,
      selectedProductSlug,
      sellerApplications,
      sellerBalances,
      sellerOrders,
      signInWithEmailPassword,
      signInWithGoogle,
      signOutLive,
      simulateDemoCheckout,
      stores,
      submitLiveSellerApplication,
      submitQuestion,
      submitReview,
      toasts,
      toggleCompare,
      toggleFollowStore,
      toggleWishlist,
      transactions,
      updateCartQuantity,
      updateDemoCustomerStatus,
      updateDemoPlatformConfig,
      updateDemoProduct,
      updateDemoSellerOrder,
      updateDemoSellerStatus,
      updateDemoStore,
      verifyLivePayment,
      view,
      wishlist,
      withdrawals,
    ]
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) {
    throw new Error('useMarketplace must be used inside MarketplaceProvider');
  }
  return ctx;
}
