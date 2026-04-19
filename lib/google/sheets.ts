/**
 * lib/google/sheets.ts
 *
 * The primary data access layer for the entire application.
 * Every read and write against the Google Sheets backend goes through here.
 *
 * Sheet tab names (must match exactly):
 *   - Clients
 *   - Orders
 *   - Standard_Rates
 *   - Custom_Rates
 *   - Appointments
 *   - Invoices
 *   - Invoice_Line_Items
 *
 * Design decisions:
 *   - Row 1 in every sheet is a header row; data starts at row 2.
 *   - UUIDs are generated client-side before writing so IDs are known
 *     immediately without a round-trip.
 *   - All timestamps are stored as ISO-8601 strings in UTC.
 *   - Booleans are stored as "TRUE" / "FALSE" strings (Sheets convention).
 */

import { google, sheets_v4 } from "googleapis";
import { getServiceAccountAuth } from "./auth";
import type {
  Client,
  Order,
  StandardRate,
  CustomRate,
  Appointment,
  Invoice,
  InvoiceLineItem,
} from "@/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSheetsClient(): sheets_v4.Sheets {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: "v4", auth });
}

const SHEET_ID = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set");
  return id;
};

/** Convert a raw Sheets row (string[]) into a typed object using a header map */
function rowToObject<T>(
  headers: string[],
  row: string[]
): T {
  const obj: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    const val = row[i] ?? "";
    // Coerce booleans
    if (val === "TRUE") obj[h] = true;
    else if (val === "FALSE") obj[h] = false;
    // Coerce numbers for known numeric fields
    else if (!isNaN(Number(val)) && val !== "") obj[h] = Number(val);
    else obj[h] = val;
  });
  return obj as T;
}

/** Convert a typed object back to an ordered row of strings */
function objectToRow(headers: string[], obj: Record<string, unknown>): string[] {
  return headers.map((h) => {
    const val = obj[h];
    if (val === undefined || val === null) return "";
    if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
    return String(val);
  });
}

/** Read all rows from a named tab, returning typed objects */
async function readSheet<T>(tabName: string, headers: string[]): Promise<T[]> {
  const sheets = getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID(),
      range: `${tabName}!A2:Z10000`, // skip header row; Z covers all sheets (max 19 cols)
    });
  } catch (err: unknown) {
    // "Unable to parse range" means the tab doesn't exist yet (setup not run).
    // Return empty rather than crashing so the UI shows an empty state.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unable to parse range")) return [];
    throw err;
  }
  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r[0]) // skip completely empty rows
    .map((r) => rowToObject<T>(headers, r.map(String)));
}

/** Append a single row to a sheet tab */
async function appendRow(tabName: string, headers: string[], obj: Record<string, unknown>): Promise<void> {
  const sheets = getSheetsClient();
  const row = objectToRow(headers, obj);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

/** Update a single row identified by a primary-key value in column A */
async function updateRow(
  tabName: string,
  headers: string[],
  pkValue: string,
  updates: Partial<Record<string, unknown>>
): Promise<void> {
  const sheets = getSheetsClient();
  // Find the row index
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A:A`,
  });
  const column = res.data.values ?? [];
  const rowIndex = column.findIndex((r) => r[0] === pkValue);
  if (rowIndex === -1) throw new Error(`Row not found: ${pkValue} in ${tabName}`);

  // Row index in Sheets is 1-based; +1 for header, +1 for 1-based = rowIndex + 2
  const sheetRow = rowIndex + 2;

  // Read the existing row to merge updates
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A${sheetRow}:Z${sheetRow}`,
  });
  const existing = (existingRes.data.values?.[0] ?? []).map(String);
  const existingObj = rowToObject<Record<string, unknown>>(headers, existing);
  const merged = { ...existingObj, ...updates };
  const newRow = objectToRow(headers, merged);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [newRow] },
  });
}

// ---------------------------------------------------------------------------
// Column header definitions (must match sheet tab column order)
// ---------------------------------------------------------------------------

const CLIENT_HEADERS: (keyof Client)[] = [
  "client_id", "name", "email", "phone", "address", "company",
  "language_pair", "has_custom_rates", "default_tax_exempt", "notes",
  "created_at", "updated_at",
];

const ORDER_HEADERS: (keyof Order)[] = [
  "order_id", "client_id", "service_type", "description", "status",
  "requested_date", "scheduled_date", "duration_minutes", "location",
  "assigned_to", "calendar_event_id", "quote_amount", "notes",
  "created_at", "updated_at",
];

const STANDARD_RATE_HEADERS: (keyof StandardRate)[] = [
  "rate_id", "service_type", "unit", "base_price", "minimum_charge",
  "description", "active", "effective_date",
];

const CUSTOM_RATE_HEADERS: (keyof CustomRate)[] = [
  "custom_rate_id", "client_id", "service_type", "unit",
  "override_price", "minimum_charge", "notes", "created_at",
];

const APPOINTMENT_HEADERS: (keyof Appointment)[] = [
  "appointment_id", "order_id", "client_id", "calendar_event_id",
  "start_time", "end_time", "timezone", "location", "meeting_link",
  "status", "reminder_sent", "notes", "created_at", "updated_at",
];

const INVOICE_HEADERS: (keyof Invoice)[] = [
  "invoice_id", "invoice_number", "order_id", "client_id", "status",
  "issue_date", "due_date", "subtotal", "tax_rate", "tax_amount", "total",
  "drive_file_id", "drive_file_url", "paid_at", "payment_method",
  "payment_reference", "notes", "created_at", "updated_at",
];

const LINE_ITEM_HEADERS: (keyof InvoiceLineItem)[] = [
  "line_item_id", "invoice_id", "service_type", "description",
  "quantity", "unit", "unit_price", "total_price", "rate_source", "notes",
];

// ---------------------------------------------------------------------------
// Public API: Clients
// ---------------------------------------------------------------------------

export async function listClients(): Promise<Client[]> {
  return readSheet<Client>("Clients", CLIENT_HEADERS as string[]);
}

export async function getClient(client_id: string): Promise<Client | null> {
  const clients = await listClients();
  return clients.find((c) => c.client_id === client_id) ?? null;
}

export async function createClient(client: Client): Promise<void> {
  await appendRow("Clients", CLIENT_HEADERS as string[], client as unknown as Record<string, unknown>);
}

export async function updateClient(
  client_id: string,
  updates: Partial<Client>
): Promise<void> {
  await updateRow("Clients", CLIENT_HEADERS as string[], client_id, updates as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Public API: Orders
// ---------------------------------------------------------------------------

export async function listOrders(filters?: { client_id?: string; status?: string }): Promise<Order[]> {
  let orders = await readSheet<Order>("Orders", ORDER_HEADERS as string[]);
  if (filters?.client_id) orders = orders.filter((o) => o.client_id === filters.client_id);
  if (filters?.status) orders = orders.filter((o) => o.status === filters.status);
  return orders;
}

export async function getOrder(order_id: string): Promise<Order | null> {
  const orders = await listOrders();
  return orders.find((o) => o.order_id === order_id) ?? null;
}

export async function createOrder(order: Order): Promise<void> {
  await appendRow("Orders", ORDER_HEADERS as string[], order as unknown as Record<string, unknown>);
}

export async function updateOrder(
  order_id: string,
  updates: Partial<Order>
): Promise<void> {
  await updateRow("Orders", ORDER_HEADERS as string[], order_id, {
    ...updates,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Public API: Rates
// ---------------------------------------------------------------------------

export async function listStandardRates(activeOnly = true): Promise<StandardRate[]> {
  const rates = await readSheet<StandardRate>("Standard_Rates", STANDARD_RATE_HEADERS as string[]);
  return activeOnly ? rates.filter((r) => r.active) : rates;
}

export async function getStandardRate(service_type: string): Promise<StandardRate | null> {
  const rates = await listStandardRates();
  return rates.find((r) => r.service_type === service_type) ?? null;
}

export async function listCustomRates(client_id?: string): Promise<CustomRate[]> {
  const rates = await readSheet<CustomRate>("Custom_Rates", CUSTOM_RATE_HEADERS as string[]);
  return client_id ? rates.filter((r) => r.client_id === client_id) : rates;
}

export async function getCustomRate(
  client_id: string,
  service_type: string
): Promise<CustomRate | null> {
  const rates = await listCustomRates(client_id);
  return rates.find((r) => r.service_type === service_type) ?? null;
}

export async function createCustomRate(rate: CustomRate): Promise<void> {
  await appendRow("Custom_Rates", CUSTOM_RATE_HEADERS as string[], rate as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Public API: Appointments
// ---------------------------------------------------------------------------

export async function listAppointments(filters?: {
  client_id?: string;
  order_id?: string;
  from?: string;
  to?: string;
}): Promise<Appointment[]> {
  let appts = await readSheet<Appointment>("Appointments", APPOINTMENT_HEADERS as string[]);
  if (filters?.client_id) appts = appts.filter((a) => a.client_id === filters.client_id);
  if (filters?.order_id) appts = appts.filter((a) => a.order_id === filters.order_id);
  if (filters?.from) appts = appts.filter((a) => a.start_time >= filters.from!);
  if (filters?.to) appts = appts.filter((a) => a.start_time <= filters.to!);
  return appts;
}

export async function createAppointment(appt: Appointment): Promise<void> {
  await appendRow("Appointments", APPOINTMENT_HEADERS as string[], appt as unknown as Record<string, unknown>);
}

export async function updateAppointment(
  appointment_id: string,
  updates: Partial<Appointment>
): Promise<void> {
  await updateRow("Appointments", APPOINTMENT_HEADERS as string[], appointment_id, {
    ...updates,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Public API: Invoices
// ---------------------------------------------------------------------------

export async function listInvoices(filters?: {
  client_id?: string;
  status?: string;
}): Promise<Invoice[]> {
  let invoices = await readSheet<Invoice>("Invoices", INVOICE_HEADERS as string[]);
  if (filters?.client_id) invoices = invoices.filter((i) => i.client_id === filters.client_id);
  if (filters?.status) invoices = invoices.filter((i) => i.status === filters.status);
  return invoices;
}

export async function getInvoice(invoice_id: string): Promise<Invoice | null> {
  const invoices = await listInvoices();
  return invoices.find((i) => i.invoice_id === invoice_id) ?? null;
}

export async function createInvoice(invoice: Invoice): Promise<void> {
  await appendRow("Invoices", INVOICE_HEADERS as string[], invoice as unknown as Record<string, unknown>);
}

export async function updateInvoice(
  invoice_id: string,
  updates: Partial<Invoice>
): Promise<void> {
  await updateRow("Invoices", INVOICE_HEADERS as string[], invoice_id, {
    ...updates,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Public API: Invoice Line Items
// ---------------------------------------------------------------------------

export async function listLineItems(invoice_id: string): Promise<InvoiceLineItem[]> {
  const items = await readSheet<InvoiceLineItem>("Invoice_Line_Items", LINE_ITEM_HEADERS as string[]);
  return items.filter((item) => item.invoice_id === invoice_id);
}

export async function appendLineItem(item: InvoiceLineItem): Promise<void> {
  await appendRow("Invoice_Line_Items", LINE_ITEM_HEADERS as string[], item as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Utility: generate next invoice number
// ---------------------------------------------------------------------------
export async function nextInvoiceNumber(): Promise<string> {
  const invoices = await listInvoices();
  const year = new Date().getFullYear();
  const yearInvoices = invoices.filter((i) =>
    i.invoice_number.startsWith(`INV-${year}-`)
  );
  const seq = yearInvoices.length + 1;
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Utility: Config key/value store (persists Drive folder ID, watch state, etc.)
// ---------------------------------------------------------------------------

/** Read a config value by key. Returns null if the key or the tab doesn't exist. */
export async function getConfig(key: string): Promise<string | null> {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID(),
      range: "Config!A2:B1000",
    });
    const row = (res.data.values ?? []).find((r) => r[0] === key);
    return row ? String(row[1] ?? "") : null;
  } catch {
    return null;
  }
}

/** Write a config value. Appends if the key is new, updates in-place otherwise. */
export async function setConfig(key: string, value: string): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = SHEET_ID();
  const now = new Date().toISOString();

  // Locate the key in the data rows (A2:A skips the header)
  const colRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Config!A2:A1000",
  });
  const keys = (colRes.data.values ?? []).map((r) => r[0] as string);
  const dataIdx = keys.findIndex((k) => k === key);

  if (dataIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "Config!A1",
      valueInputOption: "RAW",
      requestBody: { values: [[key, value, now]] },
    });
  } else {
    const sheetRow = dataIdx + 2; // +1 for 1-based, +1 for header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Config!A${sheetRow}:C${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[key, value, now]] },
    });
  }
}

// ---------------------------------------------------------------------------
// Utility: initialize sheet headers (run once during setup)
// ---------------------------------------------------------------------------
export async function initializeSheetHeaders(): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = SHEET_ID();

  const tabs = [
    { name: "Clients",            headers: CLIENT_HEADERS },
    { name: "Orders",             headers: ORDER_HEADERS },
    { name: "Standard_Rates",     headers: STANDARD_RATE_HEADERS },
    { name: "Custom_Rates",       headers: CUSTOM_RATE_HEADERS },
    { name: "Appointments",       headers: APPOINTMENT_HEADERS },
    { name: "Invoices",           headers: INVOICE_HEADERS },
    { name: "Invoice_Line_Items", headers: LINE_ITEM_HEADERS },
    { name: "Config",             headers: ["key", "value", "updated_at"] },
  ];

  // Discover which tabs already exist
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTitles = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "")
  );

  // Create any missing tabs
  const missingTabs = tabs.filter((t) => !existingTitles.has(t.name));
  if (missingTabs.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: missingTabs.map((t) => ({
          addSheet: { properties: { title: t.name } },
        })),
      },
    });
  }

  // Write header rows to all tabs
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: tabs.map((t) => ({ range: `${t.name}!A1`, values: [t.headers] })),
    },
  });
}
