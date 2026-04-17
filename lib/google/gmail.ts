/**
 * lib/google/gmail.ts
 *
 * Transactional email via Gmail API.
 *
 * Handles:
 *   - Quote/invoice delivery to clients
 *   - Appointment confirmation / reminder emails
 *   - Payment-received notifications
 *
 * Note: The service account must have domain-wide delegation enabled, OR
 * you must use an OAuth2 client with a refresh token from the sender address.
 */

import { google } from "googleapis";
import { getServiceAccountAuth } from "./auth";

// ---------------------------------------------------------------------------
// Internal: build an RFC-2822-compliant message
// ---------------------------------------------------------------------------

function buildRawMessage(params: {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
  attachmentMime?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}`;
  const from = params.from || process.env.GMAIL_FROM_ADDRESS!;

  const message = [
    `From: ${from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
  ];

  if (params.attachmentBuffer) {
    message.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    message.push("");
    message.push(`--${boundary}`);
    message.push(`Content-Type: text/html; charset=UTF-8`);
    message.push(`Content-Transfer-Encoding: quoted-printable`);
    message.push("");
    message.push(params.htmlBody);
    message.push(`--${boundary}`);
    message.push(
      `Content-Type: ${params.attachmentMime ?? "application/pdf"}; name="${params.attachmentFilename}"`
    );
    message.push(`Content-Transfer-Encoding: base64`);
    message.push(`Content-Disposition: attachment; filename="${params.attachmentFilename}"`);
    message.push("");
    message.push(params.attachmentBuffer.toString("base64"));
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
// Core send function
// ---------------------------------------------------------------------------

export async function sendEmail(params: {
  to: string;
  subject: string;
  htmlBody: string;
  attachmentBuffer?: Buffer;
  attachmentFilename?: string;
}): Promise<void> {
  const auth = getServiceAccountAuth();
  const gmail = google.gmail({ version: "v1", auth });

  const raw = buildRawMessage({
    to: params.to,
    from: process.env.GMAIL_FROM_ADDRESS!,
    subject: params.subject,
    htmlBody: params.htmlBody,
    attachmentBuffer: params.attachmentBuffer,
    attachmentFilename: params.attachmentFilename,
    attachmentMime: "application/pdf",
  });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

// ---------------------------------------------------------------------------
// High-level email templates
// ---------------------------------------------------------------------------

export async function sendInvoiceEmail(params: {
  to: string;
  clientName: string;
  invoiceNumber: string;
  total: number;
  dueDate: string;
  driveUrl: string;
  pdfBuffer?: Buffer;
}): Promise<void> {
  const subject = `Invoice ${params.invoiceNumber} — Payment Due ${params.dueDate}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Invoice ${params.invoiceNumber}</h2>
      <p>Hi ${params.clientName},</p>
      <p>Please find your invoice attached. Here's a summary:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Invoice #</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb;">${params.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Amount Due</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb; color:#16a34a;"><strong>$${params.total.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Due Date</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb;">${params.dueDate}</td>
        </tr>
      </table>
      <p>
        <a href="${params.driveUrl}" style="background:#1d4ed8; color:white; padding:10px 20px;
           border-radius:4px; text-decoration:none;">View Invoice PDF</a>
      </p>
      <p style="color:#6b7280; font-size:12px;">
        If you have any questions, please reply to this email.
      </p>
    </div>`;

  await sendEmail({
    to: params.to,
    subject,
    htmlBody,
    attachmentBuffer: params.pdfBuffer,
    attachmentFilename: `${params.invoiceNumber}.pdf`,
  });
}

export async function sendAppointmentConfirmation(params: {
  to: string;
  clientName: string;
  serviceType: string;
  startTime: string;   // human-readable
  location: string;
  meetLink?: string;
}): Promise<void> {
  const subject = `Appointment Confirmed — ${params.serviceType} on ${params.startTime}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Your Appointment is Confirmed</h2>
      <p>Hi ${params.clientName},</p>
      <p>Your appointment has been confirmed. Details:</p>
      <ul>
        <li><strong>Service:</strong> ${params.serviceType}</li>
        <li><strong>Date &amp; Time:</strong> ${params.startTime}</li>
        <li><strong>Location:</strong> ${params.location || "TBD"}</li>
        ${params.meetLink ? `<li><strong>Meeting Link:</strong> <a href="${params.meetLink}">${params.meetLink}</a></li>` : ""}
      </ul>
      <p>Please reply to this email if you need to reschedule.</p>
    </div>`;

  await sendEmail({ to: params.to, subject, htmlBody });
}

export async function sendPaymentReceiptEmail(params: {
  to: string;
  clientName: string;
  invoiceNumber: string;
  amountPaid: number;
  paidAt: string;
}): Promise<void> {
  const subject = `Payment Received — ${params.invoiceNumber}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">Payment Received</h2>
      <p>Hi ${params.clientName},</p>
      <p>We have received your payment. Thank you!</p>
      <ul>
        <li><strong>Invoice:</strong> ${params.invoiceNumber}</li>
        <li><strong>Amount:</strong> $${params.amountPaid.toFixed(2)}</li>
        <li><strong>Date:</strong> ${params.paidAt}</li>
      </ul>
      <p>A receipt has been recorded in our system. Please retain this email for your records.</p>
    </div>`;

  await sendEmail({ to: params.to, subject, htmlBody });
}
