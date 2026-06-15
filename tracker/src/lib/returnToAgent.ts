export type ReturnToAgentTemplate = "evidence" | "fix" | "review_feedback" | "custom";

export interface ReturnToAgentHandoff {
  projectSlug: string;
  issueIdentifier: string;
  template: ReturnToAgentTemplate;
  createdAt: number;
}

const STORAGE_KEY = "symphony:return-to-agent-handoff";

export function returnToAgentTemplateLabel(template: ReturnToAgentTemplate): string {
  switch (template) {
    case "evidence":
      return "Completar evidências";
    case "fix":
      return "Corrigir implementação";
    case "review_feedback":
      return "Responder review do PR";
    default:
      return "Outro";
  }
}

export function returnToAgentTemplateText(template: ReturnToAgentTemplate): string {
  switch (template) {
    case "evidence":
      return [
        "Implementação e PR já estão prontos. Não altere código salvo instrução explícita.",
        "",
        "Execute apenas a etapa VALIDATE:",
        "1. Siga o skill `evidence`",
        "2. Suba Docker se necessário (`./vibe shared up`, `./vibe up`)",
        "3. Rode os testes aplicáveis ao diff",
        "4. Se tocou UI, rode Playwright com screenshot + vídeo",
        "5. Escreva `.symphony/evidence/manifest.json` na raiz do workspace Symphony (não dentro do clone git) com `\"repo\": \"advising\"` (ou o repo do projeto)",
        "6. Atualize o workpad na seção Validation",
        "7. Não mova o card para revisão — evidência apenas",
      ].join("\n");
    case "fix":
      return [
        "A implementação precisa de ajustes antes do handoff.",
        "",
        "Prioridade:",
        "1. Leia o feedback humano/comentários do PR",
        "2. Corrija o código, commits, push e PR",
        "3. Rode testes direcionados para o que mudou",
        "4. Só então execute VALIDATE/evidence se o handoff estiver pronto",
      ].join("\n");
    case "review_feedback":
      return [
        "Há feedback de review/CI no PR que precisa ser endereçado.",
        "",
        "Prioridade:",
        "1. Leia comentários de review e checks falhos",
        "2. Corrija apenas o necessário para o PR ficar verde",
        "3. Atualize o workpad com o que foi feito",
        "4. Execute VALIDATE/evidence quando o PR estiver pronto de novo",
      ].join("\n");
    default:
      return "";
  }
}

export function stashReturnToAgentHandoff(handoff: Omit<ReturnToAgentHandoff, "createdAt">): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...handoff,
      createdAt: Date.now(),
    } satisfies ReturnToAgentHandoff),
  );
}

export function consumeReturnToAgentHandoff(
  projectSlug: string,
  issueIdentifier: string,
): ReturnToAgentHandoff | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ReturnToAgentHandoff;
    if (parsed.projectSlug !== projectSlug || parsed.issueIdentifier !== issueIdentifier) {
      return null;
    }

    sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
