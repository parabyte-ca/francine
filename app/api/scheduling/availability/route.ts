/**
 * GET /api/scheduling/availability?start=ISO&end=ISO&slotMinutes=60
 *
 * Returns free/busy slot grid from Google Calendar.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAvailability } from "@/lib/google/calendar";

const QuerySchema = z.object({
  start:       z.string(),
  end:         z.string(),
  slotMinutes: z.coerce.number().int().positive().default(60),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    start:       searchParams.get("start"),
    end:         searchParams.get("end"),
    slotMinutes: searchParams.get("slotMinutes"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const slots = await getAvailability(
    parsed.data.start,
    parsed.data.end,
    parsed.data.slotMinutes
  );

  return NextResponse.json({ data: slots });
}
