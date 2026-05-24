/**
 * GET   /api/orders/[id]   — fetch a single order
 * PATCH /api/orders/[id]   — update order (status, assigned_to, quote_amount, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOrder, updateOrder } from "@/lib/google/sheets";

const PatchOrderSchema = z.object({
  status:           z.enum(["quote","scheduled","completed","cancelled"]).optional(),
  description:      z.string().optional(),
  scheduled_date:   z.string().optional(),
  duration_hours:   z.coerce.number().positive().optional(),
  location:         z.string().optional(),
  assigned_to:      z.string().optional(),
  calendar_event_id: z.string().optional(),
  quote_amount:     z.number().nonnegative().optional(),
  mileage_cost:     z.coerce.number().nonnegative().optional(),
  parking_cost:     z.coerce.number().nonnegative().optional(),
  notes:            z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const order = await getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: order });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = PatchOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await updateOrder(params.id, parsed.data);
  const updated = await getOrder(params.id);
  return NextResponse.json({ data: updated });
}
