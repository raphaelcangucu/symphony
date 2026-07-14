export const SKILL_PROFILE_IDS = [
  "auto",
  "planning",
  "implementation",
  "debugging",
  "delivery",
  "explore",
] as const;

export type SkillProfileId = (typeof SKILL_PROFILE_IDS)[number];

export interface SkillProfileMeta {
  id: SkillProfileId;
  labelKey: string;
  descKey: string;
  preload: string[];
  visible: string[];
}

const LEGACY_ALIASES: Record<string, SkillProfileId> = {
  authoring: "planning",
  execution: "implementation",
};

export const SKILL_PROFILES: SkillProfileMeta[] = [
  {
    id: "auto",
    labelKey: "assistant.skillProfile.auto.label",
    descKey: "assistant.skillProfile.auto.desc",
    preload: [],
    visible: [],
  },
  {
    id: "planning",
    labelKey: "assistant.skillProfile.planning.label",
    descKey: "assistant.skillProfile.planning.desc",
    preload: ["brainstorming", "writing-plans"],
    visible: ["brainstorming", "writing-plans", "using-superpowers", "writing-skills"],
  },
  {
    id: "implementation",
    labelKey: "assistant.skillProfile.implementation.label",
    descKey: "assistant.skillProfile.implementation.desc",
    preload: ["test-driven-development", "verification-before-completion"],
    visible: [
      "test-driven-development",
      "verification-before-completion",
      "systematic-debugging",
      "requesting-code-review",
    ],
  },
  {
    id: "debugging",
    labelKey: "assistant.skillProfile.debugging.label",
    descKey: "assistant.skillProfile.debugging.desc",
    preload: ["systematic-debugging", "verification-before-completion"],
    visible: ["systematic-debugging", "verification-before-completion", "test-driven-development"],
  },
  {
    id: "delivery",
    labelKey: "assistant.skillProfile.delivery.label",
    descKey: "assistant.skillProfile.delivery.desc",
    preload: ["requesting-code-review", "verification-before-completion"],
    visible: [
      "requesting-code-review",
      "verification-before-completion",
      "finishing-a-development-branch",
    ],
  },
  {
    id: "explore",
    labelKey: "assistant.skillProfile.explore.label",
    descKey: "assistant.skillProfile.explore.desc",
    preload: [],
    visible: ["using-superpowers"],
  },
];

export function isSkillProfileId(value: string | null | undefined): value is SkillProfileId {
  return typeof value === "string" && (SKILL_PROFILE_IDS as readonly string[]).includes(value);
}

export function normalizeSkillProfileId(
  value: string | null | undefined,
  fallback: SkillProfileId = "auto",
): SkillProfileId {
  if (!value) return fallback;
  const lowered = value.trim().toLowerCase();
  if (isSkillProfileId(lowered)) return lowered;
  const aliased = LEGACY_ALIASES[lowered];
  return aliased ?? fallback;
}

export function skillProfileMeta(id: SkillProfileId): SkillProfileMeta {
  return SKILL_PROFILES.find((profile) => profile.id === id) ?? SKILL_PROFILES[0];
}

export function resolveAutoSkillProfile(args: {
  scope?: string | null;
  mode?: string | null;
  runtime?: "interactive" | "autonomous";
}): Exclude<SkillProfileId, "auto"> {
  if (args.runtime === "autonomous") return "implementation";
  if (args.scope === "project_explore") return "explore";
  if (args.mode === "plan") return "planning";
  if (args.mode === "build" || args.mode === "yolo") return "implementation";
  return "planning";
}

export function resolveSkillProfile(args: {
  selection: SkillProfileId;
  scope?: string | null;
  mode?: string | null;
  runtime?: "interactive" | "autonomous";
}): Exclude<SkillProfileId, "auto"> {
  if (args.selection === "auto") return resolveAutoSkillProfile(args);
  return args.selection;
}
