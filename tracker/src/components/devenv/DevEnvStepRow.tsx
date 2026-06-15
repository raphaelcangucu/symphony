import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DevEnvReadyProbe, DevEnvStep, DevEnvStepRole } from "@/types/devEnv";

interface DevEnvStepRowProps {
  step: DevEnvStep;
  index: number;
  onChange: (index: number, step: DevEnvStep) => void;
  onRemove: (index: number) => void;
  onRun?: (step: DevEnvStep) => void;
}

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function DevEnvStepRow({ step, index, onChange, onRemove, onRun }: DevEnvStepRowProps) {
  const isServe = step.role === "serve";
  const stepLabel = step.description.trim() || `step ${index + 1}`;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <span className="font-medium">Role</span>
          <select
            aria-label={`Role for ${stepLabel}`}
            className={selectClass}
            value={step.role}
            onChange={(e) => onChange(index, { ...step, role: e.target.value as DevEnvStepRole })}
          >
            <option value="setup">Setup</option>
            <option value="serve">Serve</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`Optional for ${stepLabel}`}
            checked={step.optional}
            onChange={(e) => onChange(index, { ...step, optional: e.target.checked })}
          />
          Optional
        </label>

        {isServe ? (
          <>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                aria-label={`Primary preview for ${stepLabel}`}
                checked={step.primary}
                onChange={(e) => onChange(index, { ...step, primary: e.target.checked })}
              />
              Primary preview
            </label>
            <label className="flex items-center gap-1.5">
              <span className="font-medium">Port env</span>
              <Input
                aria-label={`Port env for ${stepLabel}`}
                className="h-8 w-28"
                value={step.portEnv ?? ""}
                onChange={(e) => onChange(index, { ...step, portEnv: e.target.value.trim() || null })}
                placeholder="PORT"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="font-medium">Ready</span>
              <select
                aria-label={`Ready probe for ${stepLabel}`}
                className={selectClass}
                value={step.readyProbe}
                onChange={(e) => onChange(index, { ...step, readyProbe: e.target.value as DevEnvReadyProbe })}
              >
                <option value="tcp">TCP</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            {step.readyProbe === "http" ? (
              <label className="flex items-center gap-1.5">
                <span className="font-medium">Path</span>
                <Input
                  aria-label={`Ready path for ${stepLabel}`}
                  className="h-8 w-28"
                  value={step.readyPath}
                  onChange={(e) => onChange(index, { ...step, readyPath: e.target.value || "/" })}
                  placeholder="/"
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
