/**
 * GET  /api/scheduling/appointments   — list appointments (optional filters)
 * POST /api/scheduling/appointments   — book an appointment
 *
 * Booking flow:
 *   1. Validate input
 *   2. Create Google Calendar event (returns eventId + Meet link)
 *   3. Write Appointment row to Sheets
 *   4. Update Order: status → "scheduled", calendar_event_id, scheduled_date
 *   5. Send confirmation email to client
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createAppointment,
  listAppointments,
  updateOrder,
  getOrder,
  getClient,
} from "@/lib/google/sheets";
import { createCalendarEvent, hasCalendarConflict } from "@/lib/google/calendar";
import { sendAppointmentConfirmation } from "@/lib/google/gmail";
import type { Appointment } from "@/types";

const BookSchema = z.object({
  order_id:  z.string().uuid(),
  client_id: z.string().uuid(),
  start_time: z.string().datetime({ offset: true }),
  end_time:   z.string().datetime({ offset: true }),
  timezone:     z.string().default("America/Toronto"),
  location:     z.string().default(""),
  meeting_link: z.string().default(""),
  notes:        z.string().default(""),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const appointments = await listAppointments({
    client_id: searchParams.get("client_id") ?? undefined,
    order_id:  searchParams.get("order_id") ?? undefined,
    from:      searchParams.get("from") ?? undefined,
    to:        searchParams.get("to") ?? undefined,
  });

  return NextResponse.json({ data: appointments });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = BookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { order_id, client_id, start_time, end_time, timezone, location, meeting_link, notes } = parsed.data;

  try {
    // Fetch order & client for the calendar event title
    const [order, client] = await Promise.all([
      getOrder(order_id),
      getClient(client_id),
    ]);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Check for calendar conflicts (non-fatal if Calendar is unavailable)
    try {
      const conflict = await hasCalendarConflict(start_time, end_time);
      if (conflict) {
        return NextResponse.json(
          { error: "This time slot conflicts with an existing calendar event. Please choose another time." },
          { status: 409 }
        );
      }
    } catch (calErr) {
      console.warn("Calendar conflict check failed (skipping):", calErr instanceof Error ? calErr.message : calErr);
    }

    // Create Google Calendar event (non-fatal — booking succeeds without it)
    let eventId = "";
    let calendarWarning: string | undefined;
    try {
      const result = await createCalendarEvent({
        title:       `${order.service_type} — ${client.name}`,
        description: `Order: ${order_id}\n${order.description}\n\n${notes}`,
        startIso:    start_time,
        endIso:      end_time,
        timezone,
        location:    location || undefined,
      });
      eventId = result.eventId;
    } catch (calErr) {
      const msg = calErr instanceof Error ? calErr.message : String(calErr);
      console.error("Google Calendar event creation failed:", msg);
      calendarWarning = `Appointment saved, but the Google Calendar event could not be created: ${msg}. Check that the service account has Calendar access in Settings.`;
    }

    // Write Appointment to Sheets
    const now = new Date().toISOString();
    const appointment: Appointment = {
      appointment_id:    uuidv4(),
      order_id,
      client_id,
      calendar_event_id: eventId,
      start_time,
      end_time,
      timezone,
      location,
      meeting_link,
      status:            "scheduled",
      reminder_sent:     false,
      notes,
      created_at:        now,
      updated_at:        now,
    };
    await createAppointment(appointment);

    // Update Order status
    await updateOrder(order_id, {
      status:            "scheduled",
      scheduled_date:    start_time,
      calendar_event_id: eventId,
    });

    // Send confirmation email (non-blocking)
    sendAppointmentConfirmation({
      to:          client.email,
      clientName:  client.name,
      serviceType: order.service_type,
      startTime:   new Date(start_time).toLocaleString("en-CA", { timeZone: timezone }),
      location:    location,
      meetLink:    meeting_link || undefined,
    }).catch((err) => console.error("Appointment email failed:", err));

    return NextResponse.json(
      { data: appointment, ...(calendarWarning ? { calendar_warning: calendarWarning } : {}) },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Appointment booking failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
