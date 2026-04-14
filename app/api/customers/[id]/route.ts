/**
 * GET   /api/customers/[id]           — Customer 360 view (client + orders + invoices)
 * PATCH /api/customers/[id]           — update client fields
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  getClient,
  updateClient,
  listOrders,
  listInvoices,
  listCustomRates,
  listAppointments,
} from "@/lib/google/sheets";

const PatchClientSchema = z.object({
  name:               z.string().optional(),
  email:              z.string().email().optional(),
  phone:              z.string().optional(),
  address:            z.string().optional(),
  company:            z.string().optional(),
  language_pair:      z.string().optional(),
  default_tax_exempt: z.boolean().optional(),
  notes:              z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await getClient(params.id);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch related data in parallel — Customer 360 view
  const [orders, invoices, customRates, appointments] = await Promise.all([
    listOrders({ client_id: params.id }),
    listInvoices({ client_id: params.id }),
    listCustomRates(params.id),
    listAppointments({ client_id: params.id }),
  ]);

  return NextResponse.json({
    data: {
      client,
      orders,
      invoices,
      custom_rates: customRates,
      appointments,
      // Aggregate stats for the 360 header
      stats: {
        total_orders:    orders.length,
        active_orders:   orders.filter((o) => !["completed","cancelled"].includes(o.status)).length,
        total_invoiced:  invoices.reduce((s, i) => s + (i.total ?? 0), 0),
        amount_outstanding: invoices
          .filter((i) => i.status !== "paid" && i.status !== "void")
          .reduce((s, i) => s + (i.total ?? 0), 0),
        has_custom_rates: customRates.length > 0,
      },
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = PatchClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await updateClient(params.id, {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  });
  const updated = await getClient(params.id);
  return NextResponse.json({ data: updated });
}
