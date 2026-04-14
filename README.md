# Francine CRM

**Version 0.8**

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
| `NEXTAUTH_URL` | Full URL of the app, e.g. `http://localhost:3000` |
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
# App available at http://localhost:3000
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

# App available at http://localhost:3000
# Health check: http://localhost:3000/api/health
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
4. Create an **OAuth2 client** (Web application) → add `{NEXTAUTH_URL}/api/auth/callback/google` as an authorized redirect URI

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
curl -X POST http://localhost:3000/api/setup \
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
