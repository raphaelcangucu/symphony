import { CircleDot, FileText, GitPullRequest, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { MentionRef, MentionType, ResolvedMention } from "@/components/assistant/contextMentions";
import { cn } from "@/lib/utils";

interface GroupSpec {
  type: MentionType;
  titleKey: string;
  Icon: LucideIcon;
}

const GROUP_ORDER: readonly GroupSpec[] = [
  { type: "issue", titleKey: "issue.agent.mentions.groups.issues", Icon: CircleDot },
  { type: "file", titleKey: "issue.agent.mentions.groups.files", Icon: FileText },
  { type: "pr", titleKey: "issue.agent.mentions.groups.pull_requests", Icon: GitPullRequest },
];

export function orderMentionOptions(options: ResolvedMention[]): ResolvedMention[] {
  if (!options || options.length === 0) return [];
  return GROUP_ORDER.flatMap((group) =>
    options.filter((option) => option.type === group.type),
  );
}

interface ContextMentionPopoverProps {
  open: boolean;
  options: ResolvedMention[];
  activeIndex: number;
  onSelect: (entity: MentionRef) => void;
  className?: string;
}

export function ContextMentionPopover({
  open,
  options,
  activeIndex,
  onSelect,
  className,
}: ContextMentionPopoverProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const ordered = orderMentionOptions(options);

  if (!open || ordered.length === 0) return null;

  let flatIndex = -1;

  return (
    <div
      ref={listRef}
      className={cn(
        "absolute z-20 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md",
        className,
      )}
      role="listbox"
      aria-label={t("issue.agent.mentions.listLabel")}
    >
      {GROUP_ORDER.map((group) => {
        const groupOptions = ordered.filter((option) => option.type === group.type);
        if (groupOptions.length === 0) return null;
        const Icon = group.Icon;

        return (
          <div key={group.type} className="py-0.5">
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t(group.titleKey)}
            </div>
            {groupOptions.map((option) => {
              flatIndex += 1;
              const isActive = flatIndex === activeIndex;

              return (
                <button
                  key={`${option.type}:${option.id}`}
                  type="button"
                  role="option"
                  data-active={isActive ? "true" : "false"}
                  aria-selected={isActive}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect({ type: option.type, id: option.id });
                  }}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{option.id}</span>
                  {option.label ? (
                    <span className="truncate text-muted-foreground">{option.label}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
