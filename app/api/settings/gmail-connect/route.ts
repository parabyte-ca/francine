/**
 * GET /api/settings/gmail-connect
 *
 * Redirects the browser to Google's OAuth2 consent screen to authorise
 * the app to send email via the user's Gmail account.
 *
 * After consent Google redirects to /api/settings/gmail-callback where
 * the refresh token is stored in the Config sheet.
 *
 * Prerequisite: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must have
 * https://mail.google.com/ as an authorised scope in Google Cloud Console
 * (APIs & Services → OAuth consent screen → Scopes).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google/auth";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = crypto.randomUUID();
  cookies().set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 3600, // 1 hour
    sameSite: "lax",
  });

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  const redirectUri = `${baseUrl}/api/settings/gmail-callback`;

  const oauth = getOAuth2Client();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt:      "consent",
    scope:       ["https://mail.google.com/"],
    redirect_uri: redirectUri,
    state:       state,
  });

  return NextResponse.redirect(url);
}
