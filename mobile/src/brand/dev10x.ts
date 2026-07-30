export const APP_BRAND = "Dev10x" as const;
export const HOST_RUNTIME_NAME = "Symphony" as const;
export const APP_TAGLINE = "Your development workspace, anywhere." as const;

export function hostLabel(name: string): string {
  return name.trim() ? `${name.trim()} · Symphony host` : "Symphony host";
}
