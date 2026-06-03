import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";
import { Input } from "@/components/ui/input";
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
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The slug <code>{slug}</code> is fixed. Switching the source changes where issues are read from.
      </p>
      <TrackerSourcePicker value={trackerKind} onChange={onKindChange} />
      {trackerKind === "github" ? <GitHubTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "linear" ? <LinearTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "local" ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Issues will be stored in Symphony&apos;s local board. Remote configuration is cleared.
        </p>
      ) : null}
    </div>
  );
}

interface TrackerFieldsProps {
  config: Record<string, unknown>;
  onConfigChange: (changes: Record<string, unknown>) => void;
}

function GitHubTrackerFields({ config, onConfigChange }: TrackerFieldsProps) {
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
      .catch((cause) => active && toast.error(cause instanceof Error ? cause.message : "Failed to load GitHub projects"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const connectedBoard = projectId ? boards.find((board) => board.id === projectId) ?? null : null;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">GitHub Project v2 board</p>
        <p className="text-xs text-muted-foreground">Pick a board this token can access (user or organization).</p>
      </div>

      <ConnectedBoardSummary
        projectId={projectId}
        projectNumber={projectNumber}
        repo={repo}
        board={connectedBoard}
        loading={loading}
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Available boards</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading GitHub projects…</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No GitHub Projects v2 boards found.</p>
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
                  {board.owner.kind === "organization" ? " · org" : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="edit-github-repo">
            Issues repository
          </label>
          <Input
            id="edit-github-repo"
            value={repo}
            onChange={(event) => onConfigChange({ repo: event.target.value })}
            placeholder="owner/name (e.g. clouapp/front)"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="edit-github-status-field">
            Status field
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
  if (!projectId) {
    return <p className="text-xs text-amber-600 dark:text-amber-400">No board selected yet.</p>;
  }

  const number = board?.number ?? projectNumber;
  const url = board ? boardUrl(board) : null;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Connected board</p>
      <p className="text-sm font-medium">
        {board?.title ?? (loading ? "Resolving board…" : "Connected GitHub board")}
        {number != null ? <span className="font-normal text-muted-foreground"> · #{number}</span> : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {board ? `${board.owner.login}${board.owner.kind === "organization" ? " (org)" : ""}` : null}
        {repo ? `${board ? " · " : ""}repo ${repo}` : null}
      </p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open on GitHub
        </a>
      ) : null}
    </div>
  );
}

function boardUrl(board: GitHubProjectSummary): string {
  const scope = board.owner.kind === "organization" ? "orgs" : "users";
  return `https://github.com/${scope}/${board.owner.login}/projects/${board.number}`;
}

function LinearTrackerFields({ config, onConfigChange }: TrackerFieldsProps) {
  const projectId = configString(config, "project_id");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Linear project</p>
        <p className="text-xs text-muted-foreground">Pick a project this token can access. Issues stay in Linear.</p>
      </div>

      {projectId ? (
        <p className="rounded-md bg-muted/30 px-3 py-2 text-xs">
          Connected project: <code>{projectId}</code>
        </p>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">No project selected yet.</p>
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
