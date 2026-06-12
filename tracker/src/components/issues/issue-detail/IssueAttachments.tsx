import { AttachmentFileChip } from "@/components/shared/AttachmentFileChip";
import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { jiraAttachmentUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";
import type { IssueAttachment } from "@/types/issue";

interface IssueAttachmentsProps {
  attachments: IssueAttachment[];
  projectSlug: string;
  className?: string;
}

export function IssueAttachments({ attachments, projectSlug, className }: IssueAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <section className={cn("space-y-2.5", className)}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Attachments
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {attachments.length}
        </span>
      </h3>
      <div className="flex flex-wrap gap-3">
        {attachments.map((attachment) => (
          <AttachmentItem key={attachment.id} attachment={attachment} projectSlug={projectSlug} />
        ))}
      </div>
    </section>
  );
}

function AttachmentItem({ attachment, projectSlug }: { attachment: IssueAttachment; projectSlug: string }) {
  const src = jiraAttachmentUrl(projectSlug, attachment.id);

  if (attachment.isImage) {
    return (
      <figure className="w-32 space-y-1">
        <AttachmentImage src={src} alt={attachment.filename} className="h-24 w-32 rounded-lg border object-cover" />
        <figcaption className="truncate text-[11px] text-muted-foreground" title={attachment.filename}>
          {attachment.filename}
        </figcaption>
      </figure>
    );
  }

  return <AttachmentFileChip src={src} name={attachment.filename} />;
}
