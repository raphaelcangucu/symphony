import {
  CornerUpLeft,
  Ellipsis,
  MessageSquarePlus,
  Pencil,
  SendHorizontal,
  Trash2,
  ListX,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface QueuedGuidanceListItem {
  id: string;
  message: string;
  error: string | null;
}

interface QueuedGuidanceListProps {
  items: readonly QueuedGuidanceListItem[];
  canSteer: boolean;
  queueingEnabled: boolean;
  disabled?: boolean;
  onPromote: (id: string) => void;
  onResend: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenSideChat: (id: string) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
}

export function QueuedGuidanceList({
  items,
  canSteer,
  queueingEnabled,
  disabled = false,
  onPromote,
  onResend,
  onEdit,
  onRemove,
  onOpenSideChat,
  onQueueingEnabledChange,
}: QueuedGuidanceListProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5 px-2 pb-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-border/70 bg-muted/35 px-2.5 py-2"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {item.message}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              disabled={disabled}
              onClick={() =>
                canSteer ? onPromote(item.id) : onResend(item.id)
              }
            >
              <SendHorizontal className="h-3 w-3" />
              {canSteer
                ? t("assistant.composer.queue.steerNow")
                : t("assistant.composer.queue.sendAgain")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("assistant.composer.queue.remove")}
              disabled={disabled}
              onClick={() => onRemove(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("assistant.composer.queue.more")}
                  disabled={disabled}
                >
                  <Ellipsis className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => onEdit(item.id)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("assistant.composer.queue.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => onOpenSideChat(item.id)}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {t("assistant.composer.queue.sideChat")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() =>
                    onQueueingEnabledChange(!queueingEnabled)
                  }
                >
                  <ListX className="h-4 w-4" />
                  {queueingEnabled
                    ? t("assistant.composer.queue.disable")
                    : t("assistant.composer.queue.enable")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {item.error ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {item.error}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
