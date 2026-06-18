import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/** Shown over a card while dragging when releasing now would group onto it. */
export function GroupDropOverlay() {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-primary/15 backdrop-blur-[1px]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-lg ring-2 ring-background">
        <Layers className="h-3.5 w-3.5" />
        {t("board.group.dropToGroup")}
      </span>
    </div>
  );
}

/** Insertion line shown in the gap above/below a card to preview a reorder drop. */
export function ReorderDropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-1 z-20 flex items-center",
        edge === "top" ? "-top-1.5" : "-bottom-1.5",
      )}
    >
      <span className="h-1 w-1 rounded-full bg-primary" />
      <span className="h-0.5 flex-1 rounded-full bg-primary" />
      <span className="h-1 w-1 rounded-full bg-primary" />
    </div>
  );
}
