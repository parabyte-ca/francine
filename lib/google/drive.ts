/**
 * lib/google/drive.ts
 *
 * Handles uploading invoice PDFs to a designated Google Drive folder
 * and managing their share links.
 */

import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";
import { getServiceAccountAuth } from "./auth";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getDriveClient(): drive_v3.Drive {
  const auth = getServiceAccountAuth();
  return google.drive({ version: "v3", auth });
}

const FOLDER_ID = () => {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  return id;
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a PDF buffer to Google Drive.
 * Returns the file ID and a shareable link.
 */
export async function uploadInvoicePdf(params: {
  filename: string;     // e.g. "INV-2024-0042.pdf"
  pdfBuffer: Buffer;
}): Promise<{ fileId: string; fileUrl: string }> {
  const drive = getDriveClient();

  // Convert Buffer → Readable stream (required by the Drive API)
  const stream = Readable.from(params.pdfBuffer);

  const res = await drive.files.create({
    requestBody: {
      name: params.filename,
      mimeType: "application/pdf",
      parents: [FOLDER_ID()],
    },
    media: {
      mimeType: "application/pdf",
      body: stream,
    },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id!;

  // Make the file readable by anyone with the link
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  const fileUrl = res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

  return { fileId, fileUrl };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Retrieve a PDF as a Buffer (for re-sending via email) */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Permanently delete a file (e.g. when voiding an invoice) */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** List invoice PDFs in the configured folder */
export async function listInvoiceFiles(): Promise<
  Array<{ id: string; name: string; createdTime: string; webViewLink: string }>
> {
  const drive = getDriveClient();

  const res = await drive.files.list({
    q: `'${FOLDER_ID()}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id, name, createdTime, webViewLink)",
    orderBy: "createdTime desc",
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    createdTime: f.createdTime!,
    webViewLink: f.webViewLink!,
  }));
}
