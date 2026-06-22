import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import {
  getClient,
  listOrders,
  listInvoices,
} from "@/lib/google/sheets";
import { ArrowLeft, Star, DollarSign, ClipboardList, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import type { Invoice, Order } from "@/types";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const client = await getClient(params.id);
  return { title: client ? `${client.company || client.name} — Client 360` : "Client" };
}

function entityName(company: string, department: string): string {
  if (company && department) return `${company} — ${department}`;
  return company || "—";
}

function statusColor(inv: Invoice | null, order: Order): string {
  if (!inv) return "";
  if (inv.status === "paid") return "text-green-700 bg-green-50 border-green-200";
  if (inv.status === "sent" || inv.status === "overdue") return "text-red-700 bg-red-50 border-red-200";
  return "text-gray-600 bg-gray-50 border-gray-200";
}

function statusLabel(inv: Invoice | null, order: Order): string {
  if (!inv) return order.status;
  if (inv.status === "paid") return "Paid";
  if (inv.status === "sent") return "Unpaid";
  if (inv.status === "overdue") return "Overdue";
  if (inv.status === "draft") return "Draft";
  return inv.status;
}

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) notFound();

  const [orders, invoices] = await Promise.all([
    listOrders({ client_id: params.id }),
    listInvoices({ client_id: params.id }),
  ]);

  const totalBilled   = invoices
    .filter((i) => i.status !== "void" && i.status !== "draft")
    .reduce((s, i) => s + i.total, 0);
  const outstandingInvoices = invoices.filter(
    (i) => i.status === "sent" || i.status === "overdue"
  );
  const outstanding     = outstandingInvoices.reduce((s, i) => s + i.total, 0);
  const outstandingCount = outstandingInvoices.length;

  // Build invoice map by order_id for the unified history
  const invoiceByOrder = new Map<string, Invoice>();
  for (const inv of invoices) {
    if (inv.order_id && !invoiceByOrder.has(inv.order_id)) {
      invoiceByOrder.set(inv.order_id, inv);
    }
  }

  // Unified history: all orders, newest first
  const historyRows = [...orders].sort(
    (a, b) =>
      new Date(b.requested_date || b.created_at).getTime() -
      new Date(a.requested_date || a.created_at).getTime()
  );

  const initials = (client.abbreviation || client.name.slice(0, 2)).toUpperCase();
  const displayName = entityName(client.company, client.department ?? "");

  return (
    <>
      <Topbar
        title={displayName}
        subtitle="Client 360 View"
        actions={
          <Link href="/customers" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* Header card */}
        <div className="card">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">{displayName}</h2>
                {client.has_custom_rates && (
                  <span className="badge-yellow flex items-center gap-1">
                    <Star className="w-3 h-3" /> Custom Rates
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-0.5">
                {client.name}
                {client.email && <span className="text-gray-400"> · {client.email}</span>}
                {client.phone && <span className="text-gray-400"> · {client.phone}</span>}
              </p>
              {(client.street || client.city) && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {[client.street, client.city, client.province, client.postal_code].filter(Boolean).join(", ")}
                </p>
              )}
              {client.drive_folder_url && (
                <a
                  href={client.drive_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  <ExternalLink className="w-3 h-3" /> Open in Drive
                </a>
              )}
              {client.notes && <p className="mt-2 text-sm text-gray-500 italic">{client.notes}</p>}
            </div>
            <Link href={`/customers/${params.id}/edit`} className="btn-secondary flex-shrink-0">
              Edit
            </Link>
          </div>

          {/* Aggregate stats */}
          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t">
            <div className="text-center">
              <ClipboardList className="w-5 h-5 text-gray-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
              <p className="text-xs text-gray-500">Total Bookings</p>
            </div>
            <div className="text-center">
              <DollarSign className="w-5 h-5 text-gray-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-gray-900">${totalBilled.toFixed(2)}</p>
              <p className="text-xs text-gray-500">Total Billed</p>
            </div>
            <div className="text-center">
              <DollarSign className="w-5 h-5 text-gray-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-gray-900">${outstanding.toFixed(2)}</p>
              <p className="text-xs text-gray-500">
                Outstanding
                {outstandingCount > 0 && (
                  <span className="ml-1 text-red-500">({outstandingCount} {outstandingCount === 1 ? "booking" : "bookings"})</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Unified booking + invoice history */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Booking History</h3>
            <Link href={`/orders/new?client_id=${params.id}`} className="btn-primary text-xs py-1.5">
              + New Booking
            </Link>
          </div>
          {historyRows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No bookings yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-gray-500">
                    <th className="pb-2 font-medium pr-4">Date</th>
                    <th className="pb-2 font-medium pr-4">Event Description</th>
                    <th className="pb-2 font-medium pr-4">Invoice #</th>
                    <th className="pb-2 font-medium pr-4">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((order) => {
                    const inv = invoiceByOrder.get(order.order_id) ?? null;
                    const colorClass = statusColor(inv, order);
                    return (
                      <tr key={order.order_id} className="border-b last:border-0">
                        <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                          {(order.requested_date || order.scheduled_date)?.split("T")[0] || "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-800 max-w-[12rem] truncate">
                          <Link href={`/orders/${order.order_id}`} className="hover:text-brand-600 hover:underline">
                            {order.description || <span className="text-gray-400 italic">—</span>}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {inv ? (
                            <Link href={`/invoices/${inv.invoice_id}`} className="text-brand-600 hover:underline">
                              {inv.invoice_number}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 font-medium text-gray-800">
                          {inv ? `$${inv.total.toFixed(2)}` : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass || "text-gray-600 bg-gray-50 border-gray-200"}`}>
                            {statusLabel(inv, order)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
