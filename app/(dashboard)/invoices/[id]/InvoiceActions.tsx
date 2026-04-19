"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, DollarSign, CheckCircle2 } from "lucide-react";
import type { InvoiceStatus, PaymentMethod } from "@/types";

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  driveFileUrl?: string;
}

const METHODS: PaymentMethod[] = ["cash", "cheque", "e-transfer", "credit_card", "bank_transfer", "other"];

export default function InvoiceActions({ invoiceId, status }: Props) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    method: "e-transfer" as PaymentMethod,
    reference: "",
    send_receipt: true,
  });

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, { method: "POST" });
      const json = await res.json();
      setToast(res.ok ? json.message : (typeof json.error === "string" ? json.error : "Send failed"));
      if (res.ok) router.refresh();
    } finally {
      setSending(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const recordPayment = async () => {
    setPaying(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          payment_method: form.method,
          payment_reference: form.reference,
          send_receipt: form.send_receipt,
        }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (res.ok) {
        setToast(typeof json.email_warning === "string" ? `Payment recorded. ⚠️ ${json.email_warning}` : "Payment recorded");
        setPayModal(false);
        router.refresh();
      } else {
        setToast(typeof json.error === "string" ? json.error : `Payment failed (HTTP ${res.status})`);
      }
    } finally {
      setPaying(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {toast && (
        <div className="fixed top-4 right-4 z-50 p-3 bg-gray-900 text-white rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      {(status === "draft" || status === "sent") && (
        <>
          <button onClick={send} disabled={sending} className="btn-secondary text-xs py-1.5">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {status === "draft" ? "Send via Email" : "Resend"}
          </button>
          <button onClick={() => setPayModal(true)} className="btn-primary text-xs py-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Mark Paid
          </button>
        </>
      )}

      {status === "paid" && (
        <span className="badge-green flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Paid
        </span>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Record Payment</h2>

              <div>
                <label className="label">Method</label>
                <select
                  className="input"
                  value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}
                >
                  {METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Reference</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Cheque #, transaction ID"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.send_receipt}
                  onChange={(e) => setForm((f) => ({ ...f, send_receipt: e.target.checked }))}
                  className="rounded"
                />
                Send receipt to client
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setPayModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={recordPayment} disabled={paying} className="btn-primary">
                  {paying && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
