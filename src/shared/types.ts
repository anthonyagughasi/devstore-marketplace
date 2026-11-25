export type CurrencyCode = 'USD' | 'NGN' | 'GBP' | 'EUR';

export type UserRole = 'customer' | 'seller' | 'admin';
export type AccountStatus = 'active' | 'suspended';
export type ProductType = 'physical' | 'digital';
export type LicenseType = 'personal' | 'commercial' | 'extended';
export type PaymentProviderId = 'paystack' | 'flutterwave';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type SellerFulfilmentStatus =
  | 'pending'
  | 'accepted'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refund_requested'
  | 'refunded';

export type ProductApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface Department {
  id: string;
  name: string;
  slug: string;
  description: string;
  parentId?: string;
  isDigital: boolean;
  sortOrder: number;
  active: boolean;
}

export interface Store {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  logoUrl: string;
  bannerUrl: string;
  countryCode: string;
  policies: string;
  shippingSummary: string;
  verified: boolean;
  status: 'pending' | 'active' | 'suspended';
  ratingAvg: number;
  followerCount: number;
  createdAt: string;
}

export interface ProductVariation {
  name: string;
  options: string[];
}

export interface ProductDigitalMeta {
  version: string;
  liveDemoUrl?: string;
  docsUrl?: string;
  licensePricingMultiplier: Record<LicenseType, number>; // e.g., personal: 1, commercial: 2.5, extended: 5
  downloadLimit: number;
  downloadExpiryDays: number;
  assetKey: string;
  fileFormat: string;
  fileSizeLabel: string;
  changelog: string;
}

export interface Product {
  id: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  storeVerified: boolean;
  departmentSlug: string;
  categorySlug: string;
  productType: ProductType;
  title: string;
  slug: string;
  description: string;
  brand: string;
  currency: CurrencyCode;
  priceMinor: number;
  compareAtPriceMinor?: number;
  stockQty: number;
  imageUrls: string[];
  variations: ProductVariation[];
  badges: string[];
  isFlashDeal: boolean;
  isFeatured: boolean;
  approvalStatus: ProductApprovalStatus;
  ratingAvg: number;
  reviewCount: number;
  salesCount: number;
  digitalMeta?: ProductDigitalMeta;
  createdAt: string;
}

export interface ShippingAddress {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
}

export interface CartItem {
  productId: string;
  quantity: number;
  selectedVariation?: string;
  selectedLicense?: LicenseType;
}

export interface OrderItemSummary {
  productId: string;
  title: string;
  productType: ProductType;
  sellerId: string;
  storeId: string;
  storeName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  selectedVariation?: string;
  selectedLicense?: LicenseType;
  imageUrl: string;
}

export interface Order {
  id: string;
  customerId: string;
  currency: CurrencyCode;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  couponCode?: string;
  paymentProvider: PaymentProviderId;
  paymentReference: string;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  shippingCity?: string;
  shippingCountry?: string;
  items: OrderItemSummary[];
  createdAt: string;
}

export interface SellerOrder {
  id: string;
  parentOrderId: string;
  customerId: string;
  customerName: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  currency: CurrencyCode;
  grossMinor: number;
  commissionRateBps: number;
  commissionMinor: number;
  netEarningsMinor: number;
  fulfilmentStatus: SellerFulfilmentStatus;
  trackingNumber?: string;
  carrier?: string;
  items: OrderItemSummary[];
  createdAt: string;
}

export interface DigitalEntitlement {
  id: string;
  customerId: string;
  orderId: string;
  productId: string;
  productTitle: string;
  sellerId: string;
  storeName: string;
  licenseType: LicenseType;
  version: string;
  downloadsUsed: number;
  maxDownloads: number;
  expiresAt: string;
  assetKey: string;
  fileFormat: string;
  createdAt: string;
}

export interface LedgerTransaction {
  id: string;
  orderId?: string;
  sellerId?: string;
  userId: string;
  type: 'charge' | 'commission' | 'seller_credit' | 'refund' | 'withdrawal';
  provider: string;
  reference: string;
  currency: CurrencyCode;
  amountMinor: number;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  note: string;
  createdAt: string;
}

export interface WithdrawalRequest {
  id: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  currency: CurrencyCode;
  amountMinor: number;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  adminNote?: string;
  createdAt: string;
}

export interface ProductReview {
  id: string;
  productId: string;
  storeId: string;
  authorId: string;
  authorName: string;
  rating: number;
  title: string;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
}

export interface ProductQuestion {
  id: string;
  productId: string;
  storeId: string;
  authorId: string;
  authorName: string;
  question: string;
  answer?: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountPercent: number;
  active: boolean;
}

export interface Dispute {
  id: string;
  orderId: string;
  sellerOrderId: string;
  customerId: string;
  sellerId: string;
  reason: string;
  details: string;
  status: 'open' | 'under_review' | 'resolved_refund' | 'resolved_closed';
  resolutionNote?: string;
  createdAt: string;
}

export interface SellerApplication {
  id: string;
  applicantId: string;
  applicantName: string;
  businessName: string;
  countryCode: string;
  categoryFocus: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote?: string;
  createdAt: string;
}

export interface PlatformConfig {
  marketplaceName: string;
  defaultCurrency: CurrencyCode;
  supportedCurrencies: CurrencyCode[];
  exchangeRates: Record<CurrencyCode, number>;
  exchangeRateMode: 'manual' | 'external_api';
  exchangeRateUpdatedAt?: string;
  commissionRateBps: number; // e.g., 1000 = 10%
  paystackEnabled: boolean;
  flutterwaveEnabled: boolean;
  flashSaleBannerText: string;
}

export interface DemoActivityLog {
  id: string;
  role: UserRole;
  action: string;
  detail: string;
  createdAt: string;
}

export interface DemoCustomerAccount {
  id: string;
  name: string;
  email: string;
  countryCode: string;
  status: AccountStatus;
  ordersCount: number;
  totalSpentUsdMinor: number;
}
