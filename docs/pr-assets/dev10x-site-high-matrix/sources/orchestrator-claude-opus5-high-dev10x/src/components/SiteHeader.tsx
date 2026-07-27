import { useActiveSection } from "../hooks/useActiveSection";
import { useScrollProgress } from "../hooks/useScrollProgress";
import { NAV_ITEMS } from "../navigation";

const SECTION_IDS = NAV_ITEMS.map((item) => item.id);

export function SiteHeader() {
  const progress = useScrollProgress();
  const active = useActiveSection(SECTION_IDS);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="brand" href="#conteudo" aria-label="Dev10x, página inicial">
          <img
            className="brand__logo"
            src="/dev10x/dev10x_logo_color.png"
            alt="Dev10x"
            width={914}
            height={220}
          />
        </a>

        <nav className="site-nav" aria-label="Seções da página">
          <ul className="site-nav__list">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a
                  className="site-nav__link"
                  href={`#${item.id}`}
                  aria-current={active === item.id ? "true" : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <a className="btn btn--compact" href="#comecar">
          Criar tarefa
        </a>
      </div>

      {/* Execution line: how far the run has progressed down the page. */}
      <div
        className="execution-line"
        role="presentation"
        style={{ ["--progress" as string]: progress }}
      />
    </header>
  );
}
