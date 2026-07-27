import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

const FLOW_STEPS = [
  { id: "tarefa", label: "Tarefa", detail: "Intenção clara e critérios de aceite." },
  { id: "agente", label: "Agente", detail: "Codex, Cursor ou Claude no contexto certo." },
  { id: "workspace", label: "Workspace isolado", detail: "Árvore dedicada, sem cruzar estados." },
  { id: "preview", label: "Preview", detail: "Ambiente vivo para inspecionar o resultado." },
  { id: "evidencia", label: "Evidência", detail: "Testes, screenshots, vídeo e trace." },
  { id: "revisao", label: "Revisão", detail: "Decisão com prova anexada, não com promessa." },
] as const;

const AGENTS = [
  {
    name: "Codex",
    role: "Execução focada em implementação",
    copy: "Bom quando a tarefa pede mudanças concretas no código e um ciclo curto de verificação.",
  },
  {
    name: "Cursor",
    role: "Sessão interativa no editor",
    copy: "Útil para explorar o repositório, ajustar o plano e seguir o trabalho com contexto preservado.",
  },
  {
    name: "Claude",
    role: "Análise e escrita de engenharia",
    copy: "Encaixa em revisões profundas, specs e decisões que precisam de raciocínio estruturado.",
  },
] as const;

const EVIDENCE_ITEMS = [
  {
    label: "Testes",
    detail: "Comandos reais, com status observados — não checklists inventados.",
  },
  {
    label: "Screenshots",
    detail: "Desktop e mobile da superfície que mudou, full-page.",
  },
  {
    label: "Vídeo",
    detail: "Gravação do fluxo no navegador, com cópia H.264 para revisão rápida.",
  },
  {
    label: "Trace",
    detail: "Linha do tempo Playwright para reabrir cada passo da prova.",
  },
] as const;

export default function App() {
  return (
    <div className="page">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#topo" aria-label="Dev10x — início">
            <img
              src="/dev10x/dev10x_logo_color.png"
              alt="Dev10x"
              width={140}
              height={36}
              className="brand__logo"
            />
          </a>
          <nav className="nav" aria-label="Principal">
            <a href="#visao">Visão</a>
            <a href="#fluxo">Fluxo</a>
            <a href="#agentes">Agentes</a>
            <a href="#evidencias">Evidências</a>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="hero" id="topo" aria-labelledby="hero-heading">
          <div className="hero__atmosphere" aria-hidden="true">
            <div className="hero__grid" />
            <div className="hero__glow hero__glow--violet" />
            <div className="hero__glow hero__glow--cyan" />
            <svg className="hero__signal" viewBox="0 0 1200 240" preserveAspectRatio="none">
              <path
                className="hero__signal-path"
                d="M0 160 C180 40 320 200 480 120 S780 40 960 140 1140 80 1200 100"
              />
              <circle className="hero__signal-node" cx="180" cy="88" r="5" />
              <circle className="hero__signal-node" cx="480" cy="120" r="5" />
              <circle className="hero__signal-node" cx="780" cy="68" r="5" />
              <circle className="hero__signal-node" cx="1080" cy="108" r="5" />
            </svg>
          </div>

          <div className="hero__content">
            <p className="eyebrow">
              <span className="mono">DEV10X</span>
              <span aria-hidden="true"> · </span>
              plataforma de engenharia
            </p>
            <h1 id="hero-heading">Engenharia verificável, do pedido à prova</h1>
            <p className="hero__lede">
              Dev10x orquestra agentes, sessões, workspaces e previews para
              preservar contexto, paralelizar quando faz sentido e entregar
              evidência antes da revisão.
            </p>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#cta-final">
                Iniciar um projeto
              </a>
              <a className="btn btn--ghost" href="#fluxo">
                Ver o fluxo
              </a>
            </div>
          </div>
        </section>

        <section className="section section--vision" id="visao" aria-labelledby="visao-heading">
          <div className="section__inner">
            <p className="section__label mono">01 — visão</p>
            <h2 id="visao-heading">Da intenção à prova, sem perder o fio</h2>
            <p className="section__lede">
              Cada tarefa carrega o contexto necessário. O orquestrador decide
              quando abrir uma sessão interativa e quando disparar execução
              autônoma — com workspace isolado e preview anexado ao resultado.
            </p>

            <div className="vision-split">
              <article className="vision-block">
                <h3>Sessões interativas</h3>
                <p>
                  Converse com o agente no editor, refine o plano e mantenha o
                  histórico da decisão. Ideal quando o problema ainda precisa de
                  exploração humana.
                </p>
              </article>
              <article className="vision-block">
                <h3>Execução pelo orquestrador</h3>
                <p>
                  Dispare o trabalho com critérios claros. O orquestrador
                  provisiona o ambiente, acompanha o agente e só avança quando
                  houver evidência suficiente para revisão.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section section--flow" id="fluxo" aria-labelledby="fluxo-heading">
          <div className="section__inner">
            <p className="section__label mono">02 — fluxo</p>
            <h2 id="fluxo-heading">O fluxo completo, em uma linha de execução</h2>
            <p className="section__lede">
              Tarefa → agente → workspace isolado → preview → evidência →
              revisão. Cada etapa deixa um rastro legível.
            </p>

            <ol className="flow-track">
              {FLOW_STEPS.map((step, index) => (
                <li className="flow-step" key={step.id}>
                  <span className="flow-step__index mono" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section section--agents" id="agentes" aria-labelledby="agentes-heading">
          <div className="section__inner">
            <p className="section__label mono">03 — agentes</p>
            <h2 id="agentes-heading">Três agentes, um contrato de prova</h2>
            <p className="section__lede">
              Escolha o agente pelo tipo de trabalho — não por ranking genérico.
              Todos operam sob o mesmo ciclo: contexto, execução e evidência.
            </p>

            <div className="agent-grid">
              {AGENTS.map((agent) => (
                <article className="agent-card" key={agent.name}>
                  <p className="agent-card__role mono">{agent.role}</p>
                  <h3>{agent.name}</h3>
                  <p>{agent.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="section section--evidence"
          id="evidencias"
          aria-labelledby="evidencias-heading"
        >
          <div className="section__inner">
            <p className="section__label mono">04 — evidências</p>
            <h2 id="evidencias-heading">Evidência antes da revisão</h2>
            <p className="section__lede">
              Nada avança só com “parece pronto”. A revisão parte de artefatos
              verificáveis gerados no próprio fluxo.
            </p>

            <ul className="evidence-list">
              {EVIDENCE_ITEMS.map((item) => (
                <li className="evidence-item" key={item.label}>
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section section--cta" id="cta-final" aria-labelledby="cta-heading">
          <div className="section__inner cta-panel">
            <p className="section__label mono">dev10x start</p>
            <h2 id="cta-heading">Comece com uma tarefa clara e um critério de prova</h2>
            <p className="section__lede">
              Defina o pedido, escolha o agente e deixe o orquestrador montar o
              workspace. Você revisa com evidência — não com expectativa.
            </p>
            <a className="btn btn--primary" href="#topo">
              Iniciar um projeto
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner">
          <img
            src="/dev10x/dev10x_logo_white.png"
            alt="Dev10x"
            width={120}
            height={32}
            className="brand__logo brand__logo--footer"
          />
          <p className="site-footer__note">
            Engenharia com contexto preservado, execução disciplinada e prova
            anexada.
          </p>
        </div>
      </footer>
    </div>
  );
}
