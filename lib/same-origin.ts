import type { NextRequest } from "next/server";

/**
 * True when a state-changing request came from Francine's own pages.
 * Browsers always send Origin on POST, so a missing header is refused.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([req.nextUrl.origin]);
  for (const url of [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!url) continue;
    try {
      allowed.add(new URL(url).origin);
    } catch {
      // ignore malformed settings
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
    allowed.add(`${proto}://${host.split(",")[0].trim()}`);
  }
  return allowed.has(origin);
}
