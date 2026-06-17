import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";

interface JiraTrackerFieldsProps {
  config: Record<string, unknown>;
  onConfigChange: (changes: Record<string, unknown>) => void;
}

interface FilterRow {
  id: number;
  name: string;
  value: string;
}

export function JiraTrackerFields({ config, onConfigChange }: JiraTrackerFieldsProps) {
  const { t } = useTranslation();
  const projectKey = configString(config, "project_key");
  const jql = configString(config, "jql");
  const orderBy = configString(config, "order_by");
  const maxResults = typeof config.max_results === "number" ? String(config.max_results) : "";

  const rowId = useRef(0);
  const [rows, setRows] = useState<FilterRow[]>(() => initialRows(config.fields, rowId));

  function commitRows(next: FilterRow[]) {
    setRows(next);
    onConfigChange({ fields: rowsToFields(next) });
  }

  function updateRow(id: number, patch: Partial<FilterRow>) {
    commitRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    rowId.current += 1;
    setRows((current) => [...current, { id: rowId.current, name: "", value: "" }]);
  }

  function removeRow(id: number) {
    commitRows(rows.filter((row) => row.id !== id));
  }

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{t("project.tracker.jira.title")}</p>
        <p className="text-xs text-muted-foreground">{t("project.tracker.jira.description")}</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="edit-jira-project-key">
          {t("project.tracker.jira.projectKey")}
        </label>
        <Input
          id="edit-jira-project-key"
          value={projectKey}
          onChange={(event) => onConfigChange({ project_key: event.target.value })}
          placeholder={t("project.tracker.jira.projectKeyPlaceholder")}
        />
        {projectKey ? null : (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("project.tracker.jira.projectKeyRequired")}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">{t("project.tracker.jira.boardFilters")}</p>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> {t("project.tracker.jira.addFilter")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("project.tracker.jira.filtersHint")}</p>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("project.tracker.jira.noFilters")}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  aria-label={t("project.tracker.jira.filterFieldAria")}
                  value={row.name}
                  onChange={(event) => updateRow(row.id, { name: event.target.value })}
                  placeholder={t("project.tracker.jira.filterFieldPlaceholder")}
                />
                <span className="text-xs text-muted-foreground">=</span>
                <Input
                  aria-label={t("project.tracker.jira.filterValueAria")}
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                  placeholder={t("project.tracker.jira.filterValuePlaceholder")}
                />
                <button
                  type="button"
                  aria-label={t("project.tracker.jira.removeFilterAria")}
                  onClick={() => removeRow(row.id)}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="rounded-md bg-muted/30 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          {t("project.tracker.jira.advancedSummary")}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="edit-jira-jql">
              {t("project.tracker.jira.extraJql")}
            </label>
            <Input
              id="edit-jira-jql"
              value={jql}
              onChange={(event) => onConfigChange({ jql: emptyToUndefined(event.target.value) })}
              placeholder={t("project.tracker.jira.extraJqlPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("project.tracker.jira.extraJqlHint")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="edit-jira-order-by">
                {t("project.tracker.jira.orderBy")}
              </label>
              <Input
                id="edit-jira-order-by"
                value={orderBy}
                onChange={(event) => onConfigChange({ order_by: emptyToUndefined(event.target.value) })}
                placeholder={t("project.tracker.jira.orderByPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="edit-jira-max-results">
                {t("project.tracker.jira.maxResults")}
              </label>
              <Input
                id="edit-jira-max-results"
                type="number"
                min={1}
                value={maxResults}
                onChange={(event) => onConfigChange({ max_results: parseMaxResults(event.target.value) })}
                placeholder={t("project.tracker.jira.maxResultsPlaceholder")}
              />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function initialRows(value: unknown, rowId: { current: number }): FilterRow[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([name, raw]) => {
      rowId.current += 1;
      return { id: rowId.current, name, value: raw == null ? "" : String(raw) };
    });
  }
  return [];
}

function rowsToFields(rows: FilterRow[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) fields[name] = row.value;
  }
  return fields;
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}

function parseMaxResults(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
