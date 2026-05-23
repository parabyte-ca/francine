/**
 * GET  /api/orders          — list orders (optional ?client_id=&status=)
 * POST /api/orders          — create a new order (intake form submission)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrder, listOrders } from "@/lib/google/sheets";
import { ASL_SERVICE_TYPE } from "@/lib/constants";
import type { Order } from "@/types";

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
    order_id:         uuidv4(),
    status:           "lead",
    scheduled_date:   "",
    calendar_event_id: "",
    quote_amount:     0,
    ...parsed.data,
    service_type: ASL_SERVICE_TYPE,
    created_at: now,
    updated_at: now,
  };

  await createOrder(order);
  return NextResponse.json({ data: order }, { status: 201 });
}
