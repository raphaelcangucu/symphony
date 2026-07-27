export function FinalCta() {
  return (
    <section className="cta" id="comecar" aria-labelledby="comecar-titulo">
      <div className="cta__glow" aria-hidden="true" />
      <div className="container cta__inner">
        <p className="eyebrow eyebrow--onInk">COMEÇAR</p>
        <h2 id="comecar-titulo" className="cta__title">
          Traga uma tarefa. Devolvemos <span className="gradient-text">com a prova</span>.
        </h2>
        <p className="cta__lead">
          Escolha um repositório, escreva o escopo e deixe o run acontecer. Você recebe o
          preview para olhar, o manifesto para conferir e o diff para revisar.
        </p>

        <div className="cta__actions">
          <a className="btn btn--primary btn--large" href="#conteudo">
            Iniciar um projeto na Dev10x
          </a>
          <a className="btn btn--onInk btn--large" href="#evidencias">
            Ver as evidências
          </a>
        </div>

        <p className="cta__meta">
          <code>dev10x run --agent codex|cursor|claude --evidence</code>
        </p>
      </div>
    </section>
  );
}
