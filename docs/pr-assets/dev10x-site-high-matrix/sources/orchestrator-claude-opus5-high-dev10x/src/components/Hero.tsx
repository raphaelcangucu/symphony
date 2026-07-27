import { RunPanel } from "./RunPanel";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-titulo">
      <div className="hero__grid-backdrop" aria-hidden="true" />

      <div className="container hero__inner">
        <div className="hero__copy">
          <p className="eyebrow">
            <span className="eyebrow__dot" aria-hidden="true" />
            DEV10X · PLATAFORMA DE ENGENHARIA
          </p>

          <h1 id="hero-titulo" className="hero__title">
            Dev10x transforma intenção em{" "}
            <span className="gradient-text">execução de engenharia verificável</span>.
          </h1>

          <p className="hero__lead">
            Cada tarefa entra em um workspace isolado, roda com Codex, Cursor ou Claude,
            sobe um preview endereçável e sai com testes, screenshots, vídeo e trace
            anexados. Mais contexto preservado, execução paralela quando ela paga, prova
            antes da revisão.
          </p>

          <div className="hero__actions">
            <a className="btn btn--primary" href="#comecar">
              Iniciar um projeto
            </a>
            <a className="btn btn--ghost" href="#fluxo">
              Ver o fluxo de execução
              <span className="btn__arrow" aria-hidden="true">
                ↓
              </span>
            </a>
          </div>

          <dl className="hero__stats">
            <div className="hero__stat">
              <dt>Agentes</dt>
              <dd>Codex · Cursor · Claude</dd>
            </div>
            <div className="hero__stat">
              <dt>Isolamento</dt>
              <dd>1 workspace por tarefa</dd>
            </div>
            <div className="hero__stat">
              <dt>Saída</dt>
              <dd>Manifesto de evidência</dd>
            </div>
          </dl>
        </div>

        <RunPanel />
      </div>
    </section>
  );
}
