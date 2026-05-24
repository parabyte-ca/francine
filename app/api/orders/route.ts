/**
 * GET  /api/orders          — list orders (optional ?client_id=&status=)
 * POST /api/orders          — create a new order and auto-schedule an appointment
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrder, listOrders, getClient, createAppointment, updateOrder } from "@/lib/google/sheets";
import { createCalendarEvent, hasCalendarConflict } from "@/lib/google/calendar";
import { ASL_SERVICE_TYPE } from "@/lib/constants";
import type { Appointment, Order } from "@/types";

const CreateOrderSchema = z.object({
  client_id:      z.string().uuid(),
  service_type:   z.string().optional(),
  description:    z.string().default(""),
  requested_date: z.string().datetime({ offset: true }).or(z.string().date()),
  duration_hours: z.coerce.number().positive().default(1),
  location:       z.string().default(""),
  assigned_to:    z.string().default(""),
  mileage_cost:   z.coerce.number().nonnegative().default(0),
  parking_cost:   z.coerce.number().nonnegative().default(0),
  notes:          z.string().default(""),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id") ?? undefined;
  const status    = searchParams.get("status") ?? undefined;

  const orders = await listOrders({ client_id, status });
  return NextResponse.json({ data: orders });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const now = new Date().toISOString();
  const order: Order = {
    order_id:          uuidv4(),
    status:            "lead",
    scheduled_date:    "",
    calendar_event_id: "",
    quote_amount:      0,
    ...parsed.data,
    service_type: ASL_SERVICE_TYPE,
    created_at: now,
    updated_at: now,
  };

  await createOrder(order);

  // ── Auto-create appointment + calendar event ───────────────────────────────
  const warnings: string[] = [];

  try {
    const startIso = new Date(order.requested_date).toISOString();
    const endIso   = new Date(
      new Date(order.requested_date).getTime() + order.duration_hours * 3_600_000
    ).toISOString();

    // Conflict check (non-fatal — warn but still create)
    const conflict = await hasCalendarConflict(startIso, endIso).catch(() => false);
    if (conflict) {
      warnings.push("This time slot conflicts with an existing calendar event.");
    }

    // Google Calendar event (non-fatal)
    let eventId = "";
    try {
      const client = await getClient(order.client_id);
      const { eventId: eid } = await createCalendarEvent({
        title:       `${ASL_SERVICE_TYPE} — ${client?.name ?? "Client"}`,
        description: `Order: ${order.order_id}${order.description ? `\n${order.description}` : ""}`,
        startIso,
        endIso,
        timezone: "America/Toronto",
        location: order.location,
      });
      eventId = eid;
    } catch (calErr) {
      warnings.push(
        `Calendar event could not be created: ${calErr instanceof Error ? calErr.message : String(calErr)}`
      );
      console.error("Calendar event creation failed for order", order.order_id, calErr);
    }

    // Appointment record
    const apptNow = new Date().toISOString();
    const appointment: Appointment = {
      appointment_id:    uuidv4(),
      order_id:          order.order_id,
      client_id:         order.client_id,
      calendar_event_id: eventId,
      start_time:        startIso,
      end_time:          endIso,
      timezone:          "America/Toronto",
      location:          order.location,
      meeting_link:      "",
      status:            "scheduled",
      reminder_sent:     false,
      notes:             order.notes,
      created_at:        apptNow,
      updated_at:        apptNow,
    };
    await createAppointment(appointment);

    // Update order to scheduled
    await updateOrder(order.order_id, {
      status:            "scheduled",
      scheduled_date:    startIso,
      calendar_event_id: eventId,
    });
    order.status            = "scheduled";
    order.scheduled_date    = startIso;
    order.calendar_event_id = eventId;

  } catch (apptErr) {
    warnings.push(
      `Appointment could not be auto-created: ${apptErr instanceof Error ? apptErr.message : String(apptErr)}`
    );
    console.error("Auto-appointment creation failed for order", order.order_id, apptErr);
  }

  return NextResponse.json(
    {
      data: order,
      ...(warnings.length ? { calendar_warning: warnings.join(" ") } : {}),
    },
    { status: 201 }
  );
}
