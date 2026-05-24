/**
 * GET /api/invoices/[id]/pdf
 *
 * Serves the invoice PDF as application/pdf.
 * - Tries Drive first (fast, cached); regenerates on-the-fly if missing.
 * - ?download=1 → Content-Disposition: attachment (triggers browser download)
 * - Default     → Content-Disposition: inline (opens in browser PDF viewer)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoice, getClient, listLineItems } from "@/lib/google/sheets";
import { downloadFile } from "@/lib/google/drive";
import { generateInvoicePdf } from "@/lib/pdf-generator";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await getInvoice(params.id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let pdfBuffer: Buffer;
  if (invoice.drive_file_id) {
    pdfBuffer = await downloadFile(invoice.drive_file_id);
  } else {
    const [client, lineItems] = await Promise.all([
      getClient(invoice.client_id),
      listLineItems(invoice.invoice_id),
    ]);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    pdfBuffer = await generateInvoicePdf({ invoice, lineItems, client });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const filename = `${invoice.invoice_number}.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
}
