import { AudioLines, Check, FileText, ImageIcon, Plus, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EditedFilesSummary } from "@/components/assistant/EditedFilesSummary";
import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import { UserQuestionsCard } from "@/components/assistant/UserQuestionsCard";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { AttachmentFileChip } from "@/components/shared/AttachmentFileChip";
import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { isVideoAttachmentSource, isVideoMediaType, projectAttachmentUrl } from "@/services/attachments";
import { normalizeAssistantDocumentHref } from "@/services/threadDocuments";
import type { AssistantChatMessage, UserQuestion } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

type PlanApprovalMode = "build" | "yolo";

export interface AssistantChatPlanApprovalAction {
  messageId: string;
  disabled: boolean;
  onApprove: (messageId: string, mode: PlanApprovalMode) => void;
}

interface AssistantChatMessageBubbleProps {
  message: AssistantChatMessage;
  projectSlug?: string;
  issueIdentifier?: string;
  threadId?: number;
  onOpenDocumentPath?: (path: string) => void;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
  taskSnapshot?: AgentTaskSnapshot | null;
  planApprovalAction?: AssistantChatPlanApprovalAction;
  onKillTool?: (toolCallId: string) => void;
}

export function AssistantChatMessageBubble({
  message,
  projectSlug,
  issueIdentifier,
  threadId,
  onOpenDocumentPath,
  onInsertContext,
  taskSnapshot = null,
  planApprovalAction,
  onKillTool,
}: AssistantChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const attachments = Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];

  if (isUserQuestionsMessage(message)) {
    return <UserQuestionsReceipt message={message} />;
  }

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
      data-testid="assistant-chat-message"
      data-role={isUser ? "user" : "assistant"}
    >
      <article
        className={cn(
          "text-sm",
          isUser
            ? "w-fit max-w-[85%] rounded-3xl bg-slate-950 px-4 py-2.5 text-white shadow-sm dark:bg-primary dark:text-primary-foreground"
            : "w-full max-w-none text-foreground",
        )}
      >
        {attachments.length > 0 ? (
          <div className={cn("mb-3 flex flex-wrap gap-2", isUser && "justify-end")}>
            {attachments.map((attachment, index) => (
              <AttachmentPreview
                key={`${message.id}-attachment-${index}`}
                attachment={attachment}
                isUser={isUser}
                projectSlug={projectSlug}
              />
            ))}
          </div>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        ) : (
          <AssistantMarkdown content={message.content} onOpenDocumentPath={onOpenDocumentPath} />
        )}
        {message.toolCalls.length ? (
          <div className={cn("mt-3 border-t pt-2", isUser && "border-white/20")}>
            <ToolActivityTimeline
              toolCalls={message.toolCalls}
              taskSnapshot={taskSnapshot}
              onKillTool={onKillTool}
            />
            {!isUser ? (
              <EditedFilesSummary
                toolCalls={message.toolCalls}
                projectSlug={projectSlug}
                issueIdentifier={issueIdentifier}
                threadId={threadId}
                onInsertContext={onInsertContext}
              />
            ) : null}
          </div>
        ) : null}
        {planApprovalAction ? <PlanApprovalButtons action={planApprovalAction} /> : null}
      </article>
    </div>
  );
}

function PlanApprovalButtons({ action }: { action: AssistantChatPlanApprovalAction }) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        disabled={action.disabled}
        title={t("assistant.panel.planApproval.yoloTitle")}
        onClick={() => action.onApprove(action.messageId, "yolo")}
      >
        <Zap className="h-3.5 w-3.5" />
        {t("assistant.panel.planApproval.yolo")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-xs"
        disabled={action.disabled}
        title={t("assistant.panel.planApproval.approveTitle")}
        onClick={() => action.onApprove(action.messageId, "build")}
      >
        <Check className="h-3.5 w-3.5" />
        {t("assistant.panel.planApproval.approve")}
      </Button>
    </div>
  );
}

function isUserQuestionsMessage(message: AssistantChatMessage): boolean {
  return message.metadata.kind === "user_questions";
}

function UserQuestionsReceipt({ message }: { message: AssistantChatMessage }) {
  const { t } = useTranslation();
  const rawQuestions = Array.isArray(message.metadata.questions)
    ? (message.metadata.questions as UserQuestion[])
    : [];
  const answers =
    message.metadata.answers && typeof message.metadata.answers === "object"
      ? (message.metadata.answers as Record<string, string>)
      : {};

  if (rawQuestions.length === 0) return null;

  return (
    <div className="flex w-full justify-start">
      <article className="w-full max-w-none rounded-2xl border bg-muted/30 p-3 text-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("assistant.panel.clarifyingQuestions")}
        </p>
        <dl className="space-y-2">
          {rawQuestions.map((question) => (
            <div key={question.id}>
              <dt className="font-medium">{question.question || question.header}</dt>
              <dd className="text-muted-foreground">{answers[question.id] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}

function AttachmentPreview({
  attachment,
  isUser,
  projectSlug,
}: {
  attachment: unknown;
  isUser: boolean;
  projectSlug?: string;
}) {
  const { t } = useTranslation();
  if (!attachment || typeof attachment !== "object") return null;

  const record = attachment as Record<string, unknown>;
  const type = record.type;
  const name = typeof record.name === "string" ? record.name : t("assistant.panel.attachmentLabel.default");
  const mediaType = typeof record.media_type === "string" ? record.media_type : "";
  const data = typeof record.data === "string" ? record.data : "";
  const path = typeof record.path === "string" ? record.path : "";

  if (type === "image" && (data || path)) {
    if (path && projectSlug?.trim()) {
      return (
        <AttachmentImage
          src={projectAttachmentUrl(projectSlug, path)}
          alt={name}
          className="max-h-40 max-w-full object-cover"
        />
      );
    }

    if (data) {
      const src = data.startsWith("data:") ? data : `data:${mediaType || "image/png"};base64,${data}`;
      return <AttachmentImage src={src} alt={name} className="max-h-40 max-w-full object-cover" />;
    }

    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("assistant.panel.attachmentLabel.image", { name })}</span>
      </span>
    );
  }

  if (type === "file" && path) {
    if (projectSlug?.trim()) {
      const src = projectAttachmentUrl(projectSlug, path);
      if (isVideoMediaType(mediaType) || isVideoAttachmentSource(name) || isVideoAttachmentSource(path)) {
        return (
          <figure className="max-w-full space-y-1">
            <AttachmentVideo src={src} label={name} className="max-h-40 max-w-full rounded-lg border object-contain" />
            <figcaption className="truncate text-[11px] text-muted-foreground">{name}</figcaption>
          </figure>
        );
      }

      return <AttachmentFileChip src={src} name={name} />;
    }

    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    );
  }

  if (type === "audio") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <AudioLines className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("assistant.panel.attachmentLabel.audio", { name })}</span>
      </span>
    );
  }

  return null;
}

function AssistantMarkdown({
  content,
  onOpenDocumentPath,
}: {
  content: string;
  onOpenDocumentPath?: (path: string) => void;
}) {
  return (
    <Markdown
      className="max-w-none text-sm leading-7 text-inherit"
      linkRenderer={({ href, children }) => {
        const documentPath = normalizeAssistantDocumentHref(href);
        if (documentPath && onOpenDocumentPath) {
          return (
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              onClick={() => onOpenDocumentPath(documentPath)}
            >
              {children}
            </button>
          );
        }

        return undefined;
      }}
    >
      {content}
    </Markdown>
  );
}
