"use client";

/**
 * Scheduling page — interactive calendar with availability checking and
 * appointment booking.
 *
 * Architecture:
 *   - react-big-calendar renders the monthly/weekly/day view
 *   - On slot click → opens a booking modal
 *   - Availability slots are fetched from /api/scheduling/availability
 *   - Confirmed appointments are fetched from /api/scheduling/appointments
 */

import { useState, useEffect, useCallback } from "react";
import { Calendar, dateFnsLocalizer, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addDays } from "date-fns";
import { enCA } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import Topbar from "@/components/Topbar";
import { Loader2, X } from "lucide-react";
import type { Appointment, AvailabilitySlot } from "@/types";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { "en-CA": enCA },
});

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource?: { type: "appointment" | "available" | "busy"; data?: Appointment };
}

export default function SchedulingPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<string>(Views.WEEK);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [orders, setOrders] = useState<Array<{ order_id: string; service_type: string; client_id: string }>>([]);
  const [formData, setFormData] = useState({ order_id: "", location: "", virtual: false, notes: "" });

  const fetchData = useCallback(async (date: Date) => {
    setLoading(true);
    try {
      const start = new Date(date);
      start.setDate(start.getDate() - start.getDay()); // week start
      const end = addDays(start, 7);

      const [apptRes, availRes] = await Promise.all([
        fetch(`/api/scheduling/appointments?from=${start.toISOString()}&to=${end.toISOString()}`),
        fetch(`/api/scheduling/availability?start=${start.toISOString()}&end=${end.toISOString()}&slotMinutes=60`),
      ]);

      const [apptJson, availJson] = await Promise.all([apptRes.json(), availRes.json()]);

      const appointmentEvents: CalendarEvent[] = (apptJson.data ?? []).map((a: Appointment) => ({
        id:    a.appointment_id,
        title: `${a.location || "Remote"} (${a.status})`,
        start: new Date(a.start_time),
        end:   new Date(a.end_time),
        resource: { type: "appointment", data: a },
      }));

      const availEvents: CalendarEvent[] = (availJson.data ?? [])
        .filter((s: AvailabilitySlot) => s.available)
        .map((s: AvailabilitySlot, i: number) => ({
          id:    `avail-${i}`,
          title: "Available",
          start: new Date(s.start),
          end:   new Date(s.end),
          resource: { type: "available" },
        }));

      setEvents([...appointmentEvents, ...availEvents]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(currentDate); }, [currentDate, fetchData]);

  useEffect(() => {
    fetch("/api/orders?status=lead,quote,scheduled")
      .then((r) => r.json())
      .then((j) => setOrders(j.data ?? []));
  }, []);

  const handleSelectSlot = ({ start, end }: { start: Date; end: Date }) => {
    setSelectedSlot({ start, end });
    setModalOpen(true);
  };

  const handleBook = async () => {
    if (!selectedSlot || !formData.order_id) return;
    setBookingLoading(true);
    try {
      const order = orders.find((o) => o.order_id === formData.order_id);
      if (!order) return;

      const res = await fetch("/api/scheduling/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id:   formData.order_id,
          client_id:  order.client_id,
          start_time: selectedSlot.start.toISOString(),
          end_time:   selectedSlot.end.toISOString(),
          location:   formData.location,
          virtual:    formData.virtual,
          notes:      formData.notes,
        }),
      });
      if (res.ok) {
        setModalOpen(false);
        fetchData(currentDate);
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    const type = event.resource?.type;
    const style: React.CSSProperties = { borderRadius: "4px", border: "none", fontSize: "12px" };
    if (type === "available") { style.backgroundColor = "#dcfce7"; style.color = "#166534"; }
    else if (type === "appointment") { style.backgroundColor = "#dbeafe"; style.color = "#1e40af"; }
    else { style.backgroundColor = "#fee2e2"; style.color = "#991b1b"; }
    return { style };
  };

  return (
    <>
      <Topbar
        title="Scheduling"
        subtitle="Calendar view and appointment booking"
        actions={loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : undefined}
      />

      <div className="flex-1 p-6 overflow-hidden">
        <div className="card h-full" style={{ height: "calc(100vh - 140px)" }}>
          <Calendar
            localizer={localizer}
            events={events}
            view={view as any}
            onView={setView as any}
            date={currentDate}
            onNavigate={setCurrentDate}
            selectable
            onSelectSlot={handleSelectSlot}
            eventPropGetter={eventStyleGetter}
            style={{ height: "100%" }}
            formats={{ timeGutterFormat: "h:mm a" }}
          />
        </div>
      </div>

      {/* Booking modal */}
      {modalOpen && selectedSlot && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="font-semibold text-gray-900">Book Appointment</h2>
              <button onClick={() => setModalOpen(false)} className="btn-ghost p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                {selectedSlot.start.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
                {" · "}
                {selectedSlot.start.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {selectedSlot.end.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
              </div>

              <div>
                <label className="label">Order / Job *</label>
                <select
                  className="input"
                  value={formData.order_id}
                  onChange={(e) => setFormData((p) => ({ ...p, order_id: e.target.value }))}
                >
                  <option value="">Select an order…</option>
                  {orders.map((o) => (
                    <option key={o.order_id} value={o.order_id}>{o.service_type} — {o.order_id.slice(0, 8)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Location</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Address or leave blank for remote"
                  value={formData.location}
                  onChange={(e) => setFormData((p) => ({ ...p, location: e.target.value }))}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="virtual"
                  checked={formData.virtual}
                  onChange={(e) => setFormData((p) => ({ ...p, virtual: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="virtual" className="text-sm text-gray-700">Add Google Meet link</label>
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleBook} disabled={!formData.order_id || bookingLoading} className="btn-primary">
                  {bookingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Booking
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
