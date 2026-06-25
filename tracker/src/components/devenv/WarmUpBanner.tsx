import { Button } from "@/components/ui/button";

export type WarmUpStatus = "never" | "running" | "succeeded" | "failed";

export interface WarmUpBannerProps {
  status: WarmUpStatus;
  onPrepare: () => void;
  className?: string;
}

export function WarmUpBanner({ status, onPrepare, className }: WarmUpBannerProps) {
  if (status === "succeeded") return null;

  const failed = status === "failed";
  const running = status === "running";

  const message = failed
    ? "O último preparo do ambiente falhou. Tente preparar novamente."
    : "Este projeto ainda não foi preparado. Prepare o ambiente antes de iniciar tarefas.";

  return (
    <div
      role="status"
      className={[
        "flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      <span>{message}</span>
      <Button type="button" size="sm" onClick={onPrepare} disabled={running}>
        {running ? "Preparando…" : "Preparar ambiente"}
      </Button>
    </div>
  );
}
