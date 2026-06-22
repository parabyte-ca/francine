/**
 * GET /api/settings/gmail-callback
 *
 * OAuth2 callback — exchanges the authorization code for tokens and
 * stores the refresh token in the Config sheet as "gmail_refresh_token".
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google/auth";
import { setConfig } from "@/lib/google/sheets";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const cookieStore = cookies();
  const savedState = cookieStore.get("gmail_oauth_state")?.value;
  cookieStore.delete("gmail_oauth_state");

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";

  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${baseUrl}/setup?gmail=csrf_error`);
  }

  if (error || !code) {
    return NextResponse.redirect(`${baseUrl}/setup?gmail=denied`);
  }

  const baseUrl     = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  const redirectUri = `${baseUrl}/api/settings/gmail-callback`;

  const oauth = getOAuth2Client();
  const { tokens } = await oauth.getToken({ code, redirect_uri: redirectUri });

  if (!tokens.refresh_token) {
    return NextResponse.redirect(`${baseUrl}/setup?gmail=no_refresh_token`);
  }

  await setConfig("gmail_refresh_token", tokens.refresh_token);

  return NextResponse.redirect(`${baseUrl}/setup?gmail=connected`);
}
