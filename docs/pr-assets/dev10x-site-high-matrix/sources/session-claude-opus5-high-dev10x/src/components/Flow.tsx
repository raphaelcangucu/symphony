import "./Flow.css";

const STEPS = [
  {
    index: "01",
    title: "Tarefa",
    body: "Escopo, critérios de aceite e repositório entram como uma tarefa rastreável no board.",
  },
  {
    index: "02",
    title: "Agente",
    body: "A tarefa é atribuída a Codex, Cursor ou Claude conforme o formato do trabalho.",
  },
  {
    index: "03",
    title: "Workspace isolado",
    body: "Clone dedicado, branch própria e dependências instaladas longe da sua árvore de trabalho.",
  },
  {
    index: "04",
    title: "Preview",
    body: "A aplicação sobe em porta reservada e recebe uma URL endereçável por HTTP.",
  },
  {
    index: "05",
    title: "Evidência",
    body: "Build, testes, screenshots, vídeo e trace são gravados em um manifesto versionado.",
  },
  {
    index: "06",
    title: "Revisão",
    body: "O diff chega junto da prova. A conversa é sobre decisões, não sobre suposições.",
  },
] as const;

export function Flow() {
  return (
    <section
      className="section section--ink flow"
      id="fluxo"
      aria-labelledby="fluxo-title"
    >
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow">
            <span className="eyebrow__index">02</span> Fluxo
          </p>
          <h2 className="section-title" id="fluxo-title">
            O caminho de uma tarefa, do pedido à revisão.
          </h2>
          <p className="section-head__lead">
            Seis etapas, sempre na mesma ordem e sempre observáveis. Você acompanha em qual
            delas cada tarefa está — e o que ela já produziu.
          </p>
        </div>

        <ol className="flow__list">
          {STEPS.map((step) => (
            <li className="flow__step" key={step.index}>
              <span className="flow__node" aria-hidden="true">
                <span className="flow__node-index mono">{step.index}</span>
              </span>
              <div className="flow__content">
                <h3 className="flow__title">{step.title}</h3>
                <p className="flow__body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="flow__trace mono">
          tarefa → agente → workspace isolado → preview → evidência → revisão
        </p>
      </div>
    </section>
  );
}
