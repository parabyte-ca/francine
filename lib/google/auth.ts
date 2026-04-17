/**
 * lib/google/auth.ts
 *
 * Provides two authentication strategies:
 *
 * 1. Service Account — used for all server-side API calls (Sheets, Drive, Gmail).
 *    The JSON key is stored as a base64-encoded env var to keep it out of the
 *    filesystem and avoid accidental git commits.
 *
 * 2. OAuth2 Client — used when an action must be performed on behalf of a
 *    specific user (e.g. sending Gmail as a staff member rather than a bot).
 *
 * Usage:
 *   import { getServiceAccountAuth, SCOPES } from "@/lib/google/auth";
 *   const auth = await getServiceAccountAuth();
 *   const sheets = google.sheets({ version: "v4", auth });
 */

import { google, Auth } from "googleapis";

// ---------------------------------------------------------------------------
// Scopes required across all Google APIs used in this app
// ---------------------------------------------------------------------------
export const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",   // read/write Sheets
  "https://www.googleapis.com/auth/calendar",        // read/write Calendar
  "https://www.googleapis.com/auth/drive",           // upload PDFs to Drive
  "https://www.googleapis.com/auth/gmail.send",      // send email via Gmail
] as const;

// ---------------------------------------------------------------------------
// Service Account auth (singleton — reused across requests in the same process)
// ---------------------------------------------------------------------------
let _serviceAccountAuth: Auth.GoogleAuth | null = null;

export function getServiceAccountAuth(): Auth.GoogleAuth {
  if (_serviceAccountAuth) return _serviceAccountAuth;

  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyBase64) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not set. " +
        "Encode your service-account JSON key with: base64 -i key.json"
    );
  }

  const keyJson = Buffer.from(keyBase64, "base64").toString("utf-8");
  const credentials = JSON.parse(keyJson);

  _serviceAccountAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [...SCOPES],
  });

  return _serviceAccountAuth;
}

// ---------------------------------------------------------------------------
// OAuth2 client — for delegated user actions or refresh-token flows
// ---------------------------------------------------------------------------
export function getOAuth2Client(
  accessToken?: string,
  refreshToken?: string
): Auth.OAuth2Client {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );

  if (accessToken || refreshToken) {
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  return client;
}
