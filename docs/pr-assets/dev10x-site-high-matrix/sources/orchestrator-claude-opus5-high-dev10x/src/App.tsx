import { SiteHeader } from "./components/SiteHeader";
import { Hero } from "./components/Hero";
import { Vision } from "./components/Vision";
import { Flow } from "./components/Flow";
import { Agents } from "./components/Agents";
import { Sessions } from "./components/Sessions";
import { Evidence } from "./components/Evidence";
import { FinalCta } from "./components/FinalCta";
import { SiteFooter } from "./components/SiteFooter";

export function App() {
  return (
    <>
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo">
        <Hero />
        <Vision />
        <Flow />
        <Agents />
        <Sessions />
        <Evidence />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
