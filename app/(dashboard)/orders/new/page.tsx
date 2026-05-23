"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Topbar from "@/components/Topbar";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { ASL_SERVICE_TYPE } from "@/lib/constants";

const schema = z.object({
  client_id:      z.string().uuid("Select a valid client"),
  description:    z.string().default(""),
  requested_date: z.string().min(1, "Date is required"),
  duration_hours: z.coerce.number().positive().default(1),
  location:       z.string().default(""),
  assigned_to:    z.string().default(""),
  mileage_cost:   z.coerce.number().nonnegative().default(0),
  parking_cost:   z.coerce.number().nonnegative().default(0),
  notes:          z.string().default(""),
});
type FormData = z.infer<typeof schema>;

type ClientOption = { client_id: string; name: string; email: string; company: string };

export default function NewOrderPage() {
  const router = useRouter();
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((j) => setAllClients(j.data ?? []));
  }, []);

  const filteredClients = clientSearch.trim() === ""
    ? allClients
    : allClients.filter((c) => {
        const q = clientSearch.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q)
        );
      });

  const selectClient = (c: ClientOption) => {
    setValue("client_id", c.client_id, { shouldValidate: true });
    setClientSearch(`${c.name} — ${c.company || c.email}`);
    setShowDropdown(false);
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          service_type: ASL_SERVICE_TYPE,
          requested_date: new Date(data.requested_date).toISOString(),
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(JSON.stringify(json.error));
        return;
      }
      const json = await res.json();
      router.push(`/orders/${json.data.order_id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar
        title="New Event"
        subtitle="Capture a new service request"
        actions={
          <Link href="/orders" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
            <h2 className="font-semibold text-gray-900">Event Intake Form</h2>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Client combobox */}
            <div className="relative" ref={dropdownRef}>
              <label className="label">Client *</label>
              <input
                type="text"
                className="input"
                placeholder="Click to select or type to search…"
                value={clientSearch}
                autoComplete="off"
                onChange={(e) => { setClientSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              />
              {showDropdown && filteredClients.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 border rounded-lg bg-white shadow-lg divide-y max-h-52 overflow-y-auto">
                  {filteredClients.map((c) => (
                    <button
                      key={c.client_id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectClient(c)}
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.company ? `${c.company} · ` : ""}{c.email}</p>
                    </button>
                  ))}
                </div>
              )}
              <input type="hidden" {...register("client_id")} />
              {errors.client_id && <p className="text-xs text-red-600 mt-1">{errors.client_id.message}</p>}
            </div>

            {/* Service type (fixed) */}
            <div>
              <label className="label">Service Type</label>
              <p className="input bg-gray-50 text-gray-600 cursor-default select-none">{ASL_SERVICE_TYPE}</p>
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
                <label className="label">Duration (hours)</label>
                <input type="number" {...register("duration_hours")} className="input" min={0.25} step={0.25} defaultValue={1} />
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

            {/* Expenses */}
            <div>
              <p className="label mb-2">Expenses (optional)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-gray-500">Mileage ($)</label>
                  <input type="number" {...register("mileage_cost")} className="input" min={0} step={0.01} defaultValue={0} placeholder="0.00" />
                </div>
                <div>
                  <label className="label text-gray-500">Parking ($)</label>
                  <input type="number" {...register("parking_cost")} className="input" min={0} step={0.01} defaultValue={0} placeholder="0.00" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="label">Internal Notes</label>
              <textarea {...register("notes")} className="input resize-none" rows={2} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/orders" className="btn-secondary">Cancel</Link>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Event
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
