import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import { getInvoice, getClient, listLineItems, getOrder } from "@/lib/google/sheets";
import { ArrowLeft, FileText, ExternalLink, Download } from "lucide-react";
import { formatDuration } from "@/lib/invoice-utils";
import InvoiceActions from "./InvoiceActions";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const invoice = await getInvoice(params.id);
  return { title: invoice ? `${invoice.invoice_number}` : "Invoice" };
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const invoice = await getInvoice(params.id);
  if (!invoice) notFound();

  const [client, lineItems, order] = await Promise.all([
    getClient(invoice.client_id),
    listLineItems(invoice.invoice_id),
    invoice.order_id ? getOrder(invoice.order_id) : Promise.resolve(null),
  ]);

  return (
    <>
      <Topbar
        title={invoice.invoice_number}
        subtitle="Invoice details"
        actions={
          <Link href="/invoices" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6">

        {/* Header */}
        <div className="card">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900 font-mono">{invoice.invoice_number}</h2>
                <StatusBadge status={invoice.status} />
              </div>
              {client && (
                <div className="mt-1 space-y-0.5">
                  {/* Contact name + title (FR-026) */}
                  {(invoice.contact_name || invoice.contact_title) && (
                    <p className="text-sm font-medium text-gray-800">
                      {invoice.contact_name || client.name}
                      {invoice.contact_title && (
                        <span className="font-normal text-gray-500"> — {invoice.contact_title}</span>
                      )}
                    </p>
                  )}
                  {client.company && (
                    <p className="text-sm text-gray-700">{client.company}</p>
                  )}
                  <Link href={`/customers/${client.client_id}`} className="text-xs text-brand-600 hover:underline">
                    {client.name}
                  </Link>
                </div>
              )}
              {order && (
                <div className="mt-1">
                  <Link href={`/orders/${order.order_id}`} className="text-xs text-gray-500 hover:underline">
                    Order: {order.service_type}
                  </Link>
                </div>
              )}
            </div>
            <InvoiceActions
              invoiceId={invoice.invoice_id}
              status={invoice.status}
              driveFileUrl={invoice.drive_file_url}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t text-sm">
            <div>
              <p className="text-xs text-gray-500">Issue Date</p>
              <p className="text-gray-900">{invoice.issue_date}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Due Date</p>
              <p className="text-gray-900">{invoice.due_date}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">HST</p>
              <p className="text-gray-900">{invoice.tax_rate}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-gray-900 font-semibold">${invoice.total.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-600" /> Line Items
          </h3>
          {lineItems.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No line items</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-gray-500">
                    <th className="pb-2 font-medium pr-4">Description</th>
                    <th className="pb-2 font-medium pr-4 text-right">Rate</th>
                    <th className="pb-2 font-medium pr-4 text-right">Unit Price</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.line_item_id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-gray-800">{item.description || item.service_type}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{formatDuration(item)}</td>
                      <td className="py-2 pr-4 text-right">${item.unit_price.toFixed(2)}</td>
                      <td className="py-2 text-right font-medium">${item.total_price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm">
                    <td colSpan={3} className="pt-4 pr-4 text-right text-gray-500">Subtotal</td>
                    <td className="pt-4 text-right">${invoice.subtotal.toFixed(2)}</td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={3} className="py-1 pr-4 text-right text-gray-500">HST ({invoice.tax_rate}%)</td>
                    <td className="py-1 text-right">${invoice.tax_amount.toFixed(2)}</td>
                  </tr>
                  <tr className="text-sm font-semibold">
                    <td colSpan={3} className="pt-2 pr-4 text-right text-gray-900 border-t">Total</td>
                    <td className="pt-2 text-right text-gray-900 border-t">${invoice.total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Payment info */}
        {invoice.status === "paid" && (
          <div className="card bg-green-50 border-green-200">
            <h3 className="font-semibold text-green-900 mb-2">Payment Received</h3>
            <div className="text-sm text-green-800 space-y-1">
              <p>Paid {invoice.paid_at?.split("T")[0]} via {invoice.payment_method}</p>
              {invoice.payment_reference && <p>Reference: {invoice.payment_reference}</p>}
            </div>
          </div>
        )}

        {invoice.notes && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-2">Notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-600" /> Invoice PDF
          </h3>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/invoices/${invoice.invoice_id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              <ExternalLink className="w-4 h-4" /> Preview
            </a>
            <a
              href={`/api/invoices/${invoice.invoice_id}/pdf?download=1`}
              download={`${invoice.invoice_number}.pdf`}
              className="btn-primary text-sm"
            >
              <Download className="w-4 h-4" /> Download PDF
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
