import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useViewer } from "@/components/auth/ViewerProvider";
import { filtersPath, viewFromPathname } from "@/lib/workspaceRoutes";

type PaletteAction = "assignee_me" | "creator_me" | "clear" | "open_drawer" | "focus_search";

export function BoardPaletteShortcuts() {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { projectSlug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { viewer } = useViewer();

  const openFilters = useCallback(
    (focusSearch: boolean) => {
      const view = viewFromPathname(location.pathname);
      navigate(
        { pathname: filtersPath(projectSlug, view), search: location.search },
        { state: focusSearch ? { focusSearch: true } : undefined },
      );
    },
    [location.pathname, location.search, navigate, projectSlug],
  );

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const insideInput = tagName === "input" || tagName === "textarea" || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (event.key === "/" && !insideInput) {
        event.preventDefault();
        openFilters(true);
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openFilters]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  function applyFilter(action: PaletteAction) {
    closePalette();

    if (action === "open_drawer") {
      openFilters(false);
      return;
    }

    if (action === "focus_search") {
      openFilters(true);
      return;
    }

    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (action === "assignee_me") params.set("assignee", "me");
        if (action === "creator_me") params.set("creator", "me");
        if (action === "clear") {
          params.delete("assignee");
          params.delete("creator");
          params.delete("q");
          params.delete("updated");
        }
        return params;
      },
      { replace: true },
    );
  }

  if (!viewer) return null;

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <Command>
        <CommandInput placeholder={t("board.palette.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("board.palette.empty")}</CommandEmpty>
          <CommandGroup heading={t("board.palette.filtersHeading")}>
            <CommandItem onSelect={() => applyFilter("open_drawer")}>{t("board.palette.openFilters")}</CommandItem>
            <CommandItem onSelect={() => applyFilter("focus_search")}>{t("board.palette.searchIssues")}</CommandItem>
            <CommandItem onSelect={() => applyFilter("assignee_me")}>{t("board.palette.assignedToMe")}</CommandItem>
            <CommandItem onSelect={() => applyFilter("creator_me")}>{t("board.palette.createdByMe")}</CommandItem>
            <CommandItem onSelect={() => applyFilter("clear")}>{t("board.palette.clearFilters")}</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
