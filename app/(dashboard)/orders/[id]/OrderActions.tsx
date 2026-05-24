"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";
import type { Order } from "@/types";

const STATUSES = ["quote", "scheduled", "completed", "cancelled"] as const;
type OrderStatus = typeof STATUSES[number];

interface Props {
  orderId: string;
  status: OrderStatus;
  hasInvoice: boolean;
  order: Order;
}

export default function OrderActions({ orderId, status, hasInvoice, order }: Props) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<OrderStatus>(status);
  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Keep local state in sync when the server re-renders with fresh data
  useEffect(() => { setCurrentStatus(status); }, [status]);

  const updateStatus = async (next: OrderStatus) => {
    setCurrentStatus(next);   // optimistic update
    setStatusError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setStatusError(typeof json.error === "string" ? json.error : "Failed to update status");
        setCurrentStatus(status); // revert on error
        return;
      }
      router.refresh();
    } catch {
      setStatusError("Network error — could not update status");
      setCurrentStatus(status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          disabled={saving}
          value={currentStatus}
          onChange={(e) => updateStatus(e.target.value as OrderStatus)}
          className="input max-w-[12rem]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}</option>
          ))}
        </select>

        {!hasInvoice && currentStatus !== "cancelled" && (
          <button
            onClick={() => setShowInvoiceModal(true)}
            className="btn-primary text-xs py-1.5"
            disabled={saving}
          >
            <FileText className="w-3.5 h-3.5" /> Generate Invoice
          </button>
        )}
      </div>
      {statusError && (
        <p className="text-xs text-red-600">{statusError}</p>
      )}

      {showInvoiceModal && (
        <GenerateInvoiceModal
          order={order}
          onClose={() => setShowInvoiceModal(false)}
          onDone={(invoiceId) => router.push(`/invoices/${invoiceId}`)}
        />
      )}
    </div>
  );
}

function selectTier(hours: number): string {
  if (hours <= 1.5) return "ASL-English Interpretation < 90 min";
  if (hours <= 2)   return "ASL-English Interpretation 2h";
  if (hours <= 4)   return "ASL-English Interpretation Half Day";
  return                   "ASL-English Interpretation Full Day";
}

function tierLabel(tier: string): string {
  if (tier.includes("< 90")) return "< 90 min session";
  if (tier.includes("2h"))   return "2h session";
  if (tier.includes("Half")) return "half-day";
  return                            "full-day";
}

function GenerateInvoiceModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [hours, setHours] = useState(order.duration_hours || 1);
  const [overridePrice, setOverridePrice] = useState("");
  const [mileage, setMileage] = useState<string | null>(
    order.mileage_cost > 0 ? String(order.mileage_cost) : null
  );
  const [parking, setParking] = useState<string | null>(
    order.parking_cost > 0 ? String(order.parking_cost) : null
  );
  const [dueDays, setDueDays] = useState(30);
  const [notes, setNotes] = useState(order.notes || "");
  const [invoiceStatus, setInvoiceStatus] = useState<"draft" | "sent">("draft");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tier = selectTier(hours);

  const submit = async () => {
    setError(null);
    const line_items: Array<{
      service_type: string;
      quantity: number;
      manual_override_price?: number;
      notes: string;
    }> = [
      {
        service_type: tier,
        quantity: hours,
        manual_override_price: overridePrice ? Number(overridePrice) : undefined,
        notes: "",
      },
    ];
    if (mileage !== null && Number(mileage) > 0) {
      line_items.push({ service_type: "Mileage", quantity: 1, manual_override_price: Number(mileage), notes: "" });
    }
    if (parking !== null && Number(parking) > 0) {
      line_items.push({ service_type: "Parking", quantity: 1, manual_override_price: Number(parking), notes: "" });
    }

    setLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.order_id, due_days: dueDays, notes, status: invoiceStatus, line_items }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : `Server error ${res.status} — check that standard rates are configured.`);
        return;
      }
      onDone((json.data as { invoice: { invoice_id: string } }).invoice.invoice_id);
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Generate Invoice</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Interpretation row */}
          <div className="p-3 border rounded-lg space-y-2 bg-gray-50">
            <p className="text-xs font-medium text-gray-700">ASL-English Interpretation</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Hours</label>
                <input
                  type="number"
                  min={0.25}
                  step={0.25}
                  className="input"
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label text-xs">Override Price</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  placeholder="auto"
                  value={overridePrice}
                  onChange={(e) => setOverridePrice(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Tier: <span className="font-medium text-gray-700">{tierLabel(tier)}</span>
              {!overridePrice && <span className="text-gray-400"> — rate from your rate table</span>}
            </p>
          </div>

          {/* Mileage row */}
          {mileage !== null ? (
            <div className="p-3 border rounded-lg space-y-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">Mileage</p>
                <button onClick={() => setMileage(null)} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
              <div>
                <label className="label text-xs">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMileage("0")}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              + Add mileage
            </button>
          )}

          {/* Parking row */}
          {parking !== null ? (
            <div className="p-3 border rounded-lg space-y-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">Parking</p>
                <button onClick={() => setParking(null)} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
              <div>
                <label className="label text-xs">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  value={parking}
                  onChange={(e) => setParking(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setParking("0")}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              + Add parking
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Due in (days)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={dueDays}
                onChange={(e) => setDueDays(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <input
                type="text"
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Draft / Send toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setInvoiceStatus("draft")}
              className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${
                invoiceStatus === "draft" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={() => setInvoiceStatus("sent")}
              className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${
                invoiceStatus === "sent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Generate &amp; Send
            </button>
          </div>
          {invoiceStatus === "sent" && (
            <p className="text-xs text-brand-600">
              The invoice PDF will be emailed to the client immediately.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={loading} className="btn-primary">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {invoiceStatus === "sent" ? "Generate & Send" : "Save Draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
