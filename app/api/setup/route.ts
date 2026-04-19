/**
 * POST /api/setup
 *
 * Idempotent first-run initializer. Safe to call more than once.
 *
 * Steps:
 *   1. Create any missing Google Sheet tabs and write header rows.
 *   2. Create the invoice Drive folder if GOOGLE_DRIVE_FOLDER_ID is not set;
 *      persist the new folder ID to the Config sheet.
 *   3. Register (or renew) the Google Calendar push-notification watch;
 *      persist channel state to the Config sheet.
 *
 * The response body reports what was done and surfaces any IDs that were
 * auto-generated so the operator can record them.
 */

import { NextResponse } from "next/server";
import { initializeSheetHeaders, getConfig, setConfig } from "@/lib/google/sheets";
import { createDriveFolder } from "@/lib/google/drive";
import { renewCalendarWatchIfNeeded } from "@/lib/google/calendar";
import { auth } from "@/lib/auth";

export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  try {
    // ── 1. Sheets ──────────────────────────────────────────────────────────────
    await initializeSheetHeaders();
    results.sheets = "ok";

    // ── 2. Drive folder ──────────────────────────────────────────────────────
    const envFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const storedFolderId = await getConfig("GOOGLE_DRIVE_FOLDER_ID");

    if (envFolderId || storedFolderId) {
      results.drive_folder = "already configured";
    } else {
      const folderId = await createDriveFolder("Francine Invoices");
      await setConfig("GOOGLE_DRIVE_FOLDER_ID", folderId);
      results.drive_folder = "created";
      results.drive_folder_id = folderId;
      results.drive_folder_note =
        "Add GOOGLE_DRIVE_FOLDER_ID=" + folderId + " to .env.local for faster startup.";
    }

    // ── 3. Calendar watch ────────────────────────────────────────────────────
    const authUrl = process.env.AUTH_URL ?? "";
    if (!authUrl.startsWith("https://")) {
      results.calendar_watch = "skipped — AUTH_URL must be https:// for push notifications";
    } else {
      await renewCalendarWatchIfNeeded();
      results.calendar_watch = "ok";
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, results },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Setup complete", results });
}
