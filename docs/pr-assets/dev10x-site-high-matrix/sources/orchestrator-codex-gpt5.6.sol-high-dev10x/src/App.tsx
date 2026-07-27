const flowSteps = [
  { index: "01", title: "Tarefa", detail: "Intenção e critérios claros" },
  { index: "02", title: "Agente", detail: "Contexto certo para executar" },
  { index: "03", title: "Workspace isolado", detail: "Mudança sem colisões" },
  { index: "04", title: "Preview", detail: "Produto real em movimento" },
  { index: "05", title: "Evidência", detail: "Prova ligada à execução" },
  { index: "06", title: "Revisão", detail: "Decisão com contexto" },
];

const agents = [
  {
    name: "Codex",
    code: "agent.01",
    color: "violet",
    description:
      "Assume tarefas de implementação, navega pelo repositório e deixa a mudança pronta para validação.",
    signal: "implementação / validação",
  },
  {
    name: "Cursor",
    code: "agent.02",
    color: "blue",
    description:
      "Mantém o trabalho próximo ao editor para sessões interativas, ajustes precisos e exploração do código.",
    signal: "sessão / contexto",
  },
  {
    name: "Claude",
    code: "agent.03",
    color: "cyan",
    description:
      "Conduz análises e execuções longas com o histórico necessário para atravessar mudanças complexas.",
    signal: "análise / execução",
  },
];

const evidence = [
  {
    name: "Testes",
    detail: "O comportamento esperado, executado contra a mudança real.",
    icon: "TST",
  },
  {
    name: "Screenshots",
    detail: "O estado visual registrado nos viewports que importam.",
    icon: "PNG",
  },
  {
    name: "Vídeo",
    detail: "O percurso completo para revisar interação e acabamento.",
    icon: "VID",
  },
  {
    name: "Trace",
    detail: "A linha do tempo técnica para investigar cada passo.",
    icon: "TRC",
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function App() {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <header className="topbar">
        <a className="brand" href="#visao" aria-label="Dev10x — início">
          <img src="/dev10x/dev10x_logo_color.png" alt="Dev10x" />
        </a>
        <nav aria-label="Navegação principal">
          <a href="#visao">Visão</a>
          <a href="#fluxo">Fluxo</a>
          <a href="#agentes">Agentes</a>
          <a href="#evidencias">Evidências</a>
        </nav>
        <a className="nav-cta" href="#iniciar">
          Iniciar
          <ArrowIcon />
        </a>
      </header>

      <main id="conteudo">
        <section id="visao" className="hero">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">
                <span>DEV10X / ENGINEERING OS</span>
                <span className="status-dot">online</span>
              </div>
              <h1>
                Da intenção à prova,{" "}
                <span className="gradient-text">engenharia em movimento.</span>
              </h1>
              <p className="hero-intro">
                Dev10x orquestra agentes, sessões, tarefas e workspaces para
                preservar contexto, executar em paralelo quando faz sentido e
                chegar à revisão com evidência verificável.
              </p>
              <div className="hero-actions" aria-label="Ações principais">
                <a className="button button-primary" href="#iniciar">
                  Iniciar um projeto
                  <ArrowIcon />
                </a>
                <a className="button button-secondary" href="#fluxo">
                  Ver o fluxo
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
              <dl className="hero-metrics">
                <div>
                  <dt>Contexto</dt>
                  <dd>preservado por tarefa</dd>
                </div>
                <div>
                  <dt>Execução</dt>
                  <dd>isolada por workspace</dd>
                </div>
                <div>
                  <dt>Revisão</dt>
                  <dd>amparada por prova</dd>
                </div>
              </dl>
            </div>

            <div className="execution-panel" aria-label="Telemetria de execução">
              <div className="panel-topline">
                <span>execution / dev10x</span>
                <span className="live-pill">
                  <i />
                  LIVE
                </span>
              </div>
              <div className="signal-map">
                <div className="signal-orbit orbit-one" />
                <div className="signal-orbit orbit-two" />
                <div className="core">
                  <img src="/dev10x/dev10x_icon.png" alt="" />
                  <span>RUN</span>
                </div>
                <span className="agent-node node-codex">CODEX</span>
                <span className="agent-node node-cursor">CURSOR</span>
                <span className="agent-node node-claude">CLAUDE</span>
                <svg
                  className="connection-lines"
                  viewBox="0 0 520 360"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M75 68 C155 75 177 140 260 180" />
                  <path d="M445 68 C365 75 343 140 260 180" />
                  <path d="M260 310 C260 260 260 230 260 180" />
                </svg>
              </div>
              <div className="run-log">
                <div>
                  <span className="log-index">01:24:08</span>
                  <span>workspace / ready</span>
                  <b className="ok">●</b>
                </div>
                <div>
                  <span className="log-index">01:24:12</span>
                  <span>preview / captured</span>
                  <b className="ok">●</b>
                </div>
                <div>
                  <span className="log-index">01:24:17</span>
                  <span>evidence / attached</span>
                  <b className="active">●</b>
                </div>
              </div>
            </div>
          </div>
          <div className="hero-ruler" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index}>{String(index + 1).padStart(2, "0")}</span>
            ))}
          </div>
        </section>

        <section id="fluxo" className="flow-section section-pad">
          <div className="section-heading">
            <div>
              <p className="section-kicker">01 / FLUXO DE EXECUÇÃO</p>
              <h2>Uma linha contínua da tarefa à revisão.</h2>
            </div>
            <p>
              Cada etapa preserva o que veio antes. A intenção não se perde no
              caminho; ela vira mudança observável, resultado reproduzível e
              contexto para quem revisa.
            </p>
          </div>

          <ol className="flow-track">
            {flowSteps.map((step, index) => (
              <li key={step.title}>
                <div className="step-marker">
                  <span>{step.index}</span>
                  <i />
                </div>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
                {index < flowSteps.length - 1 && (
                  <span className="flow-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div className="context-strip">
            <span className="terminal-prompt">$ dev10x run task/142</span>
            <span className="strip-message">
              contexto preservado
              <i />
              3 agentes coordenados
              <i />
              evidência anexada
            </span>
            <span className="strip-status">READY FOR REVIEW</span>
          </div>
        </section>

        <section id="agentes" className="agents-section section-pad">
          <div className="section-heading light-heading">
            <div>
              <p className="section-kicker">02 / AGENTES</p>
              <h2>O agente certo entra com o contexto certo.</h2>
            </div>
            <p>
              Codex, Cursor e Claude trabalham dentro do mesmo sistema de
              execução. Você escolhe a abordagem pela natureza da tarefa — sem
              apagar histórico, misturar workspaces ou perder o fio da revisão.
            </p>
          </div>

          <div className="agent-grid">
            {agents.map((agent) => (
              <article
                key={agent.name}
                className={`agent-card agent-${agent.color}`}
              >
                <div className="agent-meta">
                  <span>{agent.code}</span>
                  <span className="agent-pulse" aria-hidden="true" />
                </div>
                <h3>{agent.name}</h3>
                <p>{agent.description}</p>
                <div className="agent-signal">
                  <span>uso principal</span>
                  <strong>{agent.signal}</strong>
                </div>
              </article>
            ))}
          </div>

          <div className="orchestration-grid">
            <article className="mode-card interactive-card">
              <p className="mode-number">A / SESSÃO</p>
              <h3>Interaja sem quebrar o fluxo.</h3>
              <p>
                Entre em uma sessão, ajuste a direção e continue com todo o
                histórico disponível. Decisões humanas viram parte explícita da
                execução.
              </p>
              <div className="session-dialog" aria-label="Exemplo de sessão">
                <div>
                  <span className="avatar">RC</span>
                  <p>
                    <small>Você · agora</small>
                    Preserve a API pública e cubra o estado mobile.
                  </p>
                </div>
                <div>
                  <span className="avatar avatar-agent">DX</span>
                  <p>
                    <small>Agente · executando</small>
                    Contexto atualizado. Validando o mesmo fluxo em 390px.
                  </p>
                </div>
              </div>
            </article>

            <article className="mode-card orchestrator-card">
              <p className="mode-number">B / ORQUESTRADOR</p>
              <h3>Deixe a execução avançar.</h3>
              <p>
                O orquestrador distribui tarefas independentes, mantém cada
                mudança isolada e reúne os resultados antes da revisão.
              </p>
              <div className="queue" aria-label="Fila do orquestrador">
                <div>
                  <span>task/140</span>
                  <strong>API</strong>
                  <i className="queue-done">done</i>
                </div>
                <div>
                  <span>task/141</span>
                  <strong>UI</strong>
                  <i className="queue-live">running</i>
                </div>
                <div>
                  <span>task/142</span>
                  <strong>E2E</strong>
                  <i>queued</i>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section id="evidencias" className="evidence-section section-pad">
          <div className="section-heading">
            <div>
              <p className="section-kicker">03 / EVIDÊNCIAS</p>
              <h2>Prova que acompanha a mudança.</h2>
            </div>
            <p>
              A revisão começa com fatos. Dev10x conecta a execução aos
              artefatos que mostram o que mudou, como se comportou e onde
              investigar.
            </p>
          </div>

          <div className="evidence-board">
            <div className="evidence-list">
              {evidence.map((item, index) => (
                <article key={item.name}>
                  <span className="evidence-icon">{item.icon}</span>
                  <div>
                    <p className="evidence-count">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3>{item.name}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <span className="evidence-check" aria-label="verificado">
                    ✓
                  </span>
                </article>
              ))}
            </div>

            <div className="proof-panel">
              <div className="proof-top">
                <span>PROOF / RUN-0142</span>
                <span>PASS</span>
              </div>
              <div className="proof-preview">
                <div className="browser-bar">
                  <i />
                  <i />
                  <i />
                  <span>preview.dev10x / task-142</span>
                </div>
                <div className="preview-content">
                  <span className="preview-label">FEATURE PREVIEW</span>
                  <strong>Estado real, pronto para revisar.</strong>
                  <div className="preview-bars">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
              <dl className="proof-stats">
                <div>
                  <dt>testes</dt>
                  <dd>24 / 24</dd>
                </div>
                <div>
                  <dt>viewports</dt>
                  <dd>02</dd>
                </div>
                <div>
                  <dt>trace</dt>
                  <dd>capturado</dd>
                </div>
              </dl>
              <div className="proof-foot">
                <span>hash 8f3c1a</span>
                <span>review packet ready</span>
              </div>
            </div>
          </div>
        </section>

        <section id="iniciar" className="final-cta">
          <div className="cta-signal" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="section-kicker">PRÓXIMA EXECUÇÃO</p>
          <h2>Traga a tarefa.<br />A Dev10x conduz até a prova.</h2>
          <p>
            Comece com um projeto, conecte seus agentes e transforme cada
            mudança em um fluxo que sua equipe consegue acompanhar e verificar.
          </p>
          <a
            className="button button-white"
            href="mailto:projetos@dev10x.com?subject=Iniciar%20um%20projeto%20Dev10x"
          >
            Iniciar um projeto
            <ArrowIcon />
          </a>
        </section>
      </main>

      <footer>
        <a className="footer-brand" href="#visao" aria-label="Dev10x — voltar ao início">
          <img src="/dev10x/dev10x_logo_white.png" alt="Dev10x" />
        </a>
        <p>Engenharia orquestrada. Execução verificável.</p>
        <div className="footer-meta">
          <span>DEV10X / 2026</span>
          <a href="#conteudo">Voltar ao topo ↑</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
