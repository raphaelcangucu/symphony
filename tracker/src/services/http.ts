import axios from "axios";

import { API_PREFIX, TRACKER_TOKEN_KEY, getTrackerToken } from "@/config";

export { TRACKER_TOKEN_KEY };

export interface ApiEnvelope<T> {
  data: T;
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
});

http.interceptors.request.use((config) => {
  const token = getTrackerToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
