/**
 * POST /api/admin/updates/check — check GitHub for a new release now.
 * Limited to one real check a minute; a fresher cached answer is returned instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSameOrigin } from "@/lib/same-origin";
import { getUpdateStatus, runReleaseCheck } from "@/lib/updates/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "This request didn't come from the Francine app." }, { status: 403 });
  }

  await runReleaseCheck();
  return NextResponse.json({ data: await getUpdateStatus({ includeLog: true }) });
}
