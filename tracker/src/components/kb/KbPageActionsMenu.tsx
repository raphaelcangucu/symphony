import { Download, MoreHorizontal, Pencil, RefreshCw, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  favorite: boolean;
  onRename: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onSync?: () => void;
  syncing?: boolean;
  onDownload?: () => void;
}

export function KbPageActionsMenu({
  title,
  favorite,
  onRename,
  onToggleFavorite,
  onDelete,
  onSync,
  syncing = false,
  onDownload,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title={favorite ? t("kb.actions.unfavorite") : t("kb.actions.favorite")}
        aria-label={favorite ? t("kb.actions.unfavorite") : t("kb.actions.favorite")}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground",
          favorite && "text-amber-500",
        )}
      >
        <Star className={cn("h-4 w-4", favorite && "fill-current")} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t("kb.actions.more", { title })}
            aria-label={t("kb.actions.more", { title })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("kb.actions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleFavorite}>
            <Star className={cn("mr-2 h-4 w-4", favorite && "fill-current text-amber-500")} />
            {favorite ? t("kb.actions.unfavorite") : t("kb.actions.favorite")}
          </DropdownMenuItem>
          {onSync ? (
            <DropdownMenuItem onClick={onSync} disabled={syncing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", syncing && "animate-spin")} />
              {t("kb.sync.now")}
            </DropdownMenuItem>
          ) : null}
          {onDownload ? (
            <DropdownMenuItem onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("kb.actions.downloadMarkdown")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("kb.actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
