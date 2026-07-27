import { useEffect, useState } from "react";

import "./TopNav.css";

export const NAV_LINKS = [
  { href: "#visao", label: "Visão" },
  { href: "#fluxo", label: "Fluxo" },
  { href: "#agentes", label: "Agentes" },
  { href: "#evidencias", label: "Evidências" },
] as const;

export function TopNav() {
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`topnav${lifted ? " topnav--lifted" : ""}`}>
      <div className="topnav__inner shell">
        <a className="topnav__brand" href="#conteudo" aria-label="Dev10x — início">
          <img
            className="topnav__logo"
            src="/dev10x/dev10x_logo_color.png"
            alt="Dev10x"
            width={914}
            height={220}
          />
        </a>

        <nav className="topnav__nav" aria-label="Navegação principal">
          <ul className="topnav__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className="topnav__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <a className="btn btn--primary topnav__cta" href="#cta">
          Iniciar projeto
          <span className="btn__arrow" aria-hidden="true">
            →
          </span>
        </a>
      </div>
      <div className="topnav__rail" aria-hidden="true" />
    </header>
  );
}
