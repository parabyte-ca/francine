/**
 * POST /api/invoices/[id]/remind
 *
 * Sends a manual payment reminder email to the client and increments the
 * reminder counter on the invoice row in Sheets.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getInvoice, updateInvoice, getClient } from "@/lib/google/sheets";
import { sendReminderEmail } from "@/lib/google/gmail";

const BodySchema = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await getInvoice(params.id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "void" || invoice.status === "paid") {
    return NextResponse.json({ error: "Cannot send reminder for a paid or voided invoice" }, { status: 400 });
  }
  if (invoice.status === "draft") {
    return NextResponse.json({ error: "Cannot send reminder for a draft invoice — send the invoice first" }, { status: 400 });
  }

  const client = await getClient(invoice.client_id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  const note = parsed.success ? parsed.data.note : undefined;

  const count = Number(invoice.reminder_count) || 0;
  const now   = new Date().toISOString();

  await sendReminderEmail({
    to:            client.email,
    clientName:    client.name,
    invoiceNumber: invoice.invoice_number,
    total:         invoice.total,
    dueDate:       invoice.due_date,
    driveUrl:      invoice.drive_file_url,
    reminderCount: count + 1,
    note,
  });

  await updateInvoice(params.id, {
    reminder_count:   count + 1,
    last_reminder_at: now,
  });

  return NextResponse.json({
    message: `Reminder #${count + 1} sent to ${client.email}`,
  });
}
