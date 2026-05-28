import { KeyRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TRACKER_TOKEN_KEY, getTrackerToken, setTrackerToken } from "@/config";

export function TokenGatePage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");

  if (getTrackerToken()) {
    return <Navigate to="/projects" replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    setTrackerToken(value);
    navigate("/projects", { replace: true });
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
              onChange={(event) => setToken(event.target.value)}
              placeholder="Tracker token"
              type="password"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Stored locally as <code>{TRACKER_TOKEN_KEY}</code>.</p>
            <Button type="submit" className="w-full" disabled={!token.trim()}>
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
