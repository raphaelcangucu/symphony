export interface ThreadDocument {
  id: string;
  kind: "draft";
  path: string;
  title: string;
  updatedAt: string | null;
}

export interface ThreadDocumentList {
  available: boolean;
  reason: string | null;
  documents: ThreadDocument[];
}
