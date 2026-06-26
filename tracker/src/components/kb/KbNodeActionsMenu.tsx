import { FolderPlus, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
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
  favorite?: boolean;
  variant?: "page" | "folder" | "asset";
  onRename?: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
  onCreateFolder?: () => void;
  onAddPage?: () => void;
  className?: string;
}

export function KbNodeActionsMenu({
  title,
  favorite = false,
  variant = "page",
  onRename,
  onToggleFavorite,
  onDelete,
  onCreateFolder,
  onAddPage,
  className,
}: Props) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("kb.actions.more", { title })}
          aria-label={t("kb.actions.more", { title })}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover/kb-row:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {(variant === "page" || variant === "asset") && onRename ? (
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("kb.actions.rename")}
          </DropdownMenuItem>
        ) : null}
        {variant === "page" && onToggleFavorite ? (
          <DropdownMenuItem onClick={onToggleFavorite}>
            <Star className={cn("mr-2 h-4 w-4", favorite && "fill-current text-amber-500")} />
            {favorite ? t("kb.actions.unfavorite") : t("kb.actions.favorite")}
          </DropdownMenuItem>
        ) : null}
        {onAddPage ? (
          <DropdownMenuItem onClick={onAddPage}>
            <Plus className="mr-2 h-4 w-4" />
            {t("kb.actions.addPage")}
          </DropdownMenuItem>
        ) : null}
        {onCreateFolder ? (
          <DropdownMenuItem onClick={onCreateFolder}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t("kb.actions.createFolder")}
          </DropdownMenuItem>
        ) : null}
        {(variant === "page" || variant === "asset") && onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("kb.actions.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
