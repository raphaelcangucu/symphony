type FlowStage = {
  readonly title: string;
  readonly body: string;
  readonly token: string;
};

/** tarefa → agente → workspace isolado → preview → evidência → revisão */
const STAGES: readonly FlowStage[] = [
  {
    title: "Tarefa",
    body: "Escopo, critérios de aceite e repositórios alvo entram como uma unidade rastreável.",
    token: "task: DEV-6",
  },
  {
    title: "Agente",
    body: "Codex, Cursor ou Claude assume a execução com o contexto já montado.",
    token: "agent: claude",
  },
  {
    title: "Workspace isolado",
    body: "Clone dedicado, branch própria e dependências separadas. Nada colide com outra tarefa.",
    token: "ws: dev-6/site",
  },
  {
    title: "Preview",
    body: "Porta reservada e URL endereçável para inspecionar a mudança rodando de verdade.",
    token: "preview: :4173",
  },
  {
    title: "Evidência",
    body: "Build, testes, screenshots, vídeo e trace gravados em um manifesto versionado.",
    token: "manifest.json",
  },
  {
    title: "Revisão",
    body: "O revisor abre a prova ao lado do diff e decide com base no que foi observado.",
    token: "review: ready",
  },
];

export function Flow() {
  return (
    <section className="section section--ink" id="fluxo" aria-labelledby="fluxo-titulo">
      <div className="container">
        <header className="section__head">
          <p className="eyebrow eyebrow--onInk">02 / FLUXO</p>
          <h2 id="fluxo-titulo" className="section__title">
            Fluxo de execução
          </h2>
          <p className="section__lead section__lead--onInk">
            Seis passagens, sempre na mesma ordem. Cada uma deixa um artefato para a
            seguinte, e a última recebe tudo o que foi produzido no caminho.
          </p>
        </header>

        <ol className="flow" aria-label="Etapas do fluxo de execução da Dev10x">
          {STAGES.map((stage, position) => (
            <li className="flow__stage" key={stage.title}>
              <div className="flow__marker" aria-hidden="true">
                <span className="flow__dot" />
              </div>
              <p className="flow__step" aria-hidden="true">
                {String(position + 1).padStart(2, "0")}
              </p>
              <h3 className="flow__title">{stage.title}</h3>
              <p className="flow__body">{stage.body}</p>
              <p className="flow__token">
                <code>{stage.token}</code>
              </p>
            </li>
          ))}
        </ol>

        <p className="flow__footnote">
          Uma tarefa só avança quando a passagem anterior produziu saída. Se o preview não
          sobe ou o teste falha, o run para onde falhou — e não na revisão de alguém.
        </p>
      </div>
    </section>
  );
}
