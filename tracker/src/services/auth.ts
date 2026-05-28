import { trackerPath } from "./http";

export async function validateTrackerToken(token: string): Promise<void> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error("tracker token is required");

  const response = await fetch(trackerPath("/projects"), {
    headers: {
      Authorization: `Bearer ${trimmedToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error("invalid tracker token");
  }

  if (!response.ok) {
    throw new Error("unable to validate tracker token");
  }
}
