# Symphony Sidebar Redesign — Design

> Redesenha a navegação lateral global do Symphony usando a hierarquia do
> Codex e os menus contextuais do Cursor como referências. A nova arquitetura é
> orientada a projeto e representa diretamente **Projeto → Workspace → Sessão**.

## 1. Problema

A sidebar atual (`tracker/src/components/layout/ProjectSidebar.tsx`) separa o
trabalho em dois blocos independentes:

- **Recents**: conversas e execuções recentes, sem hierarquia de workspace;
- **Boards**: projetos em uma lista plana.

Essa separação exige que o usuário reconstrua mentalmente a relação entre
projeto, workspace e sessão. Ela também duplica parte da troca de projetos
existente no `ProjectSwitcher`, oferece poucas ações contextuais e desaparece
completamente abaixo do breakpoint `md`.

## 2. Objetivos

1. Tornar o projeto a raiz da navegação.
2. Exibir workspaces e suas sessões diretamente sob cada projeto.
3. Priorizar atividade atual e recente sem deixar a árvore excessivamente
   longa.
4. Disponibilizar ações contextuais coerentes em cada nível.
5. Substituir os blocos separados `Recents` e `Boards` por uma única árvore.
6. Preservar contexto e navegação em desktop expandido, desktop recolhido e
   mobile.
7. Reutilizar os dados, rotas e atualizações já existentes sempre que possível.
8. Manter a sidebar operável por teclado e compreensível por tecnologias
   assistivas.

## 3. Não objetivos

- Redesenhar o conteúdo do board, KB, observabilidade ou settings.
- Alterar a semântica de branches ou mover diretórios físicos ao renomear um
  workspace.
- Substituir o `ProjectHeader`; ele continua responsável pelas visualizações
  internas do projeto.
- Criar um novo sistema genérico de notificações.
- Sincronizar preferências da sidebar entre dispositivos na primeira versão.
- Exibir todos os workspaces e todas as sessões de todos os projetos no mount.

## 4. Referências e direção escolhida

### Codex

- Repositórios como agrupadores principais.
- Conversas apresentadas dentro do contexto ao qual pertencem.
- Controles globais de agrupamento, ordenação, filtros e itens arquivados.
- Densidade alta com atividade recente em primeiro plano.

### Cursor

- Ações contextuais em menus `···`.
- Ação primária próxima ao cabeçalho do agrupamento.
- Estados e opções diferentes conforme o tipo do item.
- Separação visual entre ações normais e destrutivas.

### Direção aprovada

**Árvore contextual**:

```text
Projeto
├── Workspace principal
│   ├── Sessão de execução
│   └── Conversa
└── Feature workspace
    ├── Sessão de autoria
    └── Sessão de execução
```

As alternativas de lista plana de sessões e navegação dividida foram
descartadas porque perdem contexto ou duplicam os mesmos itens em mais de uma
área.

## 5. Arquitetura de informação

### 5.1 Navegação utilitária

O topo da sidebar contém:

1. **Nova sessão**
2. **Buscar**
3. **Automações**
4. **Configurações**

`Nova sessão` usa diretamente o workspace quando a rota ativa resolve para um
nó de workspace ou para uma sessão filha dele. Em qualquer outra rota, abre um
seletor obrigatório de projeto e workspace. O usuário pode criar um novo
workspace a partir desse seletor.

### 5.2 Árvore principal

A árvore usa três tipos explícitos de nó:

- **Projeto**: projeto local do Symphony.
- **Workspace**: workspace principal, de issue ou standalone.
- **Sessão**: chat, autoria ou execução.

Cada linha possui três alvos independentes:

- clique no conteúdo: navega para o item;
- clique no chevron: expande ou recolhe;
- clique em `···`: abre o menu contextual.

Projetos e workspaces podem permanecer expandidos simultaneamente. Os dados de
um projeto são carregados apenas em sua primeira expansão e ficam em cache
durante a sessão da página. Recolher um projeto encerra atualizações ativas
daquele ramo, mas mantém o último snapshot para reabertura imediata.

### 5.3 Ordenação e densidade

Por padrão:

1. itens fixados;
2. itens com execução ativa, erro ou aprovação pendente;
3. itens restantes por `updated_at` decrescente;
4. empate por nome.

A visualização inicial mostra workspaces ativos e recentes. O limite visual é
aplicado por projeto, sem descartar os itens do cache. **Mais…** expande os
demais itens; filtros e busca também podem revelá-los.

O menu global da seção oferece:

- agrupamento;
- ordenação;
- filtros por status, agente e atividade;
- inclusão ou exclusão de arquivados;
- recolher tudo;
- marcar tudo como lido quando existir ao menos uma conversa não lida.

### 5.4 Informação exibida

**Projeto**

- nome;
- quantidade de workspaces ativos;
- indicador agregado de erro ou atividade;
- estado expandido/recolhido.

**Workspace**

- nome exibido;
- tipo: principal, issue ou standalone;
- branch resumida quando útil;
- quantidade de sessões;
- indicador agregado de status.

**Sessão**

- título;
- tipo: chat, autoria ou execução;
- status;
- agente quando `agentKind` estiver presente;
- tempo desde a última atividade;
- marcador de não lida ou revisão quando o respectivo estado estiver presente.

Textos longos usam truncamento visual, mas o nome completo permanece acessível
por tooltip e nome acessível.

## 6. Ações contextuais

Os menus são gerados por capacidade. Uma ação irrelevante para aquele tipo de
item é omitida; uma ação temporariamente indisponível por estado ou permissão
fica desabilitada e explica o motivo.

### 6.1 Projeto

- **Novo workspace**
- **Nova sessão**
- **Abrir board**
- **Abrir documentação**
- **Editar configurações**
- **Renomear**
- **Arquivar**
- **Remover**

`Nova sessão` solicita um workspace existente ou oferece criar um. `Remover`
retira o projeto do Symphony; nunca apaga o repositório remoto ou diretórios
fora dos contratos já existentes.

### 6.2 Workspace

- **Nova sessão**
- **Abrir no editor**
- **Abrir terminal**
- **Fixar/Desafixar**
- **Renomear**
- **Copiar branch**
- **Copiar caminho**
- **Remover/Limpar workspace**

Renomear altera apenas o nome de exibição armazenado pelo Symphony. Branch e
caminho físico permanecem inalterados. O workspace principal não pode ser
removido pela sidebar.

### 6.3 Sessão

- **Renomear**
- **Adicionar ou remover labels**
- **Marcar ou desmarcar para revisão**
- **Copiar comando de retomada**, quando disponível
- **Arquivar**
- **Excluir**, somente para sessões locais que suportem exclusão

Sessões vinculadas a issues reutilizam o título e as labels da issue, evitando
duas fontes de verdade. Sessões freeform armazenam título e labels no próprio
thread. A marcação de revisão é uma propriedade da sessão, não uma mudança
automática do status da issue.

Execuções não são apagadas pela sidebar. Quando não houver uma entidade local
excluível, apenas **Arquivar** é oferecido.

### 6.4 Segurança das ações

- Ações destrutivas ficam após um separador e usam tom destrutivo.
- Arquivar pode usar confirmação leve quando for reversível.
- Remover e excluir exigem confirmação explícita com o nome do alvo.
- Cliques repetidos ficam bloqueados enquanto a operação estiver pendente.
- Falhas mantêm o item e mostram erro acionável; não há remoção otimista para
  ações destrutivas.

## 7. Estado e persistência

Persistência local:

- sidebar expandida ou recolhida;
- projetos e workspaces expandidos;
- itens fixados;
- agrupamento, ordenação e filtros;
- exibição de arquivados.

Entradas persistidas são validadas ao carregar. IDs ausentes, valores inválidos
ou preferências incompatíveis com a versão atual são descartados sem bloquear
a renderização.

O item selecionado é derivado da rota atual. A rota prevalece sobre preferências
persistidas e força a expansão dos ancestrais necessários.

## 8. Dados e fluxo de atualização

### 8.1 Fontes existentes

- projetos: `listProjects()`;
- sessões recentes: `listRecents()`;
- issues e execuções: `listIssues()` + `useAgentExecutions()`;
- workspaces: `fetchWorkspaceInventory()` /
  `subscribeWorkspaceInventory()`;
- rotas de sessão: helpers em `workspaceRoutes`;
- associação de sessões a workspaces: regras atualmente usadas por
  `buildWorkspaceCards()`.

### 8.2 Modelo de apresentação

A sidebar ganha um adaptador de domínio puro que converte as fontes existentes
em uma árvore imutável:

```ts
type SidebarNode =
  | SidebarProjectNode
  | SidebarWorkspaceNode
  | SidebarSessionNode;
```

O adaptador não renderiza UI e não executa requests. Ele:

- associa sessões a workspaces;
- agrega status dos filhos;
- aplica ordenação;
- separa itens visíveis e itens de **Mais…**;
- resolve capacidades de cada menu.

Isso evita acoplar `ProjectSidebar` aos cards da página de Workspaces e permite
testes unitários sem React.

### 8.3 Carregamento

1. O shell carrega a lista de projetos.
2. A rota atual expande e carrega o projeto ativo.
3. Expandir outro projeto inicia inventário, issues e sessões daquele projeto.
4. O snapshot é renderizado incrementalmente.
5. Atualizações de inventário e sessões atualizam somente o ramo afetado.
6. Recolher o projeto encerra subscriptions daquele ramo.

Não é permitido fazer fan-out de requests para todos os projetos no mount.

### 8.4 Falhas

- Falha inicial de projetos: estado de erro com **Tentar novamente**.
- Falha em um ramo: mantém os outros projetos navegáveis.
- Falha após sucesso: mantém o último snapshot e marca o ramo como
  desatualizado.
- Inventário indisponível: mantém o projeto e sessões que ainda possam ser
  resolvidas, agrupando itens sem workspace em **Sem workspace**.
- Sessão cujo workspace foi removido: aparece temporariamente em
  **Sem workspace** até atualização ou arquivamento.

## 9. Layout e responsividade

### 9.1 Desktop expandido

- largura base de `288px`;
- uma única região de scroll para a árvore;
- topo utilitário e rodapé permanecem visíveis;
- menus contextuais podem extrapolar a largura da sidebar sem causar scroll
  horizontal.

### 9.2 Desktop recolhido

- rail com ícones de navegação;
- tooltips acessíveis;
- indicador de atividade agregada;
- item atual permanece identificável;
- abrir busca, nova sessão ou um projeto pode expandir temporariamente a
  sidebar.

### 9.3 Mobile

A sidebar deixa de usar `hidden md:flex` como única estratégia. Em telas
menores:

- um botão no header abre um drawer modal;
- foco fica preso no drawer enquanto aberto;
- `Escape` e clique no backdrop fecham;
- navegar fecha o drawer;
- o estado da árvore é preservado entre aberturas.

## 10. Acessibilidade

- A árvore usa semântica `tree`, `treeitem` e `group` ou uma estrutura
  equivalente validada com leitor de tela.
- `aria-expanded` existe somente em nós expansíveis.
- Teclas:
  - `↑`/`↓`: item anterior/próximo visível;
  - `→`: expandir ou entrar no primeiro filho;
  - `←`: recolher ou voltar ao pai;
  - `Enter`: abrir;
  - `Shift+F10`: abrir menu contextual;
  - `Escape`: fechar menu ou drawer.
- Menus preservam foco e devolvem foco ao gatilho ao fechar.
- Status nunca depende apenas de cor.
- Alvos interativos respeitam tamanho mínimo e não ficam disponíveis somente
  por hover.

## 11. Estados visuais

- **Loading inicial**: skeletons da navegação e dos projetos.
- **Loading de ramo**: skeletons somente dentro do projeto expandido.
- **Vazio**: projeto sem workspaces/sessões oferece criar workspace ou sessão.
- **Erro**: mensagem compacta no ramo e botão de retry.
- **Stale**: indicador discreto sem apagar dados.
- **Operação pendente**: ação desabilitada e progresso no item afetado.
- **Arquivado**: oculto por padrão e revelado por filtro.

## 12. Migração da UI atual

1. Manter links utilitários globais relevantes.
2. Substituir `RecentsSection` e a lista `Boards` pela árvore contextual.
3. Reutilizar rotas atuais; não criar URLs paralelas apenas para a sidebar.
4. Manter `ProjectSwitcher` no header durante esta entrega.
5. Preservar a preferência atual de sidebar recolhida e migrar as novas
   preferências sob uma chave versionada.
6. Remover componentes antigos somente quando não houver outros consumidores.

## 13. Componentes e limites propostos

- `ProjectSidebar`: shell, responsividade e composição.
- `SidebarUtilityNav`: ações globais.
- `ProjectNavigationTree`: semântica e navegação da árvore.
- `ProjectTreeItem`, `WorkspaceTreeItem`, `SessionTreeItem`: apresentação por
  tipo.
- `SidebarContextMenu`: menu orientado por capacidades.
- `SidebarFiltersMenu`: agrupamento, ordenação e filtros.
- `useSidebarTree`: carregamento lazy, cache e subscriptions.
- `sidebarTree`: transformação pura e agregação de dados.
- `sidebarPreferences`: leitura, validação, migração e persistência local.

Os componentes de linha não fazem requests. Mutações ficam em hooks/serviços e
retornam resultados explícitos para que a UI trate sucesso e falha.

## 14. Testes

### 14.1 Unidade

- construção Projeto → Workspace → Sessão;
- sessões sem workspace;
- ordenação de fixados, ativos e recentes;
- agregação de status;
- limite visual e **Mais…**;
- resolução de capacidades por tipo e estado;
- validação/migração de preferências inválidas.

### 14.2 Componentes

- expandir/recolher com mouse e teclado;
- rota ativa expande ancestrais;
- menus corretos para cada nível;
- ações destrutivas exigem confirmação;
- foco retorna ao gatilho;
- loading, vazio, erro, stale e pending;
- modo recolhido;
- drawer mobile.

### 14.3 Integração direcionada

- primeira expansão carrega o projeto uma vez;
- reabertura usa cache e retoma updates;
- recolher encerra subscription;
- falha de um projeto não bloqueia os demais;
- criar workspace/sessão atualiza e seleciona o novo item;
- arquivar remove o item da visualização padrão sem perder acesso via filtro.

Sob WSL, cada comando de validação executa apenas um arquivo ou filtro
direcionado por vez.

## 15. Critérios de aceitação

1. A sidebar representa Projeto → Workspace → Sessão.
2. `Recents` e `Boards` não aparecem mais como listas independentes.
3. A rota atual expande automaticamente seus ancestrais.
4. Workspaces e sessões são carregados somente quando o projeto é expandido.
5. Ativos e recentes aparecem antes dos demais; **Mais…** revela o restante.
6. Projeto, workspace e sessão exibem menus coerentes com este documento.
7. Ações destrutivas têm confirmação e tratamento de falha.
8. Desktop expandido, desktop recolhido e drawer mobile são navegáveis.
9. A árvore funciona por teclado e status não depende apenas de cor.
10. Falhas mantêm dados válidos anteriormente carregados.
11. Preferências inválidas não quebram a sidebar.
12. Testes direcionados cobrem transformação, interação, responsividade e
    carregamento lazy.

## 16. Riscos e mitigação

- **Muitos projetos expandidos geram várias subscriptions.**
  Carregamento só ocorre sob demanda e subscriptions são encerradas ao
  recolher.
- **Sessão sem associação confiável de workspace.**
  Exibir em **Sem workspace** em vez de esconder.
- **Duplicação com `ProjectSwitcher`.**
  Mantê-lo nesta entrega evita ampliar o escopo; sua remoção pode ser avaliada
  separadamente após uso real.
- **Menus extensos.**
  O menu é orientado por capacidades, mantém ações destrutivas separadas e
  omite opções irrelevantes.
- **Regressão mobile.**
  O drawer substitui explicitamente a ausência atual da navegação abaixo de
  `md`.

## 17. Fora da primeira implementação, mas compatível

- preferências sincronizadas por usuário;
- drag-and-drop para reordenar fixados;
- virtualização para árvores muito grandes;
- badges de contagem configuráveis;
- remoção do `ProjectSwitcher` após validação da nova árvore;
- atalhos personalizáveis para criação e busca.
