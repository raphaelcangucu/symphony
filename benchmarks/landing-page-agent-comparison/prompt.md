# Tarefa: landing page do Symphony

Implemente diretamente, sem delegar a outros agentes e sem fazer perguntas.
Trabalhe no repositório `site/` deste workspace. Fora dele, escreva somente a
evidência canônica em `.symphony/evidence/` na raiz do workspace.

Crie uma landing page completa, responsiva e visualmente marcante, em português, apresentando o Symphony como uma plataforma de orquestração de agentes de engenharia. A página deve explicar de forma concreta como o Symphony organiza sessões, tarefas, previews e evidências usando Codex, Cursor e Claude.

## Stack obrigatória

- React, TypeScript e Vite.
- CSS próprio, sem bibliotecas de componentes.
- Playwright para testes E2E.
- O comando de desenvolvimento deve aceitar exatamente:
  `npm run dev -- --host 0.0.0.0`
- O projeto deve possuir os scripts `dev`, `build` e `test:e2e`.

## Conteúdo obrigatório

- Navegação superior com a marca “Symphony” e links para Visão, Fluxo, Agentes e Evidências.
- Hero com proposta de valor clara, uma chamada principal e uma secundária.
- Uma visualização do fluxo: tarefa → agente → workspace isolado → preview → evidência → revisão.
- Cards distintos para Codex, Cursor e Claude, sem declarar que um deles é objetivamente melhor.
- Seção sobre sessões interativas e execução pelo orquestrador.
- Seção de evidências citando testes, screenshots, vídeo e trace.
- CTA final para iniciar um projeto.
- Rodapé.

## Direção visual

- Aparência editorial e técnica, não um template SaaS genérico.
- Fundo escuro com contraste alto, tipografia expressiva, gradientes contidos e detalhes que lembrem uma linha de execução.
- Layout legível em desktop e mobile.
- Use somente recursos locais: CSS, SVG inline ou elementos HTML. Não dependa de imagens remotas.
- Animações sutis devem respeitar `prefers-reduced-motion`.

## Qualidade e acessibilidade

- HTML semântico e hierarquia correta de headings.
- Navegação e CTAs acessíveis por teclado, com foco visível.
- Contraste adequado e `aria-label` quando necessário.
- Não deixe warnings de TypeScript ou erros no console da página.

## Testes E2E obrigatórios

Gere `playwright.config.ts` e pelo menos um arquivo em `tests/e2e/`.
Os testes devem abrir a aplicação real por HTTP e validar:

1. o heading principal e as duas chamadas do hero;
2. os cards de Codex, Cursor e Claude;
3. a seção do fluxo e a seção de evidências;
4. a navegação por âncora ao clicar em pelo menos um link;
5. ausência de overflow horizontal em viewport mobile.

Configure Playwright para produzir screenshot, vídeo e trace. O `baseURL` deve
aceitar `PLAYWRIGHT_BASE_URL`. Não configure `webServer` no
`playwright.config.ts`: neste ambiente a sondagem de porta fechada do Playwright
pode bloquear antes de iniciar o servidor. Preserve
`scripts/run-e2e.mjs` e `scripts/child-env.mjs`, já fornecidos pelo repositório,
e configure
`test:e2e` como `node scripts/run-e2e.mjs`. Esse runner inicia um Vite próprio
na porta `PLAYWRIGHT_PORT`, usa `4173` apenas como padrão local, aguarda HTTP
com timeout explícito, usa uma allowlist de ambiente sem tokens/credenciais e
encerra todo o grupo de processos. Assim nenhum teste reutiliza outra aplicação
nem expõe segredos do agente ao Vite ou ao Playwright.
Use seletores acessíveis exatos (`exact: true`) quando um nome puder aparecer
em mais de um heading.

## Evidência obrigatória

Depois de executar o build e o E2E, grave um manifesto real em
`.symphony/evidence/manifest.json` na raiz do workspace. Copie para
`.symphony/evidence/artifacts/`:

- o relatório do build;
- screenshot full-page desktop;
- screenshot full-page mobile;
- vídeo WebM do Playwright;
- uma cópia MP4/H.264 do vídeo, gerada com `ffmpeg`;
- trace do Playwright.

Todos os artefatos devem ser arquivos ou diretórios reais dentro dessa árvore;
não use symlinks nem caminhos que escapem de `.symphony/evidence/`.

O manifesto deve possuir um run `unit` para `npm run build` e um run `e2e`
para o teste focado, ambos com os status realmente observados. No run E2E,
registre `navigations` com a URL HTTP real, `proof`, screenshots e vídeos como
objetos rotulados. Não invente arquivos, comandos ou resultados.

## Finalização

- Instale somente as dependências necessárias.
- Execute `npm run build`.
- Execute o teste E2E focado que você criou.
- Corrija falhas que estejam dentro do projeto.
- Se esta tarefa estiver sendo executada pelo orquestrador Symphony, mantenha o
  Codex Workpad atualizado, marque o escopo completo somente após a validação,
  faça commit e envie a branch para o `origin` local configurado. Não tente
  abrir um PR externo para o repositório local do benchmark.
- No resumo final, informe os arquivos principais e os comandos realmente executados; não afirme que um teste passou se ele não foi executado com sucesso.
