import { VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAttachmentObjectUrl, isTrackerAuthenticatedMediaUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";

interface AttachmentVideoProps {
  src: string;
  label: string;
  description?: string;
  className?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

function needsAuthenticatedFetch(src: string): boolean {
  if (/^(data:|blob:)/i.test(src)) return false;
  return isTrackerAuthenticatedMediaUrl(src);
}

export function AttachmentVideo({ src, label, description, className }: AttachmentVideoProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!needsAuthenticatedFetch(src)) {
      setState({ status: "ready", url: src });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    fetchAttachmentObjectUrl(src)
      .then((url) => {
        if (!cancelled) setState({ status: "ready", url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (state.status === "loading") {
    return (
      <div
        className={cn("animate-pulse rounded-lg border bg-muted", className)}
        aria-label={t("issue.attachments.loading", { name: label })}
      />
    );
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-lg border bg-muted/50 px-2 text-xs text-muted-foreground",
          className,
        )}
        role="img"
        aria-label={t("issue.attachments.loadFailed", { name: label })}
      >
        <VideoOff className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <figure className="space-y-1.5">
      {description ? (
        <figcaption className="text-sm font-medium leading-snug">{description}</figcaption>
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- attachment previews have no captions */}
      <video
        src={state.url}
        controls
        playsInline
        preload="metadata"
        aria-label={label}
        className={cn("bg-black/5", className)}
      />
      <figcaption className="truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </figcaption>
    </figure>
  );
}
