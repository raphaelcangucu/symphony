import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DevEnvStep } from "@/types/devEnv";

interface DevEnvStepRowProps {
  step: DevEnvStep;
  index: number;
  onChange: (index: number, step: DevEnvStep) => void;
  onRemove: (index: number) => void;
  onRun?: (step: DevEnvStep) => void;
}

export function DevEnvStepRow({ step, index, onChange, onRemove, onRun }: DevEnvStepRowProps) {
  return (
    <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]">
      <Input
        aria-label="Step description"
        value={step.description}
        onChange={(e) => onChange(index, { ...step, description: e.target.value })}
        placeholder="Description"
      />
      <Input
        aria-label="Step command"
        value={step.command}
        onChange={(e) => onChange(index, { ...step, command: e.target.value })}
        placeholder="command"
      />
      <div className="flex items-center gap-2">
        {onRun ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onRun(step)} disabled={!step.id}>
            Run
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
          Remove
        </Button>
      </div>
    </div>
  );
}
