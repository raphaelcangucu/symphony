export const SETTINGS_PATH = "/settings";

export function settingsPath(): string {
  return SETTINGS_PATH;
}

export function settingsAppearancePath(): string {
  return `${SETTINGS_PATH}/appearance`;
}

export function settingsKeybindingsPath(): string {
  return `${SETTINGS_PATH}/keybindings`;
}

export function settingsAgentPath(agent: string): string {
  return `${SETTINGS_PATH}/agents/${encodeURIComponent(agent)}`;
}

export function settingsToolPath(tool: string): string {
  return `${SETTINGS_PATH}/tools/${encodeURIComponent(tool)}`;
}

export function settingsProvidersPath(): string {
  return `${SETTINGS_PATH}/providers`;
}

export function settingsWebAccessPath(): string {
  return `${SETTINGS_PATH}/web-access`;
}

export function settingsMcpPath(): string {
  return `${SETTINGS_PATH}/mcp`;
}

export function settingsIntegrationsPath(): string {
  return `${SETTINGS_PATH}/integrations`;
}

export function settingsUsagePath(): string {
  return `${SETTINGS_PATH}/usage`;
}

export function settingsExperimentalPath(): string {
  return `${SETTINGS_PATH}/experimental`;
}

export function settingsTemplatesPath(slug?: string): string {
  const base = `${SETTINGS_PATH}/templates`;
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

export function settingsBackupsPath(): string {
  return `${SETTINGS_PATH}/backups`;
}

export function settingsDockerPath(): string {
  return `${SETTINGS_PATH}/docker`;
}

export function settingsGatewaysPath(): string {
  return `${SETTINGS_PATH}/gateways`;
}

export function settingsLabPath(): string {
  return `${SETTINGS_PATH}/lab`;
}
