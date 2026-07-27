import { NAV_LINKS } from "./TopNav";
import "./SiteFooter.css";

const CAPABILITIES = [
  { label: "Agentes", value: "Codex · Cursor · Claude" },
  { label: "Execução", value: "sessão interativa ou orquestrador" },
  { label: "Prova", value: "build · e2e · screenshot · vídeo · trace" },
] as const;

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="shell footer__inner">
        <div className="footer__brand">
          <img
            className="footer__logo"
            src="/dev10x/dev10x_logo_white.png"
            alt="Dev10x"
            width={912}
            height={205}
          />
          <p className="footer__tagline">
            Plataforma de engenharia para execução verificável: tarefas, agentes, workspaces,
            previews e evidências no mesmo lugar.
          </p>
        </div>

        <nav className="footer__nav" aria-label="Navegação do rodapé">
          <h2 className="footer__heading">Seções</h2>
          <ul className="footer__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className="footer__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="footer__meta">
          <h2 className="footer__heading">Plataforma</h2>
          <dl className="footer__meta-rows">
            {CAPABILITIES.map((item) => (
              <div className="footer__meta-row" key={item.label}>
                <dt>{item.label}</dt>
                <dd className="mono">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="shell footer__bottom">
        <p className="mono footer__signature">dev10x · da intenção à prova</p>
        <p className="footer__legal">© 2026 Dev10x. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}
