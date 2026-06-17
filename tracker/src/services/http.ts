import axios from "axios";

import { API_PREFIX, TRACKER_TOKEN_KEY, clearTrackerToken, getTrackerToken } from "@/config";
import { getResolvedLocale } from "@/i18n";

export { TRACKER_TOKEN_KEY };

export interface ApiEnvelope<T> {
  data: T;
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
});

http.interceptors.request.use((config) => {
  const token = getTrackerToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["X-Symphony-Locale"] = getResolvedLocale();
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearTrackerToken();
      redirectToTokenGate();
    }

    return Promise.reject(error);
  },
);

function redirectToTokenGate(): void {
  if (typeof window === "undefined") return;

  const configuredBasePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const basePath = configuredBasePath || inferTrackerBasePath(window.location.pathname);
  const tokenPath = `${basePath || ""}/token`;

  if (window.location.pathname !== tokenPath) {
    window.location.assign(tokenPath);
  }
}

function inferTrackerBasePath(pathname: string): string {
  return pathname === "/tracker" || pathname.startsWith("/tracker/") ? "/tracker" : "";
}

export function trackerPath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Tracker API path must start with /: ${path}`);
  }
  return `${API_PREFIX}${path}`;
}

export function unwrapData<T>(response: { data: ApiEnvelope<T> | T }): T {
  const body = response.data;
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as ApiEnvelope<T>).data;
  }
  return body as T;
}
