"use client";

import { useState, useEffect, useCallback } from "react";
import Topbar from "@/components/Topbar";
import StatusBadge from "@/components/StatusBadge";
import { DollarSign, TrendingUp, AlertCircle, Clock, Loader2, CheckCircle2, Send } from "lucide-react";
import type { Invoice } from "@/types";

interface DashboardData {
  invoices: (Invoice & { is_overdue: boolean })[];
  stats: {
    total_outstanding: number;
    total_paid_ytd: number;
    overdue_count: number;
    draft_count: number;
  };
}

interface Toast {
  message: string;
  type: "success" | "error";
}

export default function PaymentsPage() {
  const [data, setData]           = useState<DashboardData | null>(null);
  const [filter, setFilter]       = useState("all");
  const [recording, setRecording] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [toast, setToast]         = useState<Toast | null>(null);
  const [payModal, setPayModal]   = useState<Invoice | null>(null);
  const [payForm, setPayForm]     = useState({ method: "e-transfer", reference: "", send_receipt: true });
  const [clientMap, setClientMap] = useState<Record<string, string>>({});

  const showToast = (message: string, type: Toast["type"]) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async (status?: string) => {
    const url = status && status !== "all" ? `/api/payments?status=${status}` : "/api/payments";
    const res  = await fetch(url);
    const json = await res.json();
    setData(json.data);
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/customers").then((r) => r.json()).then((j) => {
      const map: Record<string, string> = {};
      for (const c of (j.data ?? [])) map[c.client_id] = c.name;
      setClientMap(map);
    });
  }, [fetchData]);

  const handleFilterChange = (f: string) => {
    setFilter(f);
    fetchData(f === "all" ? undefined : f);
  };

  const handleResend = async (inv: Invoice & { is_overdue: boolean }) => {
    setResending(inv.invoice_id);
    try {
      const res = await fetch(`/api/invoices/${inv.invoice_id}/send`, { method: "POST" });
      if (res.ok) {
        showToast(`Invoice ${inv.invoice_number} resent successfully.`, "success");
        await fetchData(filter === "all" ? undefined : filter);
      } else {
        const json = await res.json().catch(() => ({}));
        showToast(typeof json.error === "string" ? json.error : "Failed to resend invoice.", "error");
      }
    } catch {
      showToast("Network error — could not resend invoice.", "error");
    } finally {
      setResending(null);
    }
  };

  const handleRecordPayment = async () => {
    if (!payModal) return;
    setRecording(payModal.invoice_id);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id:        payModal.invoice_id,
          payment_method:    payForm.method,
          payment_reference: payForm.reference,
          send_receipt:      payForm.send_receipt,
        }),
      });
      if (res.ok) {
        showToast(`Payment recorded for ${payModal.invoice_number}.`, "success");
      } else {
        showToast("Failed to record payment.", "error");
      }
      setPayModal(null);
      await fetchData(filter === "all" ? undefined : filter);
    } finally {
      setRecording(null);
    }
  };

  const stats = data?.stats;

  // FR-034: sort chronologically — oldest invoices first
  const invoices = [...(data?.invoices ?? [])].sort(
    (a, b) => new Date(a.issue_date).getTime() - new Date(b.issue_date).getTime()
  );

  const FILTER_TABS: { value: string; label: string }[] = [
    { value: "all",     label: "All" },
    { value: "sent",    label: "Unpaid" },
    { value: "overdue", label: "Overdue" },
    { value: "paid",    label: "Paid" },
    { value: "draft",   label: "Draft" },
  ];

  return (
    <>
      <Topbar title="Payments" subtitle="Track and record invoice payments" />
      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Outstanding", value: `$${stats.total_outstanding.toFixed(2)}`, icon: Clock,       color: "text-orange-600 bg-orange-50" },
              { label: "Paid YTD",    value: `$${stats.total_paid_ytd.toFixed(2)}`,    icon: TrendingUp,  color: "text-green-600 bg-green-50" },
              { label: "Overdue",     value: stats.overdue_count,                       icon: AlertCircle, color: "text-red-600 bg-red-50" },
              { label: "Drafts",      value: stats.draft_count,                         icon: DollarSign,  color: "text-gray-600 bg-gray-50" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="card flex items-center gap-4">
                <div className={`p-2.5 rounded-lg ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {FILTER_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleFilterChange(value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Invoice table — FR-036: Sent + Due columns */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-gray-500">
                <th className="pb-3 font-medium pr-4">Invoice #</th>
                <th className="pb-3 font-medium pr-4">Client</th>
                <th className="pb-3 font-medium pr-4">Sent</th>
                <th className="pb-3 font-medium pr-4">Due</th>
                <th className="pb-3 font-medium pr-4">Total</th>
                <th className="pb-3 font-medium pr-4">Status</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400">No invoices.</td></tr>
              )}
              {invoices.map((inv) => {
                // FR-036: Sent date = sent_at if present, else issue_date for non-drafts
                const sentDisplay = inv.sent_at
                  ? inv.sent_at.split("T")[0]
                  : inv.status !== "draft"
                    ? inv.issue_date
                    : "—";

                const canResend = inv.status === "sent" || inv.is_overdue;

                return (
                  <tr key={inv.invoice_id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="py-3 pr-4">{clientMap[inv.client_id] ?? `${inv.client_id.slice(0, 8)}…`}</td>
                    <td className="py-3 pr-4 text-gray-600">{sentDisplay}</td>
                    <td className={`py-3 pr-4 ${inv.is_overdue ? "text-red-600 font-medium" : "text-gray-600"}`}>
                      {inv.due_date}
                    </td>
                    <td className="py-3 pr-4 font-semibold">${inv.total.toFixed(2)}</td>
                    <td className="py-3 pr-4">
                      {inv.is_overdue ? (
                        <span className="badge-red">Overdue</span>
                      ) : (
                        <StatusBadge status={inv.status} />
                      )}
                    </td>
                    <td className="py-3">
                      {inv.status === "paid" ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Paid {inv.paid_at?.split("T")[0]}
                        </span>
                      ) : inv.status !== "void" ? (
                        <div className="flex items-center gap-2">
                          {/* FR-037: Resend button for unpaid/overdue invoices */}
                          {canResend && (
                            <button
                              onClick={() => handleResend(inv)}
                              disabled={resending === inv.invoice_id}
                              className="btn-secondary text-xs py-1.5 gap-1"
                              title="Resend invoice email"
                            >
                              {resending === inv.invoice_id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Send className="w-3 h-3" />}
                              Resend
                            </button>
                          )}
                          <button
                            onClick={() => setPayModal(inv)}
                            disabled={recording === inv.invoice_id}
                            className="btn-primary text-xs py-1.5"
                          >
                            {recording === inv.invoice_id && <Loader2 className="w-3 h-3 animate-spin" />}
                            Mark Paid
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.type === "success"
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.message}
        </div>
      )}

      {/* Record payment modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Record Payment</h2>
              <p className="text-sm text-gray-600">
                {payModal.invoice_number} — <strong>${payModal.total.toFixed(2)}</strong>
              </p>

              <div>
                <label className="label">Payment Method</label>
                <select
                  className="input"
                  value={payForm.method}
                  onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}
                >
                  {["cash","cheque","e-transfer","credit_card","bank_transfer","other"].map((m) => (
                    <option key={m} value={m}>{m.replace("_", " ")}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Reference # (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Cheque #, transaction ID…"
                  value={payForm.reference}
                  onChange={(e) => setPayForm((p) => ({ ...p, reference: e.target.value }))}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="send_receipt"
                  checked={payForm.send_receipt}
                  onChange={(e) => setPayForm((p) => ({ ...p, send_receipt: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="send_receipt" className="text-sm text-gray-700">Send receipt email to client</label>
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setPayModal(null)} className="btn-secondary">Cancel</button>
                <button onClick={handleRecordPayment} disabled={!!recording} className="btn-primary">
                  {recording && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
