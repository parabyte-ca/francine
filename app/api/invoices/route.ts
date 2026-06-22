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
import { computeClientAbbr } from "@/lib/invoice-utils";
import {
  createInvoice,
  appendLineItem,
  listInvoices,
  nextInvoiceNumber,
  getOrder,
  getClient,
  updateOrder,
} from "@/lib/google/sheets";
import { resolvePrice, calculateInvoiceTotals, PricingError } from "@/lib/pricing-engine";
import { generateInvoicePdf } from "@/lib/pdf-generator";
import { uploadInvoicePdf } from "@/lib/google/drive";
import { sendInvoiceEmail } from "@/lib/google/gmail";
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
  order_id:      z.string().uuid(),
  due_days:      z.number().int().nonnegative().default(30),
  notes:         z.string().default(""),
  status:        z.enum(["draft", "sent"]).default("draft"),
  contact_name:  z.string().default(""),
  contact_title: z.string().default(""),
  line_items:    z.array(LineItemInputSchema).min(1),
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

  const { order_id, due_days, notes, status: requestedStatus, line_items, contact_name, contact_title } = parsed.data;
  const HST_RATE_PCT = Number(process.env.TAX_RATE_PERCENT ?? 13);

  // Fetch order and client
  const order = await getOrder(order_id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const client = await getClient(order.client_id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Apply tax exemption
  const effectiveTaxRate = client.default_tax_exempt ? 0 : HST_RATE_PCT;

  try {
    // ── Resolve prices via Pricing Engine ───────────────────────────────────
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
          invoice_id:   "",
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

    // ── Calculate invoice totals ─────────────────────────────────────────────
    const { subtotal, tax_amount, total } = calculateInvoiceTotals(
      resolvedItems.map((i) => i.total_price),
      effectiveTaxRate
    );

    // ── Build invoice record ─────────────────────────────────────────────────
    const invoiceId     = uuidv4();
    const invoiceNumber = await nextInvoiceNumber(computeClientAbbr(client.company, client.name));
    const now           = new Date();
    const issueDate     = now.toISOString().split("T")[0];
    const dueDate       = new Date(now.getTime() + due_days * 86_400_000)
      .toISOString().split("T")[0];

    const invoice: Invoice = {
      invoice_id:       invoiceId,
      invoice_number:   invoiceNumber,
      order_id,
      client_id:        order.client_id,
      status:           requestedStatus,
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
      contact_name:  contact_name || client.name,
      contact_title,
      sent_at:          requestedStatus === "sent" ? now.toISOString() : "",
      created_at:       now.toISOString(),
      updated_at:       now.toISOString(),
    };

    // Set invoice_id on line items
    resolvedItems.forEach((item) => { item.invoice_id = invoiceId; });

    // ── Generate PDF & upload to Drive (non-fatal) ───────────────────────────
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await generateInvoicePdf({
        invoice,
        lineItems: resolvedItems,
        client,
      });
      const { fileId, fileUrl } = await uploadInvoicePdf({
        filename:  `${invoiceNumber}.pdf`,
        pdfBuffer,
      });
      invoice.drive_file_id  = fileId;
      invoice.drive_file_url = fileUrl;
    } catch (pdfErr) {
      console.error("PDF/Drive upload failed (invoice will be saved without PDF):", pdfErr);
    }

    // ── Persist to Sheets ────────────────────────────────────────────────────
    await createInvoice(invoice);
    await Promise.all(resolvedItems.map((item) => appendLineItem(item)));

    // ── Advance order to completed ───────────────────────────────────────────
    if (order.status === "scheduled") {
      await updateOrder(order_id, { status: "completed" });
    }

    // ── Send invoice email immediately when status is "sent" (non-fatal) ─────
    let emailWarning: string | undefined;
    if (requestedStatus === "sent") {
      try {
          const buf = pdfBuffer ?? await generateInvoicePdf({ invoice, lineItems: resolvedItems, client });
        await sendInvoiceEmail({
          to:            client.email,
          clientName:    client.name,
          invoiceNumber: invoice.invoice_number,
          total:         invoice.total,
          dueDate:       invoice.due_date,
          driveUrl:      invoice.drive_file_url,
          pdfBuffer:     buf,
        });
      } catch (emailErr) {
        const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
        console.error("Invoice email failed:", msg);
        emailWarning = `Invoice saved, but the email could not be sent: ${msg}`;
      }
    }

    return NextResponse.json(
      { data: { invoice, line_items: resolvedItems }, ...(emailWarning ? { email_warning: emailWarning } : {}) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Invoice generation failed:", msg);
    return NextResponse.json({ error: `Invoice generation failed: ${msg}` }, { status: 500 });
  }
}
