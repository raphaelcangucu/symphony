import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { cn } from "@/lib/utils";
import type { IssueAssigneeOption } from "@/types/issue";

interface MentionAutocompleteProps {
  open: boolean;
  options: IssueAssigneeOption[];
  activeIndex: number;
  onSelect: (login: string) => void;
  className?: string;
}

function optionLogin(option: IssueAssigneeOption): string {
  return option.login?.trim() || option.id?.trim() || "";
}

export function MentionAutocomplete({
  open,
  options,
  activeIndex,
  onSelect,
  className,
}: MentionAutocompleteProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open || options.length === 0) return null;

  return (
    <ul
      ref={listRef}
      className={cn(
        "absolute z-20 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md",
        className,
      )}
      role="listbox"
      aria-label={t("issue.comments.mentions.listLabel")}
    >
      {options.map((option, index) => {
        const login = optionLogin(option);
        if (!login) return null;

        return (
          <li key={login}>
            <button
              type="button"
              role="option"
              data-active={index === activeIndex ? "true" : "false"}
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(login);
              }}
            >
              <AssigneeAvatar login={login} />
              <span className="font-medium">{login}</span>
              {option.name ? <span className="text-muted-foreground">{option.name}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
