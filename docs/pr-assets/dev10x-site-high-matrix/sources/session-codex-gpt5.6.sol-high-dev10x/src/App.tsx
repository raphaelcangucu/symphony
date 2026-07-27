const flowSteps = [
  { number: "01", label: "Tarefa", detail: "Escopo e critérios" },
  { number: "02", label: "Agente", detail: "Modelo certo para o trabalho" },
  { number: "03", label: "Workspace isolado", detail: "Código sem colisões" },
  { number: "04", label: "Preview", detail: "Resultado navegável" },
  { number: "05", label: "Evidência", detail: "Prova capturada" },
  { number: "06", label: "Revisão", detail: "Decisão com contexto" },
];

const agents = [
  {
    name: "Codex",
    code: "codex.run",
    index: "01",
    description:
      "Para implementar, investigar e validar mudanças com contexto do repositório e ferramentas de engenharia.",
    traits: ["implementação", "testes", "refatoração"],
    accent: "violet",
  },
  {
    name: "Cursor",
    code: "cursor.session",
    index: "02",
    description:
      "Para sessões interativas em que direção humana e edição assistida avançam no mesmo ritmo.",
    traits: ["pareamento", "edição", "exploração"],
    accent: "blue",
  },
  {
    name: "Claude",
    code: "claude.task",
    index: "03",
    description:
      "Para analisar sistemas, desenvolver alternativas e executar tarefas com instruções persistentes.",
    traits: ["análise", "arquitetura", "execução"],
    accent: "cyan",
  },
];

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}

export function App() {
  return (
    <>
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <header className="site-header">
        <div className="header-inner">
          <a className="brand-link" href="#visao" aria-label="Dev10x — início">
            <img src="/dev10x/dev10x_logo_color.png" alt="Dev10x" />
          </a>
          <nav className="primary-nav" aria-label="Navegação principal">
            <a href="#visao">Visão</a>
            <a href="#fluxo">Fluxo</a>
            <a href="#agentes">Agentes</a>
            <a href="#evidencias">Evidências</a>
          </nav>
          <a className="header-action" href="#iniciar">
            Abrir projeto
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <main id="conteudo">
        <section className="hero" id="visao" aria-labelledby="hero-title">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">
                <span>DEV10X</span>
                Plataforma de engenharia orquestrada
              </p>
              <h1 id="hero-title">
                Engenharia em movimento. <em>Evidência em mãos.</em>
              </h1>
              <p className="hero-intro">
                Dev10x transforma tarefas em sessões executáveis, organiza agentes
                em workspaces isolados e entrega cada mudança com preview e prova
                verificável.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#iniciar">
                  Iniciar um projeto
                  <ArrowIcon />
                </a>
                <a className="button button-secondary" href="#fluxo">
                  Ver o fluxo
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="hero-note">
                <span className="pulse-dot" aria-hidden="true" />
                <p>
                  <strong>Contexto preservado</strong>
                  da intenção original à revisão final
                </p>
              </div>
            </div>

            <div className="execution-panel" aria-label="Execução Dev10x em andamento">
              <div className="panel-topline">
                <span>dev10x / run-042</span>
                <span className="live-status">
                  <i aria-hidden="true" />
                  em execução
                </span>
              </div>
              <div className="panel-title">
                <p>TAREFA ATIVA</p>
                <h2>Preparar fluxo de revisão</h2>
              </div>
              <div className="run-map">
                <div className="run-line" aria-hidden="true" />
                <div className="run-item complete">
                  <span>01</span>
                  <div>
                    <strong>Contexto carregado</strong>
                    <small>branch + tarefa + critérios</small>
                  </div>
                  <CheckIcon />
                </div>
                <div className="run-item active">
                  <span>02</span>
                  <div>
                    <strong>Agentes em paralelo</strong>
                    <small>2 unidades independentes</small>
                  </div>
                  <b>LIVE</b>
                </div>
                <div className="run-item">
                  <span>03</span>
                  <div>
                    <strong>Validação e captura</strong>
                    <small>aguardando execução</small>
                  </div>
                  <i>···</i>
                </div>
              </div>
              <div className="telemetry">
                <div>
                  <span>workspaces</span>
                  <strong>02</strong>
                </div>
                <div>
                  <span>checks</span>
                  <strong>07/09</strong>
                </div>
                <div>
                  <span>evidências</span>
                  <strong>04</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="hero-rail" aria-hidden="true">
            <span>INTENÇÃO</span>
            <i />
            <span>EXECUÇÃO</span>
            <i />
            <span>PROVA</span>
          </div>
        </section>

        <section className="flow-section" id="fluxo" aria-labelledby="flow-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow eyebrow-dark">
                <span>01</span>
                Linha de execução
              </p>
              <h2 id="flow-title">Da tarefa à revisão, sem perder o fio.</h2>
            </div>
            <p>
              Cada etapa deixa um estado legível. O trabalho avança, o contexto
              permanece e a revisão começa com a prova já organizada.
            </p>
          </div>

          <ol className="flow-list" aria-label="Fluxo de execução Dev10x">
            {flowSteps.map((step, index) => (
              <li key={step.label}>
                <div className="flow-marker">
                  <span>{step.number}</span>
                  <i aria-hidden="true" />
                </div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
                {index < flowSteps.length - 1 && (
                  <span className="flow-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div className="flow-principles">
            <article>
              <span>PARALELO / QUANDO ÚTIL</span>
              <h3>Divida o trabalho, não o contexto.</h3>
              <p>
                Tarefas independentes avançam juntas. Dependências continuam
                explícitas para que nenhuma unidade trabalhe no escuro.
              </p>
            </article>
            <article>
              <span>ISOLAMENTO / POR PADRÃO</span>
              <h3>Cada execução no seu espaço.</h3>
              <p>
                Workspaces isolados protegem o código em andamento e mantêm cada
                mudança rastreável até a integração.
              </p>
            </article>
          </div>
        </section>

        <section className="agents-section" id="agentes" aria-labelledby="agents-title">
          <div className="agents-intro">
            <p className="eyebrow">
              <span>02</span>
              Agentes
            </p>
            <h2 id="agents-title">
              Um sistema.
              <br />
              <em>Três formas de executar.</em>
            </h2>
            <p>
              Dev10x organiza Codex, Cursor e Claude sob o mesmo contrato de
              tarefa, ambiente e evidência. Você escolhe pelo contexto do trabalho.
            </p>
          </div>

          <div className="agent-grid">
            {agents.map((agent) => (
              <article className={`agent-card ${agent.accent}`} key={agent.name}>
                <div className="agent-topline">
                  <span>{agent.index}</span>
                  <code>{agent.code}</code>
                </div>
                <h3>{agent.name}</h3>
                <p>{agent.description}</p>
                <ul aria-label={`Capacidades de ${agent.name}`}>
                  {agent.traits.map((trait) => (
                    <li key={trait}>{trait}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="sessions-section" aria-labelledby="sessions-title">
          <div className="session-visual" aria-label="Linha de sessões coordenadas">
            <div className="session-header">
              <span>SESSÕES / 03</span>
              <span>WORKSPACE / DEV-142</span>
            </div>
            <div className="session-row is-human">
              <span>01</span>
              <i aria-hidden="true" />
              <div>
                <strong>Sessão interativa</strong>
                <small>direção humana em tempo real</small>
              </div>
              <b>ABERTA</b>
            </div>
            <div className="session-row is-agent">
              <span>02</span>
              <i aria-hidden="true" />
              <div>
                <strong>Execução orquestrada</strong>
                <small>escopo persistente até o resultado</small>
              </div>
              <b>RUNNING</b>
            </div>
            <div className="session-row">
              <span>03</span>
              <i aria-hidden="true" />
              <div>
                <strong>Revisão humana</strong>
                <small>mudança, contexto e evidências</small>
              </div>
              <b>PRÓXIMA</b>
            </div>
          </div>
          <div className="session-copy">
            <p className="eyebrow eyebrow-dark">
              <span>03</span>
              Sessões
            </p>
            <h2 id="sessions-title">Interaja agora. Orquestre até o fim.</h2>
            <p>
              Abra uma sessão para explorar e direcionar o trabalho com o agente.
              Quando o escopo estiver claro, entregue a execução ao orquestrador:
              ele mantém a tarefa ativa, coordena dependências e reúne o resultado
              no mesmo histórico.
            </p>
            <dl>
              <div>
                <dt>Interativo</dt>
                <dd>Você e o agente compartilham decisões em tempo real.</dd>
              </div>
              <div>
                <dt>Orquestrado</dt>
                <dd>A execução continua com objetivo, critérios e estado visíveis.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section
          className="evidence-section"
          id="evidencias"
          aria-labelledby="evidence-title"
        >
          <div className="evidence-heading">
            <p className="eyebrow">
              <span>04</span>
              Evidências
            </p>
            <h2 id="evidence-title">Prova pronta para revisão.</h2>
            <p>
              Cada entrega reúne sinais técnicos e visuais em um manifesto
              verificável. Quem revisa vê o que rodou, o que mudou e como o
              resultado se comporta.
            </p>
          </div>

          <div className="evidence-console">
            <div className="console-bar">
              <span>evidence / manifest.json</span>
              <div aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="proof-grid">
              <article>
                <div className="proof-icon">
                  <span>✓</span>
                </div>
                <p>01 / CHECKS</p>
                <h3>Testes</h3>
                <small>comandos e resultados reais</small>
                <b className="proof-status">PASS</b>
              </article>
              <article>
                <div className="proof-icon">
                  <span>▣</span>
                </div>
                <p>02 / VISUAL</p>
                <h3>Screenshots</h3>
                <small>desktop e mobile full-page</small>
                <b className="proof-status">CAPTURED</b>
              </article>
              <article>
                <div className="proof-icon">
                  <span>▶</span>
                </div>
                <p>03 / FLOW</p>
                <h3>Vídeo</h3>
                <small>percurso reproduzível</small>
                <b className="proof-status">RECORDED</b>
              </article>
              <article>
                <div className="proof-icon">
                  <span>⌁</span>
                </div>
                <p>04 / DEBUG</p>
                <h3>Trace</h3>
                <small>eventos para inspeção</small>
                <b className="proof-status">ATTACHED</b>
              </article>
            </div>
            <div className="console-footer">
              <code>status: ready_for_review</code>
              <span>4 artefatos vinculados</span>
            </div>
          </div>
        </section>

        <section className="final-cta" id="iniciar" aria-labelledby="cta-title">
          <div className="cta-signal" aria-hidden="true">
            <span>+</span>
            <i />
          </div>
          <p className="eyebrow">
            <span>PRÓXIMO RUN</span>
            Sua tarefa entra aqui
          </p>
          <h2 id="cta-title">Do escopo à prova, em uma linha contínua.</h2>
          <p>
            Inicie um projeto com contexto claro. A Dev10x organiza a execução e
            prepara o resultado para uma revisão objetiva.
          </p>
          <a className="button button-white" href="mailto:projetos@dev10x.ai">
            Iniciar um projeto
            <ArrowIcon />
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="#visao" aria-label="Voltar ao início">
          Dev<span>10x</span>
        </a>
        <p>Engenharia orquestrada. Execução verificável.</p>
        <div>
          <span>Codex</span>
          <span>Cursor</span>
          <span>Claude</span>
        </div>
        <small>© 2026 Dev10x</small>
      </footer>
    </>
  );
}
