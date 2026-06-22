/**
 * POST /api/webhooks/calendar
 *
 * Receives Google Calendar push notifications (two-way sync).
 * Google sends a POST with headers X-Goog-Resource-ID and X-Goog-Channel-ID.
 * We look up the changed event and sync status back to the Appointments sheet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCalendarEvent } from "@/lib/google/calendar";
import { listAppointments, updateAppointment } from "@/lib/google/sheets";

export async function POST(req: NextRequest) {
  const reqToken = req.headers.get("x-goog-channel-token");
  const expectedToken = process.env.NEXTAUTH_SECRET || "default-secret-token";
  if (!reqToken || reqToken !== expectedToken) {
    console.warn("[webhook] Unauthorized calendar webhook request: token mismatch");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resourceState = req.headers.get("x-goog-resource-state");
  // "sync" is the initial handshake — acknowledge and return
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }

  // Extract event ID from the resource URI header if available
  const resourceUri = req.headers.get("x-goog-resource-uri") ?? "";
  const eventIdMatch = resourceUri.match(/events\/([^?]+)/);
  if (!eventIdMatch) return NextResponse.json({ ok: true });

  const eventId = eventIdMatch[1];
  const event = await getCalendarEvent(eventId);

  if (!event) {
    // Event was deleted — mark appointment as cancelled
    const appointments = await listAppointments({});
    const appt = appointments.find((a) => a.calendar_event_id === eventId);
    if (appt) {
      await updateAppointment(appt.appointment_id, { status: "cancelled" });
    }
    return NextResponse.json({ ok: true });
  }

  // Update appointment fields from the calendar event
  const appointments = await listAppointments({});
  const appt = appointments.find((a) => a.calendar_event_id === eventId);
  if (appt) {
    await updateAppointment(appt.appointment_id, {
      start_time:   event.start?.dateTime ?? appt.start_time,
      end_time:     event.end?.dateTime ?? appt.end_time,
      location:     event.location ?? appt.location,
      status:
        event.status === "cancelled" ? "cancelled"
        : event.status === "confirmed" ? "confirmed"
        : appt.status,
    });
  }

  return NextResponse.json({ ok: true });
}
