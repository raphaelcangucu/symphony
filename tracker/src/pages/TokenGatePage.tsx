import { KeyRound } from "lucide-react";
import type { TFunction } from "i18next";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TRACKER_TOKEN_KEY, clearTrackerToken, getTrackerToken, setTrackerToken } from "@/config";
import { validateTrackerToken } from "@/services/auth";
import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";

const VIEWER_ERROR_CODES = new Set([
  "github_token_missing",
  "github_unauthorized",
  "github_rate_limited",
  "github_network_error",
]);

function viewerErrorMessage(code: string, t: TFunction): string {
  if (VIEWER_ERROR_CODES.has(code)) {
    return t(`auth.viewerErrors.${code}`);
  }
  return t("auth.viewerErrors.default");
}

export function TokenGatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [storedTokenStatus, setStoredTokenStatus] = useState<"checking" | "missing" | "invalid">(() =>
    getTrackerToken() ? "checking" : "missing",
  );

  useEffect(() => {
    const storedToken = getTrackerToken();
    if (!storedToken) {
      setStoredTokenStatus("missing");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await validateTrackerToken(storedToken);
        await fetchViewer();
        if (!cancelled) {
          navigate("/projects", { replace: true });
        }
      } catch {
        if (!cancelled) {
          clearTrackerToken();
          setStoredTokenStatus("invalid");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function completeLogin(value: string) {
    await validateTrackerToken(value);
    setTrackerToken(value);

    try {
      await fetchViewer();
    } catch (cause) {
      if (cause instanceof ViewerNotConfiguredError) {
        clearTrackerToken();
        setError(viewerErrorMessage(cause.code, t));
        return;
      }

      clearTrackerToken();
      setError(t("auth.viewerLoadFailed"));
      return;
    }

    navigate("/projects", { replace: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;

    setError(null);
    setValidating(true);

    try {
      await completeLogin(value);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message || t("auth.invalidToken"));
    } finally {
      setValidating(false);
    }
  }

  if (storedTokenStatus === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.title")}</CardTitle>
            <CardDescription>{t("auth.checkingSaved")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>{t("auth.title")}</CardTitle>
          <CardDescription>{t("auth.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {storedTokenStatus === "invalid" ? (
            <p className="mb-4 text-sm text-muted-foreground">{t("auth.invalidSaved")}</p>
          ) : null}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              placeholder={t("auth.placeholder")}
              type="password"
              autoFocus
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <p className="text-xs text-muted-foreground">
              {t("auth.storedAs", { key: TRACKER_TOKEN_KEY })}
            </p>
            <Button type="submit" className="w-full" disabled={!token.trim() || validating}>
              {validating ? t("auth.validating") : t("auth.continue")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
