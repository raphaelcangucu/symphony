import { X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { WorkspaceTab } from "@/lib/workspaceTabs/types";

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose?: (tabId: string) => void;
  ariaLabel: string;
  shortcutHints?: boolean;
  trailing?: ReactNode;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  ariaLabel,
  shortcutHints = false,
  trailing,
}: WorkspaceTabBarProps) {
  if (tabs.length === 0 && !trailing) return null;

  return (
    <div className="flex shrink-0 items-stretch gap-2 overflow-hidden rounded-lg border border-border/60 bg-muted/40">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1",
          SCROLLBAR_THIN,
        )}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          return (
            <div key={tab.id} className="flex shrink-0 items-center">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "inline-flex max-w-[14rem] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(tab.id);
                }}
              >
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")}
                />
                <span className="truncate">{tab.title}</span>
                {shortcutHints && index < 9 ? (
                  <span className="hidden text-[10px] text-muted-foreground sm:inline">Ctrl+{index + 1}</span>
                ) : null}
              </button>
              {tab.closable && onClose ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => onClose(tab.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center border-l border-border/60 px-1 py-1">{trailing}</div>
      ) : null}
    </div>
  );
}
