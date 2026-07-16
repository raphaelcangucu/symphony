import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import {
  useMaestroExtraGetter,
  useMaestroHostControl,
  useMaestroKbHandlers,
} from "@/components/maestro/MaestroExtraContext";
import { MaestroLauncher } from "@/components/maestro/MaestroLauncher";
import { Button } from "@/components/ui/button";
import {
  maestroContextKey,
  resolveMaestroContext,
  type MaestroContext,
} from "@/lib/maestroContext";
import { cn } from "@/lib/utils";
import { ensureActiveFreeformThread } from "@/services/assistantThreads";

const PANEL_OPEN_STORAGE_KEY = "symphony.maestro.panelOpen";

function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Ignore storage failures (private mode, quota); open state is non-critical.
  }
}

/** Extra context injected per surface into every outgoing message. */
function extraForContext(ctx: MaestroContext): Record<string, unknown> {
  switch (ctx.kind) {
    case "home":
      return { surface: ctx.surface, maestro: { kind: "home", surface: ctx.surface } };
    case "project":
      return { maestro: { kind: "project", view: ctx.view } };
    case "issue":
      return { maestro: { kind: "issue", view: ctx.view, issueIdentifier: ctx.issueIdentifier } };
    case "kb":
      // The KB editor publishes its own `surface: "kb"` + live page snapshot.
      return {};
  }
}

function contextLabel(ctx: MaestroContext, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (ctx.kind) {
    case "home":
      return ctx.surface === "observability"
        ? t("maestro.context.observability")
        : t("maestro.context.home");
    case "project":
      return t("maestro.context.project", { slug: ctx.projectSlug });
    case "issue":
      return t("maestro.context.issue", { identifier: ctx.issueIdentifier });
    case "kb":
      return t("maestro.context.kb");
  }
}

function panelKey(ctx: MaestroContext, freeformThreadId: number | null): string {
  // Home and Observability share one freeform thread, so key by thread id to
  // avoid remounting the panel (and reloading history) when toggling between
  // them. Other contexts remount when their scope changes.
  if (ctx.kind === "home") return `home:${freeformThreadId ?? "pending"}`;
  return maestroContextKey(ctx);
}

/**
 * App-level docked Maestro. Resolves the current surface from the route and
 * binds the reused `ProjectAssistantPanel` to the matching singleton thread
 * (freeform / project / issue / kb). Renders nothing on Workspaces and
 * full-page assistant routes.
 */
export function MaestroHost() {
  const { t } = useTranslation();
  const location = useLocation();
  const getPageExtra = useMaestroExtraGetter();
  const { setHostControl } = useMaestroHostControl();
  const kbHandlers = useMaestroKbHandlers();

  const ctx = useMemo(() => resolveMaestroContext(location.pathname), [location.pathname]);

  const [open, setOpen] = useState<boolean>(() => readPanelOpen());
  const [running, setRunning] = useState(false);
  const [freeformThreadId, setFreeformThreadId] = useState<number | null>(null);
  const [freeformError, setFreeformError] = useState(false);

  const isHome = ctx?.kind === "home";
  const needsFreeformThread = isHome && (open || running) && freeformThreadId === null && !freeformError;

  useEffect(() => {
    if (!needsFreeformThread) return;
    let cancelled = false;
    void (async () => {
      try {
        const thread = await ensureActiveFreeformThread();
        if (!cancelled) setFreeformThreadId(thread.id);
      } catch {
        if (!cancelled) setFreeformError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsFreeformThread]);

  // Drop a stale running pill when the bound context changes.
  const ctxKey = ctx ? maestroContextKey(ctx) : null;
  useEffect(() => {
    setRunning(false);
  }, [ctxKey]);

  const openPanel = useCallback(() => {
    setOpen(true);
    writePanelOpen(true);
  }, []);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writePanelOpen(next);
      return next;
    });
  }, []);

  // Expose an open control so page toolbars (e.g. the KB editor "Ask AI"
  // button) can reveal the docked panel.
  useEffect(() => {
    setHostControl({ openPanel });
    return () => setHostControl(null);
  }, [setHostControl, openPanel]);

  const handleClose = useCallback(() => {
    setOpen(false);
    writePanelOpen(false);
  }, []);

  const getExtraContext = useCallback(() => {
    if (!ctx) return undefined;
    return { ...extraForContext(ctx), ...getPageExtra() };
  }, [ctx, getPageExtra]);

  if (!ctx) return null;

  const panelReady = ctx.kind !== "home" || freeformThreadId !== null;
  const showPanel = (open || running) && panelReady;

  return (
    <>
      {showPanel ? (
        <aside
          className={cn(
            "fixed bottom-0 right-0 top-0 z-40 flex w-[400px] flex-col border-l bg-background shadow-xl",
            open ? "flex" : "hidden",
          )}
          aria-label={t("maestro.title")}
        >
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("maestro.contextLabel")}
              </span>
              <span className="truncate rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
                {contextLabel(ctx, t)}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t("maestro.close")}
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="min-h-0 flex-1">
            <ProjectAssistantPanel
              key={panelKey(ctx, freeformThreadId)}
              mode="embedded"
              view={ctx.kind === "project" || ctx.kind === "issue" ? ctx.view : "board"}
              projectSlug={ctx.kind === "home" ? undefined : ctx.projectSlug}
              threadId={ctx.kind === "home" ? (freeformThreadId ?? undefined) : undefined}
              issueIdentifier={ctx.kind === "issue" ? ctx.issueIdentifier : undefined}
              assistantMode={
                ctx.kind === "project"
                  ? "project"
                  : ctx.kind === "kb"
                    ? "kb"
                    : ctx.kind === "home"
                      ? "freeform"
                      : undefined
              }
              kbRepoSlug={ctx.kind === "kb" ? ctx.repoSlug : undefined}
              kbPagePath={ctx.kind === "kb" ? ctx.pagePath : undefined}
              getExtraContext={getExtraContext}
              onRunningChange={setRunning}
              onDocumentChanged={ctx.kind === "kb" ? kbHandlers?.onDocumentChanged : undefined}
            />
          </div>
        </aside>
      ) : null}

      {!open ? <MaestroLauncher running={running} onClick={handleToggle} /> : null}
    </>
  );
}
