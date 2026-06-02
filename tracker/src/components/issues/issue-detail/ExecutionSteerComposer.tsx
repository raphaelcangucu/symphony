import { type FormEvent, type KeyboardEvent, useState } from "react";

import { parseSlashCommand } from "@/components/assistant/slashCommands";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ExecutionSteerComposerProps {
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  onSteer: (message: string) => void;
}

export function ExecutionSteerComposer({
  disabled = false,
  pending = false,
  error = null,
  onSteer,
}: ExecutionSteerComposerProps) {
  const [input, setInput] = useState("");

  function submitCurrent() {
    const parsed = parseSlashCommand(input);
    if (parsed.kind !== "infer" || !parsed.argument.trim()) return;
    onSteer(parsed.argument);
    setInput("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitCurrent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitCurrent();
  }

  return (
    <section className="rounded-xl border p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Steer agent</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Send mid-turn guidance with <span className="font-mono">/infer your message</span>.
      </p>
      <form className="mt-3 space-y-2" onSubmit={handleSubmit}>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="/infer focus on the failing test first"
          disabled={disabled || pending}
          rows={2}
          className="min-h-0 resize-none text-sm"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{pending ? "Sending steer…" : "Enter to send"}</span>
          <Button type="submit" size="sm" disabled={disabled || pending || !input.trim()}>
            Steer
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{formatSteerError(error)}</p> : null}
      </form>
    </section>
  );
}

function formatSteerError(reason: string): string {
  if (reason === "ActiveTurnNotSteerable") {
    return "No steerable agent turn is running for this issue right now.";
  }
  if (reason === "orchestrator_unavailable") {
    return "The orchestrator is unavailable; try again in a moment.";
  }
  return reason;
}
