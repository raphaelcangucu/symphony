import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchAttachmentObjectUrl, isInternalAttachmentUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";

interface AttachmentImageProps {
  src: string;
  alt: string;
  className?: string;
  /** When false, the image is not clickable and no lightbox is shown. */
  enableLightbox?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

function needsAuthenticatedFetch(src: string): boolean {
  if (/^(data:|blob:|https?:)/i.test(src)) return false;
  return isInternalAttachmentUrl(src) || src.startsWith("/");
}

export function AttachmentImage({ src, alt, className, enableLightbox = true }: AttachmentImageProps) {
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
    return <div className={cn("animate-pulse rounded-lg border bg-muted", className)} aria-label={`Loading ${alt}`} />;
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-lg border bg-muted/50 px-2 text-xs text-muted-foreground",
          className,
        )}
        role="img"
        aria-label={`Failed to load ${alt}`}
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{alt}</span>
      </div>
    );
  }

  if (!enableLightbox) {
    return <img src={state.url} alt={alt} className={className} loading="lazy" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block cursor-zoom-in overflow-hidden rounded-lg border bg-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={`Open ${alt}`}
      >
        <img src={state.url} alt={alt} className={className} loading="lazy" />
      </button>
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[92vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[92vw]">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img
            src={state.url}
            alt={alt}
            className="max-h-[88vh] w-auto max-w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
