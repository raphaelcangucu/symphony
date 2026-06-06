import { AlertTriangle, Bot, Cloud, ExternalLink, Loader2, Play, RotateCcw, Server, Square } from "lucide-react";
import { useCallback, useState } from "react";
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

const ACTIVE_PROVISIONING_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting"]);

export function PreviewTab({ projectSlug, issueIdentifier, view, execution }: PreviewTabProps) {
  const navigate = useNavigate();
  const { data, error, loading, restart, restartServer, start, startServer, stop, stopServer, startTunnel } =
    useIssueDevServers(projectSlug, issueIdentifier);
  const [startingTunnel, setStartingTunnel] = useState(false);

  const handleStartTunnel = useCallback(async () => {
    setStartingTunnel(true);
    try {
      await startTunnel();
    } finally {
      setStartingTunnel(false);
    }
  }, [startTunnel]);

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
    data.available &&
    primaryServer != null &&
    ACTIVE_PROVISIONING_STATUSES.has(primaryServer.status)
      ? provisioningStatusMessage(primaryServer)
      : null;
  const controlsDisabled = loading || !canRunManualActions(data.available, data.reason);
  const failureReason = data.reason && isPreviewFailureReason(data.reason);
  const tunnelEnabled = data.tunnel?.enabled ?? false;
  const tunnelRunning = data.tunnel?.running ?? false;
  const openPrimaryUrl = tunnelRunning ? primaryUrl : (primaryLocalUrl ?? primaryUrl);

  return (
    <div className="space-y-4 text-sm">
      {error ? (
        <StateCallout tone="error" title="Could not refresh preview status">
          {error}
        </StateCallout>
      ) : null}

      <TunnelNotice
        enabled={tunnelEnabled}
        running={tunnelRunning}
        starting={startingTunnel}
        onStart={() => void handleStartTunnel()}
      />

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

          {openPrimaryUrl ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    Preview is ready{primaryServer ? ` from ${primaryServer.slug}` : ""}.
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-emerald-700 dark:text-emerald-300">
                    {openPrimaryUrl}
                  </p>
                  {tunnelRunning && primaryPublicUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      Public (Cloudflare tunnel):{" "}
                      <a href={primaryPublicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryPublicUrl}
                      </a>
                    </p>
                  ) : null}
                  {tunnelRunning && primaryLocalUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      Local:{" "}
                      <a href={primaryLocalUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryLocalUrl}
                      </a>
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm">
                  <a href={openPrimaryUrl} target="_blank" rel="noreferrer noopener">
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
                    controlsDisabled={controlsDisabled}
                    onAskAssistant={
                      isPreviewFailureServerStatus(server.status)
                        ? () => askAssistantToFix(data, server)
                        : undefined
                    }
                    onRestart={(serverId) => void restartServer(serverId)}
                    onStart={(serverId) => void startServer(serverId)}
                    onStop={(serverId) => void stopServer(serverId)}
                    server={server}
                    tunnelRunning={tunnelRunning}
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

function ServerControls({
  disabled,
  onRestart,
  onStart,
  onStop,
  slug,
}: {
  disabled: boolean;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
  slug: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={onStart} disabled={disabled} aria-label={`Start ${slug} preview`}>
        <Play className="h-3.5 w-3.5" />
        Start
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onStop} disabled={disabled} aria-label={`Stop ${slug} preview`}>
        <Square className="h-3.5 w-3.5" />
        Stop
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRestart}
        disabled={disabled}
        aria-label={`Restart ${slug} preview`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Restart
      </Button>
    </div>
  );
}

function TunnelNotice({
  enabled,
  running,
  starting,
  onStart,
}: {
  enabled: boolean;
  running: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  if (!enabled) {
    return null;
  }

  if (running) {
    return (
      <StateCallout tone="default" icon={<Cloud className="h-5 w-5" />} title="Public preview URLs">
        The Cloudflare tunnel is running, so the public <span className="font-mono">*.tracker.cods.dev</span> links
        below reach this machine and can be shared with teammates.
      </StateCallout>
    );
  }

  return (
    <StateCallout tone="warning" title="Cloudflare tunnel is not running">
      <div className="space-y-3">
        <p>
          Public preview links won&apos;t work until the tunnel is running. Only the localhost URLs are shown below.
          Start the tunnel to expose the public <span className="font-mono">*.tracker.cods.dev</span> hosts.
        </p>
        <Button type="button" size="sm" onClick={onStart} disabled={starting}>
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {starting ? "Starting tunnel..." : "Start tunnel"}
        </Button>
      </div>
    </StateCallout>
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

function ServerRow({
  server,
  controlsDisabled,
  onAskAssistant,
  onRestart,
  onStart,
  onStop,
  tunnelRunning,
}: {
  server: IssueDevServer;
  controlsDisabled: boolean;
  onAskAssistant?: () => void;
  onRestart: (serverId: number) => void;
  onStart: (serverId: number) => void;
  onStop: (serverId: number) => void;
  tunnelRunning: boolean;
}) {
  const previewUrl = readyPreviewUrl(server);
  const publicUrl = publicTunnelPreviewUrl(server);
  const localUrl = localPreviewUrl(server);
  const openUrl = tunnelRunning ? previewUrl : (localUrl ?? previewUrl);

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
          {tunnelRunning && publicUrl ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              Public (Cloudflare tunnel):{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {publicUrl}
              </a>
            </p>
          ) : null}
          {tunnelRunning && localUrl ? (
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
          <ServerControls
            disabled={controlsDisabled}
            onRestart={() => onRestart(server.id)}
            onStart={() => onStart(server.id)}
            onStop={() => onStop(server.id)}
            slug={server.slug}
          />
          {onAskAssistant ? <AskAssistantButton onClick={onAskAssistant} /> : null}
          {openUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={openUrl} target="_blank" rel="noreferrer noopener">
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

function provisioningStatusMessage(primaryServer: IssueDevServer): string {
  return `The ${primaryServer.slug} dev server is ${primaryServer.status} and has not published a URL yet.`;
}
