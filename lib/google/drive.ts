/**
 * lib/google/drive.ts
 *
 * Handles uploading invoice PDFs to a designated Google Drive folder
 * and managing their share links.
 */

import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";
import { getServiceAccountAuth } from "./auth";
import { getConfig } from "./sheets";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getDriveClient(): drive_v3.Drive {
  const auth = getServiceAccountAuth();
  return google.drive({ version: "v3", auth });
}

async function getFolderId(): Promise<string> {
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) return process.env.GOOGLE_DRIVE_FOLDER_ID;
  const stored = await getConfig("GOOGLE_DRIVE_FOLDER_ID");
  if (stored) return stored;
  throw new Error(
    "GOOGLE_DRIVE_FOLDER_ID is not configured. Run POST /api/setup to create the folder automatically."
  );
}

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
  const folderId = await getFolderId();

  // Convert Buffer → Readable stream (required by the Drive API)
  const stream = Readable.from(params.pdfBuffer);

  const res = await drive.files.create({
    requestBody: {
      name: params.filename,
      mimeType: "application/pdf",
      parents: [folderId],
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
  const folderId = await getFolderId();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Creates a Drive folder owned by the service account and returns its ID.
 * Called once by POST /api/setup when GOOGLE_DRIVE_FOLDER_ID is not configured.
 */
export async function createDriveFolder(name: string): Promise<string> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  return res.data.id!;
}
