export type TrackerBranding = {
  productName: string;
  trackerTitle: string;
  iconPath: string;
  faviconPath: string;
  logoColorPath: string;
  logoBlackPath: string;
  logoWhitePath: string;
};

const DEFAULT_BRANDING: TrackerBranding = {
  productName: "Dev10x",
  trackerTitle: "Dev10x",
  iconPath: "dev10x_icon.png",
  faviconPath: "favicon.png",
  logoColorPath: "dev10x_logo_color.png",
  logoBlackPath: "dev10x_logo_black.png",
  logoWhitePath: "dev10x_logo_white.png",
};

declare global {
  interface Window {
    __SYMPHONY_BRANDING__?: Partial<TrackerBranding>;
  }
}

function readInjectedBranding(): Partial<TrackerBranding> {
  if (typeof window === "undefined") {
    return {};
  }

  const injected = window.__SYMPHONY_BRANDING__;
  if (injected == null || typeof injected !== "object") {
    return {};
  }

  return injected;
}

function nonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

export function getTrackerBranding(): TrackerBranding {
  const injected = readInjectedBranding();

  return {
    productName: nonEmptyString(injected.productName, DEFAULT_BRANDING.productName),
    trackerTitle: nonEmptyString(injected.trackerTitle, DEFAULT_BRANDING.trackerTitle),
    iconPath: nonEmptyString(injected.iconPath, DEFAULT_BRANDING.iconPath),
    faviconPath: nonEmptyString(injected.faviconPath, DEFAULT_BRANDING.faviconPath),
    logoColorPath: nonEmptyString(injected.logoColorPath, DEFAULT_BRANDING.logoColorPath),
    logoBlackPath: nonEmptyString(injected.logoBlackPath, DEFAULT_BRANDING.logoBlackPath),
    logoWhitePath: nonEmptyString(injected.logoWhitePath, DEFAULT_BRANDING.logoWhitePath),
  };
}

export function applyTrackerDocumentBranding(branding: TrackerBranding = getTrackerBranding()): void {
  if (typeof document === "undefined") {
    return;
  }

  document.title = branding.trackerTitle;

  const iconHref = resolveTrackerAssetPath(import.meta.env.BASE_URL, branding.faviconPath);
  const existing =
    document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
    document.querySelector<HTMLLinkElement>("link[rel='shortcut icon']");

  if (existing) {
    existing.href = iconHref;
    return;
  }

  const link = document.createElement("link");
  link.rel = "icon";
  link.href = iconHref;
  document.head.appendChild(link);
}

export function resolveTrackerAssetPath(baseUrl: string, assetName: string): string {
  if (typeof assetName !== "string" || assetName.trim().length === 0) {
    throw new Error("Tracker asset name must not be empty");
  }

  const normalizedAssetName = assetName.replace(/^\/+/, "");
  if (normalizedAssetName.length === 0) {
    throw new Error("Tracker asset name must not be empty");
  }

  if (normalizedAssetName.includes("..") || normalizedAssetName.includes("\\")) {
    throw new Error(`Unsafe tracker asset name: ${assetName}`);
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}${normalizedAssetName}`;
}
