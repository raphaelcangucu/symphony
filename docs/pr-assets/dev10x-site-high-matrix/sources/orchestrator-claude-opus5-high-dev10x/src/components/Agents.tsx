type AgentCard = {
  readonly name: string;
  readonly accent: "violet" | "blue" | "cyan";
  readonly tagline: string;
  readonly traits: readonly string[];
  readonly fit: string;
  readonly token: string;
};

/**
 * Cards describe each agent's shape of work. They deliberately do not rank the
 * agents: the choice is per task, and the evidence contract is identical.
 */
const AGENTS: readonly AgentCard[] = [
  {
    name: "Codex",
    accent: "violet",
    tagline: "Execução longa dentro de um escopo escrito.",
    traits: [
      "Segue plano e critérios de aceite como contrato",
      "Sustenta iterações longas sem perder o fio da tarefa",
      "Reporta progresso em passos verificáveis",
    ],
    fit: "Encaixa bem em refactors amplos e migrações mecânicas.",
    token: "agent=codex",
  },
  {
    name: "Cursor",
    accent: "blue",
    tagline: "Edição dentro do editor, com o repositório aberto.",
    traits: [
      "Contexto de arquivo e seleção em primeiro plano",
      "Ciclo curto entre ler, editar e rodar",
      "Diff visível enquanto a mudança acontece",
    ],
    fit: "Encaixa bem em ajustes cirúrgicos e exploração de código legado.",
    token: "agent=cursor",
  },
  {
    name: "Claude",
    accent: "cyan",
    tagline: "Sessões conversacionais e decisões de arquitetura.",
    traits: [
      "Explicita o raciocínio antes de mudar código",
      "Sustenta discussões longas de design e trade-off",
      "Coordena mudanças que atravessam vários arquivos",
    ],
    fit: "Encaixa bem em especificação, revisão e trabalho multiarquivo.",
    token: "agent=claude",
  },
];

export function Agents() {
  return (
    <section className="section section--paper" id="agentes" aria-labelledby="agentes-titulo">
      <div className="container">
        <header className="section__head">
          <p className="eyebrow">03 / AGENTES</p>
          <h2 id="agentes-titulo" className="section__title">
            Três agentes, um contrato
          </h2>
          <p className="section__lead">
            Codex, Cursor e Claude entram pelo mesmo fluxo e entregam o mesmo pacote de
            evidência. A escolha é por tarefa e por preferência do time, não por ranking.
          </p>
        </header>

        <ul className="agents">
          {AGENTS.map((agent) => (
            <li className={`agent-card agent-card--${agent.accent}`} key={agent.name}>
              <span className="agent-card__accent" aria-hidden="true" />
              <div className="agent-card__head">
                <h3 className="agent-card__name">{agent.name}</h3>
                <code className="agent-card__token">{agent.token}</code>
              </div>
              <p className="agent-card__tagline">{agent.tagline}</p>
              <ul className="agent-card__traits">
                {agent.traits.map((trait) => (
                  <li key={trait}>{trait}</li>
                ))}
              </ul>
              <p className="agent-card__fit">{agent.fit}</p>
            </li>
          ))}
        </ul>

        <p className="agents__footnote">
          Trocar de agente no meio de um projeto não muda o que a revisão recebe: mesmo
          workspace isolado, mesmo preview, mesmo manifesto.
        </p>
      </div>
    </section>
  );
}
