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

interface Props {
  previewUrl: string;
  suggestedName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function KbAssetNameDialog({ previewUrl, suggestedName, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(suggestedName);

  // Re-seed the field when the dialog advances to the next pasted image.
  useEffect(() => {
    setName(suggestedName);
  }, [suggestedName, previewUrl]);

  const submit = () => {
    const trimmed = name.trim();
    onConfirm(trimmed.length > 0 ? trimmed : suggestedName);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("kb.asset.nameDialog.title")}</DialogTitle>
          <DialogDescription>{t("kb.asset.nameDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center rounded-md border bg-muted/30 p-3">
          <img src={previewUrl} alt={name} className="max-h-48 max-w-full rounded object-contain" />
        </div>

        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
          placeholder={t("kb.asset.nameDialog.placeholder")}
          aria-label={t("kb.asset.nameDialog.title")}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("kb.asset.nameDialog.skip")}
          </Button>
          <Button onClick={submit}>{t("kb.asset.nameDialog.insert")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
