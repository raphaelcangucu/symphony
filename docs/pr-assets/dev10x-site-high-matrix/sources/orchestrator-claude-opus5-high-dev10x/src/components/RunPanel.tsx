type PanelRow = {
  readonly key: string;
  readonly value: string;
};

const RUN_CONTEXT: readonly PanelRow[] = [
  { key: "tarefa", value: "landing page da Dev10x" },
  { key: "agente", value: "claude · sessão interativa" },
  { key: "workspace", value: "ws/dev-6 · isolado" },
  { key: "preview", value: "127.0.0.1:4173 · in_sync" },
];

type RunStep = {
  readonly label: string;
  readonly detail: string;
  readonly state: "ok" | "live";
};

const RUN_STEPS: readonly RunStep[] = [
  { label: "build", detail: "vite · dist gerado", state: "ok" },
  { label: "e2e", detail: "chromium · 1 spec", state: "ok" },
  { label: "artefatos", detail: "screenshot · vídeo · trace", state: "ok" },
  { label: "revisão", detail: "prova anexada ao diff", state: "live" },
];

/**
 * Editorial rendering of a run as the orchestrator reports it: context on top,
 * pipeline below, one line of state at the end. Illustrative, not live data.
 */
export function RunPanel() {
  return (
    <figure className="run-panel">
      <figcaption className="run-panel__bar">
        <span className="run-panel__lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="run-panel__title">dev10x · run DEV-6</span>
        <span className="run-panel__badge">verificado</span>
      </figcaption>

      <div className="run-panel__body">
        <dl className="run-panel__context">
          {RUN_CONTEXT.map((row) => (
            <div className="run-panel__row" key={row.key}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        <hr className="run-panel__rule" />

        <ul className="run-panel__steps">
          {RUN_STEPS.map((step) => (
            <li className={`run-panel__step run-panel__step--${step.state}`} key={step.label}>
              <span className="run-panel__pulse" aria-hidden="true" />
              <span className="run-panel__step-label">{step.label}</span>
              <span className="run-panel__step-detail">{step.detail}</span>
              <span className="run-panel__step-state">
                {step.state === "ok" ? "passou" : "em revisão"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
