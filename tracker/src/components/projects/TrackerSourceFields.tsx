import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { JiraTrackerFields } from "@/components/projects/JiraTrackerFields";
import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";
import { Input } from "@/components/ui/input";
import { githubProjectBoardUrl } from "@/lib/projectTrackerUrl";
import { discoverGitHubProjects, type GitHubProjectSummary } from "@/services/remoteTrackers";
import type { TrackerKind } from "@/types/project";

const DEFAULT_GITHUB_STATUS_FIELD = "Status";

interface TrackerSourceFieldsProps {
  slug: string;
  trackerKind: TrackerKind;
  config: Record<string, unknown>;
  onKindChange: (kind: TrackerKind) => void;
  onConfigChange: (changes: Record<string, unknown>) => void;
}

export function TrackerSourceFields({ slug, trackerKind, config, onKindChange, onConfigChange }: TrackerSourceFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("project.tracker.fields.slugHint", { slug })}
      </p>
      <TrackerSourcePicker value={trackerKind} onChange={onKindChange} />
      {trackerKind === "github" ? <GitHubTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "linear" ? <LinearTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "jira" ? <JiraTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "local" ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">{t("project.tracker.fields.localBoard")}</p>
      ) : null}
    </div>
  );
}

interface TrackerFieldsProps {
  config: Record<string, unknown>;
  onConfigChange: (changes: Record<string, unknown>) => void;
}

function GitHubTrackerFields({ config, onConfigChange }: TrackerFieldsProps) {
  const { t } = useTranslation();
  const projectId = configString(config, "project_id");
  const projectNumber = typeof config.project_number === "number" ? config.project_number : null;
  const repo = configString(config, "repo");

  const [boards, setBoards] = useState<GitHubProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    discoverGitHubProjects()
      .then((items) => active && setBoards(items))
      .catch((cause) =>
        active && toast.error(cause instanceof Error ? cause.message : t("project.tracker.github.loadFailed")),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  const connectedBoard = projectId ? boards.find((board) => board.id === projectId) ?? null : null;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{t("project.tracker.github.title")}</p>
        <p className="text-xs text-muted-foreground">{t("project.tracker.github.descriptionEditor")}</p>
      </div>

      <ConnectedBoardSummary
        projectId={projectId}
        projectNumber={projectNumber}
        repo={repo}
        board={connectedBoard}
        loading={loading}
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t("project.tracker.github.availableBoards")}</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("project.tracker.github.loading")}</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("project.tracker.github.empty")}</p>
        ) : (
          <div className="grid max-h-56 gap-2 overflow-y-auto">
            {boards.map((board) => (
              <button
                key={board.id}
                type="button"
                onClick={() =>
                  onConfigChange({
                    project_id: board.id,
                    project_number: board.number,
                    repo: board.repoNameWithOwner ?? repo,
                    project_url: githubProjectBoardUrl(board),
                    owner_kind: board.owner.kind,
                  })
                }
                aria-pressed={board.id === projectId}
                className={`rounded-md border p-3 text-left transition hover:bg-muted/50 ${
                  board.id === projectId ? "border-primary bg-muted/40" : ""
                }`}
              >
                <span className="block text-sm font-medium">{board.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {board.owner.login} · #{board.number}
                  {board.owner.kind === "organization" ? t("project.tracker.github.orgSuffix") : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="edit-github-repo">
            {t("project.tracker.github.issuesRepository")}
          </label>
          <Input
            id="edit-github-repo"
            value={repo}
            onChange={(event) => onConfigChange({ repo: event.target.value })}
            placeholder={t("project.tracker.github.issuesRepositoryPlaceholder")}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="edit-github-status-field">
            {t("project.tracker.github.statusField")}
          </label>
          <Input
            id="edit-github-status-field"
            value={configString(config, "status_field") || DEFAULT_GITHUB_STATUS_FIELD}
            onChange={(event) => onConfigChange({ status_field: event.target.value })}
            placeholder={DEFAULT_GITHUB_STATUS_FIELD}
          />
        </div>
      </div>
    </div>
  );
}

interface ConnectedBoardSummaryProps {
  projectId: string;
  projectNumber: number | null;
  repo: string;
  board: GitHubProjectSummary | null;
  loading: boolean;
}

function ConnectedBoardSummary({ projectId, projectNumber, repo, board, loading }: ConnectedBoardSummaryProps) {
  const { t } = useTranslation();

  if (!projectId) {
    return <p className="text-xs text-amber-600 dark:text-amber-400">{t("project.tracker.github.noBoardSelected")}</p>;
  }

  const number = board?.number ?? projectNumber;
  const url = board ? githubProjectBoardUrl(board) : null;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("project.tracker.github.connectedBoard")}
      </p>
      <p className="text-sm font-medium">
        {board?.title ?? (loading ? t("project.tracker.github.resolvingBoard") : t("project.tracker.github.connectedBoardFallback"))}
        {number != null ? <span className="font-normal text-muted-foreground"> · #{number}</span> : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {board ? `${board.owner.login}${board.owner.kind === "organization" ? t("project.tracker.github.orgLabel") : ""}` : null}
        {repo ? `${board ? " · " : ""}${t("project.tracker.github.repoLine", { repo })}` : null}
      </p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          {t("project.tracker.github.openOnGitHub")}
        </a>
      ) : null}
    </div>
  );
}

function LinearTrackerFields({ config, onConfigChange }: TrackerFieldsProps) {
  const { t } = useTranslation();
  const projectId = configString(config, "project_id");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{t("project.tracker.linear.title")}</p>
        <p className="text-xs text-muted-foreground">{t("project.tracker.linear.description")}</p>
      </div>

      {projectId ? (
        <p className="rounded-md bg-muted/30 px-3 py-2 text-xs">
          {t("project.tracker.linear.connectedProject")}: <code>{projectId}</code>
        </p>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("project.tracker.linear.noProjectSelected")}</p>
      )}

      <LinearProjectPicker
        onSelect={(linearProject) =>
          onConfigChange({
            project_id: linearProject.id,
            team_id: linearProject.team.id,
            project_slug: linearProject.slugId,
          })
        }
      />
    </div>
  );
}

function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}
