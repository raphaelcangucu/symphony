import { GitFork, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { issuePath, withAgentSection } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { BundleUnit, ExecutionBundle } from "@/types/bundle";
import type { Issue } from "@/types/issue";

interface BundlePanelProps {
  issue: Issue;
  bundle?: ExecutionBundle | null;
  executions?: AgentExecution[];
}

const CONTRACT_STATUS_CLASS: Record<string, string> = {
  ready: "border-green-500/40 text-green-600",
  changing: "border-amber-500/40 text-amber-600",
  draft: "border-border/60 text-muted-foreground",
};

export function BundlePanel({ issue, bundle = null, executions = [] }: BundlePanelProps) {
  const { t } = useTranslation();
  const parentKey = normalizeIssueIdentifier(issue.identifier);

  const childExecutions = executions.filter(
    (execution) =>
      (execution.bundleRole === "child" || execution.bundleRole === "subagent") &&
      execution.parentIdentifier != null &&
      normalizeIssueIdentifier(execution.parentIdentifier) === parentKey,
  );

  const contracts = bundle?.sharedContracts ?? [];
  const hasSubtasks = (issue.subIssueSummary?.total ?? 0) > 0;

  const executionByUnit = new Map<string, AgentExecution>();
  for (const execution of childExecutions) {
    if (execution.unitId) executionByUnit.set(execution.unitId, execution);
  }

  const units: BundleUnit[] =
    bundle?.units && bundle.units.length > 0
      ? bundle.units
      : childExecutions.map((execution) => ({
          id: execution.unitId ?? execution.issueIdentifier,
          type: "child_run" as const,
          issue: execution.issueIdentifier,
          repo: execution.repo ?? null,
        }));

  if (units.length === 0 && !hasSubtasks) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Layers className="h-4 w-4 text-muted-foreground" />
        {t("issue.bundle.title")}
        {issue.subIssueSummary ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {issue.subIssueSummary.completed} / {issue.subIssueSummary.total}
          </span>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {units.map((unit) => {
          const execution = executionByUnit.get(unit.id);
          const childIdentifier = unit.issue ? normalizeIssueIdentifier(unit.issue) : null;
          const status = execution?.status ?? null;

          return (
            <li key={unit.id} className="rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{unit.id}</span>
                <span className="rounded border border-border/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {unit.type}
                </span>
                {unit.repo ? (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                    <GitFork className="h-3 w-3" />
                    {unit.repo}
                  </span>
                ) : null}
                {status ? (
                  <span className="rounded border border-border/60 px-1 py-0.5 text-[10px] capitalize text-muted-foreground">
                    {status}
                  </span>
                ) : null}
                {childIdentifier && issue.projectSlug ? (
                  <Link
                    className="ml-auto text-primary underline-offset-2 hover:underline"
                    to={withAgentSection(issuePath(issue.projectSlug, "board", childIdentifier, "sessions"), "", "execution")}
                  >
                    {childIdentifier}
                  </Link>
                ) : null}
              </div>
              {(unit.dependsOn?.length ?? 0) > 0 || (unit.consumes?.length ?? 0) > 0 ? (
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  {unit.dependsOn && unit.dependsOn.length > 0 ? (
                    <span>{t("issue.bundle.dependsOn", { units: unit.dependsOn.join(", ") })}</span>
                  ) : null}
                  {unit.consumes && unit.consumes.length > 0 ? (
                    <span>{t("issue.bundle.consumes", { contracts: unit.consumes.join(", ") })}</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {contracts.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("issue.bundle.contracts")}</p>
          <ul className="space-y-1">
            {contracts.map((contract) => (
              <li key={contract.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium">{contract.id}</span>
                {contract.kind ? (
                  <span className="font-mono text-[10px] text-muted-foreground">{contract.kind}</span>
                ) : null}
                <span
                  className={`rounded border px-1 py-0.5 text-[10px] capitalize ${
                    CONTRACT_STATUS_CLASS[contract.status] ?? CONTRACT_STATUS_CLASS.draft
                  }`}
                >
                  {contract.status}
                </span>
                {contract.ownerUnit ? (
                  <span className="text-[10px] text-muted-foreground">
                    {contract.ownerUnit}
                    {contract.consumers && contract.consumers.length > 0 ? ` → ${contract.consumers.join(", ")}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
