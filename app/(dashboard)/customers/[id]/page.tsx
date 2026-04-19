import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import {
  getClient,
  listOrders,
  listInvoices,
  listCustomRates,
  listStandardRates,
} from "@/lib/google/sheets";
import { ArrowLeft, Star, DollarSign, ClipboardList, FileText } from "lucide-react";
import type { Metadata } from "next";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const client = await getClient(params.id);
  return { title: client ? `${client.name} — Customer 360` : "Customer" };
}

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) notFound();

  const [orders, invoices, customRates, standardRates] = await Promise.all([
    listOrders({ client_id: params.id }),
    listInvoices({ client_id: params.id }),
    listCustomRates(params.id),
    listStandardRates(),
  ]);

  const totalBilled      = invoices.reduce((s, i) => s + i.total, 0);
  const outstanding      = invoices.filter((i) => i.status !== "paid" && i.status !== "void").reduce((s, i) => s + i.total, 0);
  const standardRateMap  = Object.fromEntries(standardRates.map((r) => [r.service_type, r]));
  const customRateMap    = Object.fromEntries(customRates.map((r) => [r.service_type, r]));

  const initials = client.name.split(" ").map((n) => n[0]).slice(0, 2).join("");

  return (
    <>
      <Topbar
        title={client.name}
        subtitle="Customer 360 View"
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
                <h2 className="text-xl font-bold text-gray-900">{client.name}</h2>
                {client.has_custom_rates && (
                  <span className="badge-yellow flex items-center gap-1">
                    <Star className="w-3 h-3" /> Custom Rates
                  </span>
                )}
                {client.default_tax_exempt && (
                  <span className="badge-green">Tax Exempt</span>
                )}
              </div>
              {client.company && <p className="text-gray-500 text-sm mt-0.5">{client.company}</p>}
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-600">
                <span>{client.email}</span>
                {client.phone && <span>{client.phone}</span>}
                {client.address && <span>{client.address}</span>}
                {client.language_pair && <span className="badge-blue">{client.language_pair}</span>}
              </div>
              {client.notes && <p className="mt-3 text-sm text-gray-500 italic">{client.notes}</p>}
            </div>
            <Link href={`/customers/${params.id}/edit`} className="btn-secondary flex-shrink-0">
              Edit
            </Link>
          </div>

          {/* Aggregate stats */}
          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t">
            {[
              { label: "Total Orders",   value: orders.length,              icon: ClipboardList },
              { label: "Total Billed",   value: `$${totalBilled.toFixed(2)}`, icon: DollarSign },
              { label: "Outstanding",    value: `$${outstanding.toFixed(2)}`,  icon: FileText },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Rate card */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Rate Card</h3>
            <div className="space-y-2">
              {standardRates.map((rate) => {
                const custom = customRateMap[rate.service_type];
                return (
                  <div key={rate.rate_id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                    <span className="text-gray-700">{rate.service_type}</span>
                    <div className="text-right">
                      {custom ? (
                        <>
                          <span className="font-bold text-yellow-700">${custom.override_price}/{custom.unit}</span>
                          <span className="ml-2 text-xs line-through text-gray-400">${rate.base_price}</span>
                          <span className="ml-1 text-xs badge-yellow">custom</span>
                        </>
                      ) : (
                        <span className="text-gray-900">${rate.base_price}/{rate.unit}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href={`/customers/${params.id}/rates`} className="btn-secondary w-full justify-center mt-4 text-xs">
              Manage Custom Rates
            </Link>
          </div>

          {/* Service history */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Service History</h3>
              <Link href={`/orders/new?client_id=${params.id}`} className="btn-primary text-xs py-1.5">
                + New Order
              </Link>
            </div>
            <div className="space-y-2">
              {orders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No orders yet</p>
              ) : (
                orders.slice(0, 8).map((order) => (
                  <Link
                    key={order.order_id}
                    href={`/orders/${order.order_id}`}
                    className="flex items-center justify-between py-2 border-b last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{order.service_type}</p>
                      <p className="text-xs text-gray-400">{order.scheduled_date?.split("T")[0] || order.requested_date?.split("T")[0] || "—"}</p>
                    </div>
                    <StatusBadge status={order.status} />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Invoice history */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">Invoice History</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No invoices yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-gray-500">
                  <th className="pb-2 font-medium pr-4">Invoice #</th>
                  <th className="pb-2 font-medium pr-4">Date</th>
                  <th className="pb-2 font-medium pr-4">Due</th>
                  <th className="pb-2 font-medium pr-4">Total</th>
                  <th className="pb-2 font-medium pr-4">Status</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.invoice_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="py-2 pr-4 text-gray-600">{inv.issue_date}</td>
                    <td className="py-2 pr-4 text-gray-600">{inv.due_date}</td>
                    <td className="py-2 pr-4 font-medium">${inv.total.toFixed(2)}</td>
                    <td className="py-2 pr-4"><StatusBadge status={inv.status} /></td>
                    <td className="py-2">
                      {inv.drive_file_url && (
                        <a href={inv.drive_file_url} target="_blank" rel="noopener noreferrer"
                           className="text-brand-600 hover:underline text-xs">PDF</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
