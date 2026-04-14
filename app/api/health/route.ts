import { NextResponse } from "next/server";

/**
 * GET /api/health
 * Used by Docker health checks and load-balancer probes.
 * Returns 200 as long as the Next.js server is running.
 */
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
