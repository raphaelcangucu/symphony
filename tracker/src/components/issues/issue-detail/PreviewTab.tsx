import { AlertTriangle, Bot, ExternalLink, Loader2, Play, RotateCcw, Server, Square } from "lucide-react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import {
  buildPreviewFailurePrompt,
  isPreviewFailureReason,
  isPreviewFailureServerStatus,
  previewHandoffTarget,
  stashPreviewAssistantHandoff,
} from "@/lib/previewAssistantHandoff";
import { issueAgentTabPath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { IssueDevServer, IssueDevServerReason, IssueDevServerStatus, IssueDevServersResponse } from "@/types/issue";

interface PreviewTabProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  execution?: AgentExecution;
}

const STATUS_BADGE_CLASS: Record<IssueDevServerStatus, string> = {
  crashed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  pending: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  provisioning: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  starting: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  stopped: "border-muted bg-muted text-muted-foreground",
};

const RETRYABLE_UNAVAILABLE_REASONS = new Set<IssueDevServerReason>([
  "lock_unavailable",
  "start_failed",
  "restart_failed",
  "crashed",
]);

export function PreviewTab({ projectSlug, issueIdentifier, view, execution }: PreviewTabProps) {
  const navigate = useNavigate();
  const { data, error, loading, restart, start, stop } = useIssueDevServers(projectSlug, issueIdentifier);

  const askAssistantToFix = useCallback(
    (snapshot: IssueDevServersResponse, server?: IssueDevServer | null) => {
      const target = previewHandoffTarget(execution);
      stashPreviewAssistantHandoff({
        projectSlug,
        issueIdentifier,
        target,
        message: buildPreviewFailurePrompt(snapshot, server),
        createdAt: Date.now(),
      });
      navigate(
        issueAgentTabPath(
          projectSlug,
          view,
          issueIdentifier,
          target === "execution-steer" ? "execution" : "authoring",
        ),
      );
    },
    [execution, issueIdentifier, navigate, projectSlug, view],
  );
  const primaryServer = selectPrimaryServer(data?.servers ?? []);
  const primaryUrl = readyPreviewUrl(primaryServer);
  const primaryPublicUrl = publicTunnelPreviewUrl(primaryServer);
  const primaryLocalUrl = localPreviewUrl(primaryServer);
  const hasPublicTunnelPreviews = (data?.servers ?? []).some((server) => publicTunnelPreviewUrl(server) != null);
  const hasRequiredIdentifiers = projectSlug.trim().length > 0 && issueIdentifier.trim().length > 0;

  if (!hasRequiredIdentifiers) {
    return (
      <StateCallout tone="error" title="Preview cannot load">
        Project and issue identifiers are required to load preview status.
      </StateCallout>
    );
  }

  if (loading && !data) {
    return (
      <StateCallout
        ariaLive="polite"
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        role="status"
        title="Loading preview status..."
      >
        Checking dev-server availability for this issue.
      </StateCallout>
    );
  }

  if (error && !data) {
    return (
      <StateCallout tone="error" title="Could not load preview status">
        {error}
      </StateCallout>
    );
  }

  if (!data) {
    return (
      <StateCallout title="Preview status unavailable">
        No preview status has been loaded for this issue yet.
      </StateCallout>
    );
  }

  const unavailableMessage = data.available ? null : availabilityMessage(data.reason);
  const provisioningMessage =
    data.available && !primaryUrl && primaryServer != null ? provisioningStatusMessage(primaryServer) : null;
  const controlsDisabled = loading || !canRunManualActions(data.available, data.reason);
  const failureReason = data.reason && isPreviewFailureReason(data.reason);

  return (
    <div className="space-y-4 text-sm">
      {error ? (
        <StateCallout tone="error" title="Could not refresh preview status">
          {error}
        </StateCallout>
      ) : null}

      {hasPublicTunnelPreviews ? (
        <StateCallout tone="default" title="Public preview URLs">
          These hosts are routed through the Cloudflare tunnel to your machine. Start it from{" "}
          <span className="font-mono">elixir/</span> with <span className="font-mono">make tunnel</span> (or{" "}
          <span className="font-mono">make tunnel-bg</span>) so teammates can open the links. Local links still work
          on this machine without the tunnel.
        </StateCallout>
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                Issue Preview
              </CardTitle>
              <CardDescription>
                Availability: {data.available ? "available" : "unavailable"}
                {loading ? " · refreshing status" : ""}
              </CardDescription>
            </div>
            <PreviewControls disabled={controlsDisabled} onRestart={restart} onStart={start} onStop={stop} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {unavailableMessage ? (
            <StateCallout tone="warning" title={unavailableMessage.title}>
              <div className="space-y-3">
                <p>{unavailableMessage.body}</p>
                {failureReason ? (
                  <AskAssistantButton onClick={() => askAssistantToFix(data)} />
                ) : null}
              </div>
            </StateCallout>
          ) : null}

          {primaryUrl ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    Preview is ready{primaryServer ? ` from ${primaryServer.slug}` : ""}.
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-emerald-700 dark:text-emerald-300">
                    {primaryUrl}
                  </p>
                  {primaryPublicUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      Public (Cloudflare tunnel):{" "}
                      <a href={primaryPublicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryPublicUrl}
                      </a>
                    </p>
                  ) : null}
                  {primaryLocalUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      Local:{" "}
                      <a href={primaryLocalUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryLocalUrl}
                      </a>
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm">
                  <a href={primaryUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Preview
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          {provisioningMessage ? (
            <StateCallout
              ariaLive="polite"
              icon={<Loader2 className="h-5 w-5 animate-spin" />}
              role="status"
              title="Preview is being provisioned..."
            >
              <div className="space-y-3">
                <p>{provisioningMessage}</p>
                {primaryServer && isPreviewFailureServerStatus(primaryServer.status) ? (
                  <AskAssistantButton onClick={() => askAssistantToFix(data, primaryServer)} />
                ) : null}
              </div>
            </StateCallout>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dev Servers</h3>
            {data.servers.length === 0 ? (
              <p
                aria-live="polite"
                role="status"
                className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
              >
                No dev servers are running yet. Use Start Preview when you want to provision one.
              </p>
            ) : (
              <div className="space-y-2">
                {data.servers.map((server) => (
                  <ServerRow
                    key={server.id}
                    onAskAssistant={
                      isPreviewFailureServerStatus(server.status)
                        ? () => askAssistantToFix(data, server)
                        : undefined
                    }
                    server={server}
                  />
                ))}
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewControls({
  disabled,
  onRestart,
  onStart,
  onStop,
}: {
  disabled: boolean;
  onRestart: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => void onStart()} disabled={disabled}>
        <Play className="h-3.5 w-3.5" />
        Start Preview
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void onStop()} disabled={disabled}>
        <Square className="h-3.5 w-3.5" />
        Stop Preview
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void onRestart()} disabled={disabled}>
        <RotateCcw className="h-3.5 w-3.5" />
        Restart Preview
      </Button>
    </div>
  );
}

function AskAssistantButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      <Bot className="h-3.5 w-3.5" />
      Ask assistant to fix
    </Button>
  );
}

function ServerRow({ server, onAskAssistant }: { server: IssueDevServer; onAskAssistant?: () => void }) {
  const previewUrl = readyPreviewUrl(server);
  const publicUrl = publicTunnelPreviewUrl(server);
  const localUrl = localPreviewUrl(server);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{server.slug}</span>
            {server.primary ? <Badge variant="outline">primary</Badge> : null}
            <Badge className={cn("capitalize", STATUS_BADGE_CLASS[server.status])}>{server.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {server.working_dir ? `Working directory: ${server.working_dir}` : "No working directory reported"}
            {server.port ? ` · Port ${server.port}` : ""}
          </p>
          {publicUrl ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              Public (Cloudflare tunnel):{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {publicUrl}
              </a>
            </p>
          ) : null}
          {localUrl ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              Local:{" "}
              <a href={localUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {localUrl}
              </a>
            </p>
          ) : null}
          {server.session_name ? <p className="font-mono text-xs text-muted-foreground">{server.session_name}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onAskAssistant ? <AskAssistantButton onClick={onAskAssistant} /> : null}
          {previewUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={previewUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-3.5 w-3.5" />
                Open {server.slug} preview
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">No URL yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StateCallout({
  ariaLive,
  children,
  icon,
  role,
  title,
  tone = "default",
}: {
  ariaLive?: "off" | "polite" | "assertive";
  children: React.ReactNode;
  icon?: React.ReactNode;
  role?: "alert" | "status";
  title: string;
  tone?: "default" | "error" | "warning";
}) {
  return (
    <div
      aria-live={ariaLive}
      role={role ?? (tone === "error" ? "alert" : undefined)}
      className={cn(
        "flex gap-3 rounded-lg border p-4 text-sm",
        tone === "default" && "border-dashed text-muted-foreground",
        tone === "error" && "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="h-5 w-5" />}</span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}

function selectPrimaryServer(servers: IssueDevServer[]): IssueDevServer | null {
  return servers.find((server) => server.primary) ?? servers.find((server) => server.status === "ready") ?? servers[0] ?? null;
}

function readyPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.url) {
    return null;
  }

  return server.url;
}

function publicTunnelPreviewUrl(server: IssueDevServer | null): string | null {
  const url = readyPreviewUrl(server);
  if (!url || isLoopbackUrl(url)) {
    return null;
  }

  return url;
}

function localPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.port) {
    return null;
  }

  if (isLoopbackUrl(server.url)) {
    return null;
  }

  return `http://127.0.0.1:${server.port}${pathFromUrl(server.url)}`;
}

function pathFromUrl(url: string | null): string {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return "/";
  }
}

function isLoopbackUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function canRunManualActions(available: boolean, reason: IssueDevServerReason): boolean {
  if (available) {
    return true;
  }

  return RETRYABLE_UNAVAILABLE_REASONS.has(reason);
}

function availabilityMessage(reason: IssueDevServerReason): { title: string; body: string } {
  switch (reason) {
    case "disabled":
      return {
        title: "Dev-server previews are disabled",
        body: "Availability is disabled for this project. Enable dev-server previews in the project workflow before using Start Preview.",
      };
    case "workspace_missing":
      return {
        title: "Preview workspace is missing",
        body: "Availability is blocked because the issue workspace could not be found. Create or restore the workspace before starting a preview.",
      };
    case "no_serve_step":
      return {
        title: "No serve step configured",
        body: "Availability is blocked because this project does not have a dev-server serve step configured.",
      };
    case "no_free_port":
      return {
        title: "No free preview port",
        body: "Availability is blocked because the system could not reserve a free port for the dev server.",
      };
    case "lock_unavailable":
      return {
        title: "Preview is already being changed",
        body: "Another preview action is holding the lock. Manual controls remain available so you can retry after the current action finishes.",
      };
    case "start_failed":
      return {
        title: "Preview start failed",
        body: "The last start request failed. Manual controls remain available so you can retry or restart after checking the server output.",
      };
    case "restart_failed":
      return {
        title: "Preview restart failed",
        body: "The last restart request failed. Manual controls remain available so you can retry once the underlying issue is resolved.",
      };
    case "crashed":
      return {
        title: "Preview crashed",
        body: "Availability is blocked because the preview process crashed. Manual controls remain available so you can restart after checking the server logs.",
      };
    default:
      return {
        title: "Preview unavailable",
        body: "Availability is blocked right now. Resolve the issue above, then use Start Preview when you are ready.",
      };
  }
}

function provisioningStatusMessage(primaryServer: IssueDevServer | null): string {
  if (!primaryServer) {
    return "No preview is running yet. Use Start Preview when you want to provision the dev server.";
  }

  if (primaryServer.status === "crashed") {
    return "The dev server crashed before publishing a URL. Restart the preview to try again.";
  }

  if (primaryServer.status === "stopped") {
    return "The dev server is stopped and has not published a URL yet. Start Preview to request a new run.";
  }

  return `The ${primaryServer.slug} dev server is ${primaryServer.status} and has not published a URL yet.`;
}
