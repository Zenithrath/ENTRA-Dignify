import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  await requireAuth();
  const { name } = await params;

  try {
    const bytes = await readStoredFile(name);
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const type = MIME[extension] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("File not found", { status: 404 });
  }
}
