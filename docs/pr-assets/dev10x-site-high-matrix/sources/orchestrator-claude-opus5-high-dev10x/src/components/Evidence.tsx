type Artifact = {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly file: string;
};

const ARTIFACTS: readonly Artifact[] = [
  {
    kind: "testes",
    title: "Testes",
    body: "Build e suíte E2E rodam contra a aplicação real por HTTP, na porta reservada do run. O status registrado é o observado, não o esperado.",
    file: "build.log · results.json",
  },
  {
    kind: "screenshots",
    title: "Screenshots",
    body: "Captura full-page em desktop e mobile, tirada no mesmo run que gerou o diff. Dá para comparar antes de abrir o código.",
    file: "desktop.png · mobile.png",
  },
  {
    kind: "video",
    title: "Vídeo",
    body: "Gravação WebM da sessão do teste, com cópia MP4 para abrir em qualquer player. Mostra a interação, não só o estado final.",
    file: "run.webm · run.mp4",
  },
  {
    kind: "trace",
    title: "Trace",
    body: "Trace do Playwright com ações, DOM e rede passo a passo. Quando algo falha, a causa está no trace e não na suposição.",
    file: "trace.zip",
  },
];

const MANIFEST_LINES: readonly string[] = [
  "{",
  '  "issue": "DEV-6",',
  '  "runs": [',
  '    { "kind": "unit", "command": "npm run build", "status": "passed" },',
  '    { "kind": "e2e",  "command": "npm run test:e2e", "status": "passed",',
  '      "navigations": ["http://127.0.0.1:4173/"],',
  '      "screenshots": ["desktop.png", "mobile.png"],',
  '      "videos": ["run.webm", "run.mp4"],',
  '      "proof": "trace.zip" }',
  "  ]",
  "}",
];

export function Evidence() {
  return (
    <section
      className="section section--paper"
      id="evidencias"
      aria-labelledby="evidencias-titulo"
    >
      <div className="container">
        <header className="section__head">
          <p className="eyebrow">05 / EVIDÊNCIAS</p>
          <h2 id="evidencias-titulo" className="section__title">
            Evidências anexadas a cada run
          </h2>
          <p className="section__lead">
            Ao fim de um run, a Dev10x grava um manifesto com o que rodou, onde rodou e o
            que sobrou como prova. Arquivos reais, dentro da árvore do projeto.
          </p>
        </header>

        <div className="evidence">
          <ul className="evidence__list">
            {ARTIFACTS.map((artifact) => (
              <li className="artifact" key={artifact.kind}>
                <h3 className="artifact__title">{artifact.title}</h3>
                <p className="artifact__body">{artifact.body}</p>
                <p className="artifact__file">
                  <code>{artifact.file}</code>
                </p>
              </li>
            ))}
          </ul>

          <figure className="manifest">
            <figcaption className="manifest__caption">
              <span className="manifest__path">evidence/manifest.json</span>
              <span className="manifest__badge">gravado no run</span>
            </figcaption>
            <pre className="manifest__code">
              <code>
                {MANIFEST_LINES.map((line) => (
                  <span className="manifest__line" key={line}>
                    {line}
                  </span>
                ))}
              </code>
            </pre>
            <p className="manifest__note">
              Sem symlink, sem caminho fora da árvore de evidência, sem run inventado.
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
