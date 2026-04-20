"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, dateFnsLocalizer, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addDays } from "date-fns";
import { enCA } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import Topbar from "@/components/Topbar";
import { Loader2, X, MapPin, Video, Clock, User, FileText } from "lucide-react";
import Link from "next/link";
import type { Appointment, Client, Order } from "@/types";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales: { "en-CA": enCA },
});

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
const APPT_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "completed", "no_show", "cancelled"];

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource?: { type: "appointment"; data: Appointment };
}

export default function SchedulingPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<string>(Views.WEEK);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);

  // Lookup maps for client/order names
  const [clientMap, setClientMap] = useState<Record<string, Client>>({});
  const [orderMap, setOrderMap] = useState<Record<string, Order>>({});

  const [toast, setToast] = useState<string | null>(null);

  // Booking modal
  const [bookModal, setBookModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [bookForm, setBookForm] = useState({ order_id: "", location: "", virtual: false, notes: "" });
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Appointment detail modal
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const [detailStatus, setDetailStatus] = useState<AppointmentStatus>("scheduled");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Bookable orders (lead / quote / scheduled)
  const bookableOrders = Object.values(orderMap).filter((o) =>
    ["lead", "quote", "scheduled"].includes(o.status)
  );

  const fetchAppointments = useCallback(async (date: Date) => {
    setLoading(true);
    try {
      const start = new Date(date);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0); // truncate to midnight so slots align to the hour
      const end = addDays(start, 7);

      const res = await fetch(
        `/api/scheduling/appointments?from=${start.toISOString()}&to=${end.toISOString()}`
      );
      const json = await res.json();

      const apptEvents: CalendarEvent[] = (json.data ?? []).map((a: Appointment) => ({
        id: a.appointment_id,
        title: buildTitle(a, clientMap, orderMap),
        start: new Date(a.start_time),
        end: new Date(a.end_time),
        resource: { type: "appointment" as const, data: a },
      }));

      setEvents(apptEvents);
    } finally {
      setLoading(false);
    }
  }, [clientMap, orderMap]);

  // Load clients and orders once on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/customers").then((r) => r.json()),
      fetch("/api/orders").then((r) => r.json()),
    ]).then(([clientsJson, ordersJson]) => {
      const cm: Record<string, Client> = {};
      for (const c of (clientsJson.data ?? [])) cm[c.client_id] = c;
      setClientMap(cm);

      const om: Record<string, Order> = {};
      for (const o of (ordersJson.data ?? [])) om[o.order_id] = o;
      setOrderMap(om);
    });
  }, []);

  useEffect(() => {
    fetchAppointments(currentDate);
  }, [currentDate, fetchAppointments]);

  function buildTitle(a: Appointment, cm: Record<string, Client>, om: Record<string, Order>): string {
    const clientName = cm[a.client_id]?.name;
    const serviceType = om[a.order_id]?.service_type;
    const label = clientName ?? (a.location || "Remote");
    return serviceType ? `${serviceType} — ${label}` : label;
  }

  const handleSelectSlot = ({ start, end }: { start: Date; end: Date }) => {
    setSelectedSlot({ start, end });
    setBookForm({ order_id: "", location: "", virtual: false, notes: "" });
    setBookError(null);
    setBookModal(true);
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    if (event.resource?.type !== "appointment") return;
    const appt = event.resource.data;
    setDetailAppt(appt);
    setDetailStatus(appt.status as AppointmentStatus);
    setDetailError(null);
    setDetailSaving(false);
  };

  const handleBook = async () => {
    if (!selectedSlot || !bookForm.order_id) return;
    setBookLoading(true);
    setBookError(null);
    try {
      const order = orderMap[bookForm.order_id];
      if (!order) return;

      const res = await fetch("/api/scheduling/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: bookForm.order_id,
          client_id: order.client_id,
          start_time: selectedSlot.start.toISOString(),
          end_time: selectedSlot.end.toISOString(),
          location: bookForm.location,
          virtual: bookForm.virtual,
          notes: bookForm.notes,
        }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setBookError(typeof json.error === "string" ? json.error : `Booking failed (${res.status})`);
        return;
      }
      setBookModal(false);
      fetchAppointments(currentDate);
      if (typeof json.calendar_warning === "string") {
        setToast(json.calendar_warning);
        setTimeout(() => setToast(null), 8000);
      }
    } finally {
      setBookLoading(false);
    }
  };

  const handleSaveStatus = async () => {
    if (!detailAppt) return;
    setDetailSaving(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/scheduling/appointments/${detailAppt.appointment_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: detailStatus }),
      });
      let json: Record<string, unknown> = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setDetailError(typeof json.error === "string" ? json.error : "Failed to update appointment");
        return;
      }
      setDetailAppt(null);
      fetchAppointments(currentDate);
    } finally {
      setDetailSaving(false);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    const style: React.CSSProperties = { borderRadius: "4px", border: "none", fontSize: "12px" };
    const status = event.resource?.data?.status;
    if (status === "cancelled") { style.backgroundColor = "#fee2e2"; style.color = "#991b1b"; }
    else if (status === "completed") { style.backgroundColor = "#f0fdf4"; style.color = "#166534"; }
    else if (status === "confirmed") { style.backgroundColor = "#dbeafe"; style.color = "#1e3a8a"; }
    else { style.backgroundColor = "#ede9fe"; style.color = "#4c1d95"; }
    return { style };
  };

  const detailClient = detailAppt ? clientMap[detailAppt.client_id] : null;
  const detailOrder = detailAppt ? orderMap[detailAppt.order_id] : null;

  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800 shadow-lg">
          {toast}
        </div>
      )}
      <Topbar
        title="Scheduling"
        subtitle="Click a time slot to book · Click an appointment to view details"
        actions={loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : undefined}
      />

      <div className="flex-1 p-6 overflow-hidden">
        <div className="card h-full" style={{ height: "calc(100vh - 140px)" }}>
          <Calendar
            localizer={localizer}
            events={events}
            view={view as "week" | "month" | "day" | "agenda"}
            onView={(v) => setView(v)}
            date={currentDate}
            onNavigate={setCurrentDate}
            selectable
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            eventPropGetter={eventStyleGetter}
            style={{ height: "100%" }}
            formats={{ timeGutterFormat: "h:mm a" }}
          />
        </div>
      </div>

      {/* ── Book appointment modal ─────────────────────────────────────── */}
      {bookModal && selectedSlot && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="font-semibold text-gray-900">Book Appointment</h2>
              <button onClick={() => setBookModal(false)} className="btn-ghost p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800 flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0" />
                {selectedSlot.start.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
                {" · "}
                {selectedSlot.start.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {selectedSlot.end.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
              </div>

              {bookError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {bookError}
                </div>
              )}

              <div>
                <label className="label">Order / Job *</label>
                <select
                  className="input"
                  value={bookForm.order_id}
                  onChange={(e) => setBookForm((p) => ({ ...p, order_id: e.target.value }))}
                >
                  <option value="">Select an order…</option>
                  {bookableOrders.map((o) => (
                    <option key={o.order_id} value={o.order_id}>
                      {o.service_type} — {clientMap[o.client_id]?.name ?? o.client_id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Location</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Address or leave blank for remote"
                  value={bookForm.location}
                  onChange={(e) => setBookForm((p) => ({ ...p, location: e.target.value }))}
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  id="virtual"
                  checked={bookForm.virtual}
                  onChange={(e) => setBookForm((p) => ({ ...p, virtual: e.target.checked }))}
                  className="rounded"
                />
                Add Google Meet link
              </label>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={bookForm.notes}
                  onChange={(e) => setBookForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setBookModal(false)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleBook}
                  disabled={!bookForm.order_id || bookLoading}
                  className="btn-primary"
                >
                  {bookLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Booking
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Appointment detail modal ───────────────────────────────────── */}
      {detailAppt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="font-semibold text-gray-900">Appointment Details</h2>
              <button onClick={() => setDetailAppt(null)} className="btn-ghost p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">

              {/* Time */}
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">
                    {new Date(detailAppt.start_time).toLocaleDateString("en-CA", {
                      weekday: "long", month: "long", day: "numeric", year: "numeric",
                    })}
                  </p>
                  <p className="text-gray-500">
                    {new Date(detailAppt.start_time).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {new Date(detailAppt.end_time).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>

              {/* Client */}
              {detailClient && (
                <div className="flex items-start gap-3">
                  <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <Link
                    href={`/customers/${detailClient.client_id}`}
                    className="text-brand-600 hover:underline font-medium"
                    onClick={() => setDetailAppt(null)}
                  >
                    {detailClient.name}
                  </Link>
                </div>
              )}

              {/* Order */}
              {detailOrder && (
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <Link
                    href={`/orders/${detailOrder.order_id}`}
                    className="text-brand-600 hover:underline"
                    onClick={() => setDetailAppt(null)}
                  >
                    {detailOrder.service_type}
                  </Link>
                </div>
              )}

              {/* Location */}
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-gray-700">{detailAppt.location || "Remote"}</span>
              </div>

              {/* Meeting link */}
              {detailAppt.meeting_link && (
                <div className="flex items-start gap-3">
                  <Video className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <a
                    href={detailAppt.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline break-all"
                  >
                    Join Google Meet
                  </a>
                </div>
              )}

              {/* Notes */}
              {detailAppt.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-700 whitespace-pre-wrap">{detailAppt.notes}</p>
                </div>
              )}

              {/* Status */}
              <div className="pt-2 border-t">
                <label className="label">Status</label>
                <select
                  className="input"
                  value={detailStatus}
                  onChange={(e) => setDetailStatus(e.target.value as AppointmentStatus)}
                >
                  {APPT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}
                    </option>
                  ))}
                </select>
              </div>

              {detailError && (
                <p className="text-xs text-red-600">{detailError}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setDetailAppt(null)} className="btn-secondary">Close</button>
                <button
                  onClick={handleSaveStatus}
                  disabled={detailSaving || detailStatus === detailAppt.status}
                  className="btn-primary"
                >
                  {detailSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
