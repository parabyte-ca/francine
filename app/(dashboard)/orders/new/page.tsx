"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Topbar from "@/components/Topbar";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

const schema = z.object({
  client_id:        z.string().uuid("Select a valid client"),
  service_type:     z.string().min(1, "Service type is required"),
  description:      z.string().default(""),
  requested_date:   z.string().min(1, "Date is required"),
  duration_minutes: z.coerce.number().int().positive().default(60),
  location:         z.string().default(""),
  assigned_to:      z.string().default(""),
  notes:            z.string().default(""),
});
type FormData = z.infer<typeof schema>;

const SERVICE_TYPES = [
  "Interpretation — Consecutive",
  "Interpretation — Simultaneous",
  "Interpretation — Telephone",
  "Translation",
  "Transcription",
  "Document Review",
  "Other",
];

export default function NewOrderPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Array<{ client_id: string; name: string; email: string }>>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const searchClients = async (q: string) => {
    setClientSearch(q);
    if (q.length < 2) { setClients([]); return; }
    const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    setClients(json.data ?? []);
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, requested_date: new Date(data.requested_date).toISOString() }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(JSON.stringify(json.error));
        return;
      }
      const json = await res.json();
      router.push(`/dashboard/orders/${json.data.order_id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar
        title="New Order"
        subtitle="Capture a new service request"
        actions={
          <Link href="/dashboard/orders" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
            <h2 className="font-semibold text-gray-900">Order Intake Form</h2>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Client search */}
            <div>
              <label className="label">Client *</label>
              <input
                type="text"
                className="input"
                placeholder="Search by name or email…"
                value={clientSearch}
                onChange={(e) => searchClients(e.target.value)}
              />
              {clients.length > 0 && (
                <div className="mt-1 border rounded-lg bg-white shadow-lg divide-y max-h-48 overflow-y-auto">
                  {clients.map((c) => (
                    <button
                      key={c.client_id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                      onClick={() => {
                        setClientSearch(`${c.name} (${c.email})`);
                        setClients([]);
                      }}
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.email}</p>
                    </button>
                  ))}
                </div>
              )}
              <input type="hidden" {...register("client_id")} />
              {errors.client_id && <p className="text-xs text-red-600 mt-1">{errors.client_id.message}</p>}
            </div>

            {/* Service type */}
            <div>
              <label className="label">Service Type *</label>
              <select {...register("service_type")} className="input">
                <option value="">Select a service…</option>
                {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.service_type && <p className="text-xs text-red-600 mt-1">{errors.service_type.message}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="label">Description</label>
              <textarea
                {...register("description")}
                className="input resize-none"
                rows={3}
                placeholder="Languages, subject matter, special requirements…"
              />
            </div>

            {/* Date + Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Requested Date *</label>
                <input type="datetime-local" {...register("requested_date")} className="input" />
                {errors.requested_date && <p className="text-xs text-red-600 mt-1">{errors.requested_date.message}</p>}
              </div>
              <div>
                <label className="label">Duration (minutes)</label>
                <input type="number" {...register("duration_minutes")} className="input" min={15} step={15} defaultValue={60} />
              </div>
            </div>

            {/* Location + Assigned to */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Location</label>
                <input type="text" {...register("location")} className="input" placeholder="Address or 'Remote'" />
              </div>
              <div>
                <label className="label">Assigned To</label>
                <input type="text" {...register("assigned_to")} className="input" placeholder="Staff name" />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="label">Internal Notes</label>
              <textarea {...register("notes")} className="input resize-none" rows={2} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/dashboard/orders" className="btn-secondary">Cancel</Link>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Order
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
