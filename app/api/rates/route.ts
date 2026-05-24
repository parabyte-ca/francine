/**
 * GET  /api/rates             — list all standard rates (including inactive)
 * POST /api/rates             — create a new standard rate
 * POST /api/rates?type=custom — add a custom rate for a client
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  listStandardRates,
  listCustomRates,
  createCustomRate,
  createStandardRate,
  updateClient,
  getCustomRate,
} from "@/lib/google/sheets";
import type { CustomRate, RateUnit, StandardRate } from "@/types";

const RATE_UNITS: [RateUnit, ...RateUnit[]] = [
  "hour", "flat", "per_item", "per_word", "per_minute",
  "session", "half-day", "full-day", "custom",
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id");

  const [standard, custom] = await Promise.all([
    listStandardRates(false),
    client_id ? listCustomRates(client_id) : Promise.resolve([]),
  ]);

  return NextResponse.json({ data: { standard_rates: standard, custom_rates: custom } });
}

const CreateStandardRateSchema = z.object({
  service_type:   z.string().min(1),
  unit:           z.enum(RATE_UNITS),
  base_price:     z.coerce.number().nonnegative(),
  minimum_charge: z.coerce.number().nonnegative().default(0),
  description:    z.string().default(""),
});

const CreateCustomRateSchema = z.object({
  client_id:      z.string().uuid(),
  service_type:   z.string().min(1),
  unit:           z.enum(RATE_UNITS),
  override_price: z.number().nonnegative(),
  minimum_charge: z.number().nonnegative().default(0),
  notes:          z.string().default(""),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const body = await req.json();

  // Custom rate path
  if (searchParams.get("type") === "custom") {
    const parsed = CreateCustomRateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }
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
    await updateClient(parsed.data.client_id, { has_custom_rates: true });
    return NextResponse.json({ data: rate }, { status: 201 });
  }

  // Standard rate path (default)
  const parsed = CreateStandardRateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const rate: StandardRate = {
    rate_id:        uuidv4(),
    active:         true,
    effective_date: new Date().toISOString().split("T")[0],
    ...parsed.data,
  };
  await createStandardRate(rate);
  return NextResponse.json({ data: rate }, { status: 201 });
}
