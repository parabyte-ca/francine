/**
 * GET  /api/settings  — read app settings from the Config sheet
 * PATCH /api/settings — update app settings in the Config sheet
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getConfig, setConfig } from "@/lib/google/sheets";

const PatchSettingsSchema = z.object({
  invoice_email_override: z.union([z.string().email(), z.literal("")]).optional(),
  weekly_revenue_threshold: z.number().nonnegative().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [invoice_email_override, gmail_refresh_token, weekly_revenue_threshold] = await Promise.all([
    getConfig("invoice_email_override"),
    getConfig("gmail_refresh_token"),
    getConfig("weekly_revenue_threshold"),
  ]);

  return NextResponse.json({
    data: {
      invoice_email_override: invoice_email_override ?? "",
      gmail_connected: !!(process.env.GMAIL_REFRESH_TOKEN || gmail_refresh_token),
      resend_configured: !!process.env.RESEND_API_KEY,
      weekly_revenue_threshold: weekly_revenue_threshold ? Number(weekly_revenue_threshold) : 2000,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.invoice_email_override !== undefined) {
    await setConfig("invoice_email_override", parsed.data.invoice_email_override.trim());
  }
  if (parsed.data.weekly_revenue_threshold !== undefined) {
    await setConfig("weekly_revenue_threshold", String(parsed.data.weekly_revenue_threshold));
  }

  return NextResponse.json({ data: { ok: true } });
}
