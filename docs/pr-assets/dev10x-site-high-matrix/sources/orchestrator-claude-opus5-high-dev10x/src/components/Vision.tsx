type Pillar = {
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
};

const PILLARS: readonly Pillar[] = [
  {
    index: "01",
    title: "Contexto que sobrevive à tarefa",
    body: "Sessões, tarefas e workspaces ficam ligados ao mesmo histórico. O agente retoma de onde parou em vez de reconstruir o problema a cada rodada.",
    note: "sessão → tarefa → workspace",
  },
  {
    index: "02",
    title: "Paralelismo quando ele paga",
    body: "Tarefas independentes rodam ao mesmo tempo, cada uma no seu clone e na sua branch. Trabalho acoplado continua em série, porque conflito custa mais que espera.",
    note: "isolamento por clone e branch",
  },
  {
    index: "03",
    title: "Prova antes da revisão",
    body: "Nenhuma tarefa chega à revisão sem build, testes, preview e artefatos gravados. A revisão discute decisões, não se o código roda.",
    note: "gate de evidência",
  },
];

export function Vision() {
  return (
    <section className="section section--light" id="visao" aria-labelledby="visao-titulo">
      <div className="container">
        <header className="section__head">
          <p className="eyebrow">01 / VISÃO</p>
          <h2 id="visao-titulo" className="section__title">
            Três decisões que definem o resultado
          </h2>
          <p className="section__lead">
            A Dev10x não trata o agente como um autocomplete grande. Trata como um
            processo de engenharia: com entrada rastreável, ambiente próprio e saída
            auditável.
          </p>
        </header>

        <ul className="pillars">
          {PILLARS.map((pillar) => (
            <li className="pillar" key={pillar.index}>
              <span className="pillar__index" aria-hidden="true">
                {pillar.index}
              </span>
              <h3 className="pillar__title">{pillar.title}</h3>
              <p className="pillar__body">{pillar.body}</p>
              <p className="pillar__note">
                <code>{pillar.note}</code>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
