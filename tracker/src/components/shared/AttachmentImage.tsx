import { ImageOff, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchAttachmentObjectUrl, isTrackerAuthenticatedMediaUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";

interface AttachmentImageProps {
  src: string;
  alt: string;
  className?: string;
  /** When false, the image is not clickable and no lightbox is shown. */
  enableLightbox?: boolean;
  /** Grid/card preview with consistent sizing and optional caption. */
  layout?: "inline" | "thumbnail";
  showCaption?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

function needsAuthenticatedFetch(src: string): boolean {
  if (/^(data:|blob:)/i.test(src)) return false;
  return isTrackerAuthenticatedMediaUrl(src);
}

export function AttachmentImage({
  src,
  alt,
  className,
  enableLightbox = true,
  layout = "inline",
  showCaption = false,
}: AttachmentImageProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
      <figure className={cn(layout === "thumbnail" && "space-y-1.5")}>
        <div
          className={cn(
            "animate-pulse rounded-lg border bg-muted",
            layout === "thumbnail" ? "aspect-video w-full" : className,
          )}
          aria-label={t("issue.attachments.loading", { name: alt })}
        />
        {showCaption ? <figcaption className="sr-only">{alt}</figcaption> : null}
      </figure>
    );
  }

  if (state.status === "error") {
    return (
      <figure className={cn(layout === "thumbnail" && "space-y-1.5")}>
        <div
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border bg-muted/50 px-2 text-xs text-muted-foreground",
            layout === "thumbnail" ? "aspect-video w-full" : className,
          )}
          role="img"
          aria-label={t("issue.attachments.loadFailed", { name: alt })}
        >
          <ImageOff className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{alt}</span>
        </div>
        {showCaption ? (
          <figcaption className="truncate text-center text-[11px] text-muted-foreground" title={alt}>
            {alt}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  const image = (
    <img
      src={state.url}
      alt={alt}
      className={cn(
        layout === "thumbnail" ? "max-h-full max-w-full object-contain" : className,
        layout === "inline" && !className && "max-h-80 w-auto max-w-full object-contain",
      )}
      loading="lazy"
    />
  );

  if (!enableLightbox) {
    if (layout === "thumbnail") {
      return (
        <figure className="space-y-1.5">
          <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/40 p-2">
            {image}
          </div>
          {showCaption ? (
            <figcaption className="truncate text-center text-[11px] text-muted-foreground" title={alt}>
              {alt}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    return image;
  }

  const preview =
    layout === "thumbnail" ? (
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="group relative flex aspect-video w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/40 p-2 transition hover:border-primary/30 hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={t("issue.attachments.openAria", { name: alt })}
      >
        {image}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
          <ZoomIn className="h-5 w-5 text-white opacity-0 drop-shadow transition group-hover:opacity-100" />
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="my-2 inline-flex max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-muted/20 transition hover:border-primary/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={t("issue.attachments.openAria", { name: alt })}
      >
        {image}
      </button>
    );

  return (
    <figure className={cn(layout === "thumbnail" && "space-y-1.5")}>
      {preview}
      {showCaption ? (
        <figcaption className="truncate text-center text-[11px] text-muted-foreground" title={alt}>
          {alt}
        </figcaption>
      ) : null}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className={cn(
            "!w-auto max-w-[min(92vw,1400px)] gap-3 border-0 bg-transparent p-0 shadow-none sm:max-w-[min(92vw,1400px)]",
            "[&>button]:right-1 [&>button]:top-1 [&>button]:rounded-full [&>button]:border [&>button]:border-border/50",
            "[&>button]:bg-background/90 [&>button]:p-1.5 [&>button]:shadow-md [&>button]:backdrop-blur",
          )}
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <div className="flex max-h-[82vh] items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-background/95 p-3 shadow-2xl backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/90">
            <img
              src={state.url}
              alt={alt}
              className="max-h-[78vh] max-w-[min(88vw,1360px)] object-contain"
            />
          </div>
          <p
            className="mx-auto max-w-[min(88vw,640px)] truncate rounded-full border border-border/40 bg-background/85 px-4 py-1.5 text-center text-xs text-muted-foreground shadow-sm backdrop-blur dark:bg-zinc-950/85"
            title={alt}
          >
            {alt}
          </p>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
