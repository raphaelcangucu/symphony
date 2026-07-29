export type MobileComposerActionId = "plan" | "magic" | "context" | "photo" | "goal";

export const MOBILE_COMPOSER_ACTIONS: ReadonlyArray<{
  id: MobileComposerActionId;
  label: string;
  description: string;
}> = [
  { id: "plan", label: "Plan mode", description: "Plan before making changes" },
  { id: "magic", label: "Magic", description: "Run commands and reusable prompts" },
  {
    id: "context",
    label: "Add context",
    description: "Attach issues, files, and pull requests",
  },
  { id: "photo", label: "Attach photo", description: "Choose a camera or library image" },
  { id: "goal", label: "Set goal", description: "Create or edit the session goal" },
];
