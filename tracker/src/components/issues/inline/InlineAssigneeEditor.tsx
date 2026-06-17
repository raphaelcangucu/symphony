import { Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { useMeIdentities } from "@/hooks/useMeIdentities";
import {
  assigneeMatchesMe,
  matchesPickerSearch,
  sortAssigneePickerItems,
} from "@/lib/pickerOptions";
import { cn } from "@/lib/utils";
import type { IssueAssigneeOption } from "@/types/issue";

interface InlineAssigneeEditorProps {
  assignee: string | null;
  options: IssueAssigneeOption[];
  optionsLoading?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onSave: (assigneeIds: string[]) => Promise<boolean>;
}

function assigneeValue(option: IssueAssigneeOption): string {
  return option.id ?? option.login ?? "";
}

function findOption(options: IssueAssigneeOption[], login: string | null): IssueAssigneeOption | null {
  if (!login) return null;
  const normalized = login.toLowerCase();
  return (
    options.find((option) => option.login?.toLowerCase() === normalized) ??
    options.find((option) => option.id === login) ??
    null
  );
}

export function InlineAssigneeEditor({
  assignee,
  options,
  optionsLoading = false,
  disabled = false,
  saving = false,
  onSave,
}: InlineAssigneeEditorProps) {
  const { t } = useTranslation();
  const meIdentities = useMeIdentities();
  const current = findOption(options, assignee);
  const currentValue = current ? assigneeValue(current) : assignee ?? "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setDraft(currentValue);
      setSearchQuery("");
    }
  }, [open, currentValue]);

  const commit = useCallback(async () => {
    const nextIds = draft ? [draft] : [];
    const currentIds = currentValue ? [currentValue] : [];
    const unchanged =
      nextIds.length === currentIds.length && nextIds.every((id) => currentIds.includes(id));
    if (unchanged) {
      setOpen(false);
      return;
    }
    const saved = await onSave(nextIds);
    if (saved) setOpen(false);
  }, [currentValue, draft, onSave]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        void commit();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [commit, open]);

  const optionItems = useMemo(() => {
    type AssigneeItem = {
      value: string;
      label: string;
      login?: string | null;
      option: IssueAssigneeOption | null;
    };

    const items: AssigneeItem[] = options
      .filter((option) => assigneeValue(option) !== "")
      .map((option) => ({
        value: assigneeValue(option),
        label: option.name?.trim() || option.login || option.id || t("issue.inline.assignee.unknown"),
        login: option.login,
        option,
      }));

    if (assignee && !items.some((item) => item.login === assignee || item.value === assignee)) {
      items.unshift({ value: assignee, label: assignee, login: assignee, option: null });
    }

    return sortAssigneePickerItems(
      items,
      meIdentities,
      (item) => (item.option ? assigneeMatchesMe(item.option, meIdentities) : false),
    );
  }, [assignee, meIdentities, options, t]);

  const filteredOptionItems = useMemo(
    () =>
      optionItems.filter((item) =>
        matchesPickerSearch(searchQuery, item.label, item.login, item.value),
      ),
    [optionItems, searchQuery],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => {
          if (open) {
            void commit();
          } else {
            setOpen(true);
          }
        }}
        className={cn(
          "group inline-flex w-full items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <AssigneeAvatar login={assignee} />
        <span className="text-sm">{assignee || t("issue.inline.assignee.unassigned")}</span>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.inline.assignee.title")}
          </div>
          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={searchQuery}
              placeholder={t("issue.inline.assignee.searchPlaceholder")}
              aria-label={t("issue.inline.assignee.searchAria")}
              className="h-8 w-full rounded-md border border-border/70 bg-background pl-8 pr-2.5 text-xs outline-none ring-0 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          {optionsLoading ? (
            <p className="px-1 text-xs text-muted-foreground">{t("issue.inline.assignee.loading")}</p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              {!searchQuery.trim() ? (
                <button
                  type="button"
                  aria-pressed={draft === ""}
                  onClick={() => setDraft("")}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    draft === "" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <UserRound className="h-4 w-4 opacity-70" />
                  {t("issue.inline.assignee.unassigned")}
                </button>
              ) : null}
              {filteredOptionItems.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("issue.inline.assignee.empty")}</p>
              ) : (
                filteredOptionItems.map((item) => {
                  const isMe = item.option ? assigneeMatchesMe(item.option, meIdentities) : false;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={draft === item.value}
                      onClick={() => setDraft(item.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        draft === item.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                      )}
                    >
                      <AssigneeAvatar login={item.login ?? null} />
                      <span className="min-w-0 flex-1 truncate">
                        {isMe ? t("issue.inline.assignee.mePrefix", { label: item.label }) : item.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
