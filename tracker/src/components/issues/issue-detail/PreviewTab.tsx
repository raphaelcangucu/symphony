import { AlertTriangle, Bot, Cloud, ExternalLink, Loader2, Play, RotateCcw, Server, Square } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DevServerOutputPanel } from "@/components/issues/issue-detail/DevServerOutputPanel";
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
  const { t } = useTranslation();
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
      <StateCallout tone="error" title={t("issue.preview.cannotLoadTitle")}>
        {t("issue.preview.cannotLoadBody")}
      </StateCallout>
    );
  }

  if (loading && !data) {
    return (
      <StateCallout
        ariaLive="polite"
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        role="status"
        title={t("issue.preview.loadingTitle")}
      >
        {t("issue.preview.loadingBody")}
      </StateCallout>
    );
  }

  if (error && !data) {
    return (
      <StateCallout tone="error" title={t("issue.preview.loadErrorTitle")}>
        {error}
      </StateCallout>
    );
  }

  if (!data) {
    return (
      <StateCallout title={t("issue.preview.unavailableTitle")}>
        {t("issue.preview.unavailableBody")}
      </StateCallout>
    );
  }

  const unavailableMessage = data.available ? null : availabilityMessage(data.reason, t);
  const provisioningMessage =
    data.available &&
    primaryServer != null &&
    ACTIVE_PROVISIONING_STATUSES.has(primaryServer.status)
      ? provisioningStatusMessage(primaryServer, t)
      : null;
  const controlsDisabled = loading || !canRunManualActions(data.available, data.reason);
  const failureReason = data.reason && isPreviewFailureReason(data.reason);
  const tunnelEnabled = data.tunnel?.enabled ?? false;
  const tunnelRunning = data.tunnel?.running ?? false;
  const openPrimaryUrl = tunnelRunning ? primaryUrl : (primaryLocalUrl ?? primaryUrl);

  return (
    <div className="space-y-4 text-sm">
      {error ? (
        <StateCallout tone="error" title={t("issue.preview.refreshErrorTitle")}>
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
                {t("issue.preview.cardTitle")}
              </CardTitle>
              <CardDescription>
                {t("issue.preview.availability", {
                  status: data.available ? t("issue.preview.available") : t("issue.preview.unavailable"),
                })}
                {loading ? t("issue.preview.refreshing") : ""}
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
                    {primaryServer
                      ? t("issue.preview.readyFrom", { slug: primaryServer.slug })
                      : t("issue.preview.ready")}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-emerald-700 dark:text-emerald-300">
                    {openPrimaryUrl}
                  </p>
                  {tunnelRunning && primaryPublicUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      {t("issue.preview.publicTunnel")}{" "}
                      <a href={primaryPublicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryPublicUrl}
                      </a>
                    </p>
                  ) : null}
                  {tunnelRunning && primaryLocalUrl ? (
                    <p className="mt-1 break-all font-mono text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      {t("issue.preview.local")}{" "}
                      <a href={primaryLocalUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        {primaryLocalUrl}
                      </a>
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm">
                  <a href={openPrimaryUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("issue.preview.openPreview")}
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
              title={t("issue.preview.provisioningTitle")}
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("issue.preview.devServers")}</h3>
            {data.servers.length === 0 ? (
              <p
                aria-live="polite"
                role="status"
                className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
              >
                {t("issue.preview.noServers")}
              </p>
            ) : (
              <div className="space-y-2">
                {data.servers.map((server) => (
                  <ServerRow
                    key={server.id}
                    controlsDisabled={controlsDisabled}
                    issueIdentifier={issueIdentifier}
                    onAskAssistant={
                      isPreviewFailureServerStatus(server.status)
                        ? () => askAssistantToFix(data, server)
                        : undefined
                    }
                    onRestart={(serverId) => void restartServer(serverId)}
                    onStart={(serverId) => void startServer(serverId)}
                    onStop={(serverId) => void stopServer(serverId)}
                    projectSlug={projectSlug}
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
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => void onStart()} disabled={disabled}>
        <Play className="h-3.5 w-3.5" />
        {t("issue.preview.startPreview")}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void onStop()} disabled={disabled}>
        <Square className="h-3.5 w-3.5" />
        {t("issue.preview.stopPreview")}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void onRestart()} disabled={disabled}>
        <RotateCcw className="h-3.5 w-3.5" />
        {t("issue.preview.restartPreview")}
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
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        onClick={onStart}
        disabled={disabled}
        aria-label={t("issue.preview.startServerAria", { slug })}
      >
        <Play className="h-3.5 w-3.5" />
        {t("issue.preview.start")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onStop}
        disabled={disabled}
        aria-label={t("issue.preview.stopServerAria", { slug })}
      >
        <Square className="h-3.5 w-3.5" />
        {t("issue.preview.stop")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRestart}
        disabled={disabled}
        aria-label={t("issue.preview.restartServerAria", { slug })}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t("issue.preview.restart")}
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
  const { t } = useTranslation();

  if (!enabled) {
    return null;
  }

  if (running) {
    return (
      <StateCallout tone="default" icon={<Cloud className="h-5 w-5" />} title={t("issue.preview.tunnelRunningTitle")}>
        {t("issue.preview.tunnelRunningBody")}
      </StateCallout>
    );
  }

  return (
    <StateCallout tone="warning" title={t("issue.preview.tunnelStoppedTitle")}>
      <div className="space-y-3">
        <p>{t("issue.preview.tunnelStoppedBody")}</p>
        <Button type="button" size="sm" onClick={onStart} disabled={starting}>
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {starting ? t("issue.preview.startingTunnel") : t("issue.preview.startTunnel")}
        </Button>
      </div>
    </StateCallout>
  );
}

function AskAssistantButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      <Bot className="h-3.5 w-3.5" />
      {t("issue.preview.askAssistant")}
    </Button>
  );
}

function ServerRow({
  server,
  projectSlug,
  issueIdentifier,
  controlsDisabled,
  onAskAssistant,
  onRestart,
  onStart,
  onStop,
  tunnelRunning,
}: {
  server: IssueDevServer;
  projectSlug: string;
  issueIdentifier: string;
  controlsDisabled: boolean;
  onAskAssistant?: () => void;
  onRestart: (serverId: number) => void;
  onStart: (serverId: number) => void;
  onStop: (serverId: number) => void;
  tunnelRunning: boolean;
}) {
  const { t } = useTranslation();
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
            {server.primary ? <Badge variant="outline">{t("issue.preview.primaryBadge")}</Badge> : null}
            <Badge className={cn("capitalize", STATUS_BADGE_CLASS[server.status])}>{server.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {server.working_dir
              ? t("issue.preview.workingDir", { dir: server.working_dir })
              : t("issue.preview.noWorkingDir")}
            {server.port ? t("issue.preview.port", { port: server.port }) : ""}
          </p>
          {tunnelRunning && publicUrl ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {t("issue.preview.publicTunnel")}{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {publicUrl}
              </a>
            </p>
          ) : null}
          {tunnelRunning && localUrl ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {t("issue.preview.local")}{" "}
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
                {t("issue.preview.openServerPreview", { slug: server.slug })}
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t("issue.preview.noUrlYet")}</span>
          )}
        </div>
      </div>
      <DevServerOutputPanel
        defaultOpen={ACTIVE_PROVISIONING_STATUSES.has(server.status) || server.status === "crashed"}
        issueIdentifier={issueIdentifier}
        projectSlug={projectSlug}
        serverId={server.id}
        sessionName={server.session_name}
        slug={server.slug}
        status={server.status}
      />
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

  // Use `localhost` (not `127.0.0.1`): the browser may run on a different host
  // than the dev server (e.g. Windows browser + WSL2 dev servers). `localhost`
  // resolves to both ::1 and 127.0.0.1, so it reaches IPv6-bound listeners
  // (Go's default `[::]` bind, e.g. goapi) as well as IPv4 `0.0.0.0` listeners,
  // whereas a hardcoded `127.0.0.1` fails for IPv6-only forwarded listeners.
  return `http://localhost:${server.port}${pathFromUrl(server.url)}`;
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

function availabilityMessage(reason: IssueDevServerReason, t: TFunction): { title: string; body: string } {
  const knownReasons: IssueDevServerReason[] = [
    "disabled",
    "workspace_missing",
    "no_serve_step",
    "no_free_port",
    "lock_unavailable",
    "start_failed",
    "restart_failed",
    "crashed",
  ];
  const key = knownReasons.includes(reason) ? reason : "default";
  return {
    title: t(`issue.preview.availabilityReason.${key}.title`),
    body: t(`issue.preview.availabilityReason.${key}.body`),
  };
}

function provisioningStatusMessage(primaryServer: IssueDevServer, t: TFunction): string {
  return t("issue.preview.provisioningStatus", { slug: primaryServer.slug, status: primaryServer.status });
}
