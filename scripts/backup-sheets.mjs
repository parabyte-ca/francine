// Prints a JSON snapshot of every tab in the Francine Google Sheet to stdout.
//
// update.sh runs it inside the running container, before anything changes:
//   docker exec -i francine node --input-type=module - < scripts/backup-sheets.mjs
// so it works even when the running image is older than this script. It uses
// the container's own GOOGLE_* settings and asks only for read access.

import { google } from "googleapis";

const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
if (!keyBase64 || !spreadsheetId) {
  console.error("backup: GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 and GOOGLE_SHEET_ID must be set");
  process.exit(1);
}

try {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(Buffer.from(keyBase64, "base64").toString("utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);

  const tabs = {};
  if (titles.length > 0) {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
      valueRenderOption: "FORMULA",
    });
    (res.data.valueRanges ?? []).forEach((vr, i) => {
      tabs[titles[i]] = vr.values ?? [];
    });
  }

  process.stdout.write(
    JSON.stringify({
      format: "francine-sheets-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      spreadsheet_title: meta.data.properties?.title ?? "",
      tabs,
    }) + "\n",
  );
} catch (err) {
  console.error(`backup: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
