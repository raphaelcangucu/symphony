import "./Sessions.css";

const MODES = [
  {
    label: "modo conversa",
    title: "Sessão interativa",
    body: "Você abre a tarefa e trabalha junto com o agente: ele lê o repositório, mostra o que encontrou e confirma o escopo antes de tocar em qualquer arquivo. O histórico da decisão fica na tarefa, não no seu terminal.",
  },
  {
    label: "modo delegado",
    title: "Execução pelo orquestrador",
    body: "Com o escopo estável, a tarefa é despachada. O orquestrador cria a branch, instala as dependências, sobe o preview, roda a suíte e coleta a evidência — devolvendo o status que observou, não o que esperava.",
  },
] as const;

const TRANSCRIPT = [
  { kind: "you", who: "você", text: "revisar o hero em viewport mobile" },
  { kind: "agent", who: "agente", text: "hero: título quebra em 390px — ajusto a escala?" },
  { kind: "you", who: "você", text: "ajuste e rode o e2e antes de commitar" },
] as const;

const DISPATCH = [
  { label: "branch", value: "dev10x/DEV-3" },
  { label: "preview", value: "porta reservada · HTTP" },
  { label: "suíte", value: "build + e2e observados" },
  { label: "evidência", value: "manifesto anexado à tarefa" },
] as const;

export function Sessions() {
  return (
    <section className="section sessions" id="sessoes" aria-labelledby="sessoes-title">
      <div className="shell">
        <div className="section-head sessions__head">
          <p className="eyebrow">
            <span className="eyebrow__index">04</span> Sessões
          </p>
          <h2 className="section-title" id="sessoes-title">
            Converse quando o escopo é dúvida. Delegue quando ele é decisão.
          </h2>
          <p className="section-head__lead">
            A mesma tarefa aceita dois modos de trabalho, e a troca entre eles não perde
            contexto.
          </p>
        </div>

        <div className="sessions__layout">
          <div className="sessions__modes">
            {MODES.map((mode) => (
              <article className="sessions__mode" key={mode.title}>
                <p className="sessions__mode-label mono">{mode.label}</p>
                <h3 className="sessions__mode-title">{mode.title}</h3>
                <p className="sessions__mode-body">{mode.body}</p>
              </article>
            ))}
          </div>

          <div className="sessions__panel">
            <div className="sessions__panel-head">
              <span className="mono">sessão · DEV-3</span>
              <span className="sessions__lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>

            <div className="sessions__transcript">
              {TRANSCRIPT.map((line) => (
                <p
                  className={`sessions__line sessions__line--${line.kind} mono`}
                  key={line.text}
                >
                  <span className="sessions__who">
                    <span aria-hidden="true">›</span> {line.who}
                  </span>
                  <span className="sessions__text">{line.text}</span>
                </p>
              ))}
            </div>

            <p className="sessions__divider mono" aria-hidden="true">
              despacho
            </p>

            <dl className="sessions__dispatch">
              {DISPATCH.map((row) => (
                <div className="sessions__row" key={row.label}>
                  <dt className="mono">{row.label}</dt>
                  <dd className="mono">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
