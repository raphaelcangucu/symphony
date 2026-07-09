import { cn } from "@/lib/utils";

/** Shared chrome for the issue session header / working-tree toolbar. */
export const sessionToolbarIconButtonClassName = cn(
  // p-0/gap-0 override Button size="sm" padding so Lucide icons stay h-4 like sibling Links.
  "inline-flex h-7 w-7 shrink-0 items-center justify-center gap-0 p-0 rounded-md text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
);

export const sessionToolbarIconButtonActiveClassName = "bg-accent text-foreground";

export const sessionToolbarChipClassName = cn(
  "inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5",
  "text-[11px] font-medium text-muted-foreground",
);

export const sessionToolbarLabeledButtonClassName = cn(
  "h-7 shrink-0 gap-1 px-2 text-xs",
);
