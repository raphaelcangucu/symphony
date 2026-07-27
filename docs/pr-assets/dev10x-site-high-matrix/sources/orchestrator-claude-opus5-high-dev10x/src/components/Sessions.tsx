type Mode = {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly tone: "light" | "ink";
};

const MODES: readonly Mode[] = [
  {
    kicker: "modo interativo",
    title: "Sessões interativas",
    body: "Você conversa com o agente dentro da tarefa. Perguntas, correções de rumo e decisões ficam no mesmo histórico que a execução vai usar depois.",
    points: [
      "Retomar uma thread sem reconstruir o contexto",
      "Corrigir escopo no meio do caminho, com registro",
      "Acompanhar o preview enquanto a mudança acontece",
    ],
    tone: "light",
  },
  {
    kicker: "modo orquestrado",
    title: "Execução pelo orquestrador",
    body: "O orquestrador despacha a tarefa, provisiona o workspace, acompanha o run e para no gate de evidência. Você entra quando há algo para decidir.",
    points: [
      "Despacho a partir do estado do board",
      "Paralelismo controlado entre tarefas independentes",
      "Handoff bloqueado até a prova existir",
    ],
    tone: "ink",
  },
];

export function Sessions() {
  return (
    <section className="section section--light" id="sessoes" aria-labelledby="sessoes-titulo">
      <div className="container">
        <header className="section__head">
          <p className="eyebrow">04 / SESSÕES</p>
          <h2 id="sessoes-titulo" className="section__title">
            Conversar com o agente ou deixar o orquestrador conduzir
          </h2>
          <p className="section__lead">
            Os dois modos usam o mesmo estado. Uma sessão interativa pode virar um run
            orquestrado, e um run orquestrado pode ser aberto e continuado na conversa.
          </p>
        </header>

        <div className="modes">
          {MODES.map((mode) => (
            <article className={`mode mode--${mode.tone}`} key={mode.title}>
              <p className="mode__kicker">
                <code>{mode.kicker}</code>
              </p>
              <h3 className="mode__title">{mode.title}</h3>
              <p className="mode__body">{mode.body}</p>
              <ul className="mode__points">
                {mode.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
