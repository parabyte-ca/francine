/**
 * GET /api/scheduling/check-conflict?start=ISO&end=ISO
 *
 * Lightweight conflict probe used by the new-order and scheduling forms
 * before submitting. Returns { conflict: boolean }.
 * Fails open (returns false) on any calendar error.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasCalendarConflict } from "@/lib/google/calendar";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end   = searchParams.get("end");

  if (!start || !end) return NextResponse.json({ conflict: false });

  try {
    const startDate = new Date(start);
    const endDate   = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      return NextResponse.json({ conflict: false });
    }
    const conflict = await hasCalendarConflict(start, end);
    return NextResponse.json({ conflict });
  } catch {
    return NextResponse.json({ conflict: false });
  }
}
