import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useViewer } from "@/components/auth/ViewerProvider";

import { useBoardFiltersDrawer } from "./useBoardFiltersDrawer";

export function BoardPaletteShortcuts() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [, setSearchParams] = useSearchParams();
  const { viewer } = useViewer();
  const { setOpen: setDrawerOpen, openAndFocusSearch } = useBoardFiltersDrawer();

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
        openAndFocusSearch();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openAndFocusSearch]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  function applyFilter(action: "assignee_me" | "creator_me" | "clear" | "open_drawer" | "focus_search") {
    closePalette();

    if (action === "open_drawer") {
      setDrawerOpen(true);
      return;
    }

    if (action === "focus_search") {
      openAndFocusSearch();
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
        <CommandInput placeholder="Type a command..." />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Filters">
            <CommandItem onSelect={() => applyFilter("open_drawer")}>Open filters</CommandItem>
            <CommandItem onSelect={() => applyFilter("focus_search")}>Search issues...</CommandItem>
            <CommandItem onSelect={() => applyFilter("assignee_me")}>Filter: Assigned to me</CommandItem>
            <CommandItem onSelect={() => applyFilter("creator_me")}>Filter: Created by me</CommandItem>
            <CommandItem onSelect={() => applyFilter("clear")}>Clear filters</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
