export interface ActivityEvent {
  id: string;
  issueIdentifier: string;
  type: string;
  actor: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  insertedAt: string;
}
