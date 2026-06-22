/**
 * GET /api/cron/payment-reminders
 *
 * Scans all unpaid invoices and sends automatic payment reminders.
 * Called by a scheduled job (GitHub Actions, cron-job.org, host cron, etc.).
 *
 * Auth: Bearer token via CRON_SECRET env var.
 * Safe to call daily — skips invoices that were reminded too recently.
 *
 * Reminder logic:
 *   - First reminder: issue_date + reminder_interval_days <= today
 *   - Follow-up:      last_reminder_at + reminder_interval_days <= today
 *
 * Config keys in Sheets Config tab:
 *   auto_reminders_enabled  — "true" | "false"  (default: false)
 *   reminder_interval_days  — number             (default: 30)
 */

import { NextRequest, NextResponse } from "next/server";
import { listInvoices, getClient, updateInvoice, getConfig } from "@/lib/google/sheets";
import { sendReminderEmail } from "@/lib/google/gmail";

function daysBetween(isoA: string, isoB: Date): number {
  return Math.floor((isoB.getTime() - new Date(isoA).getTime()) / 86_400_000);
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check config
  const [enabledVal, intervalVal] = await Promise.all([
    getConfig("auto_reminders_enabled"),
    getConfig("reminder_interval_days"),
  ]);

  if (enabledVal !== "true") {
    return NextResponse.json({ message: "Auto reminders are disabled", sent: 0 });
  }

  const intervalDays = intervalVal ? Math.max(1, Number(intervalVal)) : 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const invoices = await listInvoices({ status: "sent" });
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const invoice of invoices) {
    try {
      const daysSinceIssued = daysBetween(invoice.issue_date, today);
      if (daysSinceIssued < intervalDays) { skipped++; continue; }

      if (invoice.last_reminder_at) {
        const daysSinceReminder = daysBetween(invoice.last_reminder_at, today);
        if (daysSinceReminder < intervalDays) { skipped++; continue; }
      }

      const client = await getClient(invoice.client_id);
      if (!client) { skipped++; continue; }

      const count = Number(invoice.reminder_count) || 0;
      const now   = new Date().toISOString();

      await sendReminderEmail({
        to:            client.email,
        clientName:    client.name,
        invoiceNumber: invoice.invoice_number,
        total:         invoice.total,
        dueDate:       invoice.due_date,
        driveUrl:      invoice.drive_file_url,
        reminderCount: count + 1,
      });

      await updateInvoice(invoice.invoice_id, {
        reminder_count:   count + 1,
        last_reminder_at: now,
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${invoice.invoice_number}: ${msg}`);
    }
  }

  return NextResponse.json({
    message: `Sent ${sent} reminder(s), skipped ${skipped}`,
    sent,
    skipped,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
