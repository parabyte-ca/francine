/**
 * GET /api/cron/check-updates
 *
 * Daily release check, called by .github/workflows/update-check.yml (or any
 * scheduler) with "Authorization: Bearer <CRON_SECRET>". Turned off with
 * APP_UPDATE_CHECK=false.
 */

import { NextRequest, NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { isNewer } from "@/lib/updates/semver";
import { runReleaseCheck, updateSettings } from "@/lib/updates/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!updateSettings().checkEnabled) {
    return NextResponse.json({ message: "Release checks are turned off (APP_UPDATE_CHECK=false)", checked: false });
  }

  const cache = await runReleaseCheck();
  const latest = cache.release?.version ?? "";
  return NextResponse.json({
    checked: true,
    current_version: APP_VERSION,
    latest_version: latest,
    update_available: !!latest && isNewer(latest, APP_VERSION),
    ...(cache.check_error ? { error: cache.check_error } : {}),
  });
}
