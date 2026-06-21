"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Topbar from "@/components/Topbar";
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
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

type ClientOption = { client_id: string; name: string; email: string; company: string; contacts: string };

export default function NewBookingPage() {
  const router = useRouter();
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [teamSuggestions, setTeamSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarWarning, setCalendarWarning] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ checking: boolean; detected: boolean }>({
    checking: false,
    detected: false,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((j) => setAllClients(j.data ?? []));

    // Collect unique team names from past bookings for autocomplete
    fetch("/api/orders")
      .then((r) => r.json())
      .then((j) => {
        const seen = new Set<string>();
        for (const o of (j.data ?? [])) {
          if (o.assigned_to) {
            for (const name of (o.assigned_to as string).split(",").map((s: string) => s.trim()).filter(Boolean)) {
              seen.add(name);
            }
          }
        }
        setTeamSuggestions([...seen].sort());
      })
      .catch(() => {});
  }, []);

  // ── Real-time conflict check ──────────────────────────────────────────────
  const requestedDate  = watch("requested_date");
  const durationHours  = watch("duration_hours");

  useEffect(() => {
    if (!requestedDate || !durationHours) {
      setConflict({ checking: false, detected: false });
      return;
    }
    const start = new Date(requestedDate);
    if (isNaN(start.getTime())) {
      setConflict({ checking: false, detected: false });
      return;
    }
    const end = new Date(start.getTime() + Number(durationHours) * 3_600_000);
    setConflict({ checking: true, detected: false });

    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(
          `/api/scheduling/check-conflict?start=${start.toISOString()}&end=${end.toISOString()}`
        );
        const json = await res.json();
        setConflict({ checking: false, detected: json.conflict ?? false });
      } catch {
        setConflict({ checking: false, detected: false });
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [requestedDate, durationHours]);

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
    setCalendarWarning(null);
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
      if (json.calendar_warning) {
        setCalendarWarning(json.calendar_warning);
        await new Promise((r) => setTimeout(r, 2500));
      }
      router.push(`/orders/${json.data.order_id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar
        title="New Booking"
        subtitle="Capture a new interpretation booking"
        actions={
          <Link href="/orders" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
            <h2 className="font-semibold text-gray-900">Booking Intake Form</h2>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {calendarWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Calendar warning</p>
                  <p>{calendarWarning}</p>
                  <p className="text-xs mt-1 text-amber-600">Booking was created. Redirecting…</p>
                </div>
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

            {/* Event Description */}
            <div>
              <label className="label">Event Description</label>
              <input
                type="text"
                {...register("description")}
                className="input"
                placeholder="e.g. TMU Book Launch, Workplace Training, Medical Appointment…"
              />
              <p className="text-xs text-gray-400 mt-1">This appears on the invoice line item.</p>
            </div>

            {/* Date + Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Worked Date *</label>
                <input type="datetime-local" {...register("requested_date")} className="input" />
                {errors.requested_date && <p className="text-xs text-red-600 mt-1">{errors.requested_date.message}</p>}
              </div>
              <div>
                <label className="label">Duration (hours)</label>
                <input type="number" {...register("duration_hours")} className="input" min={0.25} step={0.25} defaultValue={1} />
              </div>
            </div>

            {/* Conflict indicator */}
            {conflict.checking && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking calendar…
              </div>
            )}
            {!conflict.checking && conflict.detected && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Calendar conflict detected</p>
                  <p className="text-xs mt-0.5">Another appointment overlaps this time slot. You can still create this booking — the conflict will be noted.</p>
                </div>
              </div>
            )}
            {!conflict.checking && !conflict.detected && requestedDate && durationHours && (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Time slot is available
              </div>
            )}

            {/* Location */}
            <div>
              <label className="label">Location</label>
              <input type="text" {...register("location")} className="input" placeholder="Address or 'Remote'" />
            </div>

            {/* Team — free-text with autocomplete from past bookings */}
            <div>
              <label className="label">Team</label>
              <input
                type="text"
                {...register("assigned_to")}
                className="input"
                placeholder="Team member names (comma-separated)"
                list="team-suggestions"
              />
              {teamSuggestions.length > 0 && (
                <datalist id="team-suggestions">
                  {teamSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
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
                Create Booking
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
