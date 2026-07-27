const NAV_LINKS = [
  { href: "#visao", label: "Visão" },
  { href: "#fluxo", label: "Fluxo" },
  { href: "#agentes", label: "Agentes" },
  { href: "#evidencias", label: "Evidências" },
] as const;

const FLOW_STEPS = [
  { id: "tarefa", label: "Tarefa", detail: "Intenção com escopo e critérios" },
  { id: "agente", label: "Agente", detail: "Codex, Cursor ou Claude" },
  { id: "workspace", label: "Workspace", detail: "Árvore isolada por sessão" },
  { id: "preview", label: "Preview", detail: "URL contratada para validar" },
  { id: "evidencia", label: "Evidência", detail: "Testes, captura e trace" },
  { id: "revisao", label: "Revisão", detail: "Decisão com prova anexada" },
] as const;

const AGENTS = [
  {
    name: "Codex",
    role: "Sessões de implementação com contexto longo",
    body: "Mantém o fio da tarefa, aplica mudanças no workspace e registra o caminho percorrido até a evidência.",
  },
  {
    name: "Cursor",
    role: "Edição assistida no ponto de trabalho",
    body: "Opera onde o código muda: refina, corrige e alinha a implementação ao contrato da tarefa.",
  },
  {
    name: "Claude",
    role: "Análise e orquestração de escopo",
    body: "Lê, planeja e valida critérios; útil quando a tarefa pede julgamento além da edição pontual.",
  },
] as const;

const EVIDENCE_TYPES = [
  {
    title: "Testes",
    body: "Comandos unitários e E2E com status observado — não relatos manuais.",
  },
  {
    title: "Screenshots",
    body: "Capturas full-page desktop e mobile da superfície alterada.",
  },
  {
    title: "Vídeo",
    body: "Gravação WebM do fluxo e cópia MP4 para revisão no browser.",
  },
  {
    title: "Trace",
    body: "Trace Playwright com navegações, timing e prova do caminho real.",
  },
] as const;

function App() {
  return (
    <div className="page">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <header className="site-header">
        <div className="shell header-inner">
          <a className="brand" href="#topo" aria-label="Dev10x — início">
            <img
              src="/dev10x/dev10x_logo_color.png"
              alt="Dev10x"
              width={148}
              height={40}
              className="brand-logo"
            />
          </a>
          <nav className="site-nav" aria-label="Principal">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <a className="btn btn-ghost header-cta" href="#comecar">
            Iniciar projeto
          </a>
        </div>
      </header>

      <main id="conteudo">
        <section id="topo" className="hero" aria-labelledby="hero-heading">
          <div className="hero-plane" aria-hidden="true">
            <div className="hero-grid" />
            <div className="hero-beam" />
            <svg
              className="hero-telemetry"
              viewBox="0 0 1200 420"
              preserveAspectRatio="none"
            >
              <path
                className="telemetry-path"
                d="M0 280 C180 220 260 340 420 260 S700 120 860 200 S1060 320 1200 180"
              />
              <circle className="telemetry-node n1" cx="180" cy="250" r="5" />
              <circle className="telemetry-node n2" cx="420" cy="260" r="5" />
              <circle className="telemetry-node n3" cx="700" cy="160" r="5" />
              <circle className="telemetry-node n4" cx="980" cy="240" r="5" />
            </svg>
          </div>

          <div className="shell hero-copy">
            <img
              src="/dev10x/dev10x_logo_white.png"
              alt=""
              width={180}
              height={48}
              className="hero-brand-mark"
              aria-hidden="true"
            />
            <p className="editorial-label">DEV10X · ENGENHARIA ORQUESTRADA</p>
            <h1 id="hero-heading">
              Da intenção à prova, com agentes sob o mesmo fio.
            </h1>
            <p className="hero-lead">
              Dev10x orquestra agentes, sessões, tarefas, workspaces, previews e
              evidências — com Codex, Cursor e Claude — para que cada entrega
              chegue à revisão com contexto preservado e prova verificável.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#comecar">
                Iniciar um projeto
              </a>
              <a className="btn btn-secondary" href="#fluxo">
                Ver o fluxo
              </a>
            </div>
          </div>
        </section>

        <section id="visao" className="section vision" aria-labelledby="visao-heading">
          <div className="shell section-grid">
            <div>
              <p className="editorial-label">VISÃO</p>
              <h2 id="visao-heading">
                Execução paralela quando ajuda. Evidência antes da opinião.
              </h2>
            </div>
            <div className="vision-body">
              <p>
                Em vez de chats soltos e branches sem rastreio, Dev10x amarra
                tarefa, agente e workspace isolado. O preview mostra o resultado;
                a evidência — testes, screenshots, vídeo e trace — chega junto
                para a revisão.
              </p>
              <p>
                Mais contexto preservado entre turnos. Paralelismo quando as
                fatias são independentes. Nenhuma revisão depende de “parece
                ok”.
              </p>
              <p className="mono-note">
                <span className="mono-tag">dev10x</span>
                tarefa → agente → workspace → preview → evidência → revisão
              </p>
            </div>
          </div>
        </section>

        <section id="fluxo" className="section flow" aria-labelledby="fluxo-heading">
          <div className="shell">
            <p className="editorial-label">FLUXO</p>
            <h2 id="fluxo-heading">Linha de execução contínua</h2>
            <p className="section-lead">
              Cada etapa deixa um rastro legível: da especificação da tarefa até
              a decisão de revisão.
            </p>

            <ol className="flow-track">
              {FLOW_STEPS.map((step, index) => (
                <li key={step.id} className="flow-step">
                  <span className="flow-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                  {index < FLOW_STEPS.length - 1 ? (
                    <span className="flow-connector" aria-hidden="true" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="agentes"
          className="section agents"
          aria-labelledby="agentes-heading"
        >
          <div className="shell">
            <p className="editorial-label">AGENTES</p>
            <h2 id="agentes-heading">Três runtimes, um contrato de execução</h2>
            <p className="section-lead">
              Escolha o agente certo para o tipo de trabalho — sem ranking
              absoluto. O orquestrador padroniza sessão, workspace e evidência.
            </p>

            <ul className="agent-grid">
              {AGENTS.map((agent) => (
                <li key={agent.name} className="agent-card">
                  <h3>{agent.name}</h3>
                  <p className="agent-role">{agent.role}</p>
                  <p>{agent.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="sessoes"
          className="section sessions"
          aria-labelledby="sessoes-heading"
        >
          <div className="shell sessions-layout">
            <div>
              <p className="editorial-label">SESSÕES</p>
              <h2 id="sessoes-heading">
                Interativo quando precisa. Orquestrado quando escala.
              </h2>
              <p>
                Sessões interativas mantêm o operador no loop: inspecionar,
                corrigir e avançar com o mesmo contexto. O orquestrador dispara
                fatias paralelas, isola workspaces e recolhe evidência sem
                misturar estados.
              </p>
            </div>
            <div className="session-panel" aria-hidden="true">
              <div className="session-row">
                <span className="dot live" />
                <span>sessão · interativa</span>
                <span className="mono">run/open</span>
              </div>
              <div className="session-row">
                <span className="dot queue" />
                <span>orquestrador · paralelo</span>
                <span className="mono">2 fatias</span>
              </div>
              <div className="session-row">
                <span className="dot ok" />
                <span>workspace isolado</span>
                <span className="mono">clean</span>
              </div>
              <div className="session-row">
                <span className="dot ok" />
                <span>preview contratado</span>
                <span className="mono">in_sync</span>
              </div>
            </div>
          </div>
        </section>

        <section
          id="evidencias"
          className="section evidence"
          aria-labelledby="evidencias-heading"
        >
          <div className="shell">
            <p className="editorial-label">EVIDÊNCIAS</p>
            <h2 id="evidencias-heading">Prova anexada antes da revisão</h2>
            <p className="section-lead">
              O manifesto registra o que rodou de fato: comando, status e
              artefatos. Revisão começa com material verificável.
            </p>

            <ul className="evidence-grid">
              {EVIDENCE_TYPES.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="comecar"
          className="section cta-final"
          aria-labelledby="comecar-heading"
        >
          <div className="shell cta-panel">
            <p className="editorial-label">COMEÇAR</p>
            <h2 id="comecar-heading">
              Abra um projeto. Feche o ciclo com evidência.
            </h2>
            <p>
              Defina a tarefa, escolha o agente, rode no workspace isolado e
              entregue preview + prova — pronto para revisão.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#topo">
                Começar com Dev10x
              </a>
              <a className="btn btn-secondary" href="#evidencias">
                Ver o que conta como prova
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell footer-inner">
          <img
            src="/dev10x/dev10x_logo_white.png"
            alt="Dev10x"
            width={132}
            height={36}
            className="footer-logo"
          />
          <p>
            Dev10x — plataforma de engenharia com agentes, sessões e evidência
            verificável.
          </p>
          <p className="footer-meta">
            <span className="mono-tag">dev10x</span>
            © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
