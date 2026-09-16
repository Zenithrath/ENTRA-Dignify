import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "storage", "uploads");

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.length > 0 ? base.slice(-120) : "file";
}

/**
 * Stores an uploaded file on disk under ./storage/uploads and returns the URL the
 * app serves it from. Swap this for Vercel Blob/S3 by setting BLOB_READ_WRITE_TOKEN
 * and replacing the body — callers only depend on the returned record.
 */
export async function saveUpload(file: File): Promise<{ url: string; fileName: string; size: number; mimeType: string }> {
  await mkdir(ROOT, { recursive: true });

  const stored = `${randomUUID()}-${safeName(file.name)}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(ROOT, stored), bytes);

  return {
    url: `/api/files/${stored}`,
    fileName: file.name,
    size: bytes.byteLength,
    mimeType: file.type || "application/octet-stream",
  };
}

export async function readStoredFile(storedName: string): Promise<Buffer> {
  const target = path.join(ROOT, safeName(storedName));
  if (!target.startsWith(ROOT)) throw new Error("Invalid path.");
  return readFile(target);
}
