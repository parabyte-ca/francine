import { Suspense } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import { listOrders, listClients } from "@/lib/google/sheets";
import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Events" };
export const revalidate = 60;

async function OrdersTable({ status }: { status?: string }) {
  const [orders, clients] = await Promise.all([
    listOrders({ status }),
    listClients(),
  ]);

  const clientMap = Object.fromEntries(clients.map((c) => [c.client_id, c]));

  // Sort newest first
  const sorted = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="pb-3 font-medium text-gray-500 pr-4">Client</th>
            <th className="pb-3 font-medium text-gray-500 pr-4">Interpretation</th>
            <th className="pb-3 font-medium text-gray-500 pr-4">Requested</th>
            <th className="pb-3 font-medium text-gray-500 pr-4">Team</th>
            <th className="pb-3 font-medium text-gray-500 pr-4">Status</th>
            <th className="pb-3 font-medium text-gray-500"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="py-12 text-center text-gray-400">
                No events found.{" "}
                <Link href="/orders/new" className="text-brand-600 hover:underline">
                  Create the first one
                </Link>
              </td>
            </tr>
          )}
          {sorted.map((order) => {
            const client = clientMap[order.client_id];
            return (
              <tr key={order.order_id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                <td className="py-3 pr-4">
                  {client ? (
                    <div>
                      <p className="font-medium text-gray-900">{client.name}</p>
                      <p className="text-xs text-gray-500">{client.email}</p>
                    </div>
                  ) : (
                    <span className="text-gray-400 italic">Unknown client</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-gray-700">{order.service_type}</td>
                <td className="py-3 pr-4 text-gray-500">{order.requested_date?.split("T")[0] || "—"}</td>
                <td className="py-3 pr-4 text-gray-500">{order.assigned_to || "—"}</td>
                <td className="py-3 pr-4"><StatusBadge status={order.status} /></td>
                <td className="py-3">
                  <Link href={`/orders/${order.order_id}`} className="text-brand-600 hover:underline text-xs">
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const statuses = ["all", "quote", "scheduled", "completed", "cancelled"];

  return (
    <>
      <Topbar
        title="Events"
        subtitle="Manage your service pipeline"
        actions={
          <Link href="/orders/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Event
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {/* Status filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {statuses.map((s) => (
            <Link
              key={s}
              href={s === "all" ? "/orders" : `/orders?status=${s}`}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                (searchParams.status === s) || (!searchParams.status && s === "all")
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        <div className="card">
          <Suspense fallback={<p className="text-sm text-gray-400">Loading events…</p>}>
            <OrdersTable status={searchParams.status} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
