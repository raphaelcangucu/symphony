import { AGENT_ICONS, AGENT_LABELS, AgentChip } from "@/components/shared/AgentChip";
import type { AgentKind } from "@/types/issue";

export function ProjectAgentSelect({
  value,
  effectiveDefault,
  onChange,
  disabled,
}: {
  value: AgentKind | null;
  effectiveDefault: AgentKind;
  onChange: (kind: AgentKind | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">Coding agent</span>
      <div className="flex flex-wrap gap-1.5">
        <AgentChip
          label={`Inherit (${AGENT_LABELS[effectiveDefault]})`}
          active={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
        />
        {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => {
          const Icon = AGENT_ICONS[kind];
          return (
            <AgentChip
              key={kind}
              label={AGENT_LABELS[kind]}
              icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
              active={value === kind}
              disabled={disabled}
              onClick={() => onChange(kind)}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Inherit follows the user default from Settings; explicit choices write{" "}
        <code>agent.kind</code> into the workflow front matter.
      </p>
    </div>
  );
}
