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
import { useSidebarDialogMutation } from "@/components/layout/sidebar/useSidebarDialogMutation";

export interface SidebarConfirmDialogProps {
  open: boolean;
  actionLabel: string;
  targetName: string;
  effectDescription: string;
  requireExactName: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): Promise<SidebarActionResult>;
  onCommittedWarning?(warning: string): void;
}

export function SidebarConfirmDialog({
  open,
  actionLabel,
  targetName,
  effectDescription,
  requireExactName,
  onOpenChange,
  onConfirm,
  onCommittedWarning,
}: SidebarConfirmDialogProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const { pending, error, reset, run } = useSidebarDialogMutation({
    fallbackError: t("layout.sidebar.errors.confirmFailed"),
    onCommitted: () => onOpenChange(false),
    onCommittedWarning,
  });
  const confirmed = !requireExactName || confirmation.trim() === targetName;

  useEffect(() => {
    if (!open) return;
    setConfirmation("");
    reset();
  }, [actionLabel, open, reset, targetName]);

  async function submit() {
    if (pending || !confirmed) return;
    await run(onConfirm);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>{effectDescription}</DialogDescription>
        </DialogHeader>
        {requireExactName ? (
          <label className="space-y-2 text-sm">
            <span>
              {t("layout.sidebar.dialog.typeToConfirm", {
                name: targetName,
                defaultValue: "Type {{name}} to confirm",
              })}
            </span>
            <Input
              aria-label={t("layout.sidebar.dialog.typeToConfirm", {
                name: targetName,
                defaultValue: "Type {{name}} to confirm",
              })}
              autoFocus
              value={confirmation}
              disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
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
            variant="destructive"
            disabled={pending || !confirmed}
            onClick={() => void submit()}
          >
            {pending
              ? t("layout.sidebar.dialog.working", { defaultValue: "Working…" })
              : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
