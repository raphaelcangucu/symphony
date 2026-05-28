import { Socket } from "phoenix";

import { SOCKET_PATH, getTrackerToken } from "@/config";

export function createTrackerSocket(): Socket {
  const token = getTrackerToken();
  return new Socket(SOCKET_PATH, {
    params: token ? { token } : {},
  });
}
