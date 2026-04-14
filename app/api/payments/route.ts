/**
 * GET  /api/payments          — payment dashboard data (aggregates + outstanding invoices)
 * POST /api/payments/record   — mark an invoice as paid
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listInvoices, updateInvoice, getInvoice, getClient } from "@/lib/google/sheets";
import { sendPaymentReceiptEmail } from "@/lib/google/gmail";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status"); // "paid" | "pending" | "overdue"

  const allInvoices = await listInvoices();
  const today = new Date().toISOString().split("T")[0];

  // Mark overdue invoices on the fly (read-only here; a background job should
  // update the sheet periodically)
  const enriched = allInvoices.map((inv) => ({
    ...inv,
    is_overdue:
      inv.status === "sent" &&
      inv.due_date < today,
  }));

  // Dashboard aggregates
  const stats = {
    total_outstanding: enriched
      .filter((i) => i.status !== "paid" && i.status !== "void")
      .reduce((s, i) => s + i.total, 0),
    total_paid_ytd: enriched
      .filter(
        (i) =>
          i.status === "paid" &&
          i.paid_at.startsWith(String(new Date().getFullYear()))
      )
      .reduce((s, i) => s + i.total, 0),
    overdue_count: enriched.filter((i) => i.is_overdue).length,
    draft_count:   enriched.filter((i) => i.status === "draft").length,
  };

  let filtered = enriched;
  if (statusFilter === "overdue") filtered = enriched.filter((i) => i.is_overdue);
  else if (statusFilter) filtered = enriched.filter((i) => i.status === statusFilter);

  return NextResponse.json({ data: { invoices: filtered, stats } });
}

// ---------------------------------------------------------------------------
// POST /api/payments/record  (record payment)
// ---------------------------------------------------------------------------

const RecordPaymentSchema = z.object({
  invoice_id:        z.string().uuid(),
  payment_method:    z.enum(["cash","cheque","e-transfer","credit_card","bank_transfer","other"]),
  payment_reference: z.string().default(""),
  send_receipt:      z.boolean().default(true),
});

// Note: this sits at /api/payments but is consumed as POST /api/payments
// The GET above handles dashboard; POST handles payment recording.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = RecordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { invoice_id, payment_method, payment_reference, send_receipt } = parsed.data;

  const invoice = await getInvoice(invoice_id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "Invoice already marked as paid" }, { status: 400 });
  }

  const paidAt = new Date().toISOString();

  await updateInvoice(invoice_id, {
    status:            "paid",
    paid_at:           paidAt,
    payment_method,
    payment_reference,
  });

  if (send_receipt) {
    const client = await getClient(invoice.client_id);
    if (client) {
      sendPaymentReceiptEmail({
        to:            client.email,
        clientName:    client.name,
        invoiceNumber: invoice.invoice_number,
        amountPaid:    invoice.total,
        paidAt:        new Date(paidAt).toLocaleDateString("en-CA"),
      }).catch((err) => console.error("Receipt email failed:", err));
    }
  }

  return NextResponse.json({
    message: `Invoice ${invoice.invoice_number} marked as paid`,
    paid_at: paidAt,
  });
}
