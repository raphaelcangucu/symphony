import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DevEnvStepRow } from "@/components/devenv/DevEnvStepRow";
import { listDevEnvSteps, proposeDevEnvSteps, runDevEnvStep, saveDevEnvSteps } from "@/services/devEnv";
import type { DevEnvStep } from "@/types/devEnv";

interface DevEnvPanelProps {
  projectSlug: string;
}

const EMPTY_STEP: DevEnvStep = { description: "", command: "", workingDir: null, source: "manual", optional: false };

export function DevEnvPanel({ projectSlug }: DevEnvPanelProps) {
  const [steps, setSteps] = useState<DevEnvStep[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listDevEnvSteps(projectSlug)
      .then((loaded) => active && setSteps(loaded))
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load steps"));
    return () => {
      active = false;
    };
  }, [projectSlug]);

  const handleChange = useCallback((index: number, step: DevEnvStep) => {
    setSteps((current) => current.map((existing, i) => (i === index ? step : existing)));
  }, []);

  const handleRemove = useCallback((index: number) => {
    setSteps((current) => current.filter((_, i) => i !== index));
  }, []);

  async function handlePropose() {
    setBusy(true);
    try {
      const proposed = await proposeDevEnvSteps(projectSlug);
      if (proposed.length === 0) {
        toast.info("No steps proposed; add steps manually or a .symphony/devenv.yaml");
      }
      setSteps((current) => [...current, ...proposed]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to propose steps");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      const saved = await saveDevEnvSteps(projectSlug, steps);
      setSteps(saved);
      toast.success("Dev-env steps saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to save steps");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunStep(step: DevEnvStep) {
    if (!step.id) return;
    try {
      await runDevEnvStep(projectSlug, step.id);
      toast.success(`Running: ${step.command}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to run step");
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Dev environment</h2>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={handlePropose} disabled={busy}>
            Propose steps
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
            Save steps
          </Button>
        </div>
      </header>

      <div className="space-y-2">
        {steps.map((step, index) => (
          <DevEnvStepRow
            key={step.id ?? `new-${index}`}
            step={step}
            index={index}
            onChange={handleChange}
            onRemove={handleRemove}
            onRun={handleRunStep}
          />
        ))}
      </div>

      <Button type="button" size="sm" variant="ghost" onClick={() => setSteps((c) => [...c, { ...EMPTY_STEP }])}>
        Add step
      </Button>
    </section>
  );
}
