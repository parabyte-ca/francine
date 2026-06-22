/**
 * Public client-facing invoice view — no authentication required.
 * Invoice UUIDs are 128-bit random and not guessable; this is standard
 * practice for invoice share links (Wave, FreshBooks, etc.).
 */

import { notFound } from "next/navigation";
import { getInvoice, getClient, listLineItems } from "@/lib/google/sheets";
import { formatDuration } from "@/lib/invoice-utils";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const invoice = await getInvoice(params.id);
  return {
    title: invoice ? `Invoice ${invoice.invoice_number}` : "Invoice",
    robots: { index: false, follow: false },
  };
}

export default async function ClientInvoicePage({ params }: { params: { id: string } }) {
  const invoice = await getInvoice(params.id);
  if (!invoice || invoice.status === "void") notFound();

  const [client, lineItems] = await Promise.all([
    getClient(invoice.client_id),
    listLineItems(invoice.invoice_id),
  ]);
  if (!client) notFound();

  const companyName  = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "Francine Gillis";
  const companyTitle = process.env.BUSINESS_TITLE            ?? "ASL/English Interpreter";
  const replyEmail   = process.env.GMAIL_FROM_ADDRESS        ?? "";

  const isPaid    = invoice.status === "paid";
  const isOverdue = invoice.status === "overdue";
  const isDraft   = invoice.status === "draft";

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Draft banner — visible to staff previewing an unsent invoice */}
        {isDraft && (
          <div className="flex items-center justify-center gap-2 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm font-medium text-yellow-800">
            DRAFT — This invoice has not been sent to the client yet
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

          {/* ── Company header ────────────────────────────────────────────── */}
          <div className="bg-brand-600 px-6 py-5 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold leading-tight">{companyName}</h1>
                <p className="text-sm text-amber-100 mt-0.5">{companyTitle}</p>
              </div>
              {replyEmail && (
                <p className="text-xs text-amber-200 mt-1 text-right">{replyEmail}</p>
              )}
            </div>
          </div>

          {/* ── Invoice number + dates + status ───────────────────────────── */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Invoice</p>
                <p className="text-2xl font-bold font-mono text-gray-900">{invoice.invoice_number}</p>
              </div>
              <div className="text-right space-y-1.5">
                <div className="flex items-center gap-3 justify-end">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Issued</span>
                  <span className="text-sm font-medium text-gray-900">{invoice.issue_date}</span>
                </div>
                <div className="flex items-center gap-3 justify-end">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Due</span>
                  <span className={`text-sm font-medium ${isOverdue ? "text-red-600" : "text-gray-900"}`}>
                    {invoice.due_date}
                  </span>
                </div>
                {isPaid && (
                  <span className="inline-block px-2.5 py-0.5 bg-green-100 text-green-800 text-xs font-bold rounded-full tracking-wide">
                    PAID
                  </span>
                )}
                {isOverdue && (
                  <span className="inline-block px-2.5 py-0.5 bg-red-100 text-red-800 text-xs font-bold rounded-full tracking-wide">
                    OVERDUE
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Bill To ───────────────────────────────────────────────────── */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Bill To</p>
            <p className="font-semibold text-gray-900">{invoice.contact_name || client.name}</p>
            {invoice.contact_title && (
              <p className="text-sm text-gray-600">{invoice.contact_title}</p>
            )}
            {client.company && (
              <p className="text-sm text-gray-600">{client.company}</p>
            )}
            {client.department && (
              <p className="text-sm text-gray-500">{client.department}</p>
            )}
          </div>

          {/* ── Line items ────────────────────────────────────────────────── */}
          <div className="px-6 py-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-2.5 text-left font-medium text-gray-500">Description</th>
                  <th className="pb-2.5 text-right font-medium text-gray-500 pr-4">Rate</th>
                  <th className="pb-2.5 text-right font-medium text-gray-500 pr-4">Unit Price</th>
                  <th className="pb-2.5 text-right font-medium text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.line_item_id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 pr-4 text-gray-800">{item.description || item.service_type}</td>
                    <td className="py-3 pr-4 text-right text-gray-500">{formatDuration(item)}</td>
                    <td className="py-3 pr-4 text-right text-gray-800">${item.unit_price.toFixed(2)}</td>
                    <td className="py-3 text-right font-medium text-gray-900">${item.total_price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-4 pr-4 text-right text-gray-500">Subtotal</td>
                  <td className="pt-4 text-right text-gray-800">${invoice.subtotal.toFixed(2)}</td>
                </tr>
                {invoice.tax_rate > 0 && (
                  <tr>
                    <td colSpan={3} className="py-1 pr-4 text-right text-gray-500">
                      HST ({invoice.tax_rate}%)
                    </td>
                    <td className="py-1 text-right text-gray-800">${invoice.tax_amount.toFixed(2)}</td>
                  </tr>
                )}
                <tr className="font-semibold text-gray-900">
                  <td colSpan={3} className="pt-3 pr-4 text-right border-t border-gray-200">
                    Total Due
                  </td>
                  <td className="pt-3 text-right border-t border-gray-200 text-brand-700">
                    ${invoice.total.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Payment confirmation ───────────────────────────────────────── */}
          {isPaid && (
            <div className="mx-6 mb-5 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-semibold text-green-900">Payment Received — Thank you!</p>
              <p className="text-sm text-green-800 mt-0.5">
                Paid {invoice.paid_at?.split("T")[0]} via{" "}
                {invoice.payment_method?.replace(/_/g, " ")}
              </p>
              {invoice.payment_reference && (
                <p className="text-xs text-green-700 mt-0.5">
                  Reference: {invoice.payment_reference}
                </p>
              )}
            </div>
          )}

          {/* ── Notes ─────────────────────────────────────────────────────── */}
          {invoice.notes && (
            <div className="mx-6 mb-5 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}

          {/* ── Download PDF ──────────────────────────────────────────────── */}
          {invoice.drive_file_url && (
            <div className="px-6 pb-6">
              <a
                href={invoice.drive_file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </a>
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <div className="px-6 py-4 bg-brand-50 border-t border-amber-100 text-center">
            <p className="text-xs text-gray-500">
              Thank you for your business — {companyName}
            </p>
            {replyEmail && (
              <p className="text-xs text-gray-400 mt-1">
                Questions? Email{" "}
                <a href={`mailto:${replyEmail}`} className="text-brand-600 hover:underline">
                  {replyEmail}
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
