import type { CurrencyCode, LicenseType } from './types.js';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
  minorUnitDecimals: number;
  // Configurable base exchange rates relative to 1 USD.
  // Production deployments can override these from an external FX provider via EXCHANGE_RATE_API_URL.
  unitsPerUsd: number;
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', minorUnitDecimals: 2, unitsPerUsd: 1 },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', minorUnitDecimals: 2, unitsPerUsd: 1580 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', minorUnitDecimals: 2, unitsPerUsd: 0.79 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', minorUnitDecimals: 2, unitsPerUsd: 0.92 },
};

/**
 * Validates configurable exchange rates (relative to 1 USD). Ensures USD=1 and all rates are finite > 0.
 */
export function validateExchangeRates(
  rates: Partial<Record<CurrencyCode, number>>
): Record<CurrencyCode, number> {
  const result: Record<CurrencyCode, number> = {
    USD: 1,
    NGN: SUPPORTED_CURRENCIES.NGN.unitsPerUsd,
    GBP: SUPPORTED_CURRENCIES.GBP.unitsPerUsd,
    EUR: SUPPORTED_CURRENCIES.EUR.unitsPerUsd,
  };
  for (const code of ['NGN', 'GBP', 'EUR'] as const) {
    const val = rates[code];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= 1_000_000) {
      result[code] = Number(val.toFixed(6));
    }
  }
  return result;
}

/**
 * Converts integer minor units from one currency to another using explicit configurable rates.
 * Never silently mutates persisted order currencies—used for display & checkout currency preparation.
 */
export function convertMinorAmount(
  amountMinor: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  customRates?: Partial<Record<CurrencyCode, number>>
): number {
  if (fromCurrency === toCurrency) return Math.round(amountMinor);
  const rawFrom = customRates?.[fromCurrency];
  const rawTo = customRates?.[toCurrency];
  const fromRate =
    typeof rawFrom === 'number' && Number.isFinite(rawFrom) && rawFrom > 0
      ? rawFrom
      : SUPPORTED_CURRENCIES[fromCurrency].unitsPerUsd;
  const toRate =
    typeof rawTo === 'number' && Number.isFinite(rawTo) && rawTo > 0
      ? rawTo
      : SUPPORTED_CURRENCIES[toCurrency].unitsPerUsd;
  const usdMinor = amountMinor / fromRate;
  return Math.round(usdMinor * toRate);
}

export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
  const cfg = SUPPORTED_CURRENCIES[currency];
  const major = amountMinor / Math.pow(10, cfg.minorUnitDecimals);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cfg.code,
    minimumFractionDigits: cfg.minorUnitDecimals,
    maximumFractionDigits: cfg.minorUnitDecimals,
  }).format(major);
}

/**
 * Precision-safe commission calculation using basis points (100 bps = 1%).
 * Ensures commissionMinor + netEarningsMinor === grossMinor with zero rounding leakage.
 */
export function calculateCommissionSplit(
  grossMinor: number,
  commissionRateBps: number
): { commissionMinor: number; netEarningsMinor: number } {
  const safeGross = Math.max(0, Math.round(grossMinor));
  const safeBps = Math.min(5000, Math.max(0, Math.round(commissionRateBps)));
  const commissionMinor = Math.round((safeGross * safeBps) / 10000);
  const netEarningsMinor = safeGross - commissionMinor;
  return { commissionMinor, netEarningsMinor };
}

export function getLicenseUnitPriceMinor(
  basePriceMinor: number,
  licenseType: LicenseType | undefined,
  multipliers?: Record<LicenseType, number>
): number {
  if (!licenseType || licenseType === 'personal') return basePriceMinor;
  const factor =
    multipliers?.[licenseType] ?? (licenseType === 'commercial' ? 2.5 : 4.5);
  return Math.round(basePriceMinor * factor);
}
