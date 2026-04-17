/**
 * GET  /api/rates             — list standard rates
 * POST /api/rates/custom      — add a custom rate for a client
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  listStandardRates,
  listCustomRates,
  createCustomRate,
  updateClient,
  getCustomRate,
} from "@/lib/google/sheets";
import type { CustomRate } from "@/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id");

  const [standard, custom] = await Promise.all([
    listStandardRates(),
    client_id ? listCustomRates(client_id) : Promise.resolve([]),
  ]);

  return NextResponse.json({ data: { standard_rates: standard, custom_rates: custom } });
}

const CreateCustomRateSchema = z.object({
  client_id:      z.string().uuid(),
  service_type:   z.string().min(1),
  unit:           z.enum(["hour","flat","per_item","per_word","per_minute"]),
  override_price: z.number().nonnegative(),
  minimum_charge: z.number().nonnegative().default(0),
  notes:          z.string().default(""),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateCustomRateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Prevent duplicate rates for the same client + service_type combination
  const existing = await getCustomRate(parsed.data.client_id, parsed.data.service_type);
  if (existing) {
    return NextResponse.json(
      { error: `A custom rate for "${parsed.data.service_type}" already exists for this client. Update it instead.` },
      { status: 409 }
    );
  }

  const rate: CustomRate = {
    custom_rate_id: uuidv4(),
    ...parsed.data,
    created_at: new Date().toISOString(),
  };

  await createCustomRate(rate);
  // Flag the client as having custom rates (avoids a full Custom_Rates scan later)
  await updateClient(parsed.data.client_id, { has_custom_rates: true });

  return NextResponse.json({ data: rate }, { status: 201 });
}
