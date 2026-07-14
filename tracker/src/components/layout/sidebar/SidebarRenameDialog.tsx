import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SidebarActionResult } from "@/hooks/useSidebarActions";
import { graphemeCount } from "@/lib/serviceNormalization";
import { useSidebarDialogMutation } from "@/components/layout/sidebar/useSidebarDialogMutation";

export interface SidebarRenameDialogProps {
  open: boolean;
  targetType: "project" | "workspace" | "thread" | "issue";
  targetName: string;
  maximumGraphemes: 120 | 160;
  onOpenChange(open: boolean): void;
  onSubmit(name: string): Promise<SidebarActionResult>;
  onCommittedWarning?(warning: string): void;
}

export function SidebarRenameDialog({
  open,
  targetType,
  targetName,
  maximumGraphemes,
  onOpenChange,
  onSubmit,
  onCommittedWarning,
}: SidebarRenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(targetName);
  const { pending, error, reset, run } = useSidebarDialogMutation({
    fallbackError: t("layout.sidebar.errors.renameFailed"),
    onCommitted: () => onOpenChange(false),
    onCommittedWarning,
  });
  const trimmedName = name.trim();
  const tooLong = graphemeCount(trimmedName) > maximumGraphemes;

  useEffect(() => {
    if (!open) return;
    setName(targetName);
    reset();
  }, [open, reset, targetName]);

  async function submit() {
    if (pending || !trimmedName || tooLong) return;
    await run(() => onSubmit(trimmedName));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("layout.sidebar.actions.renameTitle", {
              type: t(`layout.sidebar.types.${targetType}`, {
                defaultValue: targetType,
              }),
              defaultValue: "Rename {{type}}",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("layout.sidebar.actions.renameDescription", {
              name: targetName,
              defaultValue: "Choose a new name for {{name}}.",
            })}
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-2 text-sm">
          <span>{t("layout.sidebar.dialog.name", { defaultValue: "Name" })}</span>
          <Input
            aria-label={t("layout.sidebar.dialog.name", { defaultValue: "Name" })}
            autoFocus
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        {tooLong ? (
          <p className="text-sm text-destructive">
            {t("layout.sidebar.dialog.maximumLength", {
              count: maximumGraphemes,
              defaultValue: "Must not exceed {{count}} characters.",
            })}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("layout.sidebar.dialog.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            disabled={pending || !trimmedName || tooLong}
            onClick={() => void submit()}
          >
            {pending
              ? t("layout.sidebar.dialog.saving", { defaultValue: "Saving…" })
              : t("layout.sidebar.dialog.save", { defaultValue: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
