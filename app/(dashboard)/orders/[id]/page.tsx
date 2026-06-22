import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import {
  getOrder,
  getClient,
  listInvoices,
  listAppointments,
} from "@/lib/google/sheets";
import { ArrowLeft, User, Clock, MapPin, FileText, CalendarDays } from "lucide-react";
import OrderActions from "./OrderActions";
import OrderExpenses from "./OrderExpenses";
import type { Metadata } from "next";
import type { Order } from "@/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const order = await getOrder(params.id);
  return { title: order ? `${order.description || order.service_type} — Booking` : "Booking" };
}

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const order = await getOrder(params.id);
  if (!order) notFound();

  const [client, invoices, appointments] = await Promise.all([
    getClient(order.client_id),
    listInvoices({ client_id: order.client_id }),
    listAppointments({ order_id: params.id }),
  ]);

  const orderInvoices = invoices.filter((i) => i.order_id === params.id);

  const bookingTitle = client?.abbreviation && order.description
    ? `${client.abbreviation} ${order.description}`
    : order.description || order.service_type;

  return (
    <>
      <Topbar
        title={bookingTitle}
        subtitle={`Booking${client?.abbreviation ? ` · ${client.abbreviation}` : ""}`}
        actions={
          <Link href="/orders" className="btn-ghost">
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
                <h2 className="text-xl font-bold text-gray-900">{bookingTitle}</h2>
                <StatusBadge status={order.status} />
              </div>
              {client && (
                <Link href={`/customers/${client.client_id}`} className="text-sm text-brand-600 hover:underline mt-1 inline-flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> {client.name}{client.company ? ` · ${client.company}` : ""}
                </Link>
              )}
              {orderInvoices.length > 0 && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {orderInvoices.map((inv) => (
                    <Link
                      key={inv.invoice_id}
                      href={`/invoices/${inv.invoice_id}`}
                      className="inline-flex items-center gap-1 text-xs font-mono text-brand-700 bg-brand-50 px-2 py-0.5 rounded hover:bg-brand-100"
                    >
                      <FileText className="w-3 h-3" /> {inv.invoice_number}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <OrderActions orderId={params.id} status={order.status} hasInvoice={orderInvoices.length > 0} order={order as Order} client={client ?? undefined} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t text-sm">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Worked</p>
                <p className="text-gray-900">{order.requested_date?.split("T")[0] || "—"}</p>
                <p className="text-xs text-gray-500 mt-1">Duration: {order.duration_hours ?? 1} hr</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Location</p>
                <p className="text-gray-900">{order.location || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Team</p>
                <p className="text-gray-900">{order.assigned_to || "—"}</p>
              </div>
            </div>
          </div>

          {order.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-gray-500 mb-1">Internal Notes</p>
              <p className="text-sm text-gray-600 italic whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}

          <OrderExpenses
            orderId={params.id}
            initialMileage={order.mileage_cost}
            initialParking={order.parking_cost}
          />
        </div>

        {/* Appointments */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-brand-600" /> Appointments
          </h3>
          {appointments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No appointments scheduled</p>
          ) : (
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.appointment_id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{a.location || "Remote"}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(a.start_time).toLocaleString("en-CA")} — {new Date(a.end_time).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Related invoices */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-600" /> Invoices
          </h3>
          {orderInvoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No invoices yet for this booking</p>
          ) : (
            <div className="space-y-2">
              {orderInvoices.map((inv) => (
                <Link
                  key={inv.invoice_id}
                  href={`/invoices/${inv.invoice_id}`}
                  className="flex items-center justify-between py-2 border-b last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors text-sm"
                >
                  <div>
                    <p className="font-mono text-xs text-gray-800">{inv.invoice_number}</p>
                    <p className="text-xs text-gray-500">{inv.issue_date} · ${inv.total.toFixed(2)}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
