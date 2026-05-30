const LABEL_PALETTE = [
  "border-transparent bg-rose-500/12 text-rose-600 dark:text-rose-300",
  "border-transparent bg-amber-500/12 text-amber-600 dark:text-amber-300",
  "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  "border-transparent bg-sky-500/12 text-sky-600 dark:text-sky-300",
  "border-transparent bg-violet-500/12 text-violet-600 dark:text-violet-300",
  "border-transparent bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300",
  "border-transparent bg-teal-500/12 text-teal-600 dark:text-teal-300",
  "border-transparent bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
] as const;

const DOT_PALETTE = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-teal-500",
  "bg-indigo-500",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function labelChipClass(label: string): string {
  return LABEL_PALETTE[hashString(label) % LABEL_PALETTE.length];
}

export function labelDotClass(label: string): string {
  return DOT_PALETTE[hashString(label) % DOT_PALETTE.length];
}
