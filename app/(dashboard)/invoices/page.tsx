import { Suspense } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import { listInvoices, listClients } from "@/lib/google/sheets";
import { FileText, ExternalLink } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Invoices" };
export const revalidate = 60;

async function InvoicesTable({ status }: { status?: string }) {
  const [invoices, clients] = await Promise.all([
    listInvoices({ status }),
    listClients(),
  ]);
  const clientMap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
  const sorted = [...invoices].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="pb-3 font-medium pr-4">Invoice #</th>
            <th className="pb-3 font-medium pr-4">Client</th>
            <th className="pb-3 font-medium pr-4">Issue Date</th>
            <th className="pb-3 font-medium pr-4">Due Date</th>
            <th className="pb-3 font-medium pr-4">Total</th>
            <th className="pb-3 font-medium pr-4">Status</th>
            <th className="pb-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="py-12 text-center text-gray-400">
                No invoices found.
              </td>
            </tr>
          )}
          {sorted.map((inv) => {
            const client = clientMap[inv.client_id];
            const isOverdue = inv.status === "sent" && inv.due_date < today;
            return (
              <tr key={inv.invoice_id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                <td className="py-3 pr-4 font-mono text-xs font-medium text-gray-800">{inv.invoice_number}</td>
                <td className="py-3 pr-4">
                  {client ? (
                    <Link href={`/dashboard/customers/${client.client_id}`} className="hover:underline">
                      {client.name}
                    </Link>
                  ) : "—"}
                </td>
                <td className="py-3 pr-4 text-gray-600">{inv.issue_date}</td>
                <td className={`py-3 pr-4 ${isOverdue ? "text-red-600 font-medium" : "text-gray-600"}`}>
                  {inv.due_date}
                  {isOverdue && <span className="ml-1 badge-red">Overdue</span>}
                </td>
                <td className="py-3 pr-4 font-semibold">${inv.total.toFixed(2)}</td>
                <td className="py-3 pr-4"><StatusBadge status={inv.status} /></td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    {inv.drive_file_url && (
                      <a href={inv.drive_file_url} target="_blank" rel="noopener noreferrer"
                         className="btn-ghost py-1 text-xs">
                        <ExternalLink className="w-3 h-3" /> PDF
                      </a>
                    )}
                    <Link href={`/dashboard/invoices/${inv.invoice_id}`} className="text-brand-600 hover:underline text-xs">
                      View
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function InvoicesPage({ searchParams }: { searchParams: { status?: string } }) {
  const statuses = ["all", "draft", "sent", "paid", "overdue", "void"];

  return (
    <>
      <Topbar title="Invoices" subtitle="PDF invoice management" />
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {statuses.map((s) => (
            <Link
              key={s}
              href={s === "all" ? "/dashboard/invoices" : `/dashboard/invoices?status=${s}`}
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
          <Suspense fallback={<p className="text-sm text-gray-400">Loading invoices…</p>}>
            <InvoicesTable status={searchParams.status} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
