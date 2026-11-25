import { signHmacToken, verifyHmacToken } from '../security.ts';
import { LocalDevStorageAdapter } from './localStorage.ts';
import { S3CompatibleStorageAdapter } from './s3Storage.ts';
import type { StorageProviderAdapter, StorageProviderMode, StoredObjectResult } from './types.ts';

interface DownloadTokenPayload {
  entitlementId: string;
  assetKey: string;
  licenseType: string;
  isDemo: boolean;
  namespaceId: string;
  exp: number;
}

interface SampleAssetManifest {
  filename: string;
  contentType: string;
  content: string;
}

const SAMPLE_ASSETS: Record<string, SampleAssetManifest> = {
  'meridian-saas-ui-kit-v3.4.0': {
    filename: 'meridian-saas-ui-kit-v3.4.0-package.json',
    contentType: 'application/json; charset=utf-8',
    content: JSON.stringify(
      {
        name: 'meridian-saas-ui-kit',
        version: '3.4.0',
        licenseNotice: 'Licensed via DevStore Digital Marketplace',
        includedModules: [
          'tokens/tailwind-v4.css',
          'components/DataGrid.tsx',
          'components/CheckoutDrawer.tsx',
          'figma/Meridian_Design_System_v3.4.fig',
        ],
        docsUrl: 'https://docs.devstore.example.com/meridian',
      },
      null,
      2
    ),
  },
  'architect-icon-pack-v2.1.0': {
    filename: 'architect-icon-pack-v2.1.0-manifest.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <rect width="240" height="120" rx="12" fill="#0f172a"/>
  <rect x="24" y="24" width="44" height="44" rx="8" fill="#2563eb"/>
  <rect x="84" y="24" width="44" height="44" rx="8" fill="#1e293b" stroke="#475569"/>
  <circle cx="176" cy="46" r="22" fill="#f8fafc"/>
  <text x="24" y="98" fill="#cbd5e1" font-family="monospace" font-size="11">ARCHITECT ICON PACK v2.1.0</text>
</svg>`,
  },
  'distributed-commerce-handbook-v2': {
    filename: 'distributed-commerce-handbook-v2-excerpt.md',
    contentType: 'text/markdown; charset=utf-8',
    content: `# Distributed Commerce Architecture Handbook (2nd Edition)

## Chapter 4: Multi-Vendor Order Splitting & Idempotent Ledgers

1. Always persist monetary amounts in integer minor units (cents/kobo/pence).
2. Separate customer-facing parent orders from seller-specific fulfilment orders.
3. Verify payment provider webhooks using timing-safe HMAC signatures before granting digital entitlements.
4. Enforce idempotency keys across webhook replays and checkout retries.
`,
  },
  'velox-checkout-starter-v1.8.2': {
    filename: 'velox-checkout-starter-v1.8.2-readme.md',
    contentType: 'text/markdown; charset=utf-8',
    content: `# Velox Multi-Currency Checkout & Ledger Starter v1.8.2

Includes:
- Paystack & Flutterwave server adapters
- Multi-currency minor-unit converter (USD, NGN, GBP, EUR)
- Idempotent webhook processor & Vitest integration suite
`,
  },
};

const s3Adapter = new S3CompatibleStorageAdapter();
const localDevAdapter = new LocalDevStorageAdapter();

export function getActiveStorageAdapter(): StorageProviderAdapter | null {
  const explicit = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === 's3') {
    return s3Adapter;
  }
  if (explicit === 'local') {
    return localDevAdapter;
  }
  if (s3Adapter.isConfigured()) {
    return s3Adapter;
  }
  if (localDevAdapter.isConfigured()) {
    return localDevAdapter;
  }
  return null;
}

export function getStorageStatus(): {
  mode: StorageProviderMode;
  configured: boolean;
  optional: boolean;
  providerLabel: string;
  missingEnvVars: string[];
  vercelCompatible: boolean;
} {
  const active = getActiveStorageAdapter();
  if (active?.mode === 's3') {
    const ok = active.isConfigured();
    return {
      mode: 's3',
      configured: ok,
      optional: true,
      providerLabel: 'S3-Compatible Private Object Storage',
      missingEnvVars: active.getMissingEnvVars(),
      vercelCompatible: true,
    };
  }
  if (active?.mode === 'local_dev') {
    return {
      mode: 'local_dev',
      configured: true,
      optional: true,
      providerLabel: 'Local Development Private Disk (./private_assets)',
      missingEnvVars: s3Adapter.getMissingEnvVars(),
      vercelCompatible: true,
    };
  }
  return {
    mode: 'unconfigured_serverless',
    configured: false,
    optional: true,
    providerLabel: 'Sample Digital Vault (Attach S3/R2 for live vendor uploads)',
    missingEnvVars: s3Adapter.getMissingEnvVars(),
    vercelCompatible: true,
  };
}

/**
 * Seeds sample assets into local dev storage ONLY when running in local dev mode.
 * Never requires local disk writes in serverless/Vercel production environments.
 */
export function ensurePrivateSampleAssets(): void {
  if (!localDevAdapter.isConfigured()) return;
  for (const [assetKey, manifest] of Object.entries(SAMPLE_ASSETS)) {
    void localDevAdapter.putObject(assetKey, Buffer.from(manifest.content, 'utf8'));
  }
}

export function issueSignedDownloadToken(params: {
  entitlementId: string;
  assetKey: string;
  licenseType: string;
  isDemo: boolean;
  namespaceId: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: string; presignedS3Url?: string | null } {
  const ttlSeconds = params.ttlSeconds ?? 300;
  const exp = Date.now() + ttlSeconds * 1000;
  const token = signHmacToken({
    entitlementId: params.entitlementId,
    assetKey: params.assetKey,
    licenseType: params.licenseType,
    isDemo: params.isDemo,
    namespaceId: params.namespaceId,
    exp,
  } satisfies DownloadTokenPayload);

  let presignedS3Url: string | null = null;
  if (!params.isDemo && s3Adapter.isConfigured()) {
    const manifest = SAMPLE_ASSETS[params.assetKey];
    presignedS3Url = s3Adapter.createPresignedDownloadUrl(
      params.assetKey,
      ttlSeconds,
      manifest?.filename
    );
  }

  return {
    token,
    expiresAt: new Date(exp).toISOString(),
    presignedS3Url,
  };
}

export function verifySignedDownloadToken(token: string): DownloadTokenPayload | null {
  return verifyHmacToken<DownloadTokenPayload>(token);
}

export async function readPrivateAssetForDownload(
  assetKey: string,
  options?: { isDemo?: boolean }
): Promise<StoredObjectResult | null> {
  const manifest = SAMPLE_ASSETS[assetKey];
  const fallbackKey = manifest ? assetKey : 'velox-checkout-starter-v1.8.2';
  const resolvedMeta = SAMPLE_ASSETS[fallbackKey];

  // For live production downloads, consult S3-compatible storage first if configured
  if (!options?.isDemo && s3Adapter.isConfigured()) {
    const s3Object = await s3Adapter.readObject(assetKey, {
      filename: resolvedMeta.filename,
      contentType: resolvedMeta.contentType,
    });
    if (s3Object) return s3Object;
  }

  // In local dev, attempt reading from ./private_assets
  if (localDevAdapter.isConfigured()) {
    ensurePrivateSampleAssets();
    const localObj = await localDevAdapter.readObject(fallbackKey, {
      filename: resolvedMeta.filename,
      contentType: resolvedMeta.contentType,
    });
    if (localObj) return localObj;
  }

  // Safe bundled sample fallback for demo assets & preview mode (never exposes filesystem paths)
  return {
    filename: resolvedMeta.filename,
    contentType: resolvedMeta.contentType,
    buffer: Buffer.from(resolvedMeta.content, 'utf8'),
  };
}
