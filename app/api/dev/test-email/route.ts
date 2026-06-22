/**
 * POST /api/dev/test-email
 *
 * Development-only endpoint. Sends a plain test email to the address in
 * invoice_email_override (Config sheet) or to francine.herskowitz@gmail.com
 * as a fallback. Used to verify email delivery without creating a real invoice.
 *
 * TODO: Remove before production.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getConfig } from "@/lib/google/sheets";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const override = (await getConfig("invoice_email_override"))?.trim();
  const testAddress = override || "francine.herskowitz@gmail.com";

  try {
    await sendEmail({
      to: testAddress,
      subject: "Francine CRM — Email delivery test",
      htmlBody: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d97706;">Email delivery test</h2>
          <p>This is a test message from Francine CRM to confirm that outbound email is working correctly.</p>
          <p style="color: #6b7280; font-size: 12px;">Sent at ${new Date().toISOString()}</p>
        </div>`,
    });

    return NextResponse.json({ message: `Test email sent to ${testAddress}` }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
