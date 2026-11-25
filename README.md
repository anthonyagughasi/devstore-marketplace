# DevStore — International Multi-Vendor Physical & Digital Marketplace

**DevStore** is an international, multi-vendor e-commerce platform built for both physical goods and licensed digital products (UI kits, Next.js templates, React components, Figma resources, software, and engineering handbooks). It includes dedicated workflows for **Customers**, **Sellers**, and **Administrators**, multi-currency pricing (`USD`, `NGN`, `GBP`, `EUR`), server-verified **Paystack** & **Flutterwave** payment adapters, time-limited signed digital downloads, and an **isolated Demo Mode** so visitors can explore every role without creating an account.

---

## Table of Contents
1. [What DevStore Is](#1-what-devstore-is)
2. [Technology Stack](#2-technology-stack)
3. [Project Architecture](#3-project-architecture)
4. [Installation](#4-installation)
5. [Environment Variables](#5-environment-variables)
6. [Database Setup](#6-database-setup)
7. [Authentication Setup](#7-authentication-setup)
8. [Payment Integration](#8-payment-integration)
9. [Storage Configuration](#9-storage-configuration)
10. [Email Configuration](#10-email-configuration)
11. [Demo Mode](#11-demo-mode)
12. [Running Locally](#12-running-locally)
13. [Running Tests](#13-running-tests)
14. [Deploying to Vercel & GitHub Sync](#14-deploying-to-vercel--github-sync)
15. [API Documentation](#15-api-documentation)
16. [Phased Implementation Checklist](#16-phased-implementation-checklist)

---

## 1. What DevStore Is
DevStore unifies two marketplace experiences in one storefront:
- **Physical Goods Marketplace**: Hardware, studio workstations, audio gear, mechanical keyboards, apparel, home/living, and multi-seller international checkout with shipping addresses, carrier tracking, and delivery settlement.
- **Dedicated Digital Products Department**: Separate landing experience (`/digital`) covering 17 digital categories (website templates, WordPress themes/plugins, Next.js starters, React components, UI kits, Figma resources, graphics, icons, illustrations, software, source code, snippets, e-books, guides, educational resources, digital tools) with **Personal / Commercial / Extended** licensing tiers, version changelogs, download limits, expiry windows, and signed download links.
- **Multi-Vendor Order & Ledger Engine**: Customers can check out items from multiple vendors in a single transaction. DevStore creates one parent customer order (`orders`) and separate vendor-specific fulfilment orders (`sellerOrders`) with integer minor-unit calculations (`USD` cents, `NGN` kobo, etc.) and basis-point platform commission splits.

---

## 2. Technology Stack
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons
- **Backend / API**: Node.js + Express (`server.ts` + `src/server/app.ts` + Vercel adapter `api/index.ts`)
- **Database & Security Rules**: Firebase Firestore (`ai-studio-13f0634e-ea7d-4bdb-b482-eb98f0bb03ec`) with normalized 22-entity schema (`firebase-blueprint.json`) and hardened, ESLint-validated `firestore.rules`
- **Authentication**: Firebase Authentication (Email/Password + Google OAuth) verified server-side via `firebase-admin` (`verifyIdToken`)
- **Payments**: Provider adapter pattern for **Paystack** (HMAC-SHA512 webhooks) and **Flutterwave** (`verif-hash` webhooks)
- **Email**: Configurable **Resend** HTTP API adapter (`RESEND_API_KEY`)
- **Testing**: Vitest (`tests/marketplace.test.ts`) + `@firebase/eslint-plugin-security-rules`

> **Stack Note (Environment Adaptation)**: The original specification preferred Next.js + PostgreSQL (Cloud SQL). Cloud SQL provisioning reached project quota (`DEVELOPER_EDITION_QUOTA_PER_PROJECT_EXHAUSTED`), so DevStore runs on **React + Vite + Express + Firebase Firestore/Auth**, maintaining full multi-vendor relational isolation, normalized Firestore entities, and Vercel serverless compatibility.

---

## 3. Project Architecture
```text
├── api/index.ts                     # Vercel serverless function entrypoint
├── server.ts                        # Local / standalone Express + Vite server (port 3000)
├── vercel.json                      # Vercel API rewrites + SPA routing
├── firebase-applet-config.json      # Firebase Web SDK configuration
├── firebase-blueprint.json          # 22-entity normalized Firestore schema blueprint
├── firestore.rules                  # Hardened Firestore security rules (ESLint verified)
├── eslint.config.mjs                # Security rules linter config
├── security_spec.md                 # Security invariants & adversarial test matrix
├── src/
│   ├── shared/
│   │   ├── types.ts                 # Shared domain types (orders, products, ledgers, demo)
│   │   ├── currency.ts              # Minor-unit arithmetic, FX conversion, bps commission splits
│   │   └── catalogData.ts           # Seeded departments, stores, products, coupons, demo state
│   ├── server/
│   │   ├── app.ts                   # Express routes, SEO endpoints, webhooks, demo API
│   │   ├── security.ts              # HMAC tokens, Firebase verifyIdToken, rate limiter, path guards
│   │   ├── demo/demoEngine.ts       # Isolated namespace-keyed demo sandbox engine
│   │   ├── payments/                # Paystack, Flutterwave, split builder & idempotency ledger
│   │   ├── storage/privateDownloads.ts # Private storage + time-limited download token signer
│   │   └── email/resendAdapter.ts   # Resend transactional email adapter (blocked in demo)
│   ├── lib/firebase.ts              # Firebase Web SDK initialization & connection probe
│   ├── context/MarketplaceContext.tsx # Unified live (Firestore) + isolated demo state provider
│   └── components/                  # Storefront, Digital Hub, Checkout, Customer/Seller/Admin portals
└── tests/marketplace.test.ts        # Automated Vitest suite
```

---

## 4. Installation
```bash
npm install
```
Prerequisites:
- Node.js `20.x` or `22.x`
- npm `10.x`+

---

## 5. Environment Variables
Copy `.env.example` to `.env` (never commit `.env` or real secrets):
```bash
cp .env.example .env
```

| Variable | Required For | Description |
| :--- | :--- | :--- |
| `APP_URL` | SEO / Callbacks | Public base URL (e.g. `https://devstore.vercel.app`) |
| `SESSION_SIGNING_SECRET` | Demo & Downloads | Random 32+ byte secret for HMAC-SHA256 demo & download tokens (ephemeral fallback locally) |
| `PAYSTACK_PUBLIC_KEY` | Live Paystack (Optional for Demo) | Paystack public key (`pk_test_...` / `pk_live_...`) |
| `PAYSTACK_SECRET_KEY` | Live Paystack (Optional for Demo) | Server-only secret key (`sk_test_...` / `sk_live_...`) |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack Webhooks | HMAC-SHA512 secret for `/api/webhooks/paystack` |
| `FLUTTERWAVE_PUBLIC_KEY` | Live Flutterwave (Optional for Demo) | Flutterwave public key |
| `FLUTTERWAVE_SECRET_KEY` | Live Flutterwave (Optional for Demo) | Server-only Flutterwave secret key |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Flutterwave Webhooks | Secret hash verified against `verif-hash` header |
| `RESEND_API_KEY` | Transactional Email *(Optional)* | Leave blank to disable external email gracefully while keeping templates & dev previews |
| `EMAIL_FROM` | Transactional Email *(Optional)* | Verified sender address (e.g. `DevStore <no-reply@yourdomain.com>`) |
| `EXCHANGE_RATE_API_URL` | External FX Feed *(Optional)* | Leave blank to use admin-configurable manual exchange rates |
| `EXCHANGE_RATE_API_KEY` | External FX Feed *(Optional)* | Optional Bearer key for external FX feed |
| `STORAGE_PROVIDER` | Digital Storage *(Optional)* | `auto` (default), `local`, or `s3` |
| `PRIVATE_STORAGE_DIR` | Local Dev Storage *(Optional)* | Local folder outside `public/` (dev only; defaults to `./private_assets`) |
| `S3_BUCKET` | Private S3/R2 Storage *(Optional)* | Private bucket name for production digital assets |
| `S3_REGION` | Private S3/R2 Storage *(Optional)* | Bucket region (e.g., `auto`, `us-east-1`) |
| `S3_ENDPOINT` | Private S3/R2 Storage *(Optional)* | S3-compatible endpoint (e.g., Cloudflare R2 / Spaces / S3 URL) |
| `S3_ACCESS_KEY_ID` | Private S3/R2 Storage *(Optional)* | Server-only S3 access key |
| `S3_SECRET_ACCESS_KEY` | Private S3/R2 Storage *(Optional)* | Server-only S3 secret key |
| `S3_FORCE_PATH_STYLE` | Private S3/R2 Storage *(Optional)* | Set `true` for R2 / MinIO / custom S3 endpoints |

---

## 6. Database Setup
DevStore uses **Firebase Firestore** configured via `firebase-applet-config.json` and governed by `firestore.rules` + `firebase-blueprint.json`:
1. The schema defines 22 normalized collections: `admins`, `users`, `users/{uid}/private`, `addresses`, `wishlist`, `notifications`, `followedSellers`, `stores`, `sellerApplications`, `departments`, `products`, `orders`, `sellerOrders`, `digitalEntitlements`, `transactions`, `withdrawals`, `reviews`, `productQuestions`, `coupons`, `disputes`, `platformConfig`, and `auditLogs`.
2. **Validate & deploy security rules** whenever `firestore.rules` is updated:
   ```bash
   npm run lint:rules
   firebase deploy --only firestore:rules
   ```
3. **Production Backend Note**: When deploying on your own Firebase/Google Cloud project, grant the server service account `roles/datastore.user` if you expand `src/server/app.ts` to write verified webhook order updates directly via `firebase-admin` Firestore. On restricted starter projects where Admin IAM is unavailable, client-side verified Firestore writes obey `firestore.rules`.

---

## 7. Authentication Setup
- Production accounts use **Firebase Authentication** (Email/Password + Google OAuth).
- Backend production routes (`requireProductionAuth`) validate Firebase ID tokens with `adminAuth.verifyIdToken(token)` and explicitly reject any `x-demo-token` or demo Bearer token (`403 Forbidden`).
- If deploying to a custom domain or Vercel URL, add your domain under **Firebase Console -> Authentication -> Settings -> Authorized domains** so Google OAuth popups succeed.

---

## 8. Payment Integration & Webhook Configuration
DevStore separates checkout orchestration from provider specifics via `PaymentProviderAdapter`:
- **Paystack** (`src/server/payments/paystack.ts`): Uses minor units (`kobo`/`cents`), initializes via `https://api.paystack.co/transaction/initialize`, verifies via `/transaction/verify/:reference`, and validates webhooks via timing-safe `HMAC-SHA512` on the raw request body (`x-paystack-signature`).
- **Flutterwave** (`src/server/payments/flutterwave.ts`): Converts minor units to major decimals for `/v3/payments`, verifies transactions server-side, and validates webhooks via timing-safe comparison against `verif-hash`.
- **Idempotency & Server-to-Server Re-Verification**: Both `/api/webhooks/paystack` and `/api/webhooks/flutterwave` capture raw payloads across both local Express and Vercel serverless runtimes, deduplicate events via `IdempotencyRegistry`, and verify transactions against the provider's verify API when gateway secrets are configured.

### Configuring Webhook URLs After Deploying to Vercel
You do **not** need webhook URLs during local development. Once deployed to Vercel (for example, `https://devstore.vercel.app`):
1. **Paystack**:
   - Open **Paystack Dashboard → Settings → API Keys & Webhooks**.
   - Set **Webhook URL** to:
     `https://<your-vercel-domain>/api/webhooks/paystack`
   - Copy your Test/Live keys and Webhook Secret into Vercel Environment Variables (`PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`).
2. **Flutterwave**:
   - Open **Flutterwave Dashboard → Settings → Webhooks**.
   - Set **URL** to:
     `https://<your-vercel-domain>/api/webhooks/flutterwave`
   - Choose a strong **Secret Hash**, save it as `FLUTTERWAVE_WEBHOOK_SECRET` in Vercel Environment Variables (alongside `FLUTTERWAVE_PUBLIC_KEY` and `FLUTTERWAVE_SECRET_KEY`), and redeploy.

---

## 9. Storage Configuration (Modular & Optional for Development)
- Digital product files are **never** stored inside `public/` or `dist/`.
- `src/server/storage/` uses a modular `StorageProviderAdapter` architecture:
  - **Local Development (`LocalDevStorageAdapter`)**: Used automatically in local development (`./private_assets`). Not required as a production dependency.
  - **Private S3-Compatible Storage (`S3CompatibleStorageAdapter`)**: Native AWS SigV4 adapter supporting AWS S3, Cloudflare R2, MinIO, and DigitalOcean Spaces. Generates time-limited SigV4 presigned download URLs or server-authorized streams.
- **Required Env Vars When Enabling Production S3/R2 Storage**:
  - `STORAGE_PROVIDER=s3`
  - `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`

---

## 10. Email & Currency Configuration (Optional)
- **Email (`src/server/email/resendAdapter.ts`)**: `RESEND_API_KEY` and `EMAIL_FROM` are completely optional. When unconfigured, DevStore disables external delivery gracefully (`sent: false`, `status: 'disabled_unconfigured'`), retains all 12 templates, and captures **development-only notification previews** (`/api/dev/email-previews`) without ever falsely claiming delivery. Password recovery works via Firebase Auth's built-in recovery flow (`sendPasswordResetEmail`) or Google Account recovery.
- **Currency (`src/shared/currency.ts`, `/api/currency/rates`)**: `EXCHANGE_RATE_API_URL` is optional. Administrators can enable/disable currencies (`USD`, `NGN`, `GBP`, `EUR`) and configure manual exchange rates directly from **Admin Console → Config & Audit Logs**, while historical orders always preserve their original transaction currency.

---

## 11. Demo Mode
DevStore includes an isolated **Demo Mode Sandbox**:
- Select **Customer Demo**, **Seller Demo**, or **Admin Demo** from the header ("Explore Demo") or Sign-In modal ("Enter Demo Mode") without registering.
- **Architecture & Isolation**:
  - Server issues an HMAC-signed `demoToken` containing `{ isDemo: true, role, namespaceId, exp }`.
  - State lives in isolated namespace sandboxes inside `demoEngine`—never writing to Firestore, never hitting Paystack/Flutterwave APIs, and never sending emails.
  - Production endpoints reject demo tokens with `403`.
  - Supports **Simulated Payments** (`success`, `failed`, `cancelled`, `pending`), seller product CRUD, inventory updates, balance/withdrawal enforcement, admin moderation, commission reconfiguration, and **Reset Demo**.
- **Vercel Serverless Note**: `demoEngine` uses in-memory `Map` namespaces per serverless instance. For cross-instance sticky demo state under heavy concurrent Vercel scaling, back `DemoEngine` with **Upstash Redis** (`UPSTASH_REDIS_REST_URL`).

---

## 12. Running Locally
```bash
npm run dev
```
Starts Express + Vite middleware on `http://localhost:3000`.

For a production build & start:
```bash
npm run build
npm start
```

---

## 13. Running Tests
Run the full automated test suite (currency, multi-vendor splitting, webhooks, RBAC, demo isolation, withdrawals, signed downloads):
```bash
npm test
```
Lint TypeScript & Firestore security rules:
```bash
npm run lint
npm run lint:rules
```

---

## 14. Deploying to Vercel & GitHub Sync
1. **Sync to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "feat: initial DevStore multi-vendor marketplace"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. **Deploy on Vercel**:
   - Import your GitHub repository in the Vercel Dashboard.
   - Framework preset: **Vite** (custom `vercel.json` is already configured to route `/api/*`, `/robots.txt`, and `/sitemap.xml` to `/api/index.ts`).
   - Add environment variables (`SESSION_SIGNING_SECRET`, `APP_URL`, `PAYSTACK_*`, `FLUTTERWAVE_*`, `RESEND_API_KEY`, `EMAIL_FROM`) in **Vercel Project -> Settings -> Environment Variables**.
   - Add your `.vercel.app` domain to **Firebase Authentication -> Authorized domains**.
   - Deploy!

---

## 15. API Documentation
### Public & Health
- `GET /api/health` — Service health check.
- `GET /api/config/integrations` — Safe readiness flags for Paystack, Flutterwave, and Resend (never exposes secrets).
- `GET /robots.txt` & `GET /sitemap.xml` — Dynamic SEO directives & approved product URLs.

### Production Endpoints (Require Firebase ID Token; reject `x-demo-token` with `403`)
- `POST /api/payments/paystack/initialize` — Server-side Paystack transaction initialization (`/transaction/initialize`) with Paystack-scoped idempotency.
- `POST /api/payments/paystack/verify` — Server-side Paystack verification (`/transaction/verify/:reference`) with cross-provider ownership checks.
- `POST /api/payments/flutterwave/initialize` — Server-side Flutterwave hosted checkout initialization (`/v3/payments` returning `data.link`) with Flutterwave-scoped idempotency.
- `POST /api/payments/flutterwave/verify` — Server-side Flutterwave transaction verification (`/v3/transactions/:id/verify`) with cross-provider ownership checks.
- `GET /api/payments/transactions/:reference` — Authenticated lookup of server-verified transaction and order status.
- `POST /api/email/send` — Triggers Resend transactional email when configured (returns `sent: false` gracefully if unconfigured).
- `POST /api/downloads/issue-token` — Issues short-lived signed download URL for verified entitlements.
- `GET /api/downloads/file/:token` — Streams private digital asset after verifying HMAC signature, expiry, and download quota.

### Payment Webhooks
- `POST /api/webhooks/paystack` — Validates `x-paystack-signature` (HMAC-SHA512) and deduplicates events.
- `POST /api/webhooks/flutterwave` — Validates `verif-hash` and deduplicates events.

### Isolated Demo Endpoints (`x-demo-token` required)
- `POST /api/demo/session` — Creates or switches role (`customer` | `seller` | `admin`) in an isolated namespace.
- `GET /api/demo/state` — Returns full isolated sandbox state + computed seller balances.
- `POST /api/demo/reset` — Restores sandbox namespace to clean seeded state.
- `POST /api/demo/cart`, `/api/demo/wishlist/toggle`, `/api/demo/follow/toggle`, `/api/demo/addresses`, `/api/demo/reviews`, `/api/demo/questions`, `/api/demo/disputes`
- `POST /api/demo/payments/simulate` — Simulates `success`, `failed`, `cancelled`, or `pending` checkouts (`customer` role).
- `POST /api/demo/downloads/issue-token` — Issues signed demo download token (`customer` role).
- `POST /api/demo/seller/products`, `PATCH /api/demo/seller/products/:id`, `DELETE /api/demo/seller/products/:id` (`seller` role)
- `PATCH /api/demo/seller/orders/:id`, `POST /api/demo/seller/withdrawals`, `PATCH /api/demo/seller/store` (`seller` role)
- `PATCH /api/demo/admin/customers/:id`, `PATCH /api/demo/admin/sellers/:id`, `PATCH /api/demo/admin/applications/:id`, `PATCH /api/demo/admin/products/:id`, `PATCH /api/demo/admin/withdrawals/:id`, `PATCH /api/demo/admin/disputes/:id`, `POST /api/demo/admin/departments`, `PATCH /api/demo/admin/config`, `POST /api/demo/admin/coupons` (`admin` role)

---

## 16. Phased Implementation Checklist
- [x] **Phase 1 — Foundation**: Project structure, design system (`Plus Jakarta Sans` + `DM Sans` + `JetBrains Mono`), 22-entity Firestore schema & security rules, Firebase Auth, RBAC, storefront & navigation.
- [x] **Phase 2 — Shopping**: Product detail pages, variations, cart drawer, wishlist, product comparison, multi-address shipping, checkout, parent & vendor order records.
- [x] **Phase 3 — Seller**: Store onboarding, seller dashboard, product CRUD, inventory management, order fulfilment & tracking, revenue analytics.
- [x] **Phase 4 — Digital Marketplace**: Dedicated `/digital` department, 17 subcategories, Personal/Commercial/Extended licensing, signed time-limited downloads, download library.
- [x] **Phase 5 — Finance**: Paystack & Flutterwave server adapters, HMAC/verif-hash webhook verification, idempotency registry, multi-vendor order splitting, bps commission math, settled vs pending balance enforcement, withdrawal workflow.
- [x] **Phase 6 — Administration**: Admin dashboard, customer moderation, seller application approvals, product moderation, dispute resolution, commission/banner/coupon config, audit log viewer.
- [x] **Phase 7 — Demo Mode**: Customer Demo, Seller Demo, and Admin Demo sandbox roles, isolated namespace engine, simulated payments (`success`/`failed`/`cancelled`/`pending`), reset sandbox, strict production isolation.
- [x] **Phase 8 — Finalization**: Vitest automated test suite, security hardening, SEO (`robots.txt`, `sitemap.xml`, OpenGraph), documentation (`README.md`), `.env.example`, and Vercel deployment configuration.
