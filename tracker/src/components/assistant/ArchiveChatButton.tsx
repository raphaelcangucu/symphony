import { Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
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
        Archive
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={archiving}
      aria-label="Archive conversation"
      title="Archive conversation"
      className={cn("h-8 w-8 shrink-0 text-muted-foreground", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onArchive(threadId);
      }}
    >
      <Archive className="h-4 w-4" />
    </Button>
  );
}
