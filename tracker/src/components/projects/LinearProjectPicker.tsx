import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { discoverLinearProjects, type LinearProjectSummary } from "@/services/remoteTrackers";

interface LinearProjectPickerProps {
  onSelect: (project: LinearProjectSummary) => void;
}

export function LinearProjectPicker({ onSelect }: LinearProjectPickerProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<LinearProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    discoverLinearProjects()
      .then((items) => active && setProjects(items))
      .catch((cause) =>
        toast.error(cause instanceof Error ? cause.message : t("project.tracker.linear.loadFailed")),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("project.tracker.linear.loading")}</p>;
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">{t("project.tracker.linear.empty")}</p>;

  return (
    <div className="grid gap-2">
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project)}
          className="rounded-md border p-3 text-left transition hover:bg-muted/50"
        >
          <span className="block text-sm font-medium">{project.name}</span>
          <span className="block text-xs text-muted-foreground">{project.team.name}</span>
        </button>
      ))}
    </div>
  );
}
