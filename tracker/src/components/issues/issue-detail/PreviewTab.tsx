import { AlertTriangle, Bot, Cloud, ExternalLink, Loader2, MoreHorizontal, Play, RotateCcw, Server, Square } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DevServerOutputPanel } from "@/components/issues/issue-detail/DevServerOutputPanel";
import { useIssueDevServers, type UseIssueDevServersResult } from "@/hooks/useIssueDevServers";
import {
  localPreviewUrl,
  readyPreviewUrl,
  selectPrimaryServer,
} from "@/lib/devServerUrls";
import {
  buildPreviewFailurePrompt,
  isPreviewFailureReason,
  isPreviewFailureServerStatus,
  previewHandoffTarget,
  stashPreviewAssistantHandoff,
} from "@/lib/previewAssistantHandoff";
import { issueAgentTabPath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { devServerStatusBadgeClass } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { IssueDevServer, IssueDevServerReason, IssueDevServerStatus, IssueDevServersResponse } from "@/types/issue";

interface PreviewTabProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  execution?: AgentExecution;
}

const RETRYABLE_UNAVAILABLE_REASONS = new Set<IssueDevServerReason>([
  "lock_unavailable",
  "start_failed",
  "restart_failed",
  "crashed",
]);

const ACTIVE_PROVISIONING_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting"]);

export function PreviewTab({ projectSlug, issueIdentifier, view, execution }: PreviewTabProps) {
  const devServers = useIssueDevServers(projectSlug, issueIdentifier);

  return (
    <PreviewPanel
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier}
      view={view}
      execution={execution}
      devServers={devServers}
    />
  );
}

interface PreviewPanelProps extends PreviewTabProps {
  /** Shared dev-servers state, so embedders (e.g. the session preview dock) keep a single SSE subscription. */
  devServers: UseIssueDevServersResult;
}

/**
 * Full dev-server management panel: availability, tunnel, per-server controls,
 * logs and assistant handoff. Rendered by the issue Preview tab and embedded by
 * the session preview dock so both surfaces share the same behavior.
 */
export function PreviewPanel({ projectSlug, issueIdentifier, view, execution, devServers }: PreviewPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, error, loading, restart, restartServer, start, startServer, stop, stopServer, startTunnel } =
    devServers;
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
  const canRunActions = canRunManualActions(data.available, data.reason);
  const controlsDisabled = loading || !canRunActions;
  const failureReason = data.reason != null && isPreviewFailureReason(data.reason);
  const primaryFailureServer =
    primaryServer && isPreviewFailureServerStatus(primaryServer.status) ? primaryServer : null;
  const tunnelEnabled = data.tunnel?.enabled ?? false;
  const tunnelRunning = data.tunnel?.running ?? false;
  const openPrimaryUrl = tunnelRunning ? primaryUrl : (primaryLocalUrl ?? primaryUrl);
  const canStartPreview = openPrimaryUrl == null && canRunActions && !failureReason && primaryFailureServer == null;
  const canAskAssistant = openPrimaryUrl == null && (failureReason || primaryFailureServer != null);

  return (
    <div className="space-y-4 text-sm">
      {error ? (
        <StateCallout tone="error" title={t("issue.preview.refreshErrorTitle")}>
          {error}
        </StateCallout>
      ) : null}

      <Card>
        <CardHeader className="gap-3 p-4">
          <PreviewStatusStrip
            available={data.available}
            loading={loading}
            onStartTunnel={() => void handleStartTunnel()}
            startingTunnel={startingTunnel}
            tunnelEnabled={tunnelEnabled}
            tunnelRunning={tunnelRunning}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                {t("issue.preview.cardTitle")}
              </CardTitle>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <PrimaryPreviewAction
                canAskAssistant={canAskAssistant}
                canStart={canStartPreview}
                disabled={controlsDisabled}
                onAskAssistant={() => askAssistantToFix(data, primaryFailureServer)}
                onStart={start}
                openUrl={openPrimaryUrl}
              />
              <SecondaryPreviewControls disabled={controlsDisabled} onRestart={restart} onStop={stop} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          {openPrimaryUrl ? <ReadyUrlLine url={openPrimaryUrl} /> : null}

          {unavailableMessage ? (
            <StateCallout tone="warning" title={unavailableMessage.title}>
              {unavailableMessage.body}
            </StateCallout>
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
              <div className="divide-y rounded-lg border">
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

function PreviewStatusStrip({
  available,
  loading,
  onStartTunnel,
  startingTunnel,
  tunnelEnabled,
  tunnelRunning,
}: {
  available: boolean;
  loading: boolean;
  onStartTunnel: () => void;
  startingTunnel: boolean;
  tunnelEnabled: boolean;
  tunnelRunning: boolean;
}) {
  const { t } = useTranslation();
  const tunnelLabel = tunnelEnabled
    ? tunnelRunning
      ? t("issue.preview.tunnelRunning")
      : t("issue.preview.tunnelStopped")
    : t("issue.preview.tunnelDisabled");

  return (
    <div
      aria-label={t("issue.preview.statusStripLabel")}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <span>
        {t("issue.preview.availability", {
          status: available ? t("issue.preview.available") : t("issue.preview.unavailable"),
        })}
        {loading ? t("issue.preview.refreshing") : ""}
      </span>
      <span aria-hidden="true">·</span>
      <span>{tunnelLabel}</span>
      {tunnelEnabled && !tunnelRunning ? (
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={onStartTunnel} disabled={startingTunnel}>
          {startingTunnel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {startingTunnel ? t("issue.preview.startingTunnel") : t("issue.preview.startTunnel")}
        </Button>
      ) : null}
    </div>
  );
}

function PrimaryPreviewAction({
  canAskAssistant,
  canStart,
  disabled,
  onAskAssistant,
  onStart,
  openUrl,
}: {
  canAskAssistant: boolean;
  canStart: boolean;
  disabled: boolean;
  onAskAssistant: () => void;
  onStart: () => Promise<void>;
  openUrl: string | null;
}) {
  const { t } = useTranslation();

  if (openUrl) {
    return (
      <Button asChild size="sm">
        <a href={openUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="h-3.5 w-3.5" />
          {t("issue.preview.openPreview")}
        </a>
      </Button>
    );
  }

  if (canAskAssistant) {
    return <AskAssistantButton onClick={onAskAssistant} primary />;
  }

  if (canStart) {
    return (
      <Button type="button" size="sm" onClick={() => void onStart()} disabled={disabled}>
        <Play className="h-3.5 w-3.5" />
        {t("issue.preview.startPreview")}
      </Button>
    );
  }

  return null;
}

function SecondaryPreviewControls({
  disabled,
  onRestart,
  onStop,
}: {
  disabled: boolean;
  onRestart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={() => void onStop()} disabled={disabled}>
        <Square className="h-3.5 w-3.5" />
        {t("issue.preview.stopPreview")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => void onRestart()} disabled={disabled}>
        <RotateCcw className="h-3.5 w-3.5" />
        {t("issue.preview.restartPreview")}
      </Button>
    </div>
  );
}

function ReadyUrlLine({ url }: { url: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-emerald-500/10 px-3 py-2 text-xs sm:flex-row sm:items-center">
      <span className="font-medium text-emerald-800 dark:text-emerald-200">{t("issue.preview.readyUrl")}</span>
      <code className="break-all font-mono text-emerald-700 dark:text-emerald-300">{url}</code>
    </div>
  );
}

function AskAssistantButton({ onClick, primary = false }: { onClick: () => void; primary?: boolean }) {
  const { t } = useTranslation();

  return (
    <Button type="button" size="sm" variant={primary ? "default" : "outline"} onClick={onClick}>
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const previewUrl = readyPreviewUrl(server);
  const localUrl = localPreviewUrl(server);
  const openUrl = tunnelRunning ? previewUrl : (localUrl ?? previewUrl);
  const portLabel = server.port ? `:${server.port}` : t("issue.preview.noPort");
  const compactLabel = `${server.slug} · ${portLabel} · ${server.status}`;
  const hasOverflowActions = openUrl != null || onAskAssistant != null;

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-xs">
          <span className="font-medium">{compactLabel}</span>
          {server.primary ? (
            <Badge variant="outline" className="ml-2 align-middle">
              {t("issue.preview.primaryBadge")}
            </Badge>
          ) : null}
          <Badge className={cn("ml-2 align-middle capitalize", devServerStatusBadgeClass(server.status))}>{server.status}</Badge>
          {server.session_name ? (
            <span className="ml-2 truncate font-mono text-muted-foreground">{server.session_name}</span>
          ) : null}
        </div>
        <div className="relative flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onStart(server.id)}
            disabled={controlsDisabled}
            aria-label={t("issue.preview.startServerAria", { slug: server.slug })}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onStop(server.id)}
            disabled={controlsDisabled}
            aria-label={t("issue.preview.stopServerAria", { slug: server.slug })}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onRestart(server.id)}
            disabled={controlsDisabled}
            aria-label={t("issue.preview.restartServerAria", { slug: server.slug })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          {hasOverflowActions ? (
            <div className="relative">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-controls={actionsId}
                aria-expanded={actionsOpen}
                aria-label={t("issue.preview.moreActionsAria", { slug: server.slug })}
                onClick={() => setActionsOpen((value) => !value)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
              {actionsOpen ? (
                <div
                  id={actionsId}
                  className="absolute right-0 z-10 mt-1 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {onAskAssistant ? (
                    <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={onAskAssistant}>
                      <Bot className="h-3.5 w-3.5" />
                      {t("issue.preview.askAssistant")}
                    </Button>
                  ) : null}
                  {openUrl ? (
                    <Button asChild size="sm" variant="ghost" className="w-full justify-start">
                      <a href={openUrl} target="_blank" rel="noreferrer noopener" aria-label={t("issue.preview.openServerPreview", { slug: server.slug })}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("issue.preview.openUrl")}
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <span className="px-2 text-xs text-muted-foreground">{t("issue.preview.noUrlYet")}</span>
          )}
        </div>
      </div>
      <div className="mt-2">
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
        <div>{children}</div>
      </div>
    </div>
  );
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
