import { useEffect, useMemo, useState } from "react";
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
import type { IssueFormOptions } from "@/types/issue";
import { useSidebarDialogMutation } from "@/components/layout/sidebar/useSidebarDialogMutation";

const MAX_LABELS = 12;
const MAX_LABEL_GRAPHEMES = 40;

export type SidebarSessionMetadataTarget =
  | {
      kind: "thread";
      labels: readonly string[] | null;
      needsReview: boolean;
      canReview: boolean;
    }
  | {
      kind: "issue";
      currentLabelNames: readonly string[] | null;
      needsReview: boolean;
      canReviewThread: boolean;
      canReview: boolean;
      loadOptions(): Promise<IssueFormOptions>;
    };

export interface SidebarSessionMetadataDialogProps {
  open: boolean;
  target: SidebarSessionMetadataTarget;
  onOpenChange(open: boolean): void;
  onSubmit(
    value:
      | { kind: "thread"; labels: string[]; needsReview: boolean }
      | { kind: "issue"; labelIds: string[]; needsReview: boolean },
  ): Promise<SidebarActionResult>;
  onCommittedWarning?(warning: string): void;
}

export function SidebarSessionMetadataDialog({
  open,
  target,
  onOpenChange,
  onSubmit,
  onCommittedWarning,
}: SidebarSessionMetadataDialogProps) {
  const { t } = useTranslation();
  const [labelsText, setLabelsText] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const {
    pending,
    error: mutationError,
    reset,
    run,
  } = useSidebarDialogMutation({
    fallbackError: t("layout.sidebar.errors.metadataUpdateFailed"),
    onCommitted: () => onOpenChange(false),
    onCommittedWarning,
  });
  const [metadataState, setMetadataState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [issueOptions, setIssueOptions] = useState<
    readonly { id: string; name: string }[]
  >([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (target.kind === "thread") {
      if (target.labels === null) {
        setMetadataState("unavailable");
        setMetadataError(t("layout.sidebar.errors.metadataUnavailable"));
        return () => {
          cancelled = true;
        };
      }
      setLabelsText(target.labels.join(", "));
      setNeedsReview(target.needsReview);
      setMetadataState("ready");
    } else {
      setNeedsReview(target.needsReview);
      if (target.currentLabelNames === null) {
        setMetadataState("unavailable");
        setMetadataError(t("layout.sidebar.errors.issueLabelsUnavailable"));
        return () => {
          cancelled = true;
        };
      }
      setMetadataState("loading");
      void target.loadOptions().then(
        (options) => {
          if (cancelled) return;
          const normalizedOptions = options.labels
            .filter(
              (option): option is typeof option & { id: string } =>
                typeof option.id === "string" && option.id.trim().length > 0,
            )
            .map((option) => ({ id: option.id.trim(), name: option.name }));
          const idByName = new Map(
            normalizedOptions.map((option) => [option.name, option.id]),
          );
          const selected = target.currentLabelNames!.map((name) =>
            idByName.get(name),
          );
          if (selected.some((id) => id === undefined)) {
            setMetadataState("unavailable");
            setMetadataError(t("layout.sidebar.errors.issueLabelMappingFailed"));
            return;
          }
          setIssueOptions(normalizedOptions);
          setSelectedIds(new Set(selected as string[]));
          setMetadataState("ready");
        },
        () => {
          if (cancelled) return;
          setMetadataState("unavailable");
          setMetadataError(t("layout.sidebar.errors.issueOptionsFailed"));
        },
      );
    }
    reset();
    setMetadataError(null);
    return () => {
      cancelled = true;
    };
  }, [open, t, target]);

  const normalizedLabels = useMemo(
    () =>
      [...new Set(labelsText.split(",").map((label) => label.trim()).filter(Boolean))],
    [labelsText],
  );
  const labelError =
    target.kind === "thread" && normalizedLabels.length > MAX_LABELS
      ? t("layout.sidebar.errors.labelCount", { count: MAX_LABELS })
      : target.kind === "thread" &&
          normalizedLabels.some((label) => graphemeCount(label) > MAX_LABEL_GRAPHEMES)
        ? t("layout.sidebar.errors.labelLength", {
            count: MAX_LABEL_GRAPHEMES,
          })
        : null;

  async function submit() {
    if (pending || labelError || metadataState !== "ready") return;
    await run(async () => {
      const value =
        target.kind === "thread"
          ? { kind: "thread" as const, labels: normalizedLabels, needsReview }
          : {
              kind: "issue" as const,
              labelIds: [...selectedIds],
              needsReview,
            };
      return onSubmit(value);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("layout.sidebar.actions.metadataTitle", {
              defaultValue: "Session metadata",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("layout.sidebar.actions.metadataDescription", {
              defaultValue: "Update labels and review state.",
            })}
          </DialogDescription>
        </DialogHeader>
        {target.kind === "thread" ? (
          <>
            <label className="space-y-2 text-sm">
              <span>{t("layout.sidebar.dialog.labels", { defaultValue: "Labels" })}</span>
              <Input
                aria-label={t("layout.sidebar.dialog.labels", { defaultValue: "Labels" })}
                value={labelsText}
                disabled={pending}
                placeholder="bug, ui"
                onChange={(event) => setLabelsText(event.target.value)}
              />
            </label>
            {target.canReview ? <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={needsReview}
                disabled={pending}
                onChange={(event) => setNeedsReview(event.target.checked)}
              />
              {t("layout.sidebar.dialog.needsReview", { defaultValue: "Needs review" })}
            </label> : null}
          </>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("layout.sidebar.dialog.labels", { defaultValue: "Labels" })}
              </legend>
              {issueOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(option.id)}
                    disabled={pending}
                    onChange={() =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(option.id)) next.delete(option.id);
                        else next.add(option.id);
                        return next;
                      })
                    }
                  />
                  {option.name}
                </label>
              ))}
            </fieldset>
            {target.canReviewThread && target.canReview ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={needsReview}
                  disabled={pending}
                  onChange={(event) => setNeedsReview(event.target.checked)}
                />
                {t("layout.sidebar.dialog.needsReview", { defaultValue: "Needs review" })}
              </label>
            ) : null}
          </>
        )}
        {metadataState === "loading" ? (
          <p role="status">{t("layout.sidebar.dialog.loadingMetadata")}</p>
        ) : null}
        {labelError ? <p className="text-sm text-destructive">{labelError}</p> : null}
        {metadataError ?? mutationError ? (
          <p role="alert" className="text-sm text-destructive">
            {metadataError ?? mutationError}
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
            disabled={pending || Boolean(labelError) || metadataState !== "ready"}
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
