/**
 * lib/email.ts
 *
 * Unified email dispatch layer. Provider priority:
 *   1. Resend (RESEND_API_KEY env var)
 *   2. Gmail OAuth2 (GMAIL_REFRESH_TOKEN env var OR gmail_refresh_token in Config sheet)
 *   3. Error — no provider configured
 *
 * The test override (invoice_email_override in Config) is applied here so all
 * email paths benefit automatically — no per-route override logic needed.
 */

import { google } from "googleapis";
import { getOAuth2Client } from "./google/auth";
import { getConfig } from "./google/sheets";

export interface SendEmailParams {
  to: string;
  subject: string;
  htmlBody: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
}

// ---------------------------------------------------------------------------
// RFC-2822 message builder (used by the Gmail OAuth2 path)
// ---------------------------------------------------------------------------

function buildRawMessage(params: {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}`;

  const message = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
  ];

  if (params.attachmentBuffer) {
    message.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    message.push("");
    message.push(`--${boundary}`);
    message.push(`Content-Type: text/html; charset=UTF-8`);
    message.push(`Content-Transfer-Encoding: base64`);
    message.push("");
    // Base64-encode the HTML body and wrap at 76 chars per RFC 2045
    message.push(Buffer.from(params.htmlBody).toString("base64").replace(/(.{76})/g, "$1\r\n").trimEnd());
    message.push(`--${boundary}`);
    message.push(`Content-Type: application/pdf; name="${params.attachmentFilename}"`);
    message.push(`Content-Transfer-Encoding: base64`);
    message.push(`Content-Disposition: attachment; filename="${params.attachmentFilename}"`);
    message.push("");
    // Wrap at 76 chars per RFC 2045
    message.push(params.attachmentBuffer.toString("base64").replace(/(.{76})/g, "$1\r\n").trimEnd());
    message.push(`--${boundary}--`);
  } else {
    message.push(`Content-Type: text/html; charset=UTF-8`);
    message.push("");
    message.push(params.htmlBody);
  }

  return Buffer.from(message.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

export async function sendEmail(params: SendEmailParams): Promise<void> {
  // Apply test override — replaces recipient for all outbound emails when set
  const override = (await getConfig("invoice_email_override"))?.trim();
  const recipient = override || params.to;

  const fromAddress =
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.GMAIL_FROM_ADDRESS ||
    "noreply@example.com";

  // ── Path 1: Resend ────────────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);

    const attachments: Array<{ filename: string; content: Buffer }> = [];
    if (params.attachmentBuffer && params.attachmentFilename) {
      attachments.push({ filename: params.attachmentFilename, content: params.attachmentBuffer });
    }

    const { error } = await resend.emails.send({
      from: fromAddress,
      to:   recipient,
      subject: params.subject,
      html:    params.htmlBody,
      attachments,
    });

    if (error) throw new Error(`Resend error: ${error.message}`);
    return;
  }

  // ── Path 2: Gmail OAuth2 ──────────────────────────────────────────────────
  const refreshToken =
    process.env.GMAIL_REFRESH_TOKEN ||
    (await getConfig("gmail_refresh_token"));

  if (refreshToken) {
    const oauth = getOAuth2Client();
    oauth.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth });

    const raw = buildRawMessage({
      to:                 recipient,
      from:               fromAddress,
      subject:            params.subject,
      htmlBody:           params.htmlBody,
      attachmentBuffer:   params.attachmentBuffer,
      attachmentFilename: params.attachmentFilename,
    });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return;
  }

  // ── No provider ───────────────────────────────────────────────────────────
  throw new Error(
    "No email provider configured. " +
    "Set RESEND_API_KEY in .env.local, or connect your Gmail account in Settings."
  );
}
