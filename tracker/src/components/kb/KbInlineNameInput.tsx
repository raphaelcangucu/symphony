import { FileText, Folder, Image, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type KbInlineInputKind = "page" | "folder" | "asset";

const ICONS = { page: FileText, folder: Folder, asset: Image } as const;

interface Props {
  depth: number;
  initialValue?: string;
  kind?: KbInlineInputKind;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

export function KbInlineNameInput({ depth, initialValue = "", kind = "page", onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = depth * 12 + 4;
  const Icon = ICONS[kind];
  const placeholder =
    kind === "folder"
      ? t("kb.create.folderPlaceholder")
      : kind === "asset"
        ? t("kb.asset.renamePlaceholder")
        : t("kb.create.placeholder");
  const ariaLabel =
    kind === "folder"
      ? t("kb.actions.createFolder")
      : kind === "asset"
        ? t("kb.asset.rename")
        : t("kb.create.newPage");

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const submit = async () => {
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await onSubmit(next);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-accent/60 py-1 pr-1"
      style={{ paddingLeft: indent + 20 }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-foreground" />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (busy) return;
          if (!value.trim()) onCancel();
          else void submit();
        }}
        disabled={busy}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none",
          "placeholder:text-muted-foreground/60 disabled:opacity-60",
        )}
      />
    </div>
  );
}
