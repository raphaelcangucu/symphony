import { createContext, useContext } from "react";

import type { KbDocumentLinkTarget } from "@/lib/kbDocumentLinks";

export interface AssistantKbDocumentLinksValue {
  resolve: (rawReference: string) => KbDocumentLinkTarget | null;
  openDocument: (path: string) => void;
}

const AssistantKbDocumentLinksContext = createContext<AssistantKbDocumentLinksValue | null>(null);

export const AssistantKbDocumentLinksProvider = AssistantKbDocumentLinksContext.Provider;

export function useAssistantKbDocumentLinks(): AssistantKbDocumentLinksValue | null {
  return useContext(AssistantKbDocumentLinksContext);
}
