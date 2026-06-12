import { useEffect, useMemo, useState } from "react";

import { useViewer } from "@/components/auth/ViewerProvider";
import { fetchIdentities } from "@/services/settings";

/**
 * The set of values that identify the current operator across providers, used to
 * resolve the "me" / "Assigned to me" filter token. Combines the GitHub viewer
 * (login + name) with every connected provider identity (match value, login,
 * name) — so "me" works on a Jira board (display name) as well as GitHub.
 */
export function useMeIdentities(): string[] {
  const { viewer } = useViewer();
  const [identityValues, setIdentityValues] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentities()
      .then((identities) => {
        if (cancelled) return;
        const values: string[] = [];
        for (const status of identities) {
          if (!status.connected || !status.identity) continue;
          for (const value of [status.identity.match_value, status.identity.login, status.identity.name]) {
            if (value) values.push(value);
          }
        }
        setIdentityValues(values);
      })
      .catch(() => {
        // Identities are best-effort; "me" still resolves against the GitHub viewer.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const all = [...identityValues];
    if (viewer?.githubLogin) all.push(viewer.githubLogin);
    if (viewer?.name) all.push(viewer.name);
    return Array.from(new Set(all.map((value) => value.trim()).filter(Boolean)));
  }, [identityValues, viewer]);
}
