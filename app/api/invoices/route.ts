/**
 * GET  /api/invoices            — list invoices (optional ?client_id=&status=)
 * POST /api/invoices            — generate an invoice from an order
 *
 * Generation flow (Schedule → Invoice transition):
 *   1. Receive order_id + line item inputs
 *   2. Run each line through the Pricing Engine
 *   3. Calculate totals (subtotal, tax, grand total)
 *   4. Generate PDF via pdf-generator
 *   5. Upload PDF to Google Drive
 *   6. Write Invoice + InvoiceLineItems rows to Sheets
 *   7. Advance Order status to "completed" (if all work done)
 *   8. Return invoice with Drive link
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createInvoice,
  appendLineItem,
  listInvoices,
  nextInvoiceNumber,
  getOrder,
  getClient,
  updateOrder,
} from "@/lib/google/sheets";
import { resolvePrice, calculateInvoiceTotals } from "@/lib/pricing-engine";
import { generateInvoicePdf } from "@/lib/pdf-generator";
import { uploadInvoicePdf } from "@/lib/google/drive";
import type { Invoice, InvoiceLineItem } from "@/types";

const LineItemInputSchema = z.object({
  service_type:           z.string().min(1),
  description:            z.string().default(""),
  quantity:               z.number().positive(),
  unit:                   z.enum(["hour","flat","per_item","per_word","per_minute"]).optional(),
  manual_override_price:  z.number().nonnegative().optional(),
  notes:                  z.string().default(""),
});

const CreateInvoiceSchema = z.object({
  order_id:   z.string().uuid(),
  due_days:   z.number().int().nonnegative().default(30),
  notes:      z.string().default(""),
  line_items: z.array(LineItemInputSchema).min(1),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const invoices = await listInvoices({
    client_id: searchParams.get("client_id") ?? undefined,
    status:    searchParams.get("status") ?? undefined,
  });

  return NextResponse.json({ data: invoices });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { order_id, due_days, notes, line_items } = parsed.data;
  const HST_RATE_PCT = Number(process.env.TAX_RATE_PERCENT ?? 13);

  // Fetch order and client
  const order = await getOrder(order_id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const client = await getClient(order.client_id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Apply tax exemption
  const effectiveTaxRate = client.default_tax_exempt ? 0 : HST_RATE_PCT;

  // ── Resolve prices via Pricing Engine ─────────────────────────────────────
  const resolvedItems = await Promise.all(
    line_items.map(async (item) => {
      const priceResult = await resolvePrice({
        client_id:             order.client_id,
        service_type:          item.service_type,
        quantity:              item.quantity,
        unit:                  item.unit,
        manual_override_price: item.manual_override_price,
      });

      const lineItem: InvoiceLineItem = {
        line_item_id: uuidv4(),
        invoice_id:   "", // set after invoice_id is known
        service_type: item.service_type,
        description:  item.description || item.service_type,
        quantity:     item.quantity,
        unit:         priceResult.unit,
        unit_price:   priceResult.unit_price,
        total_price:  priceResult.total_price,
        rate_source:  priceResult.rate_source,
        notes:        item.notes,
      };
      return lineItem;
    })
  );

  // ── Auto-add mileage / parking as flat line items ─────────────────────────
  if (order.mileage_cost > 0) {
    resolvedItems.push({
      line_item_id: uuidv4(),
      invoice_id:   "",
      service_type: "Mileage",
      description:  "Mileage reimbursement",
      quantity:     1,
      unit:         "flat",
      unit_price:   order.mileage_cost,
      total_price:  order.mileage_cost,
      rate_source:  "manual_override",
      notes:        "",
    });
  }
  if (order.parking_cost > 0) {
    resolvedItems.push({
      line_item_id: uuidv4(),
      invoice_id:   "",
      service_type: "Parking",
      description:  "Parking",
      quantity:     1,
      unit:         "flat",
      unit_price:   order.parking_cost,
      total_price:  order.parking_cost,
      rate_source:  "manual_override",
      notes:        "",
    });
  }

  // ── Calculate invoice totals ───────────────────────────────────────────────
  const { subtotal, tax_amount, total } = calculateInvoiceTotals(
    resolvedItems.map((i) => i.total_price),
    effectiveTaxRate
  );

  // ── Build invoice record ───────────────────────────────────────────────────
  const invoiceId     = uuidv4();
  const invoiceNumber = await nextInvoiceNumber(client.abbreviation || "");
  const now           = new Date();
  const issueDate     = now.toISOString().split("T")[0];
  const dueDate       = new Date(now.getTime() + due_days * 86_400_000)
    .toISOString().split("T")[0];

  const invoice: Invoice = {
    invoice_id:       invoiceId,
    invoice_number:   invoiceNumber,
    order_id,
    client_id:        order.client_id,
    status:           "draft",
    issue_date:       issueDate,
    due_date:         dueDate,
    subtotal,
    tax_rate:         effectiveTaxRate,
    tax_amount,
    total,
    drive_file_id:    "",
    drive_file_url:   "",
    paid_at:          "",
    payment_method:   "",
    payment_reference: "",
    notes,
    created_at:       now.toISOString(),
    updated_at:       now.toISOString(),
  };

  // Set invoice_id on line items
  resolvedItems.forEach((item) => { item.invoice_id = invoiceId; });

  // ── Generate PDF ───────────────────────────────────────────────────────────
  const pdfBuffer = await generateInvoicePdf({
    invoice,
    lineItems: resolvedItems,
    client,
  });

  // ── Upload to Drive ────────────────────────────────────────────────────────
  const { fileId, fileUrl } = await uploadInvoicePdf({
    filename:  `${invoiceNumber}.pdf`,
    pdfBuffer,
  });
  invoice.drive_file_id  = fileId;
  invoice.drive_file_url = fileUrl;

  // ── Persist to Sheets ──────────────────────────────────────────────────────
  await createInvoice(invoice);
  await Promise.all(resolvedItems.map((item) => appendLineItem(item)));

  // ── Advance order to completed ─────────────────────────────────────────────
  if (order.status === "in_progress" || order.status === "scheduled") {
    await updateOrder(order_id, { status: "completed" });
  }

  return NextResponse.json(
    { data: { invoice, line_items: resolvedItems } },
    { status: 201 }
  );
}
