// ─────────────────────────────────────────────────────────────────────────────
//  Francine CRM — Shared TypeScript Types
//  These mirror the Google Sheets schema exactly. Each type maps 1-to-1 with
//  a sheet tab.  Column order in the interfaces matches column order in Sheets
//  so row-to-object mapping is unambiguous.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Enums / union literals
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "quote"
  | "scheduled"
  | "completed"
  | "cancelled";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

export type RateUnit = "hour" | "flat" | "per_item" | "per_word" | "per_minute" | "session" | "half-day" | "full-day" | "custom";

export type RateSource = "standard" | "custom" | "manual_override";

export type PaymentMethod =
  | "cash"
  | "cheque"
  | "e-transfer"
  | "credit_card"
  | "bank_transfer"
  | "other";

// ---------------------------------------------------------------------------
// Sheet: Clients
// ---------------------------------------------------------------------------

export interface Client {
  client_id: string;          // UUID — primary key
  name: string;
  email: string;
  phone: string;
  street:      string;
  city:        string;
  province:    string;
  postal_code: string;
  company: string;
  department: string;         // department within the org — each dept is a distinct billing entity
  language_pair?: string;     // e.g. "EN-FR" — retained in DB, not shown in UI
  has_custom_rates: boolean;  // flag: at least one Custom_Rate row exists
  default_tax_exempt: boolean;
  notes: string;
  created_at: string;         // ISO-8601
  updated_at: string;
  abbreviation: string;       // 2-char invoice prefix, e.g. "HL" for "High Life"
  contacts: string;            // comma-separated list of contacts at the client org
  drive_folder_url: string;   // Google Drive folder URL for invoices / receipts
}

// ---------------------------------------------------------------------------
// Sheet: Orders  (Master Orders — the canonical job pipeline)
// ---------------------------------------------------------------------------

export interface Order {
  order_id: string;           // UUID
  client_id: string;          // FK → Clients.client_id
  service_type: string;       // e.g. "Interpretation", "Translation", "Cleaning"
  description: string;
  status: OrderStatus;
  requested_date: string;     // ISO-8601 date requested by client
  scheduled_date: string;     // ISO-8601 confirmed date
  duration_hours: number;
  location: string;
  assigned_to: string;        // staff name or email
  calendar_event_id: string;  // Google Calendar event ID (set after scheduling)
  quote_amount: number;
  mileage_cost: number;
  parking_cost: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Sheet: Standard_Rates
// ---------------------------------------------------------------------------

export interface StandardRate {
  rate_id: string;            // UUID
  service_type: string;       // must match Order.service_type values
  unit: RateUnit;
  base_price: number;         // price per unit (CAD/USD, raw number)
  minimum_charge: number;     // minimum billable amount, 0 = no minimum
  description: string;
  active: boolean;
  effective_date: string;     // ISO-8601 — when this rate became active
}

// ---------------------------------------------------------------------------
// Sheet: Custom_Rates  (per-client overrides)
// ---------------------------------------------------------------------------

export interface CustomRate {
  custom_rate_id: string;     // UUID
  client_id: string;          // FK → Clients.client_id
  service_type: string;       // FK → Standard_Rates.service_type
  unit: RateUnit;
  override_price: number;
  minimum_charge: number;
  notes: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Sheet: Appointments
// ---------------------------------------------------------------------------

export interface Appointment {
  appointment_id: string;     // UUID
  order_id: string;           // FK → Orders.order_id
  client_id: string;          // FK → Clients.client_id
  calendar_event_id: string;  // Google Calendar event ID
  start_time: string;         // ISO-8601 datetime
  end_time: string;           // ISO-8601 datetime
  timezone: string;           // IANA tz, e.g. "America/Toronto"
  location: string;
  meeting_link: string;       // Google Meet / Zoom URL if virtual
  status: AppointmentStatus;
  reminder_sent: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Sheet: Invoices
// ---------------------------------------------------------------------------

export interface Invoice {
  invoice_id: string;         // UUID
  invoice_number: string;     // human-readable, e.g. "INV-2024-0042"
  order_id: string;           // FK → Orders.order_id
  client_id: string;          // FK → Clients.client_id
  status: InvoiceStatus;
  issue_date: string;         // ISO-8601 date
  due_date: string;           // ISO-8601 date
  subtotal: number;
  tax_rate: number;           // percentage, e.g. 13
  tax_amount: number;
  total: number;
  drive_file_id: string;      // Google Drive file ID of the PDF
  drive_file_url: string;     // public/shared URL
  paid_at: string;            // ISO-8601 datetime, empty if unpaid
  payment_method: PaymentMethod | "";
  payment_reference: string;  // cheque number, transaction ID, etc.
  notes: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Sheet: Invoice_Line_Items
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  line_item_id: string;       // UUID
  invoice_id: string;         // FK → Invoices.invoice_id
  service_type: string;
  description: string;
  quantity: number;
  unit: RateUnit;
  unit_price: number;         // final price used (after any overrides)
  total_price: number;        // quantity × unit_price
  rate_source: RateSource;    // audit trail: where did this price come from?
  notes: string;
}

// ---------------------------------------------------------------------------
// Pricing Engine types (not persisted to Sheets)
// ---------------------------------------------------------------------------

export interface PricingInput {
  client_id: string;
  service_type: string;
  quantity: number;
  unit?: RateUnit;
  manual_override_price?: number; // explicitly set by staff
}

export interface PricingResult {
  unit_price: number;
  unit: RateUnit;             // resolved unit from the winning rate
  minimum_charge: number;
  total_price: number;        // max(quantity × unit_price, minimum_charge)
  rate_source: RateSource;
  rate_id: string;            // custom_rate_id or rate_id used
  notes: string;
}

// ---------------------------------------------------------------------------
// API request/response helpers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// Google Calendar slot type used by the scheduling UI
export interface AvailabilitySlot {
  start: string;  // ISO-8601
  end: string;    // ISO-8601
  available: boolean;
}
