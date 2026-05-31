import { KeyRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TRACKER_TOKEN_KEY, clearTrackerToken, getTrackerToken, setTrackerToken } from "@/config";
import { validateTrackerToken } from "@/services/auth";
import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";

function viewerErrorMessage(code: string): string {
  switch (code) {
    case "github_token_missing":
      return "GITHUB_TOKEN is not configured on the Symphony server. Set it and restart Symphony.";
    case "github_unauthorized":
      return "GitHub rejected the configured GITHUB_TOKEN. Generate a new token with the required scopes.";
    case "github_rate_limited":
      return "GitHub's API rate limit is exhausted. Symphony will recover automatically once the limit resets.";
    case "github_network_error":
      return "Symphony could not reach GitHub. Check the server's connectivity and retry.";
    default:
      return "Symphony could not identify the operator. Check the server configuration.";
  }
}

export function TokenGatePage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  if (getTrackerToken()) {
    return <Navigate to="/projects" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;

    setError(null);
    setValidating(true);

    try {
      await validateTrackerToken(value);
      setTrackerToken(value);

      try {
        await fetchViewer();
      } catch (cause) {
        if (cause instanceof ViewerNotConfiguredError) {
          clearTrackerToken();
          setError(viewerErrorMessage(cause.code));
          return;
        }

        throw cause;
      }

      navigate("/projects", { replace: true });
    } catch {
      setError("Invalid tracker token.");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Connect Local Tracker</CardTitle>
          <CardDescription>Enter the tracker token configured for your Phoenix backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              placeholder="Tracker token"
              type="password"
              autoFocus
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <p className="text-xs text-muted-foreground">Stored locally as <code>{TRACKER_TOKEN_KEY}</code>.</p>
            <Button type="submit" className="w-full" disabled={!token.trim() || validating}>
              {validating ? "Validating..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
