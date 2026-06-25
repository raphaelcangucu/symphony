import { X } from "lucide-react";
import { useState } from "react";

import { AttachmentFileChip } from "@/components/shared/AttachmentFileChip";
import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { cn } from "@/lib/utils";
import { isVideoAttachmentSource, isVideoMediaType, jiraAttachmentUrl } from "@/services/attachments";
import { useTranslation } from "react-i18next";
import type { IssueAttachment } from "@/types/issue";

interface IssueAttachmentsProps {
  attachments: IssueAttachment[];
  projectSlug: string;
  className?: string;
  onRemoveAttachment?: (attachmentId: string) => Promise<boolean>;
}

export function IssueAttachments({
  attachments,
  projectSlug,
  className,
  onRemoveAttachment,
}: IssueAttachmentsProps) {
  const { t } = useTranslation();
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  async function handleRemove(attachment: IssueAttachment) {
    if (!onRemoveAttachment || removingId) return;
    setRemovingId(attachment.id);
    try {
      await onRemoveAttachment(attachment.id);
    } finally {
      setRemovingId(null);
    }
  }

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
          <AttachmentItem
            key={attachment.id}
            attachment={attachment}
            projectSlug={projectSlug}
            removable={Boolean(onRemoveAttachment)}
            removing={removingId === attachment.id}
            onRemove={onRemoveAttachment ? () => void handleRemove(attachment) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function AttachmentItem({
  attachment,
  projectSlug,
  removable,
  removing,
  onRemove,
}: {
  attachment: IssueAttachment;
  projectSlug: string;
  removable: boolean;
  removing: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const src = jiraAttachmentUrl(projectSlug, attachment.id);

  const removeButton =
    removable && onRemove ? (
      <button
        type="button"
        aria-label={t("issue.attachmentsSection.removeAttachment", { name: attachment.filename })}
        disabled={removing}
        onClick={onRemove}
        className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-3 w-3" />
      </button>
    ) : null;

  if (attachment.isImage) {
    return (
      <div className="group relative">
        <AttachmentImage alt={attachment.filename} layout="thumbnail" showCaption src={src} />
        {removeButton}
      </div>
    );
  }

  if (isVideoMediaType(attachment.mimeType) || isVideoAttachmentSource(attachment.filename)) {
    return (
      <figure className="group relative w-48 max-w-full space-y-1">
        <AttachmentVideo
          src={src}
          label={attachment.filename}
          className="max-h-40 w-full rounded-lg border object-contain"
        />
        <figcaption className="truncate text-[11px] text-muted-foreground" title={attachment.filename}>
          {attachment.filename}
        </figcaption>
        {removeButton}
      </figure>
    );
  }

  return (
    <div className="group relative">
      <AttachmentFileChip src={src} name={attachment.filename} />
      {removeButton}
    </div>
  );
}
