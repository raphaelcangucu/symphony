import { NAV_ITEMS } from "../navigation";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <img
            className="site-footer__logo"
            src="/dev10x/dev10x_logo_white.png"
            alt="Dev10x"
            width={912}
            height={205}
          />
          <p className="site-footer__pitch">
            Plataforma de engenharia para orquestrar agentes, sessões, tarefas, workspaces,
            previews e evidências.
          </p>
        </div>

        <nav className="site-footer__nav" aria-label="Rodapé">
          <h2 className="site-footer__heading">Nesta página</h2>
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-footer__meta">
          <h2 className="site-footer__heading">Execução</h2>
          <ul>
            <li>Codex</li>
            <li>Cursor</li>
            <li>Claude</li>
          </ul>
        </div>
      </div>

      <div className="container site-footer__bottom">
        <p>© 2026 Dev10x</p>
        <p className="site-footer__terminal">
          <code>dev10x · intenção → prova</code>
        </p>
      </div>
    </footer>
  );
}
