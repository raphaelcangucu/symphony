import { Link } from "react-router-dom";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Single visual identity for every labeled Workspaces control. */
export const workspaceActionButtonClassName = cn(
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md border border-border/60 bg-background",
  "px-2 text-[11px] font-normal leading-none text-foreground/80",
  "hover:bg-muted/50 hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:pointer-events-none disabled:opacity-50",
);

export const workspaceActionButtonDangerClassName = cn(
  workspaceActionButtonClassName,
  "text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive",
);

/** Icon-only twin (external link, overflow menu). */
export const workspaceIconButtonClassName = cn(
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
  "text-muted-foreground/70",
  "hover:bg-muted/50 hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:pointer-events-none disabled:opacity-50",
);

export const workspaceActionIconProps = {
  className: "h-3 w-3 shrink-0 opacity-70",
  strokeWidth: 1.5,
} as const;

interface WorkspaceActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  danger?: boolean;
  href?: string;
}

export const WorkspaceActionButton = forwardRef<HTMLButtonElement, WorkspaceActionButtonProps>(
  function WorkspaceActionButton(
    { icon, danger = false, href, className, children, type = "button", ...props },
    ref,
  ) {
    const classes = cn(
      danger ? workspaceActionButtonDangerClassName : workspaceActionButtonClassName,
      className,
    );

    if (href) {
      return (
        <Link to={href} className={classes} aria-label={props["aria-label"]}>
          {icon}
          {children}
        </Link>
      );
    }

    return (
      <button ref={ref} type={type} className={classes} {...props}>
        {icon}
        {children}
      </button>
    );
  },
);

interface WorkspaceIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  href?: string;
  label: string;
  children: ReactNode;
}

export const WorkspaceIconButton = forwardRef<HTMLButtonElement, WorkspaceIconButtonProps>(
  function WorkspaceIconButton(
    { href, label, className, children, type = "button", ...props },
    ref,
  ) {
    const classes = cn(workspaceIconButtonClassName, className);

    if (href) {
      return (
        <Link to={href} aria-label={label} title={label} className={classes}>
          {children}
        </Link>
      );
    }

    return (
      <button ref={ref} type={type} aria-label={label} title={label} className={classes} {...props}>
        {children}
      </button>
    );
  },
);
