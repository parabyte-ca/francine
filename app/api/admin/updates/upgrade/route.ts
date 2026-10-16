/**
 * POST /api/admin/updates/upgrade { version } — ask the host helper to upgrade.
 *
 * Needs a signed-in browser session (bearer tokens are refused), a same-origin
 * request, the latest release, a newer version than the one running, a
 * connected helper and no upgrade already requested or running.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSameOrigin } from "@/lib/same-origin";
import { checkUpgradeCaller } from "@/lib/updates/policy";
import { requestUpgrade } from "@/lib/updates/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  const caller = checkUpgradeCaller({
    sessionEmail: session?.user?.email ?? null,
    hasAuthorizationHeader: req.headers.has("authorization"),
    sameOrigin: isSameOrigin(req),
  });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body: unknown = await req.json().catch(() => null);
  const version = body && typeof body === "object" ? (body as { version?: unknown }).version : undefined;

  const result = await requestUpgrade(version, session!.user!.email!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.status }, { status: 202 });
}
