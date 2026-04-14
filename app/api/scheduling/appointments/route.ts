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
import { createCalendarEvent } from "@/lib/google/calendar";
import { sendAppointmentConfirmation } from "@/lib/google/gmail";
import type { Appointment } from "@/types";

const BookSchema = z.object({
  order_id:  z.string().uuid(),
  client_id: z.string().uuid(),
  start_time: z.string().datetime({ offset: true }),
  end_time:   z.string().datetime({ offset: true }),
  timezone:   z.string().default("America/Toronto"),
  location:   z.string().default(""),
  virtual:    z.boolean().default(false),  // request Meet link
  notes:      z.string().default(""),
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

  const { order_id, client_id, start_time, end_time, timezone, location, virtual, notes } = parsed.data;

  // Fetch order & client for the calendar event title
  const [order, client] = await Promise.all([
    getOrder(order_id),
    getClient(client_id),
  ]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // 1. Create Google Calendar event
  const { eventId, meetLink } = await createCalendarEvent({
    title:          `${order.service_type} — ${client.name}`,
    description:    `Order: ${order_id}\n${order.description}\n\n${notes}`,
    startIso:       start_time,
    endIso:         end_time,
    timezone,
    location:       location || undefined,
    attendeeEmails: [client.email],
    meetLink:       virtual,
  });

  // 2. Write Appointment to Sheets
  const now = new Date().toISOString();
  const appointment: Appointment = {
    appointment_id:   uuidv4(),
    order_id,
    client_id,
    calendar_event_id: eventId,
    start_time,
    end_time,
    timezone,
    location,
    meeting_link:     meetLink,
    status:           "scheduled",
    reminder_sent:    false,
    notes,
    created_at:       now,
    updated_at:       now,
  };
  await createAppointment(appointment);

  // 3. Update Order status
  await updateOrder(order_id, {
    status:           "scheduled",
    scheduled_date:   start_time,
    calendar_event_id: eventId,
  });

  // 4. Send confirmation email (non-blocking — failure shouldn't abort booking)
  sendAppointmentConfirmation({
    to:          client.email,
    clientName:  client.name,
    serviceType: order.service_type,
    startTime:   new Date(start_time).toLocaleString("en-CA", { timeZone: timezone }),
    location:    location,
    meetLink:    meetLink || undefined,
  }).catch((err) => console.error("Appointment email failed:", err));

  return NextResponse.json({ data: appointment }, { status: 201 });
}
