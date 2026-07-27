import "./Vision.css";

const PILLARS = [
  {
    index: "01",
    title: "Contexto preservado",
    body: "Cada tarefa carrega seu próprio histórico: decisões tomadas, arquivos tocados e comandos executados. A próxima execução continua de onde a anterior parou, sem reconstruir o problema do zero.",
    accent: "violet",
  },
  {
    index: "02",
    title: "Execução paralela quando útil",
    body: "Tarefas independentes ganham workspaces separados e avançam ao mesmo tempo. Trabalho acoplado permanece em uma única árvore, na ordem em que precisa acontecer.",
    accent: "blue",
  },
  {
    index: "03",
    title: "Prova antes da revisão",
    body: "Nenhuma entrega sai sem manifesto: comandos, status observados e artefatos que qualquer pessoa consegue reabrir. Se não foi executado, não é registrado como concluído.",
    accent: "cyan",
  },
] as const;

export function Vision() {
  return (
    <section className="section vision" id="visao" aria-labelledby="visao-title">
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow">
            <span className="eyebrow__index">01</span> Visão
          </p>
          <h2 className="section-title" id="visao-title">
            Uma plataforma para o trabalho de engenharia que precisa ser verificado.
          </h2>
          <p className="section-head__lead">
            A Dev10x não substitui a sua engenharia: ela organiza a execução em unidades
            rastreáveis, com limites claros entre o que foi pedido, o que foi feito e o que foi
            comprovado.
          </p>
        </div>

        <ul className="vision__grid">
          {PILLARS.map((pillar) => (
            <li className={`vision__card vision__card--${pillar.accent}`} key={pillar.index}>
              <span className="vision__index mono">{pillar.index}</span>
              <h3 className="vision__title">{pillar.title}</h3>
              <p className="vision__body">{pillar.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
