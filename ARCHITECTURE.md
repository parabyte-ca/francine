# Francine CRM — Architectural Roadmap

> **Light CRM as a Google Workspace Front-End**
> A purpose-built SMB service management system using Google Sheets, Calendar,
> Drive, and Gmail as the backend persistence layer.

---

## 1. Workflow Mapping: Jobber vs Interpreter Intelligence vs Francine CRM

### Lead → Quote → Job → Invoice transition

| Stage | **Jobber** | **Interpreter Intelligence** | **Francine CRM** |
|-------|------------|-------------------------------|-------------------|
| **Lead / Intake** | Web intake form or manual entry; stored in "Requests" | Client submits request via portal specifying language pair, subject, date | `POST /api/orders` writes to **Orders** sheet with `status: lead` |
| **Quote** | Automated or manual quote email with line items | Rate calculated from language pair + duration; quote PDF sent | Pricing Engine resolves rate → quote amount stored on Order row; Order advances to `status: quote` |
| **Job Scheduling** | Assigned to a crew; calendar event created | Interpreter assigned; Google Calendar event created | `POST /api/scheduling/appointments` → Google Calendar event created; Order advances to `status: scheduled` |
| **Job Execution** | Field staff clock in/out; photos, notes attached | Interpreter confirms attendance; minutes recorded | Order advanced to `status: in_progress` manually; notes field updated |
| **Invoice Generation** | Auto-generated from job completion; line items from job | Invoice generated from confirmed duration; per-minute or per-word billing | `POST /api/invoices` runs Pricing Engine on line items → PDF generated via pdf-lib → uploaded to Drive → Invoice row written to Sheets |
| **Invoice Delivery** | Emailed to client directly from Jobber | Emailed via platform | `POST /api/invoices/[id]/send` → Gmail API sends PDF attachment |
| **Payment** | Client pays via Stripe link in invoice | Manual payment tracked | `POST /api/payments` marks Invoice `status: paid`; optional receipt email via Gmail |

### Key Architectural Differences

**Jobber** is a monolith with its own DB, mobile app, and payment gateway.
**Interpreter Intelligence** adds domain specificity (language pairs, credentials) but follows the same pipeline.
**Francine CRM** deliberately externalises state to Google Workspace, meaning:
- Zero DB cost — Sheets is the database
- Zero file storage cost — Drive is the file system
- Zero email cost — Gmail is the transactional mailer
- Calendar is the scheduling engine, not a calendar widget

---

## 2. Google Sheets Schema Design

Each sheet tab corresponds to a data entity. The schema enforces relational integrity through UUID foreign keys rather than native Sheets relationships.

### Tab: `Clients`

| Column | Type | Notes |
|--------|------|-------|
| `client_id` | UUID (PK) | Generated in app; never changes |
| `name` | string | Full name |
| `email` | string | Primary contact email |
| `phone` | string | |
| `address` | string | |
| `company` | string | |
| `language_pair` | string | e.g. `EN-FR` — Interpreter Intelligence field |
| `has_custom_rates` | BOOL | Denormalized flag to avoid full Custom_Rates scan |
| `default_tax_exempt` | BOOL | Skip tax calculation for this client |
| `notes` | string | Internal notes |
| `created_at` | ISO-8601 | |
| `updated_at` | ISO-8601 | |

### Tab: `Orders` (Master Orders — the canonical job pipeline)

| Column | Type | Notes |
|--------|------|-------|
| `order_id` | UUID (PK) | |
| `client_id` | UUID (FK → Clients) | |
| `service_type` | string | Must match Standard_Rates service types |
| `description` | string | Free-text details |
| `status` | enum | `lead │ quote │ scheduled │ in_progress │ completed │ cancelled` |
| `requested_date` | ISO-8601 | Client's requested date |
| `scheduled_date` | ISO-8601 | Confirmed appointment start |
| `duration_minutes` | integer | Billable duration |
| `location` | string | |
| `assigned_to` | string | Staff name or email |
| `calendar_event_id` | string | Google Calendar event ID |
| `quote_amount` | number | Pre-confirmed quote (0 if not quoted) |
| `notes` | string | |
| `created_at` | ISO-8601 | |
| `updated_at` | ISO-8601 | |

### Tab: `Standard_Rates`

| Column | Type | Notes |
|--------|------|-------|
| `rate_id` | UUID (PK) | |
| `service_type` | string | Matches Orders.service_type |
| `unit` | enum | `hour │ flat │ per_item │ per_word │ per_minute` |
| `base_price` | number | Price per unit |
| `minimum_charge` | number | Floor; 0 = no minimum |
| `description` | string | Human-readable description |
| `active` | BOOL | Soft-delete / deprecation flag |
| `effective_date` | ISO-8601 date | When this rate became active |

### Tab: `Custom_Rates`

| Column | Type | Notes |
|--------|------|-------|
| `custom_rate_id` | UUID (PK) | |
| `client_id` | UUID (FK → Clients) | |
| `service_type` | string | FK → Standard_Rates.service_type |
| `unit` | enum | |
| `override_price` | number | Negotiated rate |
| `minimum_charge` | number | |
| `notes` | string | e.g. "VIP client; 20% discount" |
| `created_at` | ISO-8601 | |

### Tab: `Appointments`

| Column | Type | Notes |
|--------|------|-------|
| `appointment_id` | UUID (PK) | |
| `order_id` | UUID (FK → Orders) | |
| `client_id` | UUID (FK → Clients) | Denormalized for faster queries |
| `calendar_event_id` | string | Google Calendar event ID (two-way sync) |
| `start_time` | ISO-8601 datetime | |
| `end_time` | ISO-8601 datetime | |
| `timezone` | IANA tz | e.g. `America/Toronto` |
| `location` | string | |
| `meeting_link` | string | Google Meet URL |
| `status` | enum | `scheduled │ confirmed │ cancelled │ completed │ no_show` |
| `reminder_sent` | BOOL | |
| `notes` | string | |
| `created_at` | ISO-8601 | |
| `updated_at` | ISO-8601 | |

### Tab: `Invoices`

| Column | Type | Notes |
|--------|------|-------|
| `invoice_id` | UUID (PK) | |
| `invoice_number` | string | Human-readable, e.g. `INV-2024-0042` |
| `order_id` | UUID (FK → Orders) | |
| `client_id` | UUID (FK → Clients) | |
| `status` | enum | `draft │ sent │ paid │ overdue │ void` |
| `issue_date` | ISO-8601 date | |
| `due_date` | ISO-8601 date | |
| `subtotal` | number | |
| `tax_rate` | number | Percentage (e.g. 13) |
| `tax_amount` | number | |
| `total` | number | |
| `drive_file_id` | string | Google Drive file ID |
| `drive_file_url` | string | Shareable PDF link |
| `paid_at` | ISO-8601 datetime | Empty if unpaid |
| `payment_method` | enum | `cash │ cheque │ e-transfer │ credit_card │ bank_transfer │ other` |
| `payment_reference` | string | Cheque #, transaction ID, etc. |
| `notes` | string | |
| `created_at` | ISO-8601 | |
| `updated_at` | ISO-8601 | |

### Tab: `Invoice_Line_Items`

| Column | Type | Notes |
|--------|------|-------|
| `line_item_id` | UUID (PK) | |
| `invoice_id` | UUID (FK → Invoices) | |
| `service_type` | string | |
| `description` | string | |
| `quantity` | number | Hours, words, items, etc. |
| `unit` | enum | |
| `unit_price` | number | Final price used |
| `total_price` | number | `max(quantity × unit_price, minimum_charge)` |
| `rate_source` | enum | `standard │ custom │ manual_override` — audit trail |
| `notes` | string | |

---

## 3. Tech Stack Decision

### Frontend + API: Next.js 14 (App Router)

**Why Next.js over alternatives:**

| Factor | Next.js | Google Apps Script | Plain React |
|--------|---------|--------------------|-------------|
| Auth | NextAuth (Google OAuth) | Built-in (G Suite) | Custom |
| API layer | Route Handlers | Built-in web app | Separate backend |
| Deployment | Vercel / Cloud Run | Google's infra | Separate hosting |
| TypeScript | Native | Limited | Native |
| PDF generation | pdf-lib (server) | Not viable | Client-side only |
| Caching | ISR, React cache() | No | No |
| **Verdict** | **Best for custom UI + server logic** | Fast for simple tools | Overkill without SSR |

**Apps Script is appropriate when:** you need ultra-simple read/write UIs embedded directly in Sheets, or for automations (e.g. nightly overdue invoice flagging). Use it as a **complement** to Next.js, not a replacement.

### Authentication Architecture

```
User Browser
     │
     ▼ GET /login
Next.js Server ──► NextAuth.js
                      │
                      ▼ Google OAuth 2.0
                   Google Identity
                      │ access_token + refresh_token
                      ▼
             Stored in encrypted JWT session cookie
                      │
     ┌────────────────┴────────────────┐
     │                                 │
     ▼                                 ▼
Service Account Auth              OAuth2 Client Auth
(server-side Sheets, Drive)    (Gmail send-as user)
```

- **Service Account**: used for all Sheets, Drive, Calendar reads/writes.
  Zero token expiry concerns — the googleapis SDK auto-refreshes.
- **OAuth2 (user)**: used only when sending Gmail as a specific staff address.
  Refresh token stored in session.
- **NextAuth session**: Google OAuth for staff login; JWT strategy; no DB required.

### API call flow (server → Google)

```
Next.js Route Handler (server)
  │
  ├─► getServiceAccountAuth()       ← reads base64 key from env
  │       └─► googleapis SDK        ← handles token refresh automatically
  │               └─► Google API    ← Sheets / Calendar / Drive / Gmail
  │
  └─► Returns typed response to client
```

---

## 4. Pricing Engine — Logic Flow

```
resolvePrice(client_id, service_type, quantity, manual_override?)
│
├─► STEP 1: Manual override provided by staff?
│     YES ──► unit_price = manual_override
│             rate_source = "manual_override"
│             minimum = 0
│             GOTO TOTAL
│
├─► STEP 2: Query Custom_Rates WHERE client_id AND service_type
│     FOUND ──► unit_price = Custom_Rate.override_price
│               rate_source = "custom"
│               minimum = Custom_Rate.minimum_charge
│               GOTO TOTAL
│
├─► STEP 3: Query Standard_Rates WHERE service_type AND active=TRUE
│     FOUND ──► unit_price = Standard_Rate.base_price
│               rate_source = "standard"
│               minimum = Standard_Rate.minimum_charge
│               GOTO TOTAL
│
└─► NOT FOUND ──► RAISE PricingError (must configure rate before invoicing)

TOTAL:
  raw_total   = quantity × unit_price
  final_total = MAX(raw_total, minimum_charge)

RETURN { unit_price, rate_source, total_price: final_total, rate_id, notes }
```

### Example: Interpretation session, 2.5 hours

```
Client: Acme Corp (has custom rate for "Interpretation — Consecutive")
Service: Interpretation — Consecutive
Quantity: 2.5 hours
Manual override: none

Step 1: No manual override → continue
Step 2: Custom_Rate found → override_price = $95/hr, minimum = $150
  raw_total   = 2.5 × $95 = $237.50
  final_total = MAX($237.50, $150) = $237.50
  rate_source = "custom"

Invoice line item:
  Description: Interpretation — Consecutive
  Quantity:    2.5 hr
  Unit Price:  $95.00  (custom rate)
  Total:       $237.50
  Rate Source: custom  ← audit trail
```

### Example: Same service, different client (no custom rate)

```
Client: New Client Corp (no custom rates)
Step 2: No Custom_Rate found → continue
Step 3: Standard_Rate found → base_price = $85/hr, minimum = $0
  raw_total   = 2.5 × $85 = $212.50
  final_total = $212.50
  rate_source = "standard"
```

---

## 5. Schedule-to-Invoice Transition (Full Flow)

```
1. Order Created (status: lead)
        │
        ▼ POST /api/orders
   [Orders Sheet: row appended]

2. Quote Approved (status: quote)
        │
        ▼ PATCH /api/orders/[id] { status: "quote", quote_amount: 450 }
   [Orders Sheet: row updated]

3. Appointment Booked (status: scheduled)
        │
        ▼ POST /api/scheduling/appointments
        │   ├─ createCalendarEvent() → eventId, meetLink
        │   ├─ createAppointment()   → [Appointments Sheet: row appended]
        │   ├─ updateOrder()         → status: scheduled, calendar_event_id
        │   └─ sendAppointmentConfirmation() → Gmail
        │
   [Orders Sheet + Appointments Sheet + Google Calendar updated]

4. Job Executed (status: in_progress → completed)
        │
        ▼ PATCH /api/orders/[id] { status: "in_progress" }
        ▼ PATCH /api/orders/[id] { status: "completed" }

5. Invoice Generated
        │
        ▼ POST /api/invoices
        │   ├─ resolvePrice()        → Pricing Engine per line item
        │   ├─ calculateTotals()     → subtotal, tax, total
        │   ├─ generateInvoicePdf()  → Buffer (pdf-lib)
        │   ├─ uploadInvoicePdf()    → Drive → fileId, fileUrl
        │   ├─ createInvoice()       → [Invoices Sheet: row appended]
        │   └─ appendLineItem() ×n  → [Invoice_Line_Items Sheet]
        │
   [Invoice row: status = draft]

6. Invoice Sent
        │
        ▼ POST /api/invoices/[id]/send
        │   ├─ downloadFile()        → PDF Buffer from Drive
        │   ├─ sendInvoiceEmail()    → Gmail (PDF attachment)
        │   └─ updateInvoice()       → status: sent
        │
   [Invoice row: status = sent]

7. Payment Recorded
        │
        ▼ POST /api/payments
        │   ├─ updateInvoice()       → status: paid, paid_at, method, reference
        │   └─ sendPaymentReceipt()  → Gmail (optional)
        │
   [Invoice row: status = paid]
```

---

## 6. Deployment Guide

### Prerequisites

1. **Google Cloud Project**
   - Enable APIs: Sheets, Calendar, Drive, Gmail
   - Create a Service Account → download JSON key → base64-encode it
   - Enable domain-wide delegation if Gmail send-as is needed

2. **Google Workspace Resources**
   - One Google Sheet (paste ID into `GOOGLE_SHEET_ID`)
   - One Google Calendar (paste ID into `GOOGLE_CALENDAR_ID`)
   - One Drive folder for invoices (paste ID into `GOOGLE_DRIVE_FOLDER_ID`)

3. **OAuth2 Credentials**
   - Create OAuth2 client ID (Web application type)
   - Authorized redirect URI: `https://your-domain.com/api/auth/callback/google`

### Environment Variables

Copy `.env.example` → `.env.local` and fill in all values.

### One-time Sheet Setup

After deploying, call the setup endpoint once to write header rows:

```bash
curl -X POST https://your-domain.com/api/setup \
  -H "Cookie: <your session cookie>"
```

### Initial Rate Configuration

Add rows to the `Standard_Rates` tab manually (or via a future admin UI):

| rate_id | service_type | unit | base_price | minimum_charge | active |
|---------|-------------|------|-----------|----------------|--------|
| uuid | Interpretation — Consecutive | hour | 85.00 | 150.00 | TRUE |
| uuid | Interpretation — Simultaneous | hour | 110.00 | 200.00 | TRUE |
| uuid | Translation | per_word | 0.18 | 50.00 | TRUE |
| uuid | Transcription | per_minute | 2.50 | 25.00 | TRUE |

### Deployment Options

| Option | Best For | Notes |
|--------|----------|-------|
| **Vercel** | Simplest | Auto-scales; ISR built-in; free tier generous |
| **Cloud Run** | GCP ecosystem | Docker container; pays per request |
| **Self-hosted** | Data residency | Node.js + PM2 or Docker |

### Calendar Webhook Renewal

Google Calendar push notification channels expire after 7 days. Set up a
Cloud Scheduler (or Vercel cron) to call the watch registration endpoint weekly:

```bash
# cron: 0 0 * * 0  (every Sunday midnight)
curl -X POST https://your-domain.com/api/scheduling/register-watch \
  -H "Authorization: Bearer <internal-token>"
```

---

## 7. Limitations & Production Considerations

### Google Sheets as a Database — Tradeoffs

| Concern | Impact | Mitigation |
|---------|--------|------------|
| **Row volume** | Sheets handles ~50k rows reliably; slower beyond that | Archive completed orders to a separate sheet annually |
| **Concurrent writes** | No row-level locking; race conditions on sequential row lookups | Use append-only writes (never gap-search for empty rows); consider Firestore for high-volume |
| **API quotas** | 300 reads/min per project; 60 writes/min | Cache `listClients()` and rate data with `revalidate = 300`; batch writes |
| **No transactions** | Invoice + line items written separately; partial failure possible | Write Invoice row last; implement idempotency via invoice_id check before appending |
| **No indexes** | Full sheet scan for every lookup | Acceptable at SMB scale (<5k rows); add Redis cache for frequently accessed data if needed |

### Security

- Service account key stored as base64 env var; never commit to git
- All API routes require session auth via `auth()` guard
- Webhook endpoint should validate `x-goog-channel-token` against a stored secret
- Drive PDF links use "anyone with link" — appropriate for invoices; restrict to specific users for sensitive documents

### Recommended Phase 2 Additions

1. **Admin UI for rate management** — CRUD for Standard_Rates without editing Sheets directly
2. **Overdue invoice job** — Cloud Scheduler calls a batch endpoint that marks `status: overdue` and sends reminder emails
3. **Stripe integration** — Add a payment link to invoice emails; webhook updates `status: paid` automatically
4. **Multi-staff** — Add an `Assignees` sheet and assignment UI; integrate with Google Directory API
5. **Client portal** — Read-only Next.js app (separate subdomain) where clients can view their invoices and appointment history
6. **Apps Script companion** — Lightweight GAS trigger that runs nightly to flag overdue invoices and send reminders (simpler than a cron job)
