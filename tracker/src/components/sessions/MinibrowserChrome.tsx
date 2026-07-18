import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Home,
  LoaderCircle,
  RefreshCw,
  SquareArrowOutUpRight,
  StopCircle,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  canGoBack,
  canGoForward,
  createMinibrowserHistory,
  goBack,
  goForward,
  navigateTo,
} from "@/lib/minibrowserHistory";
import { resolvePreviewNavigationUrl } from "@/lib/previewNavigationUrl";
import { cn } from "@/lib/utils";

interface MinibrowserChromeProps {
  homeUrl: string;
  frameTitle: string;
  showPopout?: boolean;
  onPopout?: () => void;
  className?: string;
}

export function MinibrowserChrome({
  homeUrl,
  frameTitle,
  showPopout = false,
  onPopout,
  className,
}: MinibrowserChromeProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState(() => createMinibrowserHistory(homeUrl));
  const [draftUrl, setDraftUrl] = useState(homeUrl);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stopped, setStopped] = useState(false);
  const previousHomeUrl = useRef(homeUrl);

  useEffect(() => {
    if (previousHomeUrl.current === homeUrl) return;

    previousHomeUrl.current = homeUrl;
    setHistory(createMinibrowserHistory(homeUrl));
    setDraftUrl(homeUrl);
    setReloadKey(0);
    setLoading(true);
    setStopped(false);
  }, [homeUrl]);

  function navigate(url: string) {
    const nextHistory = navigateTo(history, url);
    if (nextHistory === history) return;

    setHistory(nextHistory);
    setDraftUrl(nextHistory.current);
    setLoading(true);
    setStopped(false);
  }

  function handleBack() {
    const nextHistory = goBack(history);
    if (nextHistory === history) return;

    setHistory(nextHistory);
    setDraftUrl(nextHistory.current);
    setLoading(true);
    setStopped(false);
  }

  function handleForward() {
    const nextHistory = goForward(history);
    if (nextHistory === history) return;

    setHistory(nextHistory);
    setDraftUrl(nextHistory.current);
    setLoading(true);
    setStopped(false);
  }

  function handleReload() {
    setStopped(false);
    setLoading(true);
    setReloadKey((current) => current + 1);
  }

  function handleStop() {
    if (!loading) return;

    setStopped(true);
    setLoading(false);
  }

  function handleHome() {
    navigate(homeUrl);
  }

  function handleUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const resolved = resolvePreviewNavigationUrl(draftUrl, history.current);
    if (!resolved) return;
    navigate(resolved);
  }

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background", className)}>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/50 px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.minibrowser.back")}
          title={t("workspace.preview.minibrowser.back")}
          disabled={!canGoBack(history)}
          onClick={handleBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.minibrowser.forward")}
          title={t("workspace.preview.minibrowser.forward")}
          disabled={!canGoForward(history)}
          onClick={handleForward}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.reload")}
          title={t("workspace.preview.reload")}
          onClick={handleReload}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.minibrowser.stop")}
          title={t("workspace.preview.minibrowser.stop")}
          disabled={!loading}
          onClick={handleStop}
        >
          <StopCircle className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.minibrowser.home")}
          title={t("workspace.preview.minibrowser.home")}
          onClick={handleHome}
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
        <input
          type="text"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={handleUrlKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("workspace.preview.urlInputAria")}
          title={draftUrl}
          className="min-w-0 flex-1 rounded border border-border/60 bg-background px-2 py-1 font-mono text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading ? (
          <LoaderCircle
            aria-label={t("workspace.preview.minibrowser.loadingAria")}
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        ) : null}
        <Button asChild variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <a
            href={history.current}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("workspace.preview.openInNewTab")}
            title={t("workspace.preview.openInNewTab")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
        {showPopout && onPopout ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={t("workspace.preview.minibrowser.popoutAria")}
            title={t("workspace.preview.minibrowser.popoutAria")}
            onClick={onPopout}
          >
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe
          key={`${history.current}:${reloadKey}`}
          src={stopped ? "about:blank" : history.current}
          title={frameTitle}
          className="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
