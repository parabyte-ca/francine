/**
 * POST /api/dev/reset
 *
 * Development-only endpoint. Clears all data rows from every sheet tab
 * (keeps header row 1 and the Config tab intact).
 *
 * TODO: Remove before production.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearAllData } from "@/lib/google/sheets";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const cleared = await clearAllData();
    return NextResponse.json({ cleared });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
