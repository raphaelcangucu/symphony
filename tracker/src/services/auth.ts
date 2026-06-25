import { i18n } from "@/i18n";

import { trackerPath } from "./http";

export async function validateTrackerToken(token: string): Promise<void> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error(i18n.t("auth.tokenRequired"));

  const response = await fetch(trackerPath("/projects"), {
    headers: {
      Authorization: `Bearer ${trimmedToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error(i18n.t("auth.invalidToken"));
  }

  if (!response.ok) {
    throw new Error(i18n.t("auth.serverUnreachable"));
  }
}
