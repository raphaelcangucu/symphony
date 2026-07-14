import { ChevronDown, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SKILL_PROFILES,
  resolveSkillProfile,
  skillProfileMeta,
  type SkillProfileId,
} from "@/lib/skillProfiles";

interface SkillProfileMenuProps {
  selection: SkillProfileId;
  resolvedProfile: Exclude<SkillProfileId, "auto">;
  disabled?: boolean;
  onChange: (profile: SkillProfileId) => void;
}

function humanizeSkillSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function SkillProfileMenu({
  selection,
  resolvedProfile,
  disabled,
  onChange,
}: SkillProfileMenuProps) {
  const { t } = useTranslation();
  const resolved = skillProfileMeta(resolvedProfile);
  const isAuto = selection === "auto";
  const preloadLabels = useMemo(
    () => resolved.preload.map(humanizeSkillSlug),
    [resolved.preload],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            disabled={disabled}
            aria-label={t("assistant.skillProfile.menuAria")}
            title={t(resolved.descKey)}
            data-testid="skill-profile-menu"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("assistant.skillProfile.label")}:</span>
            <span>{t(resolved.labelKey)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {isAuto ? t("assistant.skillProfile.auto.label") : t("assistant.skillProfile.custom")}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t("assistant.skillProfile.menuAria")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={selection}
            onValueChange={(value) => onChange(value as SkillProfileId)}
          >
            {SKILL_PROFILES.map((profile) => (
              <DropdownMenuRadioItem key={profile.id} value={profile.id} className="gap-2">
                <span className="flex flex-col">
                  <span>{t(profile.labelKey)}</span>
                  <span className="text-[11px] text-muted-foreground">{t(profile.descKey)}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {preloadLabels.length > 0 ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-1 px-1 text-[11px] text-muted-foreground"
          data-testid="skill-profile-active-chips"
        >
          <span className="font-medium">{t("assistant.skillProfile.active")}:</span>
          {preloadLabels.map((label) => (
            <span
              key={label}
              className="rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px]"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function resolvedSkillProfileForUi(args: {
  selection: SkillProfileId;
  scope?: string | null;
  mode?: string | null;
}): Exclude<SkillProfileId, "auto"> {
  return resolveSkillProfile({
    selection: args.selection,
    scope: args.scope,
    mode: args.mode,
    runtime: "interactive",
  });
}
