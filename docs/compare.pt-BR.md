# Como o Finite Monkey se compara

[English](compare.md) | Português (Brasil) | [Español](compare.es.md)

> **Versões iniciais.** O Finite Monkey tem versões iniciais no canal `next` do npm. O benchmark ainda não rodou.

**Conferido em 2026-10-25**, lendo o código de cada projeto no commit indicado. Nenhum hook de terceiro foi executado.

## Mecanismo ou prosa

Para cada projeto: quando o modelo prefere pular uma regra, o que continua valendo?

- **Mecanismo**: código que roda no harness (um hook, uma regra de permissão, um git hook, uma etapa de CI) e bloqueia ou confere seja qual for a decisão do modelo.
- **Prosa**: texto que o modelo lê (uma skill, um prompt, um `CLAUDE.md`) e pode seguir. Prosa muitas vezes é a ferramenta certa para planejar, para estilo e para julgamento. Sozinha, não mostra que algo aconteceu.

A maioria das configurações precisa dos dois. O escopo do Finite Monkey é estreito: as poucas coisas que precisam valer sempre (pronto verificado, testes não enfraquecidos, nenhum segredo vazado, nenhum trabalho perdido no git, nenhuma mexida na produção na mão) devem ser mecanismo.

## Visão geral

| Projeto | O que é | Melhor em | Mecanismo | Fica com o modelo |
|---|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | Biblioteca de skills e método de desenvolvimento | Planejar antes de codar, disciplina de teste primeiro, zero comandos | Um hook `SessionStart`; um script `task-done` que só registra com saída 0 | Chamar o `task-done`, e todo portão das skills |
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | Orquestração multiagente | Delegação, modos, barra de status | Hooks no `Stop`, trava de git com parser de shell, orçamento de leitura | Declarar conclusão (`/cancel`); trava de git desligada fora dos modos autônomos |
| [GSD](https://github.com/open-gsd/gsd-core) | Fluxo de spec e fases com estado em arquivo | Trabalho que sobrevive ao `/clear`, planejamento | Travas na leitura de `.env`, no encolhimento de arquivos de estado, no isolamento de agentes | O veredito da verificação, escrito por um agente LLM |
| [Spec Kit](https://github.com/github/spec-kit) | Kit de desenvolvimento guiado por spec | Estrutura para mudanças médias e grandes, extensibilidade | Etapas `shell` do workflow; um subsistema de hooks nativos, desligado por padrão | Hooks de extensão, validação de testes, "Converged" |
| [ECC](https://github.com/affaan-m/ECC) | Catálogo grande de skills, agentes, comandos e hooks | Amplitude; uma trava de `--no-verify` minuciosa | Trava de `--no-verify`, proteção de config de lint | A checagem de tipos no `Stop` relata e sai 0; a trava de primeiro toque libera a repetição |
| [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop) | Plugin oficial que mantém o agente iterando | Persistência em tarefa longa, simplicidade | Um hook `Stop` que devolve o prompt | A condição de saída, uma frase que o modelo escreve |
| [tdd-guard](https://github.com/nizos/tdd-guard) | Obriga teste primeiro | Um trabalho só, feito com foco | Hook nas edições que pode bloquear | O julgamento se a edição seguiu teste primeiro (uma chamada de modelo) |
| [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) | Guarda de comandos destrutivos | Cobertura de comandos perigosos, falha fechado por tempo | Bloqueio no `PreToolUse` | n/a (não trata de pronto) |
| [cc-safety-net](https://github.com/kenryu42/cc-safety-net) | Guarda de comandos destrutivos | Um trabalho só, instalação rápida, `doctor` | Bloqueio no `PreToolUse` | n/a (não trata de pronto) |
| Finite Monkey | Portão em torno de uma definição de pronto | Nada medido ainda: versões iniciais no `next` | Portão no `Stop`, travas no `PreToolUse`, git hooks, CI | Nada nos quatro danos |

## Superpowers

Commit [`2ce8aa1`](https://github.com/obra/superpowers/tree/2ce8aa1) (v7.0.1).

**O que faz bem.** As skills disparam sozinhas, então não há nada para lembrar. A skill de brainstorming faz o agente ler o projeto e perguntar antes de codar, que é o efeito que os usuários citam primeiro. As skills de teste primeiro e de depuração dão ao modelo um método forte.

**Mecanismo.** Um hook: `SessionStart` em `startup|clear|compact` ([`hooks/hooks.json`](https://github.com/obra/superpowers/blob/2ce8aa1/hooks/hooks.json)). O script [`skills/executing-plans/scripts/task-done`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/executing-plans/scripts/task-done) roda o comando de teste e só grava a linha "Task N: complete" com saída 0.

**Prosa.** Os portões são texto de skill, como "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE" em [`verification-before-completion`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/verification-before-completion/SKILL.md). Quem decide chamar o `task-done` é o modelo, e a [obra/superpowers#2549](https://github.com/obra/superpowers/issues/2549) registra que um comando substituto como `echo "tests passed"` não se distingue de uma execução real de testes.

**Onde o Finite Monkey é diferente.** O portão roda a checagem ele mesmo, a partir de um hook, toda vez que o agente tenta parar, e comando trivial não conta como prova. O planejamento fica com skills como essas: um design aprovado no Superpowers pode virar a entrada de uma definição de pronto.

## oh-my-claudecode

Commit [`5632614`](https://github.com/Yeachan-Heo/oh-my-claudecode/tree/5632614) (v5.7.14).

**O que faz bem.** Orquestração multiagente com papéis e modos, uma barra de status de que os usuários gostam e uma trava de git com parser de shell de verdade.

**Mecanismo.** O [`scripts/workflow-drift-guard.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/workflow-drift-guard.mjs) no `Stop` bloqueia quando a última mensagem diz que terminou e o diff acrescentou `.skip(`, `.only(` ou marcadores provisórios. O [`scripts/git-guardrails.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/git-guardrails.mjs) bloqueia `git push`, `reset --hard`, `clean -f` e afins. Um orçamento de leitura nega leituras enormes sem limite.

**Onde o modelo decide.** O drift guard deixa o fim passar quando `stop_hook_active` está ligado (linha 910), então bloqueia uma vez. A trava de git só fica ativa nos modos `ralph`, `autopilot`, `team` e `ultragoal` (linha 38) ou com uma variável de ambiente. Nos modos persistentes, concluir é o modelo rodar `/cancel`.

**Onde o Finite Monkey é diferente.** O portão continua bloqueando enquanto a definição de pronto falhar, e a trava de git fica sempre ligada.

## GSD

[`open-gsd/gsd-core`](https://github.com/open-gsd/gsd-core) no commit [`754e886`](https://github.com/open-gsd/gsd-core/tree/754e886) (v1.18.0). O original [`gsd-build/get-shit-done`](https://github.com/gsd-build/get-shit-done) está arquivado e aponta para ele.

**O que faz bem.** O estado fica em arquivo, então o trabalho continua depois do `/clear`. Planejamento e fases são o centro do produto. Traz travas que bloqueiam de verdade.

**Mecanismo.** O [`hooks/gsd-secret-read-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-secret-read-guard.js) bloqueia a leitura de `.env` e arquivos parecidos por Read, Grep e Bash, e o cabeçalho explica por que um hook funciona melhor que regras de permissão `Read()`. O [`hooks/gsd-write-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-write-guard.js) bloqueia escritas que encolhem o roadmap ou os arquivos de estado. Uma trava de isolamento nega agentes executores sem worktree.

**Onde o modelo decide.** A verificação é um agente LLM ([`agents/gsd-verifier.md`](https://github.com/open-gsd/gsd-core/blob/754e886/agents/gsd-verifier.md)) que escreve o `VERIFICATION.md`, e o portão de fase em [`src/phase.cts`](https://github.com/open-gsd/gsd-core/blob/754e886/src/phase.cts) lê o status que esse agente escreveu.

**Onde o Finite Monkey é diferente.** O veredito vem de comandos que o portão rodou nos arquivos atuais.

## Spec Kit

Commit [`67e0f72`](https://github.com/github/spec-kit/tree/67e0f72).

**O que faz bem.** Uma estrutura clara de spec para plano para tarefas em mudanças médias e grandes, muitas integrações e um contexto fixo pequeno. Os usuários elogiam a extensibilidade.

**Mecanismo.** As etapas `shell` do workflow falham com saída diferente de zero. Um subsistema `events` consegue instalar hooks nativos do Claude Code e repassar o código de saída; as extensões embutidas não o ligam.

**Prosa.** Hooks de extensão como `after_implement` dependem de o modelo chamá-los: "mandatory extension hooks rely on the model invoking the hook skill" ([`src/specify_cli/integrations/claude/__init__.py`](https://github.com/github/spec-kit/blob/67e0f72/src/specify_cli/integrations/claude/__init__.py), linhas 70 a 72). A validação de testes no comando de implementação é uma instrução, e a convergência é declarada pelo modelo. A [github/spec-kit#1323](https://github.com/github/spec-kit/issues/1323) pede um portão final de qualidade.

**Onde o Finite Monkey é diferente.** O portão roda como handler de `Stop` e também é um comando (`finitemonkey gate`) que uma etapa `shell` de workflow do Spec Kit pode rodar, e o `finitemonkey task from-spec` propõe uma definição de pronto a partir de um `tasks.md` sem mexer nele.

## ECC (Everything Claude Code)

[`affaan-m/ECC`](https://github.com/affaan-m/ECC) no commit [`90606c8`](https://github.com/affaan-m/ECC/tree/90606c8) (v2.2.3).

**O que faz bem.** O catálogo mais amplo desta lista. A trava de `--no-verify` é a mais minuciosa lida para esta página: também pega o redirecionamento de hooks por `core.hooksPath`, `include.path` e `includeIf`, e bloqueia quando não consegue analisar o comando.

**Mecanismo.** O [`block-no-verify.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/block-no-verify.js) e o [`config-protection.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/config-protection.js) bloqueiam com código de saída 2. A proteção cobre configs de linter e formatador e deixa de fora, de propósito, configs de teste como `vitest.config.ts` e `tsconfig.json` (linhas 111 a 115).

**Onde o modelo decide.** O [`stop-format-typecheck.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/stop-format-typecheck.js) roda no `Stop`, relata e sai 0, ou seja, informa sem bloquear. O [`gateguard-fact-force.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/gateguard-fact-force.js) nega o primeiro toque num arquivo e deixa a repetição passar (linhas 1935 e 1936).

**Onde o Finite Monkey é diferente.** Um núcleo pequeno com orçamento de contexto conferido no CI, um portão no `Stop` que bloqueia e nenhuma trava que cede na repetição.

## ralph-loop

Plugin oficial em [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop), commit `5826794`.

**O que faz bem.** Mantém o agente trabalhando numa tarefa longa em vez de parar cedo, quase sem configuração.

**Mecanismo.** Um hook `Stop` ([`hooks/stop-hook.sh`](https://github.com/anthropics/claude-plugins-official/blob/5826794/plugins/ralph-loop/hooks/stop-hook.sh)) devolve o prompt até chegar a um número máximo de iterações (linha 61).

**Onde o modelo decide.** O laço termina quando a última mensagem do modelo contém `<promise>TEXTO</promise>` igual à promessa de conclusão que você definiu (linhas 129 a 138). A própria mensagem do hook pede ao modelo que não minta para sair.

**Onde o Finite Monkey é diferente.** O portão no `Stop` mantém o agente trabalhando até a definição de pronto passar e, depois do limite de bloqueios, termina com um relatório de "não terminado".

## tdd-guard

Commit [`108992d`](https://github.com/nizos/tdd-guard/tree/108992d).

**O que faz bem.** Um trabalho só, feito com foco: bloqueia edições que pulam o teste que falha primeiro. A pessoa liga e desliga digitando `tdd-guard on` ou `tdd-guard off` ([`src/hooks/userPromptHandler.ts`](https://github.com/nizos/tdd-guard/blob/108992d/src/hooks/userPromptHandler.ts), linhas 8 e 9), o que deixa esse interruptor nas mãos de quem usa.

**Mecanismo e julgamento.** O hook bloqueia de verdade. Se uma edição conta como teste primeiro é decidido por uma chamada de modelo a cada edição.

**Onde o Finite Monkey é diferente.** Ele não obriga teste primeiro. Ele confere que testes não foram removidos, pulados ou enfraquecidos, e que passam nos arquivos finais. Se o que você quer é teste primeiro, o tdd-guard é a ferramenta mais direta.

## dcg (destructive_command_guard)

Commit [`b33f3ef`](https://github.com/Dicklesworthstone/destructive_command_guard/tree/b33f3ef).

**O que faz bem.** Cobertura ampla de comandos destrutivos, suporte a vários agentes e uma direção de falha clara: uma avaliação acima de 1000 ms devolve uma decisão indeterminada, "never allow" ([`src/perf.rs`](https://github.com/Dicklesworthstone/destructive_command_guard/blob/b33f3ef/src/perf.rs), linhas 800 a 812). Os mantenedores acompanham falsos positivos em público, por exemplo na [#560](https://github.com/Dicklesworthstone/destructive_command_guard/issues/560).

**Onde o Finite Monkey é diferente.** O dcg guarda comandos. O Finite Monkey soma uma fotografia e um `undo` em volta das operações arriscadas no git, e um portão de pronto. Se você só precisa de um guarda de comandos, o dcg é uma escolha focada.

## cc-safety-net

Commit [`71baf74`](https://github.com/kenryu42/cc-safety-net/tree/71baf74).

**O que faz bem.** Bloqueia `git reset --hard`, `git push --force`, `rm -rf` em alvos perigosos e scripts de instalação via pipe, mesmo dentro de `bash -c` ou `python -c` ([`README.md`](https://github.com/kenryu42/cc-safety-net/blob/71baf74/README.md), linha 74). Instala em uma linha e tem `doctor`. Quando o hook ficou lento com `npx`, o mantenedor passou para um binário embutido ([#16](https://github.com/kenryu42/cc-safety-net/issues/16)).

**Onde o Finite Monkey é diferente.** O mesmo que no dcg: os acréscimos são a fotografia com `undo` e o portão de pronto. Para um guarda de comandos sozinho, o cc-safety-net é a instalação mais simples.

## Onde o Finite Monkey é diferente

- **Prova das execuções do próprio portão.** Pronto quer dizer que o portão rodou a definição de pronto nos arquivos atuais. Mensagem no chat, arquivo de progresso ou relatório escrito por um agente não contam.
- **Bloqueio até as checagens passarem.** Ele continua bloqueando enquanto a definição de pronto falha, e termina com um relatório de "não terminado" em vez de um laço sem fim.
- **Quatro danos numa instalação.** "Pronto" falso, segredo vazado, mexida na produção na mão e trabalho perdido no git, com um `undo` para o git.
- **Contexto fixo pequeno.** A obrigação mora nos hooks, que não custam token a cada turno, com um orçamento em bytes conferido no CI.
- **Benchmark.** Um benchmark público com ablação decide quais regras ficam.

## Onde eles estão na frente hoje

- Eles têm versões estáveis e são usados. O Finite Monkey só tem versões iniciais no `next`.
- Superpowers, GSD e Spec Kit ajudam a decidir o que construir. O Finite Monkey não constrói essa fase; lê o que eles produzem.
- Vários funcionam em muitos agentes. O Finite Monkey começa só com o Claude Code.

## Outros no mesmo espaço

- [OpenSpec](https://github.com/Fission-AI/OpenSpec): mudanças guiadas por spec; a [#1142](https://github.com/Fission-AI/OpenSpec/issues/1142) pede portões de qualidade como conceito de primeira classe.
- [no-mistakes](https://github.com/kunchenguid/no-mistakes): revisão e testes antes do push, com os comandos lidos da branch padrão e não do commit enviado.
- [hookify](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/hookify): plugin oficial que transforma uma frase numa regra de hook.
- No npm, `redpen-cli` ("A definition-of-done and verification layer for coding agents") e `@reneza/skillgate` ("Deterministic finish-line gates for AI coding agents") descrevem objetivos próximos aos do Finite Monkey. Eles não foram lidos a fundo para esta página.
