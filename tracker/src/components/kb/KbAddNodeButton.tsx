import { FolderPlus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  label?: string;
  onAddPage: () => void;
  onCreateFolder: () => void;
  className?: string;
}

export function KbAddNodeButton({ label, onAddPage, onCreateFolder, className }: Props) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label ?? t("kb.actions.add")}
          aria-label={label ?? t("kb.actions.add")}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover/kb-row:opacity-100 group-hover/repo:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={onAddPage}>
          <Plus className="mr-2 h-4 w-4" />
          {t("kb.actions.addPage")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateFolder}>
          <FolderPlus className="mr-2 h-4 w-4" />
          {t("kb.actions.createFolder")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
