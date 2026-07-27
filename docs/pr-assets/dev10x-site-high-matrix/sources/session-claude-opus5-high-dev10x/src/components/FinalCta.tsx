import "./FinalCta.css";

const CHECKS = [
  "workspace isolado por tarefa",
  "preview endereçável por HTTP",
  "manifesto de evidência versionado",
] as const;

export function FinalCta() {
  return (
    <section className="cta" id="cta" aria-labelledby="cta-title">
      <div className="shell cta__inner">
        <p className="eyebrow">
          <span className="eyebrow__index">06</span> Começar
        </p>

        <h2 className="cta__title" id="cta-title">
          Traga a próxima tarefa. Devolvemos o código com a{" "}
          <span className="grad-text">prova anexada</span>.
        </h2>

        <p className="cta__lead">
          Comece com um repositório e uma tarefa real. Você acompanha a execução na sessão,
          abre o preview e recebe a evidência antes de revisar o diff.
        </p>

        <div className="cta__actions">
          <a className="btn btn--on-ink" href="mailto:projetos@dev10x.dev">
            Começar um projeto
            <span className="btn__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a className="btn btn--ghost-on-ink" href="#evidencias">
            Rever a evidência
          </a>
        </div>

        <ul className="cta__checks">
          {CHECKS.map((check) => (
            <li className="cta__check mono" key={check}>
              <span className="cta__check-mark" aria-hidden="true">
                ✓
              </span>
              {check}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
