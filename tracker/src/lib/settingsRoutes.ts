export const SETTINGS_PATH = "/settings";

export function settingsPath(): string {
  return SETTINGS_PATH;
}

export function settingsTemplatesPath(slug?: string): string {
  const base = `${SETTINGS_PATH}/templates`;
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

export function settingsBackupsPath(): string {
  return `${SETTINGS_PATH}/backups`;
}

export function settingsGatewaysPath(): string {
  return `${SETTINGS_PATH}/gateways`;
}

export function settingsLabPath(): string {
  return `${SETTINGS_PATH}/lab`;
}
