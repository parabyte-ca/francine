import { Suspense } from "react";
import Topbar from "@/components/Topbar";
import {
  listOrders,
  listInvoices,
  listClients,
  listAppointments,
} from "@/lib/google/sheets";
import { DollarSign, Users, ClipboardList, CalendarDays, TrendingUp, AlertCircle } from "lucide-react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

// Revalidate every 5 minutes
export const revalidate = 300;

async function DashboardContent() {
  const today = new Date().toISOString().split("T")[0];

  const [orders, invoices, clients, appointments] = await Promise.all([
    listOrders(),
    listInvoices(),
    listClients(),
    listAppointments({ from: today }),
  ]);

  const activeOrders   = orders.filter((o) => !["completed","cancelled"].includes(o.status));
  const outstanding    = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
  const overdue        = invoices.filter((i) => i.status === "sent" && i.due_date < today);
  const todayAppts     = appointments.filter((a) => a.start_time.startsWith(today));
  const totalOutstanding = outstanding.reduce((s, i) => s + i.total, 0);
  const paidYtd        = invoices
    .filter((i) => i.status === "paid" && i.paid_at?.startsWith(String(new Date().getFullYear())))
    .reduce((s, i) => s + i.total, 0);

  const stats = [
    { label: "Active Orders",    value: activeOrders.length,              icon: ClipboardList, href: "/orders",    color: "text-blue-600 bg-blue-50" },
    { label: "Total Clients",    value: clients.length,                   icon: Users,         href: "/customers", color: "text-purple-600 bg-purple-50" },
    { label: "Outstanding",      value: `$${totalOutstanding.toFixed(0)}`, icon: DollarSign,   href: "/payments",  color: "text-orange-600 bg-orange-50" },
    { label: "Paid YTD",         value: `$${paidYtd.toFixed(0)}`,         icon: TrendingUp,   href: "/payments",  color: "text-green-600 bg-green-50" },
  ];

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">
            <strong>{overdue.length} invoice{overdue.length > 1 ? "s are" : " is"} overdue.</strong>
            {" "}<Link href="/payments?status=overdue" className="underline">View overdue invoices</Link>
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, href, color }) => (
          <Link key={label} href={href} className="card hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
              </div>
              <div className={`p-2 rounded-lg ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's appointments */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-brand-600" />
              Today&apos;s Appointments
            </h2>
            <Link href="/scheduling" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          {todayAppts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No appointments today</p>
          ) : (
            <div className="space-y-3">
              {todayAppts.slice(0, 5).map((a) => (
                <div key={a.appointment_id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{a.location || "Remote"}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(a.start_time).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                      {" — "}
                      {new Date(a.end_time).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent orders */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-brand-600" />
              Recent Orders
            </h2>
            <Link href="/orders" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {orders.slice(0, 5).map((o) => (
                <Link
                  key={o.order_id}
                  href={`/orders/${o.order_id}`}
                  className="flex items-center justify-between py-2 border-b last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{o.service_type}</p>
                    <p className="text-xs text-gray-500">{o.created_at.split("T")[0]}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" subtitle="Overview of your operations" />
      <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading...</div>}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
