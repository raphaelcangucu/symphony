import { Clock, SendHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface QueuedMessageChip {
  id: string;
  message: string;
}

interface QueuedMessageChipsProps {
  items: QueuedMessageChip[];
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
}

export function QueuedMessageChips({ items, onSendNow, onRemove }: QueuedMessageChipsProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 px-4 pb-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{item.message}</span>
          <button
            type="button"
            aria-label={t("assistant.panel.sendQueuedNow")}
            title={t("assistant.panel.sendNow")}
            onClick={() => onSendNow(item.id)}
            className="rounded p-0.5 hover:text-foreground"
          >
            <SendHorizontal className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={t("assistant.panel.removeQueued")}
            title={t("assistant.panel.remove")}
            onClick={() => onRemove(item.id)}
            className="rounded p-0.5 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
