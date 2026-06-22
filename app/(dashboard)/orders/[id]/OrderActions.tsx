"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";
import type { Order, Client, StandardRate } from "@/types";

const STATUSES = ["quote", "scheduled", "completed", "cancelled"] as const;
type OrderStatus = typeof STATUSES[number];

interface Props {
  orderId: string;
  status: OrderStatus;
  hasInvoice: boolean;
  order: Order;
  client?: Client;
}

export default function OrderActions({ orderId, status, hasInvoice, order, client }: Props) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<OrderStatus>(status);
  const [saving, setSaving]               = useState(false);
  const [statusError, setStatusError]     = useState<string | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => { setCurrentStatus(status); }, [status]);

  const updateStatus = async (next: OrderStatus) => {
    setCurrentStatus(next);
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
        setCurrentStatus(status);
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
          client={client}
          onClose={() => setShowInvoiceModal(false)}
          onDone={(invoiceId) => router.push(`/invoices/${invoiceId}`)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate picker — FR-029 / FR-039 (dynamic from Standard_Rates sheet)
// ---------------------------------------------------------------------------

interface RateOption {
  label: string;
  service: string;
  price: number | null; // null = custom (enter manually)
}

const DEFAULT_RATE_OPTIONS: RateOption[] = [
  { label: "< 90 min",   service: "ASL-English Interpretation < 90 min",  price: 230 },
  { label: "2 hours",    service: "ASL-English Interpretation 2h",          price: 275 },
  { label: "Half day",   service: "ASL-English Interpretation Half Day",    price: 330 },
  { label: "Full day",   service: "ASL-English Interpretation Full Day",    price: 630 },
  { label: "Conference", service: "ASL-English Interpretation Conference",  price: 800 },
  { label: "Custom",     service: "ASL-English Interpretation",             price: null },
];

const DEFAULT_SELECTED = "ASL-English Interpretation Half Day";

function GenerateInvoiceModal({
  order,
  client,
  onClose,
  onDone,
}: {
  order: Order;
  client?: Client;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [rateOptions, setRateOptions]         = useState<RateOption[]>(DEFAULT_RATE_OPTIONS);
  const [selectedService, setSelectedService] = useState(DEFAULT_SELECTED);
  const [customPrice, setCustomPrice]         = useState("");
  const [contactName, setContactName]         = useState(client?.name || "");
  const [contactTitle, setContactTitle]       = useState("");
  const [mileage, setMileage]                 = useState<string | null>(
    order.mileage_cost > 0 ? String(order.mileage_cost) : null
  );
  const [parking, setParking]                 = useState<string | null>(
    order.parking_cost > 0 ? String(order.parking_cost) : null
  );
  const [dueDays, setDueDays]                 = useState(30);
  // FR-030: pre-fill notes from booking's Event Description
  const [notes, setNotes]                     = useState(order.description || "");
  const [invoiceStatus, setInvoiceStatus]     = useState<"draft" | "sent">("draft");
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  // FR-039: load rates dynamically from Standard_Rates sheet
  useEffect(() => {
    fetch("/api/rates")
      .then((r) => r.json())
      .then((json) => {
        const standards: StandardRate[] = json.data?.standard_rates ?? [];
        const aslRates = standards
          .filter((r) => r.active && r.service_type.startsWith("ASL-English Interpretation"))
          .sort((a, b) => {
            if (a.base_price === 0) return 1;
            if (b.base_price === 0) return -1;
            return a.base_price - b.base_price;
          });

        if (aslRates.length > 0) {
          const options: RateOption[] = aslRates.map((r) => {
            const suffix = r.service_type
              .replace("ASL-English Interpretation ", "")
              .replace("ASL-English Interpretation", "")
              .trim();
            return {
              label:   suffix || "Custom",
              service: r.service_type,
              price:   r.base_price > 0 ? r.base_price : null,
            };
          });
          setRateOptions(options);
          // Keep selection if the service still exists; fall back to half-day or first option
          setSelectedService((prev) => {
            if (options.some((o) => o.service === prev)) return prev;
            const halfDay = options.find((o) => o.service.toLowerCase().includes("half day"));
            return halfDay ? halfDay.service : options[0].service;
          });
        }
      })
      .catch(() => { /* keep static defaults on network failure */ });
  }, []);

  const selectedRate = rateOptions.find((r) => r.service === selectedService) ?? rateOptions[0];
  const isCustom     = selectedRate.price === null;

  const submit = async () => {
    setError(null);

    if (isCustom && !customPrice) {
      setError("Enter a price for the custom rate.");
      return;
    }

    const line_items: Array<{
      service_type: string;
      description?: string;
      quantity: number;
      manual_override_price?: number;
      notes: string;
    }> = [
      {
        service_type:          selectedRate.service,
        // FR-027: prefix description with "Event: "
        description:           order.description ? `Event: ${order.description}` : undefined,
        quantity:              1,
        manual_override_price: isCustom ? Number(customPrice) : selectedRate.price!,
        notes:                 selectedRate.label,
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
        body: JSON.stringify({
          order_id: order.order_id,
          due_days: dueDays,
          notes,
          status: invoiceStatus,
          contact_name:  contactName,
          contact_title: contactTitle,
          line_items,
        }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : `Server error ${res.status}`);
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

          {/* FR-029 / FR-039: Dynamic rate picker */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Rate</p>
            <div className="grid grid-cols-3 gap-1.5">
              {rateOptions.map((r) => (
                <button
                  key={r.service}
                  type="button"
                  onClick={() => setSelectedService(r.service)}
                  className={`py-2 px-1 text-xs rounded-lg border font-medium transition-colors ${
                    selectedService === r.service
                      ? "bg-brand-50 border-brand-400 text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div>{r.label}</div>
                  {r.price !== null && <div className="text-gray-400 font-normal">${r.price}</div>}
                </button>
              ))}
            </div>
            {isCustom && (
              <div className="mt-1">
                <label className="label text-xs">Custom Price ($)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  placeholder="0.00"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* FR-026: Contact fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Billing Contact</label>
              <input
                type="text"
                className="input"
                placeholder="Contact name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div>
              <label className="label text-xs">Contact Title</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. HR Manager"
                value={contactTitle}
                onChange={(e) => setContactTitle(e.target.value)}
              />
            </div>
          </div>

          {/* Mileage */}
          {mileage !== null ? (
            <div className="p-3 border rounded-lg space-y-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">Mileage</p>
                <button onClick={() => setMileage(null)} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
              <div>
                <label className="label text-xs">Amount ($)</label>
                <input type="number" min={0} step={0.01} className="input" value={mileage}
                  onChange={(e) => setMileage(e.target.value)} />
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setMileage("0")}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              + Add mileage
            </button>
          )}

          {/* Parking */}
          {parking !== null ? (
            <div className="p-3 border rounded-lg space-y-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">Parking</p>
                <button onClick={() => setParking(null)} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
              <div>
                <label className="label text-xs">Amount ($)</label>
                <input type="number" min={0} step={0.01} className="input" value={parking}
                  onChange={(e) => setParking(e.target.value)} />
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setParking("0")}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              + Add parking
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Due in (days)</label>
              <input type="number" min={0} className="input" value={dueDays}
                onChange={(e) => setDueDays(Number(e.target.value))} />
            </div>
            <div>
              {/* FR-030: pre-filled from booking Event Description */}
              <label className="label">Notes</label>
              <input type="text" className="input" value={notes}
                onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {/* Draft / Send toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button type="button" onClick={() => setInvoiceStatus("draft")}
              className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${
                invoiceStatus === "draft" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              Save as Draft
            </button>
            <button type="button" onClick={() => setInvoiceStatus("sent")}
              className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${
                invoiceStatus === "sent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
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
