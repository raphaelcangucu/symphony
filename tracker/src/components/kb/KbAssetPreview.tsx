import { Download, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { kbAssetApiPath } from "@/lib/kbAssets";
import { fetchAttachmentObjectUrl } from "@/services/attachments";

interface Props {
  projectSlug: string;
  repoSlug: string;
  assetPath: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error" };

function assetName(assetPath: string): string {
  const segments = assetPath.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? assetPath;
}

export function KbAssetPreview({ projectSlug, repoSlug, assetPath }: Props) {
  const { t } = useTranslation();
  const src = kbAssetApiPath(projectSlug, repoSlug, assetPath);
  const name = assetName(assetPath);

  // KB assets are served behind a bearer-authenticated route, so a plain
  // <img src> GET (which omits the Authorization header) returns 401 on a fresh
  // load. Fetch the bytes with the token and render the resulting blob URL,
  // mirroring how the in-editor image node view loads the same asset.
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchAttachmentObjectUrl(src)
      .then((objectUrl) => {
        if (!cancelled) setState({ status: "ready", objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  const objectUrl = state.status === "ready" ? state.objectUrl : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-w-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={assetPath}>
          {name}
        </span>
        <a
          href={objectUrl ?? src}
          target="_blank"
          rel="noreferrer"
          aria-disabled={objectUrl === null}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("kb.asset.openTab")}
        </a>
        <a
          href={objectUrl ?? src}
          download={name}
          aria-disabled={objectUrl === null}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {t("kb.asset.download")}
        </a>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-6">
        {state.status === "loading" && (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("kb.asset.loading")}
          </span>
        )}
        {state.status === "error" && (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="h-4 w-4" />
            {t("kb.asset.loadFailed")}
          </span>
        )}
        {state.status === "ready" && (
          <img
            src={state.objectUrl}
            alt={name}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          />
        )}
      </div>
    </div>
  );
}
