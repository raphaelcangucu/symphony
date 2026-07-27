import type { ReactNode } from "react";

import "./Evidence.css";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type Artifact = {
  readonly name: string;
  readonly file: string;
  readonly body: string;
  readonly glyph: ReactNode;
};

const ARTIFACTS: readonly Artifact[] = [
  {
    name: "Testes",
    file: "build-report.txt",
    body: "Comando, código de saída e resultado observado de cada execução — unitário e E2E, sem estimativa no meio.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path {...stroke} d="M4.5 12.5l4 4 11-11" />
        <path {...stroke} d="M4.5 5.5h6" />
        <path {...stroke} d="M4.5 19h7" />
      </svg>
    ),
  },
  {
    name: "Screenshots",
    file: "desktop.png · mobile.png",
    body: "Capturas full-page em desktop e mobile, tiradas da aplicação real servida por HTTP na porta reservada.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect {...stroke} x="3" y="5" width="18" height="14" rx="2.5" />
        <path {...stroke} d="M3 15.5l4.5-4 3.5 3 4-4.5 5 5.5" />
      </svg>
    ),
  },
  {
    name: "Vídeo",
    file: "run.webm · run.mp4",
    body: "Gravação WebM da execução com uma cópia MP4/H.264, para abrir em qualquer player sem conversão manual.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect {...stroke} x="3" y="5.5" width="13" height="13" rx="2.5" />
        <path {...stroke} d="M16 11l5-3v8l-5-3z" />
      </svg>
    ),
  },
  {
    name: "Trace",
    file: "trace.zip",
    body: "Trace do Playwright com DOM, rede e console passo a passo — reabrível offline, quadro por quadro.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path {...stroke} d="M3 16.5l4-6 4 3 3.5-7 2.5 5 4-3.5" />
        <circle {...stroke} cx="7" cy="10.5" r="1.6" />
        <circle {...stroke} cx="14.5" cy="6.5" r="1.6" />
      </svg>
    ),
  },
];

const MANIFEST = [
  { key: "runs[]", value: "kind · comando · status realmente observado" },
  { key: "navigations[]", value: "a URL HTTP que o teste abriu de fato" },
  { key: "proof[]", value: "screenshots e vídeos como objetos rotulados" },
  { key: "artifacts/", value: "arquivos reais na árvore da tarefa, sem symlink" },
] as const;

export function Evidence() {
  return (
    <section className="section evidence" id="evidencias" aria-labelledby="evidencias-title">
      <div className="shell">
        <div className="section-head">
          <p className="eyebrow">
            <span className="eyebrow__index">05</span> Evidências
          </p>
          <h2 className="section-title" id="evidencias-title">
            Evidência não é captura de tela solta.
          </h2>
          <p className="section-head__lead">
            Cada execução grava um manifesto que amarra comandos, navegações e artefatos. Quem
            revisa reabre exatamente o que a máquina viu — no mesmo estado.
          </p>
        </div>

        <ul className="evidence__grid">
          {ARTIFACTS.map((artifact) => (
            <li className="evidence__card" key={artifact.name}>
              <span className="evidence__glyph" aria-hidden="true">
                {artifact.glyph}
              </span>
              <h3 className="evidence__name">{artifact.name}</h3>
              <p className="evidence__file mono">{artifact.file}</p>
              <p className="evidence__body">{artifact.body}</p>
            </li>
          ))}
        </ul>

        <div className="evidence__manifest">
          <p className="evidence__manifest-path mono">evidence/manifest.json</p>
          <dl className="evidence__manifest-rows">
            {MANIFEST.map((row) => (
              <div className="evidence__manifest-row" key={row.key}>
                <dt className="mono">{row.key}</dt>
                <dd className="mono">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="evidence__manifest-note">
            Se um comando não rodou, ele não aparece como concluído. O manifesto registra o
            status observado, incluindo falha.
          </p>
        </div>
      </div>
    </section>
  );
}
