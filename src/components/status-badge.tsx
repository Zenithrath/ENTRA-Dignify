import { Badge } from "@/components/ui/badge";
import { statusMeta } from "@/lib/status";

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const meta = statusMeta(value);
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}
