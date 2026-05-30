import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const AVATAR_PALETTE = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-teal-500/15 text-teal-600 dark:text-teal-300",
] as const;

const GITHUB_LOGIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initials(login: string): string {
  const cleaned = login.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function githubAvatarUrl(login: string, pixels: number): string | null {
  const handle = login.replace(/^@/, "").trim();
  if (!GITHUB_LOGIN_PATTERN.test(handle)) return null;
  return `https://github.com/${handle}.png?size=${pixels}`;
}

interface AssigneeAvatarProps {
  login: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function AssigneeAvatar({ login, size = "sm", className }: AssigneeAvatarProps) {
  const dimension = size === "md" ? "h-7 w-7 text-[11px]" : "h-5 w-5 text-[9px]";
  const pixels = size === "md" ? 56 : 40;
  const avatarUrl = login ? githubAvatarUrl(login, pixels) : null;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  if (!login) {
    return (
      <span
        title="Unassigned"
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground",
          dimension,
          className,
        )}
      >
        ?
      </span>
    );
  }

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt={login}
        title={login}
        loading="lazy"
        onError={() => setImageFailed(true)}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-border/60", dimension, className)}
      />
    );
  }

  const palette = AVATAR_PALETTE[hashString(login) % AVATAR_PALETTE.length];

  return (
    <span
      title={login}
      className={cn("inline-flex items-center justify-center rounded-full font-semibold", dimension, palette, className)}
    >
      {initials(login)}
    </span>
  );
}
