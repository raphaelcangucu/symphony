export interface AssistantThread {
  id: number;
  scope: string;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
}
