"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";

const STATUSES = ["lead", "quote", "scheduled", "in_progress", "completed", "cancelled"] as const;
type OrderStatus = typeof STATUSES[number];

interface Props {
  orderId: string;
  status: OrderStatus;
  hasInvoice: boolean;
}

export default function OrderActions({ orderId, status, hasInvoice }: Props) {
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
          orderId={orderId}
          onClose={() => setShowInvoiceModal(false)}
          onDone={(invoiceId) => router.push(`/invoices/${invoiceId}`)}
        />
      )}
    </div>
  );
}

function GenerateInvoiceModal({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const LINE_ITEM_TYPES = [
    "Interpretation — Consecutive",
    "Interpretation — Simultaneous",
    "Interpretation — Telephone",
    "Translation",
    "Transcription",
    "Document Review",
    "Mileage",
    "Parking",
    "Other",
  ];

  const [items, setItems] = useState([
    { service_type: "", service_type_custom: "", quantity: 1, manual_override_price: "", description: "" },
  ]);
  const [dueDays, setDueDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addItem = () =>
    setItems((prev) => [...prev, { service_type: "", service_type_custom: "", quantity: 1, manual_override_price: "", description: "" }]);

  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const update = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const submit = async () => {
    setError(null);
    const line_items = items
      .filter((it) => it.service_type.trim())
      .map((it) => ({
        service_type: it.service_type === "Other" ? (it.service_type_custom.trim() || "Other") : it.service_type,
        description: it.description,
        quantity: Number(it.quantity) || 1,
        manual_override_price: it.manual_override_price
          ? Number(it.manual_override_price)
          : undefined,
        notes: "",
      }));

    if (line_items.length === 0) {
      setError("Add at least one line item");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          due_days: dueDays,
          notes,
          line_items,
        }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON error body */ }
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : `Server error ${res.status} — check that standard rates are configured for these service types.`);
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

          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="p-3 border rounded-lg space-y-2 bg-gray-50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Item {i + 1}</span>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="text-xs text-red-500 hover:underline">
                      Remove
                    </button>
                  )}
                </div>
                <select
                  className="input"
                  value={it.service_type}
                  onChange={(e) => update(i, { service_type: e.target.value, service_type_custom: "" })}
                >
                  <option value="">Select service type…</option>
                  {LINE_ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {it.service_type === "Other" && (
                  <input
                    className="input"
                    placeholder="Describe the service…"
                    value={it.service_type_custom}
                    onChange={(e) => update(i, { service_type_custom: e.target.value })}
                  />
                )}
                <input
                  className="input"
                  placeholder="Description (optional)"
                  value={it.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">Quantity</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="input"
                      value={it.quantity}
                      onChange={(e) => update(i, { quantity: Number(e.target.value) })}
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
                      value={it.manual_override_price}
                      onChange={(e) => update(i, { manual_override_price: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addItem} className="btn-secondary text-xs w-full justify-center">
              + Add Line Item
            </button>
          </div>

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

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={loading} className="btn-primary">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
