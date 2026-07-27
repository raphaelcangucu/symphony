import type { ReactNode } from "react";

import "./Agents.css";

type Agent = {
  readonly slot: string;
  readonly name: string;
  readonly accent: "violet" | "blue" | "cyan";
  readonly summary: string;
  readonly shape: string;
  readonly glyph: ReactNode;
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const AGENTS: readonly Agent[] = [
  {
    slot: "agente 01",
    name: "Codex",
    accent: "violet",
    summary:
      "Executa planos longos de ponta a ponta dentro do workspace isolado, com commits incrementais e relatório dos comandos que rodou.",
    shape: "execução em lote · varreduras amplas · trabalho assíncrono",
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path {...stroke} d="M12 8 6 16l6 8" />
        <path {...stroke} d="M20 8l6 8-6 8" />
        <path {...stroke} d="M17.5 10.5 14.5 21.5" />
      </svg>
    ),
  },
  {
    slot: "agente 02",
    name: "Cursor",
    accent: "blue",
    summary:
      "Aproxima a execução do editor: mudanças acompanháveis arquivo por arquivo, com diffs curtos que você revisa enquanto escreve.",
    shape: "iteração no editor · diffs cirúrgicos · pareamento",
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path {...stroke} d="M8 5.5v21" />
        <path {...stroke} d="M13 9.5l9 6.5-9 6.5z" />
        <path {...stroke} d="M25.5 12.5v7" />
      </svg>
    ),
  },
  {
    slot: "agente 03",
    name: "Claude",
    accent: "cyan",
    summary:
      "Conduz sessões interativas com contexto extenso: lê o repositório, questiona o escopo e confirma decisões antes de escrever código.",
    shape: "sessões interativas · leitura ampla · revisão dialogada",
    glyph: (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle {...stroke} cx="16" cy="16" r="4" />
        <path {...stroke} d="M16 4.5a11.5 11.5 0 0 1 0 23" />
        <path {...stroke} d="M16 9.5A6.5 6.5 0 0 0 16 22.5" />
      </svg>
    ),
  },
];

export function Agents() {
  return (
    <section className="section agents" id="agentes" aria-labelledby="agentes-title">
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow">
            <span className="eyebrow__index">03</span> Agentes
          </p>
          <h2 className="section-title" id="agentes-title">
            Três agentes, um mesmo contrato de execução.
          </h2>
          <p className="section-head__lead">
            Você escolhe quem executa; o contrato não muda — workspace isolado, preview real e
            evidência gravada. Cada agente tem um formato de trabalho diferente, e a escolha
            depende da tarefa, não de um ranking.
          </p>
        </div>

        <ul className="agents__grid">
          {AGENTS.map((agent) => (
            <li className={`agents__card agents__card--${agent.accent}`} key={agent.name}>
              <div className="agents__head">
                <span className="agents__glyph" aria-hidden="true">
                  {agent.glyph}
                </span>
                <span className="agents__slot mono">{agent.slot}</span>
              </div>
              <h3 className="agents__name">{agent.name}</h3>
              <p className="agents__summary">{agent.summary}</p>
              <p className="agents__shape mono">{agent.shape}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
