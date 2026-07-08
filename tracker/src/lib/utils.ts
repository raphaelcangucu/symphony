import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const SCROLLBAR_THIN = [
  "[scrollbar-width:thin]",
  "[scrollbar-color:hsl(var(--muted-foreground)/0.35)_transparent]",
  "[&::-webkit-scrollbar]:w-1.5",
  "[&::-webkit-scrollbar]:h-1.5",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb]:bg-muted-foreground/35",
].join(" ");

export { formatDateTime } from "@/lib/timeFormat";
