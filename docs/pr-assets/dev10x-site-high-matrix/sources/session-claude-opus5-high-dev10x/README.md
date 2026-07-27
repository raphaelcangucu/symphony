# Dev10x — landing page

Landing page da Dev10x: React + TypeScript + Vite, CSS próprio (sem biblioteca de
componentes) e E2E em Playwright. Todos os recursos são locais — os assets oficiais
da marca ficam em `public/dev10x/`.

## Comandos

```bash
npm install
npm run dev -- --host 0.0.0.0   # desenvolvimento
npm run build                   # tsc --noEmit + vite build
npm run test:e2e                # Playwright via scripts/run-e2e.mjs
```

`npm run test:e2e` sobe um Vite próprio na porta `PLAYWRIGHT_PORT` (padrão local
`4173`), espera o HTTP responder e encerra o grupo de processos ao final. O
`playwright.config.ts` não define `webServer` de propósito; o `baseURL` respeita
`PLAYWRIGHT_BASE_URL`.

## Estrutura

- `src/styles/tokens.css` — paleta canônica da marca e escalas de tipografia/espaço.
- `src/styles/base.css` — reset, primitivas de layout, botões e rótulos editoriais.
- `src/components/` — uma seção por componente, com o CSS ao lado.
- `tests/e2e/landing.spec.ts` — marca, hero, agentes, fluxo, evidências, navegação
  por âncora, ausência de overflow horizontal no mobile e console limpo.

## Marca

`Dev10x` é o wordmark; `DEV10X` aparece em rótulos editoriais e `dev10x` em
detalhes com linguagem de terminal. Os logotipos em `public/dev10x/` são usados
como fornecidos (apenas escala proporcional): a versão colorida sobre superfícies
claras e a branca sobre a tinta `#0F172A`.
