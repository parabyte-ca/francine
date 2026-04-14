/**
 * POST /api/invoices/[id]/send
 *
 * Sends the invoice PDF to the client via Gmail and updates status to "sent".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getInvoice,
  updateInvoice,
  getClient,
  listLineItems,
} from "@/lib/google/sheets";
import { downloadFile } from "@/lib/google/drive";
import { sendInvoiceEmail } from "@/lib/google/gmail";
import { generateInvoicePdf } from "@/lib/pdf-generator";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await getInvoice(params.id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "void") {
    return NextResponse.json({ error: "Cannot send a voided invoice" }, { status: 400 });
  }

  const client = await getClient(invoice.client_id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Fetch PDF — try Drive first, regenerate if missing
  let pdfBuffer: Buffer;
  if (invoice.drive_file_id) {
    pdfBuffer = await downloadFile(invoice.drive_file_id);
  } else {
    const lineItems = await listLineItems(invoice.invoice_id);
    pdfBuffer = await generateInvoicePdf({ invoice, lineItems, client });
  }

  await sendInvoiceEmail({
    to:            client.email,
    clientName:    client.name,
    invoiceNumber: invoice.invoice_number,
    total:         invoice.total,
    dueDate:       invoice.due_date,
    driveUrl:      invoice.drive_file_url,
    pdfBuffer,
  });

  await updateInvoice(params.id, { status: "sent" });

  return NextResponse.json({ message: `Invoice ${invoice.invoice_number} sent to ${client.email}` });
}
