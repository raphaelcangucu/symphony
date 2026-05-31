import { ExternalLink } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateProject } from "@/services/projects";
import { discoverGitHubProjects, type GitHubProjectSummary } from "@/services/remoteTrackers";
import type { Project, ProjectTrackerConfig, TrackerKind } from "@/types/project";

const DEFAULT_GITHUB_STATUS_FIELD = "Status";

interface EditProjectDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (project: Project) => void;
}

export function EditProjectDialog({ project, open, onOpenChange, onSaved }: EditProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [trackerKind, setTrackerKind] = useState<TrackerKind>(project.tracker.kind);
  const [config, setConfig] = useState<Record<string, unknown>>(project.tracker.config);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setTrackerKind(project.tracker.kind);
    setConfig(project.tracker.config);
  }, [open, project]);

  function handleTrackerKindChange(kind: TrackerKind) {
    setTrackerKind(kind);
    setConfig(initialConfigForKind(kind, project.tracker, project.tracker.kind === kind));
  }

  function updateConfig(changes: Record<string, unknown>) {
    setConfig((current) => ({ ...current, ...changes }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Project name is required");
      return;
    }

    const validationError = validateTrackerConfig(trackerKind, config);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateProject(project.slug, {
        name: trimmedName,
        description: description.trim() || null,
        tracker: { kind: trackerKind, config: trackerKind === "local" ? {} : config },
      });
      onSaved(updated);
      onOpenChange(false);
      toast.success("Project updated");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update the project details and the tracker source it reads issues from.</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-name">
              Name
            </label>
            <Input
              id="edit-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-description">
              Description
            </label>
            <Textarea
              id="edit-project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Tracker source</p>
            <p className="text-xs text-muted-foreground">
              The slug <code>{project.slug}</code> is fixed. Switching the source changes where issues are read from.
            </p>
            <TrackerSourcePicker value={trackerKind} onChange={handleTrackerKindChange} />
          </div>

          {trackerKind === "github" ? (
            <GitHubTrackerFields config={config} onConfigChange={updateConfig} />
          ) : null}

          {trackerKind === "linear" ? <LinearTrackerFields config={config} onConfigChange={updateConfig} /> : null}

          {trackerKind === "local" ? (
            <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              Issues will be stored in Symphony&apos;s local board. Remote configuration is cleared.
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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

function initialConfigForKind(
  kind: TrackerKind,
  current: ProjectTrackerConfig,
  sameAsCurrent: boolean,
): Record<string, unknown> {
  if (sameAsCurrent) return current.config;
  if (kind === "github") return { status_field: DEFAULT_GITHUB_STATUS_FIELD };
  return {};
}

function validateTrackerConfig(kind: TrackerKind, config: Record<string, unknown>): string | null {
  if (kind === "github") {
    if (!configString(config, "project_id")) return "Select a GitHub board first";
    if (!configString(config, "repo")) return "An issues repository (owner/name) is required";
    return null;
  }

  if (kind === "linear") {
    if (!configString(config, "project_id")) return "Select a Linear project first";
    return null;
  }

  return null;
}

function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return "Failed to update project";
}
