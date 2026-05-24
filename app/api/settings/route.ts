/**
 * GET  /api/settings  — read app settings from the Config sheet
 * PATCH /api/settings — update app settings in the Config sheet
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getConfig, setConfig } from "@/lib/google/sheets";

const PatchSettingsSchema = z.object({
  invoice_email_override: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice_email_override = await getConfig("invoice_email_override") ?? "";
  return NextResponse.json({ data: { invoice_email_override } });
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

  return NextResponse.json({ data: { ok: true } });
}
