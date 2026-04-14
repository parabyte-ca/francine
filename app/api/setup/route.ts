/**
 * POST /api/setup
 *
 * One-time initialization: writes header rows to all Sheets tabs.
 * Protect this route — call it once after deploying to a fresh workspace.
 */

import { NextResponse } from "next/server";
import { initializeSheetHeaders } from "@/lib/google/sheets";
import { auth } from "@/lib/auth";

export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initializeSheetHeaders();
  return NextResponse.json({ message: "Sheet headers initialized successfully" });
}
