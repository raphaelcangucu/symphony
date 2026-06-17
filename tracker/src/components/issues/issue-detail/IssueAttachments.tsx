import { AttachmentFileChip } from "@/components/shared/AttachmentFileChip";
import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { isVideoAttachmentSource, isVideoMediaType, jiraAttachmentUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { IssueAttachment } from "@/types/issue";

interface IssueAttachmentsProps {
  attachments: IssueAttachment[];
  projectSlug: string;
  className?: string;
}

export function IssueAttachments({ attachments, projectSlug, className }: IssueAttachmentsProps) {
  const { t } = useTranslation();

  if (attachments.length === 0) return null;

  return (
    <section className={cn("space-y-2.5", className)}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("issue.attachmentsSection.title")}
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
      <AttachmentImage
        alt={attachment.filename}
        layout="thumbnail"
        showCaption
        src={src}
      />
    );
  }

  if (isVideoMediaType(attachment.mimeType) || isVideoAttachmentSource(attachment.filename)) {
    return (
      <figure className="w-48 max-w-full space-y-1">
        <AttachmentVideo
          src={src}
          label={attachment.filename}
          className="max-h-40 w-full rounded-lg border object-contain"
        />
        <figcaption className="truncate text-[11px] text-muted-foreground" title={attachment.filename}>
          {attachment.filename}
        </figcaption>
      </figure>
    );
  }

  return <AttachmentFileChip src={src} name={attachment.filename} />;
}
