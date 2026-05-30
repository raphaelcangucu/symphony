export interface ActivityEvent {
  id: string;
  eventType: string;
  metadata: Record<string, unknown>;
  insertedAt: string;
}
