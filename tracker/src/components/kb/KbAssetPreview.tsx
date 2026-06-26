import { Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { kbAssetApiPath } from "@/lib/kbAssets";

interface Props {
  projectSlug: string;
  repoSlug: string;
  assetPath: string;
}

function assetName(assetPath: string): string {
  const segments = assetPath.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? assetPath;
}

export function KbAssetPreview({ projectSlug, repoSlug, assetPath }: Props) {
  const { t } = useTranslation();
  const src = kbAssetApiPath(projectSlug, repoSlug, assetPath);
  const name = assetName(assetPath);

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-w-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={assetPath}>
          {name}
        </span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("kb.asset.openTab")}
        </a>
        <a
          href={src}
          download={name}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          {t("kb.asset.download")}
        </a>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-6">
        <img
          src={src}
          alt={name}
          className="max-h-full max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    </div>
  );
}
