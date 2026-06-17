import { Socket } from "phoenix";

import { SOCKET_PATH, getTrackerToken } from "@/config";
import { getResolvedLocale } from "@/i18n";

export function createTrackerSocket(): Socket {
  const token = getTrackerToken();
  const params: Record<string, string> = { locale: getResolvedLocale() };
  if (token) params.token = token;
  return new Socket(SOCKET_PATH, { params });
}
