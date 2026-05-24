import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updateStandardRate } from "@/lib/google/sheets";
import type { RateUnit } from "@/types";

const RATE_UNITS: [RateUnit, ...RateUnit[]] = [
  "hour", "flat", "per_item", "per_word", "per_minute",
  "session", "half-day", "full-day", "custom",
];

const PatchRateSchema = z.object({
  service_type:   z.string().min(1).optional(),
  unit:           z.enum(RATE_UNITS).optional(),
  base_price:     z.coerce.number().nonnegative().optional(),
  minimum_charge: z.coerce.number().nonnegative().optional(),
  description:    z.string().optional(),
  active:         z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = PatchRateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await updateStandardRate(params.id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await updateStandardRate(params.id, { active: false });
  return NextResponse.json({ ok: true });
}
