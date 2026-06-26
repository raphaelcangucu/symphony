import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  onCreate: (title: string) => Promise<void> | void;
  variant?: "sidebar" | "empty";
}

export function KbCreatePageForm({ onCreate, variant = "sidebar" }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const reset = () => {
    setEditing(false);
    setValue("");
  };

  const submit = async () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onCreate(title);
      reset();
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
      reset();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground",
          variant === "sidebar"
            ? "w-full px-2 py-1 text-sm"
            : "border bg-background px-3 py-2 text-sm font-medium",
        )}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {t("kb.create.newPage")}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        variant === "sidebar" ? "px-2 py-1" : "rounded-md border bg-background px-2 py-1.5",
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!value.trim()) reset();
        }}
        disabled={busy}
        placeholder={t("kb.create.placeholder")}
        aria-label={t("kb.create.newPage")}
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
      />
    </div>
  );
}
