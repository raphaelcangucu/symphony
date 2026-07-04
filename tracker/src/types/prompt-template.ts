export interface PromptTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
  agentKind: string | null;
  model: string | null;
  effort: string | null;
  mode: string | null;
  scope: string;
  builtIn: boolean;
  enabled: boolean;
  position: number;
  insertedAt: string | null;
  updatedAt: string | null;
}
