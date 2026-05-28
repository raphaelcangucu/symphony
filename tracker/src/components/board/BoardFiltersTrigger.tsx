import { ListFilter } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useBoardFiltersDrawer } from "./useBoardFiltersDrawer";

const TRACKED_KEYS = ["q", "assignee", "creator"] as const;

export function BoardFiltersTrigger() {
  const { setOpen, open } = useBoardFiltersDrawer();
  const [searchParams] = useSearchParams();
  const activeCount = TRACKED_KEYS.reduce((acc, key) => {
    const value = searchParams.get(key);
    return acc + (value && value.trim() ? 1 : 0);
  }, 0);

  const label = activeCount === 0 ? "Filters" : `Filters · ${activeCount}`;

  return (
    <Button variant="outline" size="sm" aria-label={label} onClick={() => setOpen(!open)}>
      <ListFilter className="h-4 w-4" />
      {label}
    </Button>
  );
}
