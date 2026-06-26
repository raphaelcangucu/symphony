import { ImageOff, ImagePlus, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { kbAssetApiPath, type KbAssetContext } from "@/lib/kbAssets";
import type { KbGalleryAsset } from "@/lib/kbGallery";
import { fetchAttachmentObjectUrl } from "@/services/attachments";

interface Props {
  mode: "insert" | "replace";
  assetContext: KbAssetContext;
  assets: KbGalleryAsset[];
  uploading: boolean;
  onUpload: () => void;
  onSelect: (asset: KbGalleryAsset) => void;
  onClose: () => void;
}

function GalleryThumb({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setObjectUrl(null);
    setFailed(false);
    // The object URL is cached per source for the page lifetime, so it must not
    // be revoked here (other thumbnails / the editor may share it).
    fetchAttachmentObjectUrl(src)
      .then((url) => {
        if (!cancelled) setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <ImageOff className="h-5 w-5" aria-label={t("kb.asset.loadFailed")} />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} className="h-full w-full object-cover" draggable={false} />;
}

export function KbImagePickerDialog({
  mode,
  assetContext,
  assets,
  uploading,
  onUpload,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length === 0) return assets;
    return assets.filter((asset) => asset.name.toLowerCase().includes(term));
  }, [assets, query]);

  const title = mode === "replace" ? t("kb.editor.imagePicker.replaceTitle") : t("kb.editor.imagePicker.insertTitle");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("kb.editor.imagePicker.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("kb.editor.imagePicker.searchPlaceholder")}
              aria-label={t("kb.editor.imagePicker.searchPlaceholder")}
              className="pl-8"
              disabled={assets.length === 0}
            />
          </div>
          <Button onClick={onUpload} disabled={uploading} className="shrink-0">
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            {t("kb.editor.imagePicker.upload")}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {assets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("kb.editor.imagePicker.galleryEmpty")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("kb.editor.imagePicker.noMatches")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 py-1 sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((asset) => (
                <button
                  key={asset.path}
                  type="button"
                  onClick={() => onSelect(asset)}
                  title={asset.path}
                  className="group/asset flex flex-col overflow-hidden rounded-lg border text-left transition hover:border-primary hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="aspect-video w-full overflow-hidden bg-muted/30">
                    <GalleryThumb
                      src={kbAssetApiPath(assetContext.projectSlug, assetContext.repoSlug, asset.path)}
                      alt={asset.name}
                    />
                  </div>
                  <span className="truncate px-2 py-1.5 text-xs text-muted-foreground group-hover/asset:text-foreground">
                    {asset.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
