import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SessionRowActionButton } from "@/components/shared/SessionRowActionButton";
import { cn } from "@/lib/utils";

interface ArchiveChatButtonProps {
  threadId: number;
  archiving: boolean;
  onArchive: (threadId: number) => void;
  className?: string;
  variant?: "icon" | "menu";
}

export function ArchiveChatButton({
  threadId,
  archiving,
  onArchive,
  className,
  variant = "icon",
}: ArchiveChatButtonProps) {
  const { t } = useTranslation();

  if (variant === "menu") {
    return (
      <button
        type="button"
        disabled={archiving}
        className={cn(
          "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent disabled:opacity-50",
          className,
        )}
        onClick={() => onArchive(threadId)}
      >
        <Archive className="mr-2 h-4 w-4" />
        {t("assistant.archive.label")}
      </button>
    );
  }

  return (
    <SessionRowActionButton
      label={t("assistant.archive.ariaLabel")}
      onClick={() => onArchive(threadId)}
      disabled={archiving}
      className={className}
    >
      <Archive className="h-3 w-3" strokeWidth={1.5} />
    </SessionRowActionButton>
  );
}
