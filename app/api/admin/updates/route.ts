/**
 * GET /api/admin/updates — release and upgrade status for the Updates page.
 * GET /api/admin/updates?summary=1 — just whether an update is available (sidebar).
 *
 * Francine always hosts a single organisation, so this server-wide feature is
 * always offered. Everyone in ALLOWED_EMAILS has owner rights.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpdateStatus } from "@/lib/updates/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const summary = req.nextUrl.searchParams.get("summary") === "1";
  const status = await getUpdateStatus({ includeLog: !summary });
  if (summary) {
    return NextResponse.json({
      data: {
        update_available: status.update_available,
        latest_version: status.latest?.version ?? "",
        in_progress: status.upgrade.in_progress,
      },
    });
  }
  return NextResponse.json({ data: status }, { headers: { "Cache-Control": "no-store" } });
}
