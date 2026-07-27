import "./Hero.css";

type TelemetryLine = {
  readonly state: "done" | "active" | "pending";
  readonly label: string;
  readonly meta: string;
};

const TELEMETRY: readonly TelemetryLine[] = [
  { state: "done", label: "tarefa aceita", meta: "escopo + critérios" },
  { state: "done", label: "workspace isolado", meta: "branch dedicada" },
  { state: "active", label: "agente em execução", meta: "codex · sessão viva" },
  { state: "pending", label: "preview servido", meta: "porta reservada" },
  { state: "pending", label: "evidência gravada", meta: "6 artefatos" },
];

const MARKERS = [
  { value: "Contexto", detail: "preservado entre execuções" },
  { value: "Paralelo", detail: "quando as tarefas são independentes" },
  { value: "Prova", detail: "anexada antes da revisão" },
] as const;

export function Hero() {
  return (
    <section className="hero" id="hero" aria-label="Dev10x">
      <div className="hero__grid shell">
        <div className="hero__copy">
          <p className="eyebrow">
            DEV10X <span className="hero__eyebrow-sep">/</span> plataforma de engenharia
          </p>

          <h1 className="hero__title">
            Dev10x transforma intenção em{" "}
            <span className="grad-text">execução de engenharia verificável</span>.
          </h1>

          <p className="hero__lead">
            A Dev10x recebe a tarefa, escolhe o agente, abre um workspace isolado e sobe um
            preview real. No final da execução, testes, screenshots, vídeo e trace já estão
            anexados — a revisão começa com a prova em mãos.
          </p>

          <div className="hero__actions">
            <a className="btn btn--primary" href="#cta">
              Iniciar um projeto
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </a>
            <a className="btn btn--secondary" href="#fluxo">
              Ver o fluxo de execução
            </a>
          </div>

          <p className="hero__command mono">
            <span className="hero__prompt" aria-hidden="true">
              dev10x&nbsp;›
            </span>
            run DEV-3 --agent codex --workspace isolado --evidence on
          </p>
        </div>

        <div className="hero__panel">
          <div className="hero__panel-head">
            <span className="mono hero__panel-id">DEV-3 · landing dev10x</span>
            <span className="hero__badge mono">em execução</span>
          </div>

          <ol className="hero__telemetry">
            {TELEMETRY.map((line) => (
              <li
                key={line.label}
                className={`hero__line hero__line--${line.state}`}
                aria-current={line.state === "active" ? "step" : undefined}
              >
                <span className="hero__dot" aria-hidden="true" />
                <span className="hero__line-label">{line.label}</span>
                <span className="hero__line-meta mono">{line.meta}</span>
              </li>
            ))}
          </ol>

          <p className="hero__panel-foot mono">
            manifesto: build · e2e · screenshots · vídeo · trace
          </p>
        </div>
      </div>

      <div className="hero__markers shell">
        {MARKERS.map((marker) => (
          <div className="hero__marker" key={marker.value}>
            <p className="hero__marker-value">{marker.value}</p>
            <p className="hero__marker-detail">{marker.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
