import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NotionImportResult } from "@/services/notion";

interface NotionImportCardProps {
  result: NotionImportResult;
  onOpenPreview: () => void;
  disabled?: boolean;
}

const PREVIEW_MAX_CHARS = 280;

export function NotionImportCard({ result, onOpenPreview, disabled }: NotionImportCardProps) {
  const { t } = useTranslation();
  const title = result.title?.trim() || t("assistant.notionImport.untitled");
  const kindLabel = kindBadgeLabel(result.kind, t);
  const preview = truncate(result.previewMarkdown, PREVIEW_MAX_CHARS);
  const assetCount = Number.isFinite(result.assetCount) ? Math.max(0, result.assetCount) : 0;

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="notion-import-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          {kindLabel}
        </Badge>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {t("assistant.notionImport.assetCount", { count: assetCount })}
      </p>

      {result.warnings.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-400">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
          {preview}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={onOpenPreview}>
          {t("assistant.notionImport.openPreview")}
        </Button>
      </div>
    </div>
  );
}

function kindBadgeLabel(kind: string, t: (key: string) => string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "page") return t("assistant.notionImport.kind.page");
  if (normalized === "database") return t("assistant.notionImport.kind.database");
  return kind.trim() || t("assistant.notionImport.kind.page");
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
