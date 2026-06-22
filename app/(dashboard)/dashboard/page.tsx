import { Suspense } from "react";
import Topbar from "@/components/Topbar";
import {
  listOrders,
  listInvoices,
  listClients,
  getConfig,
} from "@/lib/google/sheets";
import {
  DollarSign,
  FileText,
  ClipboardList,
  CalendarDays,
  TrendingUp,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };
export const revalidate = 300;

// ─── Week helpers ───────────────────────────────────────────────────────────

function weekBounds(offset = 0): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const mondayDiff = (day + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayDiff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return {
    start: monday.toISOString().split("T")[0],
    end:   sunday.toISOString().split("T")[0],
  };
}

// ─── Dashboard data ──────────────────────────────────────────────────────────

async function DashboardContent() {
  const [orders, invoices, clients, thresholdCfg] = await Promise.all([
    listOrders(),
    listInvoices(),
    listClients(),
    getConfig("weekly_revenue_threshold"),
  ]);

  const threshold = Number(thresholdCfg ?? 2000);
  const clientMap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
  const today     = new Date().toISOString().split("T")[0];
  const currWeek  = weekBounds(0);
  const nextWeek  = weekBounds(1);

  // ── Outstanding AR (sent, awaiting payment) ────────────────────────────────
  const sentInvoices = invoices.filter((i) => i.status === "sent");
  const arByClient   = new Map<string, number>();
  for (const inv of sentInvoices) {
    arByClient.set(inv.client_id, (arByClient.get(inv.client_id) ?? 0) + inv.total);
  }
  const arRows = [...arByClient.entries()]
    .map(([cid, amt]) => ({ client: clientMap[cid], amt }))
    .sort((a, b) => b.amt - a.amt);
  const totalAR = sentInvoices.reduce((s, i) => s + i.total, 0);

  // ── Draft invoices ─────────────────────────────────────────────────────────
  const draftInvoices = invoices
    .filter((i) => i.status === "draft")
    .map((inv) => ({ inv, client: clientMap[inv.client_id] }));

  // ── Need to Invoice (no invoice exists for the order) ─────────────────────
  const invoicedOrderIds = new Set(invoices.map((i) => i.order_id).filter(Boolean));
  const needToInvoice    = orders
    .filter((o) => !["cancelled"].includes(o.status) && !invoicedOrderIds.has(o.order_id))
    .map((o) => ({ order: o, client: clientMap[o.client_id] }))
    .sort((a, b) => (b.order.scheduled_date ?? "").localeCompare(a.order.scheduled_date ?? ""));
  const uninvoicedTotal = needToInvoice.reduce((s, { order }) => s + (order.quote_amount || 0), 0);

  // ── This-week gross (invoices issued Mon–Sun of current week) ─────────────
  const thisWeekInvoices = invoices.filter(
    (i) =>
      i.status !== "void" &&
      i.status !== "draft" &&
      i.issue_date >= currWeek.start &&
      i.issue_date < currWeek.end
  );
  const weekGross     = thisWeekInvoices.reduce((s, i) => s + i.total, 0);
  const weekPct       = threshold > 0 ? Math.min(100, Math.round((weekGross / threshold) * 100)) : 100;
  const weekOnTarget  = weekGross >= threshold;

  // ── Overdue ────────────────────────────────────────────────────────────────
  const overdue = invoices.filter((i) => i.status === "sent" && i.due_date < today);

  // ── Next-week forecast (scheduled orders next Mon–Sun) ────────────────────
  const nextWeekOrders = orders.filter(
    (o) =>
      o.status === "scheduled" &&
      o.scheduled_date >= nextWeek.start &&
      o.scheduled_date < nextWeek.end
  );
  const nextWeekForecast = nextWeekOrders.reduce((s, o) => s + (o.quote_amount || 0), 0);

  return (
    <div className="flex-1 p-4 sm:p-6 space-y-5 overflow-y-auto">

      {/* ── Overdue alert ────────────────────────────────────────────────── */}
      {overdue.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">
            <strong>{overdue.length} invoice{overdue.length > 1 ? "s are" : " is"} overdue.</strong>
            {" "}<Link href="/payments?status=overdue" className="underline">View overdue</Link>
          </p>
        </div>
      )}

      {/* ── Stat chips ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/payments" className="card hover:shadow-md transition-shadow group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Outstanding AR</p>
              <p className="text-xl font-bold text-gray-900">${totalAR.toFixed(0)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{sentInvoices.length} unpaid</p>
            </div>
            <div className="p-2 rounded-lg text-orange-600 bg-orange-50"><DollarSign className="w-4 h-4" /></div>
          </div>
        </Link>

        <Link href="/invoices?status=draft" className="card hover:shadow-md transition-shadow group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Draft Invoices</p>
              <p className="text-xl font-bold text-gray-900">{draftInvoices.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">waiting to send</p>
            </div>
            <div className="p-2 rounded-lg text-brand-600 bg-brand-50"><FileText className="w-4 h-4" /></div>
          </div>
        </Link>

        <Link href="/orders" className="card hover:shadow-md transition-shadow group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Need to Invoice</p>
              <p className="text-xl font-bold text-gray-900">{needToInvoice.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {uninvoicedTotal > 0 ? `~$${uninvoicedTotal.toFixed(0)} est.` : "bookings"}
              </p>
            </div>
            <div className="p-2 rounded-lg text-purple-600 bg-purple-50"><ClipboardList className="w-4 h-4" /></div>
          </div>
        </Link>

        <Link href="/scheduling" className="card hover:shadow-md transition-shadow group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Next Week</p>
              <p className="text-xl font-bold text-gray-900">
                {nextWeekOrders.length > 0
                  ? nextWeekForecast > 0 ? `$${nextWeekForecast.toFixed(0)}` : `${nextWeekOrders.length} booked`
                  : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {nextWeekOrders.length > 0 ? `${nextWeekOrders.length} booking${nextWeekOrders.length > 1 ? "s" : ""}` : "nothing scheduled"}
              </p>
            </div>
            <div className="p-2 rounded-lg text-blue-600 bg-blue-50"><CalendarDays className="w-4 h-4" /></div>
          </div>
        </Link>
      </div>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* This week's gross */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-brand-600" />
              This Week&apos;s Gross
            </h2>
            <Link href="/setup" className="text-xs text-gray-400 hover:text-brand-600">
              target: ${threshold.toLocaleString()}
            </Link>
          </div>
          <p className={`text-3xl font-bold mb-3 ${weekOnTarget ? "text-green-600" : "text-red-500"}`}>
            ${weekGross.toFixed(0)}
          </p>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${weekOnTarget ? "bg-green-500" : "bg-red-400"}`}
              style={{ width: `${weekPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">
            {weekPct}% of ${threshold.toLocaleString()} weekly target
            {weekOnTarget ? " — on track ✓" : ""}
          </p>
          {thisWeekInvoices.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t pt-3">
              {thisWeekInvoices.slice(0, 4).map((inv) => (
                <div key={inv.invoice_id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-gray-700">{clientMap[inv.client_id]?.company || clientMap[inv.client_id]?.name || "—"}</span>
                    <span className="text-xs text-gray-400 ml-2">{inv.invoice_number}</span>
                  </div>
                  <span className="font-medium text-gray-900">${inv.total.toFixed(0)}</span>
                </div>
              ))}
              {thisWeekInvoices.length > 4 && (
                <p className="text-xs text-gray-400">+{thisWeekInvoices.length - 4} more</p>
              )}
            </div>
          )}
          {thisWeekInvoices.length === 0 && (
            <p className="text-sm text-gray-400 mt-2">No invoices issued this week yet.</p>
          )}
        </div>

        {/* Outstanding AR by client */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-orange-500" />
              Outstanding AR
            </h2>
            <Link href="/payments" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {arRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No outstanding invoices — all paid up!</p>
          ) : (
            <div className="space-y-2">
              {arRows.slice(0, 6).map(({ client, amt }, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{client?.company || client?.name || "Unknown"}</p>
                    {client?.company && <p className="text-xs text-gray-400">{client.name}</p>}
                  </div>
                  <span className="text-sm font-semibold text-orange-600">${amt.toFixed(2)}</span>
                </div>
              ))}
              {arRows.length > 6 && (
                <p className="text-xs text-gray-400">+{arRows.length - 6} more clients</p>
              )}
            </div>
          )}
        </div>

        {/* Draft invoices */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" />
              Draft Invoices
            </h2>
            <Link href="/invoices" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {draftInvoices.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No drafts — inbox zero!</p>
          ) : (
            <div className="space-y-2">
              {draftInvoices.slice(0, 6).map(({ inv, client }) => (
                <Link
                  key={inv.invoice_id}
                  href={`/invoices/${inv.invoice_id}`}
                  className="flex items-center justify-between py-1.5 border-b last:border-0 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{client?.company || client?.name || "—"}</p>
                    <p className="text-xs text-gray-400">{inv.invoice_number} · {inv.issue_date}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">${inv.total.toFixed(2)}</span>
                </Link>
              ))}
              {draftInvoices.length > 6 && (
                <p className="text-xs text-gray-400">+{draftInvoices.length - 6} more</p>
              )}
            </div>
          )}
        </div>

        {/* Need to Invoice */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-purple-600" />
              Need to Invoice
            </h2>
            <Link href="/orders" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {needToInvoice.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">All bookings have been invoiced.</p>
          ) : (
            <div className="space-y-2">
              {needToInvoice.slice(0, 6).map(({ order, client }) => (
                <Link
                  key={order.order_id}
                  href={`/orders/${order.order_id}`}
                  className="flex items-center justify-between py-1.5 border-b last:border-0 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{client?.company || client?.name || "—"}</p>
                    <p className="text-xs text-gray-400">
                      {order.scheduled_date
                        ? new Date(order.scheduled_date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })
                        : order.status}
                    </p>
                  </div>
                  {order.quote_amount > 0
                    ? <span className="text-xs font-medium text-purple-600">~${order.quote_amount.toFixed(0)}</span>
                    : <span className="text-xs text-gray-400">no quote</span>
                  }
                </Link>
              ))}
              {needToInvoice.length > 6 && (
                <p className="text-xs text-gray-400">+{needToInvoice.length - 6} more bookings</p>
              )}
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
      <Topbar title="Dashboard" subtitle="Financial overview" />
      <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
