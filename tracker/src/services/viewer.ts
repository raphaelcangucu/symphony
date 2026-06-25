import axios from "axios";

import { i18n } from "@/i18n";
import { http, trackerPath, unwrapData } from "./http";
import type { Viewer } from "@/types/viewer";

interface BackendViewerDto {
  github_login?: string | null;
  githubLogin?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
}

export class ViewerNotConfiguredError extends Error {
  constructor(
    public code: string,
    public resetAt: string | null = null,
  ) {
    super(code);
    this.name = "ViewerNotConfiguredError";
  }
}

export function normalizeViewer(dto: BackendViewerDto): Viewer {
  const login = dto.githubLogin ?? dto.github_login ?? "";
  if (!login.trim()) {
    throw new Error(i18n.t("auth.viewerErrors.missingLogin"));
  }

  return {
    githubLogin: login,
    name: dto.name ?? null,
    avatarUrl: dto.avatarUrl ?? dto.avatar_url ?? null,
  };
}

const VIEWER_ERROR_CODES = new Set([
  "github_token_missing",
  "github_unauthorized",
  "github_rate_limited",
  "github_network_error",
  "github_malformed_response",
]);

export async function fetchViewer(): Promise<Viewer> {
  try {
    const response = await http.get(trackerPath("/viewer"));
    return normalizeViewer(unwrapData<BackendViewerDto>(response));
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response) {
      const errorBody = (cause.response.data as { error?: { code?: string; reset_at?: string } } | undefined)?.error;
      const code = errorBody?.code;
      if (code && VIEWER_ERROR_CODES.has(code)) {
        throw new ViewerNotConfiguredError(code, errorBody?.reset_at ?? null);
      }
    }

    throw cause;
  }
}
