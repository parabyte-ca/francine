/**
 * lib/pdf-generator.ts
 *
 * Generates invoice PDFs using pdf-lib (pure JS, no external binaries).
 * The resulting Buffer is passed directly to the Drive uploader and/or
 * attached to the Gmail invoice email.
 *
 * Layout (A4):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Francine Gillis (white on brand blue header)            │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  INVOICE                         # INV-2024-0042         │
 *   │                                  Issue Date: 2024-01-15  │
 *   │  BILL TO:                        Due Date:   2024-02-15  │
 *   │  Client Name                     Status: SENT            │
 *   │  client@email.com                                        │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Description           Duration    Unit Price   Total    │
 *   │  ──────────────────────────────────────────────────────  │
 *   │  ASL-English Interp…   Half Day    $330.00      $330.00  │
 *   ├──────────────────────────────────────────────────────────┤
 *   │                               Subtotal:        $330.00   │
 *   │                               Tax (13%):        $42.90   │
 *   │                               TOTAL:           $372.90   │
 *   └──────────────────────────────────────────────────────────┘
 */

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";
import type { Invoice, InvoiceLineItem, Client } from "@/types";
import { formatDuration } from "./invoice-utils";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const BRAND       = rgb(0.855, 0.467, 0.039); // #d97706 amber-600
const TEXT_DARK   = rgb(0.07, 0.07, 0.07);
const TEXT_MUTED  = rgb(0.42, 0.42, 0.42);
const DIVIDER     = rgb(0.9, 0.9, 0.9);
const HEADER_BG   = rgb(0.996, 0.988, 0.906); // #fef9e8 warm cream

// ---------------------------------------------------------------------------
// Layout constants (points; 1pt = 1/72 inch)
// ---------------------------------------------------------------------------

const PAGE_W = 595.28;  // A4 width
const PAGE_H = 841.89;  // A4 height
const MARGIN  = 50;

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateInvoicePdf(params: {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  client: Client;
  companyName?: string;
  companyAddress?: string;
}): Promise<Buffer> {
  const { invoice, lineItems, client } = params;
  const companyName = params.companyName
    ?? process.env.NEXT_PUBLIC_BUSINESS_NAME
    ?? "Francine Gillis";

  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const boldFont    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // ── Header bar ────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: PAGE_H - 90,
    width: PAGE_W, height: 90,
    color: BRAND,
  });

  drawText(page, boldFont, companyName, MARGIN, PAGE_H - 45, 22, { color: rgb(1,1,1) });

  // ── "INVOICE" — left side, directly under the name ───────────────────────
  let y = PAGE_H - 110;
  drawText(page, boldFont, "INVOICE", MARGIN, y, 20, { color: BRAND });

  // ── Invoice metadata (right column) ───────────────────────────────────────
  const metaX = PAGE_W - 220;
  drawText(page, regularFont, `# ${invoice.invoice_number}`, metaX, y, 11, { color: TEXT_DARK });
  y -= 16;
  drawText(page, regularFont, `Issue Date: ${formatDate(invoice.issue_date)}`, metaX, y, 10, { color: TEXT_MUTED });
  y -= 14;
  drawText(page, regularFont, `Due Date:   ${formatDate(invoice.due_date)}`,   metaX, y, 10, { color: TEXT_MUTED });
  y -= 14;
  drawText(page, regularFont, `Status: ${invoice.status.toUpperCase()}`, metaX, y, 10, {
    color: invoice.status === "paid" ? rgb(0.1, 0.6, 0.2) : TEXT_MUTED,
  });

  // ── Bill To (pushed down 25 pts to clear INVOICE label) ───────────────────
  const billY = PAGE_H - 140;
  drawText(page, boldFont, "BILL TO", MARGIN, billY, 9, { color: TEXT_MUTED });
  drawText(page, boldFont, client.name, MARGIN, billY - 16, 13, { color: TEXT_DARK });
  if (client.company) drawText(page, regularFont, client.company, MARGIN, billY - 30, 10, { color: TEXT_DARK });
  drawText(page, regularFont, client.email, MARGIN, billY - 44, 10, { color: TEXT_MUTED });
  if (client.phone) drawText(page, regularFont, client.phone, MARGIN, billY - 58, 10, { color: TEXT_MUTED });

  y = billY - 80;

  // ── Divider ───────────────────────────────────────────────────────────────
  drawHRule(page, y);
  y -= 4;

  // ── Line-item table header ────────────────────────────────────────────────
  const COL = { desc: MARGIN, duration: 330, price: 415, total: 495 };

  page.drawRectangle({
    x: MARGIN - 4, y: y - 20,
    width: PAGE_W - 2 * MARGIN + 8, height: 22,
    color: HEADER_BG,
  });

  const th = (label: string, x: number) =>
    drawText(page, boldFont, label, x, y - 14, 9, { color: TEXT_MUTED });
  th("DESCRIPTION", COL.desc);
  th("DURATION",    COL.duration);
  th("UNIT PRICE",  COL.price);
  th("TOTAL",       COL.total);

  y -= 28;
  drawHRule(page, y + 8, 0.5);

  // ── Line items ────────────────────────────────────────────────────────────
  for (const item of lineItems) {
    if (y < 150) break; // TODO: page break for very long invoices

    const desc = truncate(`${item.description || item.service_type}`, 52);
    drawText(page, regularFont, desc,                       COL.desc,     y - 6, 10, { color: TEXT_DARK });
    drawText(page, regularFont, formatDuration(item),       COL.duration, y - 6, 10, { color: TEXT_DARK });
    drawText(page, regularFont, formatCurrency(item.unit_price), COL.price, y - 6, 10);
    drawText(page, boldFont,    formatCurrency(item.total_price), COL.total, y - 6, 10, { color: TEXT_DARK });

    if (item.rate_source === "custom") {
      drawText(page, regularFont, "(custom rate)", COL.desc, y - 17, 7.5, { color: TEXT_MUTED });
      y -= 26;
    } else {
      y -= 20;
    }

    drawHRule(page, y + 4, 0.3);
  }

  y -= 12;

  // ── Totals block ──────────────────────────────────────────────────────────
  const totX = PAGE_W - MARGIN - 160;

  const drawTotal = (label: string, value: string, bold = false, highlight = false) => {
    const font  = bold ? boldFont : regularFont;
    const size  = bold ? 12 : 10;
    const color = highlight ? BRAND : TEXT_DARK;
    drawText(page, font, label, totX, y, size, { color: TEXT_MUTED });
    drawText(page, font, value, PAGE_W - MARGIN - 2, y, size, { color, align: "right" });
    y -= (bold ? 20 : 16);
  };

  drawHRule(page, y + 8);
  drawTotal("Subtotal", formatCurrency(invoice.subtotal));
  if (invoice.tax_rate > 0) {
    drawTotal(`Tax (${invoice.tax_rate}%)`, formatCurrency(invoice.tax_amount));
  }
  drawHRule(page, y + 8, 1.5);
  y -= 4;
  drawTotal("TOTAL DUE", formatCurrency(invoice.total), true, true);

  // ── Footer ────────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_W, height: 40,
    color: HEADER_BG,
  });
  drawText(page, regularFont, `Thank you for your business — ${companyName}`,
    PAGE_W / 2, 22, 9, { color: TEXT_MUTED, align: "center" });

  // ── Serialize ─────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string | number | null | undefined,
  x: number,
  y: number,
  size: number,
  options?: { color?: ReturnType<typeof rgb>; align?: "left" | "center" | "right" }
): void {
  const str   = String(text ?? "");
  const color = options?.color ?? TEXT_DARK;
  let drawX = x;

  if (options?.align === "center") {
    const w = font.widthOfTextAtSize(str, size);
    drawX = x - w / 2;
  } else if (options?.align === "right") {
    const w = font.widthOfTextAtSize(str, size);
    drawX = x - w;
  }

  page.drawText(str, { x: drawX, y, size, font, color });
}

function drawHRule(page: PDFPage, y: number, thickness = 0.75): void {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness,
    color: DIVIDER,
  });
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
