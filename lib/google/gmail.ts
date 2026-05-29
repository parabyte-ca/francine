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

import { sendEmail } from "../email";

// Re-export so existing imports of sendEmail from this module still work
export { sendEmail };

/** Escape HTML special characters to prevent injection in email bodies */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
      <h2 style="color: #d97706;">Invoice ${esc(params.invoiceNumber)}</h2>
      <p>Hi ${esc(params.clientName)},</p>
      <p>Please find your invoice attached. Here's a summary:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Invoice #</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb;">${esc(params.invoiceNumber)}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Amount Due</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb; color:#16a34a;"><strong>$${params.total.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #e5e7eb;"><strong>Due Date</strong></td>
          <td style="padding:8px; border:1px solid #e5e7eb;">${esc(params.dueDate)}</td>
        </tr>
      </table>
      <p>
        <a href="${esc(params.driveUrl)}" style="background:#d97706; color:white; padding:10px 20px;
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
      <h2 style="color: #d97706;">Your Appointment is Confirmed</h2>
      <p>Hi ${esc(params.clientName)},</p>
      <p>Your appointment has been confirmed. Details:</p>
      <ul>
        <li><strong>Service:</strong> ${esc(params.serviceType)}</li>
        <li><strong>Date &amp; Time:</strong> ${esc(params.startTime)}</li>
        <li><strong>Location:</strong> ${esc(params.location || "TBD")}</li>
        ${params.meetLink ? `<li><strong>Meeting Link:</strong> <a href="${esc(params.meetLink)}">${esc(params.meetLink)}</a></li>` : ""}
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
      <p>Hi ${esc(params.clientName)},</p>
      <p>We have received your payment. Thank you!</p>
      <ul>
        <li><strong>Invoice:</strong> ${esc(params.invoiceNumber)}</li>
        <li><strong>Amount:</strong> $${params.amountPaid.toFixed(2)}</li>
        <li><strong>Date:</strong> ${esc(params.paidAt)}</li>
      </ul>
      <p>A receipt has been recorded in our system. Please retain this email for your records.</p>
    </div>`;

  await sendEmail({ to: params.to, subject, htmlBody });
}
