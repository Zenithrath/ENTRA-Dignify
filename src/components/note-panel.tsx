import { AttachmentEntity } from "@/generated/prisma/enums";
import { addNote } from "@/lib/actions/attachment-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { FormShell } from "@/components/form-shell";
import { formatDateTime } from "@/lib/queries/common";

export type NoteRow = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
};

export function NotePanel({
  entityType,
  entityId,
  notes,
  canEdit,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  notes: NoteRow[];
  canEdit: boolean;
}) {
  const action = addNote.bind(null, entityType, entityId);

  return (
    <Card>
      <CardHeader title="Internal notes" description="Hanya terlihat oleh tim internal." />
      {notes.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {notes.map((note) => (
            <li key={note.id} className="px-5 py-3">
              <p className="text-sm text-slate-700">{note.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                {note.authorName ?? "Internal"} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <CardBody className="text-xs text-slate-500">Belum ada catatan internal.</CardBody>
      )}

      {canEdit ? (
        <CardBody className="border-t border-slate-100">
          <FormShell action={action} submitLabel="Add note" size="sm">
            <Textarea name="body" placeholder="Catatan untuk tim…" required />
          </FormShell>
        </CardBody>
      ) : null}
    </Card>
  );
}
