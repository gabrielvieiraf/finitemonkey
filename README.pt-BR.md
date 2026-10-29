# Finite Monkey

<p align="center">
  <a href="https://www.npmjs.com/package/finitemonkey/v/next"><img src="https://img.shields.io/npm/v/finitemonkey/next?color=cb3837&logo=npm&label=npm%40next" alt="npm"></a>
  <a href="https://www.npmjs.com/package/finitemonkey"><img src="https://img.shields.io/npm/dm/finitemonkey?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml"><img src="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml/badge.svg?branch=next" alt="CI"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/next/README.pt-BR.md#instala%C3%A7%C3%A3o-planejada"><img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757?logo=anthropic&logoColor=white" alt="Claude Code plugin"></a>
</p>

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animação: um macaco de moletom amarelo esmurra o teclado de um notebook enquanto um terminal roda o portão. As verificações que falham ficam verdes e travam uma a uma até aparecer actually done, e o macaco comemora com uma banana.">
  <br>
  <sub>Ilustração. A gravação abaixo é a ferramenta de verdade.</sub>
</p>

<p align="center">
  <img src="assets/gate.gif" width="720" alt="Gravação de uma sessão do Claude Code. Pedem para ele somar um cupom ao carrinho sem rodar os testes; ele roda o portão mesmo assim, vê o teste total rounds to cents falhar, arredonda o resultado e roda de novo. O hook de Stop então informa: portão verde, 10 checagens passaram nesta árvore.">
  <br>
  <sub>Gravação real, finitemonkey 0.1.0-next.27 com Claude Code 2.1.283, acelerada 1,3×. Fonte: <a href="assets/gate.cast">assets/gate.cast</a>.</sub>
</p>

**Infinitos macacos não são necessários. Um basta: você.**

[English](README.md) | Português (Brasil) | [Español](README.es.md)

> **Pré-lançamento.** Ainda não dá para instalar. O nome `finitemonkey` no npm está reservado (a 0.0.0 é só um marcador) e o código está sendo feito em público. Tudo abaixo é o plano, não o que acontece hoje. Dê uma estrela ou acompanhe o repositório se quiser saber quando sair a v0.1.

Eu sei como é. Com o advento da IA, muita coisa mudou.

Uns batem a cabeça no teclado esperando que o Claude cuspa magicamente o próximo SaaS bilionário. Outros já cansaram de digitar código. E tem quem precise entregar, em dias, o que antes exigiria equipes inteiras trabalhando por meses.

O resultado é quase sempre o mesmo: você vira um macaco na frente do computador, soterrado por tanta coisa para fazer que já não sabe por onde começar, muito menos como terminar.

O Finite Monkey foi criado para ser o portão entre esse macaco e a `main`.

Digite do jeito que quiser. Trabalhe com a IA que preferir. Produza código na velocidade que conseguir.

O Finite Monkey cuida primeiro do que não pode ficar na base da confiança: as verificações.

Cada verificação aprovada fica registrada. Cada falha continua visível até ser resolvida. E nada é considerado pronto sem evidências de que realmente funciona.

Não importa quanto código foi gerado, quantos agentes trabalharam ou quão convincente parece a resposta da IA. Se não passou pelas verificações, não está pronto.

E o portão é só o começo: o Finite Monkey também percebe quando você está dando voltas, mostra o que falta num projeto maior que você, segura as rédeas de vários agentes ao mesmo tempo e leva tudo até produção sem quebrar nada pelo caminho.

Um macaco. Tempo finito. Trabalho que sai de verdade.

## O Claude Code diz que terminou, mas não terminou

Esse é o principal problema que o Finite Monkey quer resolver. Comportamento planejado:

- Cada tarefa ganha uma **definição de pronto** que a máquina consegue checar: comandos que precisam passar, testes que precisam existir e passar, um diff que não sai do escopo.
- Quando o Claude tenta encerrar a sessão, o hook `Stop` roda essa checagem. Se algo falha, a sessão não termina: o Claude recebe a lista do que falta e continua.
- Só vale como prova o comando que o próprio Finite Monkey rodou, no estado atual dos arquivos. "Rodei os testes antes da última edição" não conta.
- O relatório final sai só dessa prova.

## O Claude pulou ou apagou testes para eles passarem

Travas planejadas nas edições: teste removido, `skip` ou `only` novo, asserção apagada e mexida na configuração do próprio portão são pegos e reportados.

## O Claude rodou `git reset --hard` e eu perdi trabalho

Planejado:

- Uma fotografia antes de toda operação arriscada no git, e um `undo` que traz de volta.
- Nada de `--force`, nunca.
- Worktree com mudança pendente é arquivada, não apagada.
- Uma checagem de "nada se perdeu" em todo merge.

## As regras do meu CLAUDE.md são ignoradas, ainda mais depois da compactação

São mesmo. O Claude lê o `CLAUDE.md` como parte do contexto, e nada confere se ele foi seguido. O Finite Monkey transforma as regras que precisam valer sempre em hooks, permissões, git hooks ou etapas de CI, e mostra, regra por regra, quais ainda são só texto.

## Como impedir o Claude Code de vazar segredos?

Planejado: uma regra única de detecção, aplicada quando um arquivo é escrito, no prompt, no commit, no histórico e no CI. Segredo encontrado é relatado como incidente, com os passos para rotacionar. O segredo é citado por arquivo e linha, nunca pelo valor.

## Como impedir um agente de mexer na produção na mão?

Planejado: comandos com efeito num servidor de produção são bloqueados. Produção muda pelo caminho de deploy que você declarar.

## Mais que um portão (planejado)

O portão vem primeiro porque nada mais importa se o "pronto" pode ser mentira. O resto do plano é sobre quem está digitando:

- **Quando você está dando voltas.** A quarta correção para o mesmo erro, o mesmo arquivo editado para lá e para cá, um bug colado de uma IA para outra e de volta: o Finite Monkey percebe a volta e diz isso com todas as letras, com o que tentar no lugar.
- **Quando o projeto é maior que você, por enquanto.** Quem nunca colocou um SaaS no ar não sabe que ele precisa de login, cobrança, backup e um jeito de voltar atrás. As plantas de projeto mostram o que uma versão de verdade precisa e o que ainda falta, para uma tela de login não ser chamada de produto. As explicações acompanham o que você já sabe e vão sumindo conforme você aprende.
- **Quando uma decisão pesa.** Antes de trocar uma biblioteca ou um fornecedor: o que existe hoje, quais as opções, os critérios escritos antes dos candidatos, o custo e como voltar.
- **Quando você roda vários agentes ao mesmo tempo.** Frentes de trabalho em paralelo, cada uma na sua branch, um merge que confere que nada se perdeu e uma tela com o que cada frente está fazendo.
- **Quando uma regra precisa valer em todo lugar.** A regra que você escreve uma vez vira hook, permissão, git hook e passo de CI, e você vê onde ela ainda é só texto.
- **Quando vai para produção.** CI, deploy e infraestrutura no tamanho do projeto, e checagens de organização de código para bases que cresceram rápido demais.

## Nenhum comando para decorar

Você roda um comando, uma vez. Depois disso o Finite Monkey age pelo contexto, dentro do Claude Code:

- **Hooks** fazem a parte de obrigar: `SessionStart` recupera o estado da tarefa, `UserPromptSubmit` percebe o que você pediu, `PreToolUse` barra a ação perigosa antes de acontecer, `Stop` não deixa terminar enquanto a definição de pronto falha, e `SubagentStop` confere o que os subagentes relatam.
- **Skills** são acionadas pelo próprio Claude quando a situação pede.
- **Comandos com barra** são atalhos opcionais. Nenhum fluxo depende de você lembrar de um.
- **O estilo de saída `report`** é opcional e vem desligado. Escolha com `/output-style report` se quiser toda resposta no formato do relatório final: resultado primeiro, depois verificado, não verificado e pendente, com FATO, OPINIÃO e INFERÊNCIA marcados. Ele mantém as instruções de programação do Claude Code (`keep-coding-instructions: true`).

## Instalação (planejada)

Ainda não disponível. Quando a v0.1 sair:

```sh
npx finitemonkey@latest init
```

Ou como plugin do Claude Code, de dentro da sessão:

```
/plugin install finitemonkey --marketplace gabrielvieiraf/finitemonkey
```

Requisitos: Node.js 20 ou mais novo, em Linux, macOS, Windows ou WSL. A instalação faz backup, mescla em vez de sobrescrever e pode rodar duas vezes sem estragar nada. `doctor` diz o que está errado, `uninstall` deixa tudo como estava.

**Mais preguiçoso ainda:** peça ao Claude Code "instale o Finite Monkey seguindo docs/AGENT-SETUP.pt-BR.md". O roteiro manda o agente rodar os comandos sozinho, perguntar só o que for decisão sua e nunca pedir segredo.

## De onde vem o desenho

O Finite Monkey parte de um estudo sobre o que acontece quando alguém trabalha com IA acima do que consegue julgar. O ensaio [Efeito Ricochete: o usuário como limite invisível da inteligência artificial](docs/ricochet/ricochet.pt-BR.md) descreve duas fronteiras que a pessoa não vê de dentro: o que ela não sabe pedir e o que não consegue avaliar. A seção 10 mostra como cada mecanismo daqui põe uma verificação executável nesses dois pontos e quais hipóteses a bancada vai testar.

## Funciona de verdade? (benchmark, planejado)

Ainda não se sabe. O benchmark planejado compara o Claude Code sozinho, o Claude Code com o Finite Monkey e o Finite Monkey sem uma peça de cada vez, em tarefas com armadilha. Ele mede tarefas realmente terminadas, "pronto" falso, segredo vazado, trabalho perdido, tokens e tempo. Regra sem efeito medido sai do núcleo. Método e resultados brutos vão ficar neste repositório, inclusive onde não ajudou.

<!-- generated:evidence:start -->
Taxas de erro dos guards sempre ligados, reproduzidas com `npm run evidence` na versão 0.1.0-next.40 sobre o corpus rotulado em [bench/corpus](bench/corpus). Uma release falha quando a taxa de falso positivo de um guard passa de 15% ou quando o corpus dele tem menos de 50 casos que devem bloquear ou 50 que devem passar. Por enquanto todo caso é sintético, escrito a partir das listas de teste dos próprios guards; casos de sessões reais vão ser contados à parte.

| Guard | Deve bloquear | Deve deixar | Falsos positivos | Falsos negativos | p95 (ms) |
|---|---|---|---|---|---|
| `secrets` | 59 | 54 | 0/54 (0.0%) | 0/59 (0.0%) | 0.4 |
| `gate` | 52 | 52 | 0/52 (0.0%) | 0/52 (0.0%) | 0.3 |
| `git` | 55 | 59 | 1/59 (1.7%) | 0/55 (0.0%) | 95.8 |
| `rules` | 50 | 55 | 0/55 (0.0%) | 0/50 (0.0%) | 2.5 |

Custo contra o Claude Code puro nas mesmas tarefas: ainda não medido.
<!-- generated:evidence:end -->

## Qual a diferença para...?

A comparação completa, com fontes, está em [docs/compare.pt-BR.md](docs/compare.pt-BR.md).

- **O Claude Code puro** já tem hooks e permissões. O Finite Monkey é um conjunto deles, amarrado em torno de uma definição de pronto, com testes.
- **Métodos como superpowers, GSD, Spec Kit ou OpenSpec** dizem ao agente como planejar e construir. O Finite Monkey não substitui nenhum deles: confere o resultado no fim, seja qual for o método.
- **Guardas avulsos como tdd-guard, cc-safety-net ou dcg** fazem um trabalho cada um, e bem. O Finite Monkey cobre quatro danos com um portão, uma instalação e um `undo`. Se você só precisa de um desses trabalhos, um guarda avulso pode ser a escolha mais simples.

<!-- generated:defaults:start -->
## Padrões e a evidência de cada um

Um conjunto de padrões para todo mundo, gerado a partir de `src/defaults/items.ts`. Cada item vem de práticas encontradas em 78 sessões locais e três repositórios. Orientação que ajuda quem começa pode atrapalhar quem já domina (efeito de reversão da expertise, Kalyuga et al. 2003), então qualquer item desliga com `defaults: <item>: off` em `.finitemonkey/config.yml`, e uma convenção do repositório diferente de um padrão gera uma pergunta, uma vez.

| Padrão | O que faz | Evidência |
|---|---|---|
| `no-attribution` | Sem crédito de IA em commits e pull requests: `attribution` é esvaziado nas configurações quando não definido, e o guard e o hook `commit-msg` bloqueiam linhas `Co-Authored-By` de ferramentas de IA e rodapés `Generated with`. | Mantido nos três repositórios estudados e corrigido à mão nas sessões locais: o commit é trabalho da pessoa. Regra I3 deste repositório. |
| `branch-names` | Um branch novo precisa se chamar `tipo/issue-descricao`; outro nome é bloqueado em vez de só gerar aviso. | Um pull request por issue, achado pelo nome do branch, nos três repositórios. |
| `prose-blocks` | Texto de commit, pull request e issue e Markdown alterado com cara de texto de máquina são bloqueados em vez de só gerar aviso. | Corrigido nas sessões locais e mantido nos três repositórios. Cada padrão está no catálogo de prosa com o seu corpus de teste. |
| `research-first` | Uma dependência nova precisa de um registro de pesquisa antes de o portão passar. | Pesquisa antes do desenho, com registro de decisão, nas sessões locais e nos três repositórios. |
| `no-comments` | Comentários `TODO` e `FIXME` não entram como dívida; a dívida fica no registro gravado quando a tarefa fecha. | Sem comentários no código nos três repositórios. Regra I1 deste repositório. |
| `no-time-estimates` | A checagem de prosa aponta estimativas de tempo em planos (`docs/plan/`) e relatórios. | Prática das sessões locais: planos e relatórios dizem o que está pronto, o que falta e o que bloqueia, sem estimativas. |
| `conventional-commits` | Cabeçalhos de commit seguem Conventional Commits, conferidos pelos hooks `commit-msg` e `pre-push` e pela CI. Quando a maioria dos commits recentes é diferente, o `init` pergunta uma vez e guarda a resposta em `conventions.commits`. | Usado nos três repositórios, onde a versão sai dos tipos de commit. Regra I4 deste repositório. |
<!-- generated:defaults:end -->

<!-- generated:footprint:start -->
## O que ele lê, grava e envia

Gerado a partir de `src/core/footprint.ts`, a lista que os testes cobram do código. Sem telemetria. Caminhos são relativos ao projeto, exceto os que começam com `~`.

| | O quê | Para quê |
|---|---|---|
| Lê | `stdin` | O evento que o Claude Code passa a cada hook: a chamada de ferramenta, o prompt ou o pedido de parada. |
| Lê | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | As configurações do Claude Code, para conferir que os hooks estão instalados e que nada os desliga. `$CLAUDE_CONFIG_DIR` substitui `~/.claude` quando definido. |
| Lê | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Arquivos de instrução, lidos pelo `doctor` para apontar regras que só existem como texto. |
| Lê | `~/.claude/projects/` | Os logs locais de sessão do Claude Code deste projeto: lidos uma vez com `init --look-back`, e lidos aos poucos a cada prompt só quando há um teto de gasto em `.finitemonkey/config.yml`. |
| Lê | `~/.claude/plugins/`, `~/.claude/debug/latest` | O `doctor` lê os plugins instalados e os arquivos de hook deles para listar cada hook e achar conflitos; o `doctor --hooks` também lê o log de debug mais recente do Claude Code para os tempos dos hooks. Nunca altera arquivos de outro plugin. |
| Lê | `.git/` | O repositório pelo comando `git`: status, diffs, refs e o reflog. |
| Lê | `git diff` | Arquivos alterados, varridos atrás de segredos, testes pulados, placeholders e padrões de prosa. |
| Lê | `.finitemonkey/config.yml`, `.finitemonkey/policy.yml`, `.finitemonkey/briefing.md`, `.finitemonkey/look.yml`, `.finitemonkey/appsec.yml`, `.finitemonkey/routes-public.yml`, `.finitemonkey/rules.yml`, `.finitemonkey/arch.yml` | A configuração do projeto, a política dos guards e o briefing opcional para subagentes. |
| Lê | `.finitemonkey/profile.yml`, `~/.finitemonkey/profile.yml` | O nível da pessoa por domínio; o nível de infraestrutura escolhe os padrões de git (intermediário quando falta). |
| Lê | `~/.claude/CLAUDE.md`, `~/.claude/rules/`, `/etc/claude-code/CLAUDE.md`, `../CLAUDE.md` | O `finitemonkey instructions` e o `doctor` leem cada arquivo de instruções que o Claude Code carregaria: o `CLAUDE.md` gerenciado, o seu `~/.claude/CLAUDE.md` e `~/.claude/rules/`, e cada `CLAUDE.md`, `CLAUDE.local.md` e `AGENTS.md` da pasta onde você trabalha até a raiz do disco, para listá-los e achar regras que se contradizem. |
| Grava | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/verify/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` e `update`: configuração dos hooks (e, com `--sandbox`, o sandbox nas suas configurações locais), a skill verify, um bloco gerenciado curto no `AGENTS.md` que o `CLAUDE.md` importa, uma linha no `.gitignore`, o runtime fixado e um backup de cada arquivo que alteram. |
| Grava | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Contratos de tarefa e qual tarefa está ativa. |
| Grava | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | A evidência de cada checagem, ligada ao hash da árvore, e o log do portão. |
| Grava | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Aprovações e liberações digitadas pela pessoa, e um cache curto dos pull requests abertos. |
| Grava | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | A baseline de achados aceitos e os incidentes de exposição. Os dois guardam impressões e máscaras, nunca o valor de um segredo. |
| Grava | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/`, `.git/finitemonkey/snapshots/` | Snapshots antes de comandos git destrutivos e de `rm` no repositório, com cópias de arquivos ignorados e de segredos não rastreados até 50 MB dentro do .git, o diário que o `undo` lê e as decisões sobre linhas descartadas em merges. |
| Grava | `.finitemonkey/reports/` | Relatórios de bug mascarados que o `doctor --report` grava, só quando pedido, e o relatório que cada frente grava antes de parar. |
| Grava | `.finitemonkey/pr/` | Quem aceitou arquivos fora do escopo da tarefa no `pr open`, quando e por quê, um arquivo por branch. |
| Grava | `.finitemonkey/fronts.yml`, `.finitemonkey/briefing.md` | O estado de uma onda de frentes paralelas (escopo, worktree, branch, porta, agente, status e inbox de cada frente) e o briefing que todo prompt de frente cita. Local, nunca vai para commit. |
| Grava | `.finitemonkey/github-ruleset.json` | O ruleset que o `init --github` propõe quando a branch padrão não tem nenhum; só vai para o GitHub depois do sim da pessoa. |
| Grava | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | O registro de worktrees e os relatórios de mescla no diretório comum do git (nunca vão para commit), a linha de exclusão local para `.claude/worktrees/` e os worktrees criados pelo `wt new`; repositório em `/mnt/<disco>` ou em pasta sincronizada recebe os seus em `~/.finitemonkey/worktrees/`. O `wt archive` guarda um worktree em `refs/finitemonkey/archive/` e copia arquivos ignorados que não são segredo para `~/.finitemonkey/archive/`. |
| Grava | `.finitemonkey/creds.yml` | O `creds` grava o inventário de credenciais: nomes de variáveis, onde são lidas, ambientes, tipo e risco. Nunca um valor. |
| Grava | `.finitemonkey/findings/osv.json`, `.github/dependabot.yml`, `renovate.json` | O `deps scan` guarda a data em que cada vulnerabilidade conhecida apareceu pela primeira vez, para o prazo valer entre execuções. O `deps config --write` grava o arquivo do Dependabot ou do Renovate; sem `--write` ele só imprime. |
| Grava | `$FINITEMONKEY_HOLD_DIR/<session>.hold.json` | Só com `supervisor: enabled: true` na configuração: um arquivo de espera de vida curta por sessão no diretório que um supervisor de troca de conta anuncia, enquanto o portão roda ou segura a parada. O `gain` lê o `usage.json` desse diretório. |
| Grava | `.finitemonkey/semgrep/`, `.finitemonkey/data-map.yml` | O `appsec rules --write` grava as regras do semgrep geradas para a stack detectada, para o CI rodar; sem `--write` ele só imprime. O `data-map` grava uma linha por campo pessoal achado no schema (só nomes). |
| Grava | `.finitemonkey/rules-compiled.json`, `.github/workflows/finitemonkey-rules.yml` | O `rules compile` grava, para cada regra de `.finitemonkey/rules.yml`: entradas de deny e chaves de configuração em `.claude/settings.json`, uma linha no `AGENTS.md`, a lista do que gravou e, com `--ci`, um workflow que confere as regras nos pull requests. O `uninstall` remove tudo isso. |
| Grava | `.finitemonkey/look/` | Capturas de tela, a folha de contato e o resumo JSON que o `look` grava por hash da árvore. |
| Grava | `.finitemonkey/prompts.jsonl` | O que você digita para o Claude Code neste projeto, com segredos mascarados, para o `finitemonkey audit` achar pedidos e decisões que nunca chegaram a um documento. Fica nesta máquina. |
| Grava | `.finitemonkey/spend.json`, `.finitemonkey/spend-reconcile.jsonl` | O gasto do agente estimado a partir dos logs locais de sessão, por tarefa, dia e mês, e as diferenças achadas pelo `cost reconcile`. |
| Grava | `docs/plan/` | Documentos de plano em `docs/plan/`: o inventário do que o código faz hoje, registros de decisão, registros de pesquisa, modelos de custo, o plano mestre a partir da primeira tarefa L e a cópia dele guardada antes de cada consolidação. |
| Grava | `.finitemonkey/map.txt` | O mapa do código de `finitemonkey map`: uma linha por pasta com as definições de topo, em cache pelo hash da árvore, e o registro dos avisos de reuso com o resultado de cada um. |
| Grava | `.finitemonkey/signals.jsonl`, `.finitemonkey/signals-index.json`, `.finitemonkey/signals-profile.json` | Sinais de volta de `finitemonkey signals`: assinaturas de erro, hashes de edição e impressões dos pedidos (pares de palavras em hash, nunca o texto), o índice de voltas e os limiares calibrados. Apagados por `signals forget`. |
| Grava | `.finitemonkey/perfil.yml`, `.finitemonkey/perfil-commits.json`, `.finitemonkey/conceitos.yml` | O perfil da pessoa por domínio, de `finitemonkey perfil`: literacia na ferramenta e conhecimento do domínio, que sobem com palavras técnicas nos pedidos e com commits feitos fora da sessão, e o livro de conceitos com o nível mostrado em cada conceito visto no projeto. Nunca vai para commit, texto de PR ou relatório. Apagado por `perfil forget`. |
| Grava | `.finitemonkey/runs/` | A saída inteira dos comandos rodados por `finitemonkey run`, com segredos mascarados; ficam as 30 mais recentes. |
| Grava | `.finitemonkey/map.txt`, `.finitemonkey/reuse.json` | O mapa do código de `finitemonkey map`: uma linha por pasta com as definições de topo, em cache pelo hash da árvore, e o registro dos avisos de reuso com o resultado de cada um. |
| Grava | `.finitemonkey/review/`, `.claude/agents/verifier.md` | A contagem de rodadas de revisão usada pelo `review packet` e, só quando `review.playwright: true` está na configuração, um agente verificador com o MCP do Playwright. |
| Grava | `.finitemonkey/regression/` | Um worktree descartável do git no commit base, usado para checar que o teste novo de uma correção de bug falha sem a correção. Ele é removido depois da execução. |
| Grava | `.finitemonkey/suggestions.jsonl` | Sugestões de refatoração mostradas no fim de uma tarefa depois que o portão passa, com o que foi aceito, descartado ou fechado. Nada é mudado no código. |
| Grava | `~/.finitemonkey/heavy/` | Um arquivo de trava por instalação, compilação ou suíte de testes em andamento, compartilhado por todas as worktrees da máquina, para que rodem uma de cada vez (por padrão no WSL). |
| Grava | `.finitemonkey/instructions.jsonl` | O hook `InstructionsLoaded` acrescenta uma linha por arquivo de instruções que o Claude Code carrega: a sessão, o caminho, o motivo e quando. O `finitemonkey instructions` compara com o que ele resolveu. Nenhum conteúdo de arquivo é copiado. |
| Grava | `.finitemonkey/rules.yml`, `.finitemonkey/rule-violations.jsonl` | O `rules propose` acrescenta a `.finitemonkey/rules.yml` só as entradas que você confirma num terminal. Cada regra descumprida no fim de um turno, bloqueada por um guard ou informada com `rules violation` ganha uma linha em `rule-violations.jsonl` (regra, origem, detalhe mascarado), a evidência para promover um lembrete. |
| Grava | `.finitemonkey/learnings.jsonl` | Lições de trabalhos anteriores: um texto curto ligado a caminhos de arquivo ou à assinatura de um erro que parou depois de uma mudança, quantas vezes cada uma foi usada e quando combinou pela última vez. Uma lição sem uso por 90 dias ou marcada como inútil duas vezes é apagada; `learnings delete` remove uma à mão. |
| Grava | `.finitemonkey/ownership.yml` | O `gen ownership` grava uma entrada por peça (nome, tipo do vocabulário, dono, consumidores) depois que a pessoa passa `--yes`; `ci gate`, `ownership check` e `plan check` leem o arquivo, ou leem o `catalog-info.yaml` quando ele existe. |
| Grava | `.finitemonkey/ci-protect.jsonl` | Uma linha por configuração do GitHub que o `ci protect` mudou depois do sim da pessoa num terminal: quando, o repositório, a configuração, o valor antes e depois, e se o GitHub aceitou. O que ele leu fica em cache em `.finitemonkey/cache/github-settings.json` para o `doctor`. |
| Grava | `.finitemonkey/ci-watch/` | O `ci-watch` guarda, por pull request, os commits cuja CI falhou e quando o acompanhamento começou, mais uma linha por execução com o commit, o resultado de cada checagem, a classe da falha e a tentativa. Os logs de falha são lidos pelo `gh` com segredos mascarados e só as últimas linhas aparecem, sem ser guardadas. |
| Grava | `.finitemonkey/infra.yml`, `.finitemonkey/hosts.local.yml` | Como o projeto faz deploy, lido dos próprios arquivos quando você roda `finitemonkey infra`: nível, alvos e riscos com `arquivo:linha`, sem endereço. Hosts de produção achados nos arquivos de deploy vão para `hosts.local.yml`, que o git ignora, e só quando o bloco do `.gitignore` existe. |
| Grava | `observability/scrub.mjs`, `observability/log.mjs`, `observability/plan.yml` | Só com `finitemonkey observe --yes`, e só arquivos que ainda não existem: um scrubber de relatórios de erro, um logger em JSON com lista de campos permitidos e, a partir do nível 2, um plano para preencher. Nenhuma conta é criada em lugar nenhum. |
| Grava | `.github/workflows/deploy.yml`, `.github/workflows/drift.yml`, `deploy/remote.sh`, `deploy/compose.yml` | Só com `finitemonkey deploy generate --yes`, e só arquivos que ainda não existem: os workflows de deploy e de drift, o script que o servidor roda e o compose dele. Um arquivo existente nunca é sobrescrito; o diff aparece no lugar. |
| Grava | `.finitemonkey/golden/` | Saídas esperadas dos casos golden, um arquivo por caso, mais `accepted.jsonl` com quem gravou cada uma e quando. Só o `finitemonkey golden accept`, rodado pela pessoa num terminal, escreve nelas. |
| Grava | `docs/organize/` | O `finitemonkey organize plan <file>` grava um esqueleto de plano de divisão para esse arquivo, só quando o plano ainda não existe: responsabilidades com faixas de linhas e a sequência de passos pequenos. O ranking de hotspots fica em cache em `.finitemonkey/cache/`. |
| Grava | `src/api/`, `src/mocks/`, `app/api/`, `app/mocks/`, `lib/api/`, `lib/mocks/` | Só com `finitemonkey contract --write` ou `contract mocks --write`: o registro de endpoints, o cliente tipado, o envelope de erro e o teste de cobertura em `api/`, e os mocks MSW em `mocks/`, dentro de `src/`, `app/` (Remix) ou `lib/` (Next sem `src/`), gerados a partir de `api/contract.yml`. Arquivos existentes nunca são substituídos, a menos que a pessoa passe `--overwrite` num terminal. |
| Grava | `.github/workflows/ds-sync.yml` | Só com `finitemonkey ds-sync init --write`: um workflow que copia o design system do repositório de protótipos por um GitHub App da organização e mantém um pull request atualizado. O `ds-sync issue --yes`, rodado pela pessoa ou por esse workflow, abre ou edita issues pelo `gh`, reescrevendo só a seção entre os marcadores. |
| Grava | `ruff.toml`, `pytest.ini`, `scripts/check_no_comments.py`, `.github/workflows/ci.yml` | Só com `finitemonkey preset python --write` num projeto Python: regras do ruff para complexidade e tamanho, opções do pytest que falham com marcadores desconhecidos, um script que rejeita comentários no código, contratos do import-linter quando `.finitemonkey/arch.yml` existe e um workflow de CI com `uv sync --locked`. Um arquivo existente aparece como diff e é mantido. |
| Grava | `.finitemonkey/onboard.json`, `AGENTS.md` | O `finitemonkey onboard` roda os comandos de build, teste, lint e typecheck que acha nos manifestos e no AGENTS.md ou CLAUDE.md, com limite de tempo, e guarda em `onboard.json` e no seu próprio bloco do AGENTS.md só os que deram certo, mais o número de possíveis segredos achados por uma varredura única do histórico do git. Comandos que publicam, instalam ou ficam rodando não são executados. |
| Grava | `~/.finitemonkey/ledger.key` | Uma chave aleatória, criada na primeira vez que uma evidência é gravada, que assina cada linha do registro de evidências. Fica na sua pasta pessoal, fora do projeto, legível só por você. Linhas sem assinatura válida são ignoradas e relatadas; apagar a chave faz as evidências antigas contarem como não executadas. |
| Envia | `api.github.com` | Pelo `gh`, só quando ele está instalado e logado: o estado do pull request citado numa tarefa e os seus pull requests abertos para a linha da sessão. Código nunca é enviado. |
| Envia | `127.0.0.1` | Uma requisição ao seu próprio app na porta que a checagem `runtime` declara, depois de subir o app ou achá-lo rodando. Nada sai desta máquina. |
| Envia | `registry.npmjs.org`, `pypi.org` | O nome do pacote, ao registro do npm ou do PyPI, quando um comando de shell vai adicionar um pacote que o projeto ainda não declara. Nunca com `FINITEMONKEY_OFFLINE=1`. |
| Envia | `api.osv.dev` | Nomes e versões de pacotes dos seus lockfiles, para a base do OSV pelo `osv-scanner`, só quando você roda `deps scan` (no CI, por exemplo). Nunca a partir de um hook. |
| Envia | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | Pelo `curl`, só quando você roda `finitemonkey secrets live <provedor> --env <VARIAVEL> --send`: uma requisição com aquela chave para a API do provedor para ver se ela ainda funciona. Desligado por padrão, nunca roda por hook, e o host aparece antes de qualquer envio. |
| Envia | `deploy.version_url` | Pelo `curl`, só quando `deploy.version_url` está definido em `.finitemonkey/config.yml`: um GET nessa URL depois de um push, para ler qual commit está no ar. Com `deploy.environment`, a mesma pergunta vai aos deployments do GitHub pelo `gh`. |
| Envia | `hosts.local.yml` | Pelo `ssh`, só quando uma pessoa roda `finitemonkey infra --remote --yes` num terminal: comandos só de leitura (`docker ps`, `systemctl list-units`) nos hosts de `hosts.local.yml`. Nunca por hook nem por agente. |
| Envia | `headers.url` | Pelo `curl`, só quando `headers.url` está definido em `.finitemonkey/config.yml` e um contrato de tarefa tem o check `headers`: um GET por rota configurada, para ler os headers de segurança da resposta real. Sem isso, os headers vêm do app que o `look` já subiu em 127.0.0.1. |
| Envia | `hosts.local.yml`, `FINITEMONKEY_DEPLOY_HOST` | Pelo `ssh`, quando você roda `finitemonkey deploy check` (ou o workflow agendado dele, ou o check `deploy` do gate): comandos só de leitura (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) com o usuário só de leitura, para comparar a produção com a branch. Com `--issue`, uma issue do GitHub é aberta ou comentada pelo `gh`. |
<!-- generated:footprint:end -->

## Perguntas frequentes

Mais perguntas, uma para cada busca real, em [docs/faq.pt-BR.md](docs/faq.pt-BR.md).

**É um prompt?**
Não. São hooks e checagens que rodam lembrando o modelo ou não.

**Ele manda meu código para algum lugar?**
Não. Seu código nunca sai da sua máquina, e não há telemetria. A única chamada de rede é o `gh` perguntando ao GitHub sobre pull requests, e só quando o `gh` está logado. A lista completa está em [O que ele lê, grava e envia](#o-que-ele-lê-grava-e-envia).

**Vai me deixar mais lento?**
Tarefa pequena não tem cerimônia, só o portão no fim. Hook rápido continua rápido; a checagem cara roda no `Stop`. O CI reprova um pull request que leve um guard de `PreToolUse` acima de 50 ms no p95 ou que acrescente contexto no início da sessão; os limites estão em [budgets.json](budgets.json). Os tempos de ponta a ponta saem junto com o benchmark.

**E se ele barrar algo que não devia?**
Abra uma issue com o modelo "Blocked something it should not have" (bloqueou o que não devia). Falso positivo é tratado como bug e contado em público.

**Funciona com Codex, Cursor ou outros agentes?**
Primeiro o Claude Code. Os outros depois, se o benchmark disser que vale.

**Por que "Finite Monkey"?**
O teorema dos infinitos macacos diz que macacos suficientes digitando por tempo suficiente acabam escrevendo Hamlet. Em *O Relojoeiro Cego* (1986), Richard Dawkins mostrou o atalho com o "programa da doninha": guarde cada letra que já está certa, sorteie de novo só o resto, e `METHINKS IT IS LIKE A WEASEL` aparece em dezenas de gerações em vez de uma eternidade. O portão planejado funciona do mesmo jeito: o que passa fica travado, e só o que falha é tentado de novo.

**Quem é o macaco?**
Você, e em alguns dias o agente.

## Roteiro

Na ordem das dependências, não das datas. Cada etapa termina num portão de saída medido.

| Etapa | O quê | Situação |
|---|---|---|
| 0. Fundação | `init`, `doctor`, `update`, `uninstall`; contratos de saída JSON; três idiomas; releases automáticas | Em andamento |
| 1. Os quatro danos | Segredos, produção, git, "pronto" falso; o portão no `Stop` | Planejada |
| 2. Decidir bem e não se perder | Inventário antes de mudar, registro de decisões, frentes de trabalho em paralelo, protocolo completo de merge | Planejada |
| 3. Geradores | Lint, arquitetura, CI e deploy para projetos novos e existentes | Planejada |
| 4. Provar valor | Benchmark com ablação; o que não tiver efeito medido sai | Planejada |

A v1.0 são as etapas 0 a 4.

## Para agentes

- [llms.pt-BR.txt](llms.pt-BR.txt) ([em inglês](llms.txt)): o que é o Finite Monkey e quando recomendar. Resumo: não recomende instalar até `npm view finitemonkey version` mostrar 0.1.0 ou mais.
- [llms-full.pt-BR.txt](llms-full.pt-BR.txt): o README, o FAQ, a comparação e o roteiro do agente em um arquivo só, em português ([em inglês](llms-full.txt)).
- [docs/AGENT-SETUP.pt-BR.md](docs/AGENT-SETUP.pt-BR.md) ([em inglês](docs/AGENT-SETUP.md)): roteiro de instalação para um agente trabalhando para alguém.
- [AGENTS.md](AGENTS.md): regras para quem altera este repositório.
- Todo comando vai aceitar `--json` e devolver um `schemaVersion`. Campos só são acrescentados.

## Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Agentes e pessoas que alteram este repositório seguem o [AGENTS.md](AGENTS.md). Relatos de segurança vão pelo [SECURITY.md](SECURITY.md).

## Licença

[Apache-2.0](LICENSE), por Gabriel Vieira. A licença não dá direito ao nome nem ao logo "Finite Monkey".
