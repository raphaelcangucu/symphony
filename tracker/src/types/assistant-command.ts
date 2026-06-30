export interface AssistantCommand {
  slug: string;
  name: string;
  description: string;
  kind: "builtin" | "skill";
  category: string | null;
  submitKind: "goal" | "infer" | "btw" | "message" | null;
  source: string;
}
