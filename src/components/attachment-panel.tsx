import { AttachmentEntity } from "@/generated/prisma/enums";
import { deleteAttachment, uploadAttachment } from "@/lib/actions/attachment-actions";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { FormShell } from "@/components/form-shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/queries/common";
import { buttonClass } from "@/components/ui/button";

export type AttachmentRow = {
  id: string;
  fileName: string;
  url: string;
  label: string | null;
  version: number;
  sizeBytes: number | null;
  createdAt: Date;
};

const INLINE_IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

/** PDFs and images can be shown in-place; anything else just opens in a new tab. */
function isPreviewable(fileName: string): boolean {
  const extension = extensionOf(fileName);
  return extension === "pdf" || INLINE_IMAGE_EXT.includes(extension);
}

function Preview({ attachment }: { attachment: AttachmentRow }) {
  const extension = extensionOf(attachment.fileName);

  if (extension === "pdf") {
    return (
      <object data={attachment.url} type="application/pdf" className="h-96 w-full rounded-lg border border-slate-200">
        <p className="p-4 text-xs text-slate-500">Browser tidak mendukung preview PDF.</p>
      </object>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachment.url}
      alt={attachment.fileName}
      className="max-h-96 w-auto rounded-lg border border-slate-200"
      loading="lazy"
    />
  );
}

function AttachmentItem({ attachment, canEdit }: { attachment: AttachmentRow; canEdit: boolean }) {
  const previewable = isPreviewable(attachment.fileName);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium text-indigo-600 hover:underline"
          >
            {attachment.fileName}
          </a>
          <p className="text-xs text-slate-500">
            {attachment.label ? `${attachment.label} · ` : ""}
            v{attachment.version}
            {attachment.sizeBytes ? ` · ${(attachment.sizeBytes / 1024).toFixed(0)} KB` : ""} ·{" "}
            {formatDateTime(attachment.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {previewable ? (
            <details className="group">              <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none")}>Preview</summary>
            </details>
          ) : null}
          {canEdit ? (
            <ActionForm action={deleteAttachment.bind(null, attachment.id)}>
              <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                Remove
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </div>

      {previewable ? (
        <div className="hidden group-open:block">
          <div className="mt-3 flex justify-center">
            <Preview attachment={attachment} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AttachmentPanel({
  entityType,
  entityId,
  attachments,
  canEdit,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  attachments: AttachmentRow[];
  canEdit: boolean;
}) {
  const upload = uploadAttachment.bind(null, entityType, entityId);

  return (
    <Card>
      <CardHeader
        title="Attachments"
        description="Dokumen pendukung, versi terbaru di atas."
        actions={<span className="text-xs text-slate-500">{attachments.length} file</span>}
      />
      {attachments.length === 0 ? (
        <EmptyState title="No attachments" description="Upload dokumen kontrak, PO, atau bukti pengiriman." />
      ) : (
        <ul className="divide-y divide-slate-100">{attachments.map((attachment) => (
          <AttachmentItem key={attachment.id} attachment={attachment} canEdit={canEdit} />
        ))}</ul>
      )}

      {canEdit ? (
        <CardBody className="border-t border-slate-100">
          <FormShell action={upload} submitLabel="Upload" size="sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="File">
                <Input type="file" name="file" className="py-1.5" />
              </Field>
              <Field label="Label">
                <Input name="label" placeholder="e.g. Signed PO" />
              </Field>
              <Field label="atau URL dokumen" hint="Untuk dokumen yang sudah ada di drive lain">
                <Input name="url" placeholder="https://…" />
              </Field>
            </div>
          </FormShell>
        </CardBody>
      ) : null}
    </Card>
  );
}

export function attachmentLinkLabel(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}
