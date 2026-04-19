# Francine CRM

**Version 0.8.8**

A lightweight, Google Workspace-backed CRM for SMB service operations. Francine replaces heavy platforms like Jobber with a purpose-built Next.js front-end that uses Google Sheets as its database, Google Calendar for scheduling, Google Drive for invoice storage, and Gmail for transactional email — with no third-party SaaS subscription required.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Running with Docker](#running-with-docker)
- [Google Workspace Setup](#google-workspace-setup)
- [First-Run Initialization](#first-run-initialization)
- [API Reference](#api-reference)
- [Pricing Engine](#pricing-engine)
- [Changelog](#changelog)

---

## Overview

Francine implements the full service-business pipeline:

```
Lead → Quote → Scheduled → In Progress → Completed → Invoiced → Paid
```

Every stage maps to a row update in Google Sheets. Appointments sync two-way with Google Calendar. Invoices are generated as PDFs, uploaded to Drive, and emailed via Gmail — all from the same web UI.

---

## Features

| Module | What it does |
|--------|-------------|
| **Order Intake** | Public/internal form captures service requests; writes to the `Orders` sheet with `status: lead` |
| **Scheduling** | Interactive calendar (react-big-calendar) checks Google Calendar free/busy; books appointments; sends confirmation emails; two-way webhook sync |
| **Customer 360** | Per-client view with full service history, invoice history, aggregate stats, and custom rate card |
| **Pricing Engine** | Three-tier resolution: manual override → client custom rate → standard rate; minimum-charge guard; full audit trail via `rate_source` |
| **Invoice Generation** | PDF built with pdf-lib (no binaries); uploaded to Google Drive; shareable link stored on the invoice row |
| **Invoice Delivery** | Gmail API sends PDF as email attachment; status advances to `sent` |
| **Payment Tracking** | Dashboard marks invoices paid; records method and reference; sends optional receipt email |
| **Health Check** | `GET /api/health` for Docker and load-balancer probes |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript) |
| Auth | NextAuth v5 — Google OAuth for staff login |
| Database | Google Sheets API v4 (via service account) |
| Scheduling | Google Calendar API v3 |
| File storage | Google Drive API v3 |
| Email | Gmail API v1 |
| PDF | pdf-lib (pure JS, no headless browser) |
| UI | Tailwind CSS, Radix UI primitives, Lucide icons |
| Calendar UI | react-big-calendar |
| Forms | react-hook-form + Zod |
| Containerization | Docker (multi-stage, standalone output), Docker Compose |

---

## Project Structure

```
francine/
├── app/
│   ├── (dashboard)/            # Authenticated layout + pages
│   │   ├── dashboard/          # Overview — stats, today's appointments, recent orders
│   │   ├── orders/             # Order list + intake form (new/)
│   │   ├── customers/          # Client grid + Customer 360 ([id]/)
│   │   ├── scheduling/         # Interactive calendar + booking modal
│   │   ├── invoices/           # Invoice list with status filter tabs
│   │   └── payments/           # Payment dashboard + record-payment modal
│   ├── api/
│   │   ├── auth/[...nextauth]/ # NextAuth handler
│   │   ├── orders/             # GET list, POST create, PATCH [id]
│   │   ├── customers/          # GET list, POST create, GET/PATCH [id]
│   │   ├── scheduling/
│   │   │   ├── availability/   # GET free/busy slots from Calendar
│   │   │   └── appointments/   # GET list, POST book
│   │   ├── invoices/           # GET list, POST generate, POST [id]/send
│   │   ├── payments/           # GET dashboard, POST record payment
│   │   ├── rates/              # GET standard+custom, POST custom rate
│   │   ├── setup/              # POST — one-time sheet header init
│   │   ├── health/             # GET — Docker/LB health probe
│   │   └── webhooks/calendar/  # POST — Google Calendar push notifications
│   ├── login/                  # Sign-in page
│   └── layout.tsx / globals.css
├── components/
│   ├── Sidebar.tsx             # Navigation sidebar
│   ├── Topbar.tsx              # Page header with actions + sign-out
│   └── StatusBadge.tsx         # Coloured status pills (orders, invoices, appointments)
├── lib/
│   ├── auth.ts                 # NextAuth config (Google OAuth + JWT callbacks)
│   ├── pricing-engine.ts       # 3-tier price resolver + invoice totals calculator
│   ├── pdf-generator.ts        # A4 invoice PDF layout via pdf-lib
│   └── google/
│       ├── auth.ts             # Service account + OAuth2 client factory
│       ├── sheets.ts           # Full data access layer — all 7 sheet tabs
│       ├── calendar.ts         # Free/busy, event CRUD, watch registration
│       ├── drive.ts            # PDF upload, download, delete, list
│       └── gmail.ts            # Invoice email, appointment confirmation, receipt
├── types/
│   └── index.ts                # Shared TypeScript types (mirrors Sheets schema)
├── Dockerfile                  # Multi-stage build (deps → builder → runner)
├── docker-compose.yml          # Production-style Compose with health check
├── .dockerignore
├── .env.example                # All required environment variables (no secrets)
├── ARCHITECTURE.md             # Detailed architectural roadmap and schema docs
└── next.config.js              # Next.js config — standalone output for Docker
```

---

## Prerequisites

- Node.js 20+ (local dev) or Docker (containerised)
- A Google Cloud project with these APIs enabled:
  - Google Sheets API
  - Google Calendar API
  - Google Drive API
  - Gmail API
- A Google Workspace (or personal Google) account for OAuth login

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in every value before running.

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth2 client ID (for staff login) |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret |
| `NEXTAUTH_SECRET` | Random string — `openssl rand -base64 32` |
| `AUTH_URL` | Canonical app URL — `https://francine.lantix.ca` (NextAuth v5) |
| `NEXTAUTH_URL` | Same as `AUTH_URL` — kept for backwards compatibility |
| `AUTH_TRUST_HOST` | Set to `true` when running behind a reverse proxy |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | Base64-encoded service account JSON key |
| `GOOGLE_SHEET_ID` | ID from the Google Sheets URL |
| `GOOGLE_CALENDAR_ID` | Calendar ID (use `primary` for the default calendar) |
| `GOOGLE_DRIVE_FOLDER_ID` | Drive folder ID where invoice PDFs are stored |
| `TAX_RATE_PERCENT` | Default tax rate, e.g. `13` for 13% HST (0 = no tax) |
| `GMAIL_FROM_ADDRESS` | From address for outgoing emails |
| `NEXT_PUBLIC_APP_NAME` | Display name shown in the UI |
| `NEXT_PUBLIC_APP_URL` | Public URL (used for OAuth callbacks) |

To encode the service account key:

```bash
base64 -i path/to/service-account-key.json | tr -d '\n'
# Paste the output into GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
```

---

## Running Locally

```bash
npm install
npm run dev
# App available at http://localhost:3002
```

Other commands:

```bash
npm run build      # Production build
npm run start      # Run production build
npm run typecheck  # TypeScript check without emitting
npm run lint       # ESLint
```

---

## Running with Docker

```bash
# 1. Fill in your secrets
cp .env.example .env.local

# 2. Build and start
docker compose up --build

# App available at http://localhost:3002
# Health check: http://localhost:3002/api/health
```

To rebuild after code changes:

```bash
docker compose up --build --force-recreate
```

To run detached:

```bash
docker compose up -d --build
docker compose logs -f   # follow logs
docker compose down      # stop
```

### Docker image details

The Dockerfile uses a three-stage build:

1. **deps** — `npm ci` with layer caching
2. **builder** — `next build` with `output: "standalone"`
3. **runner** — copies only `.next/standalone` + static assets; runs as non-root user `nextjs:nodejs`

Final image size is approximately 150–250 MB. No secrets are baked into any layer — all credentials are injected at runtime via `env_file`.

---

## Google Workspace Setup

### 1. Google Cloud Project

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable: **Sheets API**, **Calendar API**, **Drive API**, **Gmail API**
3. Create a **Service Account** → grant it no project roles → download JSON key → base64-encode it
4. Create an **OAuth2 client** (Web application) → add the following as an **Authorized redirect URI**:
   ```
   https://francine.lantix.ca/api/auth/callback/google
   ```

### 2. Google Workspace Resources

| Resource | How to get the ID |
|----------|------------------|
| Google Sheet | Create a new Sheet; copy the ID from the URL: `.../spreadsheets/d/<ID>/edit` |
| Google Calendar | Open Calendar settings → find the Calendar ID under "Integrate calendar" |
| Drive folder | Create a folder in Drive; copy the ID from the URL: `.../folders/<ID>` |

### 3. Share resources with the service account

The service account email looks like `name@project-id.iam.gserviceaccount.com`. Share the following with it:

- **Google Sheet** — Editor access
- **Drive folder** — Editor access
- **Google Calendar** — "Make changes to events" permission

Gmail sending uses the same service account with domain-wide delegation, or an OAuth2 refresh token from the sender address.

---

## First-Run Initialization

After the app is running, call the setup endpoint once to write the header row to every sheet tab:

```bash
curl -X POST http://localhost:3002/api/setup \
  -H "Cookie: <your session cookie after signing in>"
```

This creates headers in: `Clients`, `Orders`, `Standard_Rates`, `Custom_Rates`, `Appointments`, `Invoices`, `Invoice_Line_Items`.

Then seed your service types in the `Standard_Rates` tab:

| rate_id | service_type | unit | base_price | minimum_charge | active | effective_date |
|---------|-------------|------|-----------|----------------|--------|----------------|
| *(uuid)* | Interpretation — Consecutive | hour | 85.00 | 150.00 | TRUE | 2024-01-01 |
| *(uuid)* | Translation | per_word | 0.18 | 50.00 | TRUE | 2024-01-01 |

---

## API Reference

All routes require an authenticated session (Google OAuth). Responses follow `{ data: T }` or `{ error: string }`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orders` | List orders; filter by `?status=` or `?client_id=` |
| `POST` | `/api/orders` | Create order (intake form) |
| `GET` | `/api/orders/:id` | Get single order |
| `PATCH` | `/api/orders/:id` | Update order (status, assignment, etc.) |
| `GET` | `/api/customers` | List clients; search by `?q=` |
| `POST` | `/api/customers` | Create client |
| `GET` | `/api/customers/:id` | Customer 360 — client + orders + invoices + custom rates |
| `PATCH` | `/api/customers/:id` | Update client fields |
| `GET` | `/api/scheduling/availability` | Free/busy slots from Google Calendar |
| `GET` | `/api/scheduling/appointments` | List appointments |
| `POST` | `/api/scheduling/appointments` | Book appointment — creates Calendar event, writes Sheets row, sends email |
| `GET` | `/api/invoices` | List invoices; filter by `?status=` or `?client_id=` |
| `POST` | `/api/invoices` | Generate invoice — runs Pricing Engine, creates PDF, uploads to Drive |
| `POST` | `/api/invoices/:id/send` | Email invoice PDF to client via Gmail |
| `GET` | `/api/payments` | Payment dashboard — aggregates + invoice list |
| `POST` | `/api/payments` | Record a payment; optional receipt email |
| `GET` | `/api/rates` | List standard rates and/or client custom rates |
| `POST` | `/api/rates` | Add a custom rate for a client |
| `POST` | `/api/setup` | One-time: initialize sheet header rows |
| `GET` | `/api/health` | Health check — returns `{ status: "ok" }` |
| `POST` | `/api/webhooks/calendar` | Google Calendar push notification receiver |

---

## Pricing Engine

Prices are resolved in this order, highest priority first:

```
1. Manual override   — staff explicitly sets a one-off line item price
2. Custom rate       — client has a negotiated rate for this service type
3. Standard rate     — the default rate in the Standard_Rates sheet
4. PricingError      — no rate found; must be resolved before invoicing
```

A minimum-charge guard is applied after resolution:

```
final_total = MAX(quantity × unit_price, minimum_charge)
```

Every line item records its `rate_source` (`standard`, `custom`, or `manual_override`) for a full audit trail.

---

## Changelog

### v0.8.8 — Fix Sheets API 400: replace open-ended ranges with bounded ranges

- `lib/google/sheets.ts`: Google Sheets API v4 rejects open-ended ranges like `A2:Z` (col+row start, col-only end) with a 400 "Unable to parse range" error — valid forms are either fully bounded (`A2:Z100`) or pure-column (`A:Z`); changed all three affected ranges to explicit bounded forms: `readSheet` → `A2:Z10000`, `getConfig` → `Config!A2:B1000`, `setConfig` key lookup → `Config!A2:A1000`

---

### v0.8.7 — Fix build failure: googleapis webpack externals for instrumentation.ts

- `next.config.js`: added a `webpack()` function that marks `googleapis`, `google-auth-library`, `gaxios`, `agent-base`, and `https-proxy-agent` as CommonJS externals for all server-side bundles — `serverComponentsExternalPackages` covers RSC/route-handler bundles but not the separate webpack compilation used for `instrumentation.ts`, causing `Can't resolve 'http'/'https'/'net'` errors during `next build`

---

### v0.8.6 — Automated Drive folder creation and Calendar watch renewal

- `lib/google/sheets.ts`: added `Config` sheet tab (key/value store); added `getConfig`/`setConfig` helpers; `initializeSheetHeaders` now creates and headers the Config tab alongside the other 7
- `lib/google/drive.ts`: replaced sync `FOLDER_ID()` with async `getFolderId()` that falls back to the Config sheet; added `createDriveFolder()` — called once by setup if `GOOGLE_DRIVE_FOLDER_ID` is not set; the new folder ID is stored in Config and returned in the setup response
- `lib/google/calendar.ts`: added `stopCalendarWatch()`; added `renewCalendarWatchIfNeeded()` — checks Config for stored watch expiration and renews the channel (stop + re-register) when fewer than 24 hours remain; skips silently in local/non-HTTPS environments
- `app/api/setup/route.ts`: `POST /api/setup` now orchestrates all three steps — sheet tabs, Drive folder, Calendar watch — and reports per-step results in the response body
- `instrumentation.ts`: new Next.js server startup hook; calls `renewCalendarWatchIfNeeded()` on every process boot so the watch self-heals without any manual intervention
- `next.config.js`: enabled `experimental.instrumentationHook`

---

### v0.8.5 — Automatic sheet tab creation on setup

- `lib/google/sheets.ts` `initializeSheetHeaders`: now calls `spreadsheets.get` to discover existing tabs, then creates any missing ones via `batchUpdate addSheet` before writing headers — the entire Google Sheet is initialized from scratch by `POST /api/setup` with no manual tab creation required
- `lib/google/sheets.ts` `updateRow`: fixed second instance of invalid `ZZ` column range (`A{row}:ZZ{row}` → `A{row}:Z{row}`)

---

### v0.8.4 — Sheets range fix

- `lib/google/sheets.ts`: changed `readSheet` range from `${tabName}!A2:ZZ` to `${tabName}!A2:Z` — `ZZ` is not a valid A1 notation column; `Z` (26 columns) is sufficient for all 7 sheet tabs (widest is Invoices at 19 columns, A–S)

---

### v0.8.3 — Production domain configuration

- Set canonical domain to `https://francine.lantix.ca` across all config
- `.env.example`: added `AUTH_URL`, `AUTH_TRUST_HOST=true`; updated `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to production domain
- `docker-compose.yml`: `AUTH_URL`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST` hardcoded in `environment` block (override `env_file` for these keys); `NEXT_PUBLIC_APP_URL` build arg updated
- `lib/auth.ts`: added `trustHost: true` to NextAuth config (belt-and-suspenders with `AUTH_TRUST_HOST` env var) — required when running behind a reverse proxy
- `README.md`: documented `AUTH_URL` / `AUTH_TRUST_HOST` env vars; added explicit Google OAuth redirect URI (`https://francine.lantix.ca/api/auth/callback/google`)

---

### v0.8.2 — Port change

- App now runs on port **3002** instead of 3000
- Updated: `Dockerfile` (`EXPOSE`, `PORT`, `ENV`), `docker-compose.yml` (port mapping, `PORT`, health-check URL, `NEXT_PUBLIC_APP_URL`), `.env.example` (`NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`)

---

### v0.8.1 — Bug fixes and stability

**Docker / dependency fixes**
- `Dockerfile`: changed `npm ci` to `npm install` to resolve lock-file compatibility issues in containers
- `package.json`: removed non-existent `@radix-ui/react-badge` dependency

**TypeScript / lint fixes**
- `lib/google/auth.ts`: spread `SCOPES` tuple into array literal to satisfy `GoogleAuth` constructor type
- `app/(dashboard)/customers/page.tsx`: replaced `title` prop with `aria-label` on `Star` icon (DOM attribute warning)
- `.eslintrc.json`: added ESLint config; fixed `react/no-unescaped-entities` error in dashboard page

**Critical bug fixes**
- `app/(dashboard)/orders/new/page.tsx`: client selection dropdown now calls `setValue("client_id", ...)` — previously the hidden input was never populated, causing every new-order submission to fail validation
- `lib/pricing-engine.ts` + `types/index.ts`: added `unit` field to `PricingResult`; each rate tier now returns its own unit. Fixed `app/api/invoices/route.ts` where both branches of a dead ternary always produced `item.unit ?? "hour"`, ignoring the resolved rate's unit

**Other fixes**
- `app/(dashboard)/scheduling/page.tsx`: `startOfWeek` in `dateFnsLocalizer` now passes the calendar date argument instead of always using `new Date()`
- `lib/google/calendar.ts`: removed unused `Appointment` import
- `lib/google/gmail.ts`: changed `let message` to `const` (value never reassigned)
- `app/api/webhooks/calendar/route.ts`: removed unused `channelToken` variable
- `app/api/rates/route.ts`: added 409 duplicate-rate guard — creating a custom rate for a `client_id + service_type` pair that already exists now returns a clear error instead of silently appending a duplicate row

---

### v0.8 — Initial release

- Next.js 14 App Router scaffold with TypeScript and Tailwind CSS
- Google Sheets data layer: 7 tabs (`Clients`, `Orders`, `Standard_Rates`, `Custom_Rates`, `Appointments`, `Invoices`, `Invoice_Line_Items`)
- Google Calendar integration: free/busy availability, event CRUD, two-way webhook sync
- Google Drive: PDF upload, shareable link generation
- Gmail: invoice delivery, appointment confirmation, payment receipt emails
- Three-tier Pricing Engine with minimum-charge guard and audit trail
- A4 PDF invoice generator (pdf-lib, no external binaries)
- Full REST API: orders, customers, scheduling, invoices, payments, rates
- Frontend pages: dashboard, order intake, customer 360, scheduling calendar, invoice list, payments dashboard
- NextAuth v5 with Google OAuth (staff login) + Service Account (server-side APIs)
- Docker: multi-stage Dockerfile, `.dockerignore`, `docker-compose.yml`, health check endpoint (`/api/health`)
- `ARCHITECTURE.md`: workflow mapping vs Jobber / Interpreter Intelligence, schema design, pricing engine pseudocode, deployment guide
