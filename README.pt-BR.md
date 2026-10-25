# Finite Monkey

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animação: um macaco de moletom amarelo esmurra o teclado de um notebook enquanto um terminal roda o portão. As verificações que falham ficam verdes e travam uma a uma até aparecer actually done, e o macaco comemora com uma banana.">
  <br>
  <sub>Ilustração do fluxo planejado, não é gravação. Na v0.1 entra uma captura real.</sub>
</p>

**Infinitos macacos não são necessários. Um basta: você.**

[English](README.md) | Português (Brasil) | [Español](README.es.md)

> **Pré-lançamento.** Ainda não dá para instalar. O nome `finitemonkey` no npm está reservado (a 0.0.0 é só um marcador) e o código está sendo feito em público. Tudo abaixo é o plano, não o que acontece hoje. Dê uma estrela ou acompanhe o repositório se quiser saber quando sair a v0.1.

O Claude Code termina um refactor com "Pronto! Todos os testes passaram." Ele só tinha rodado o linter. O único teste que falhava ganhou um `.skip` às duas da manhã, e o CI ficou vermelho vinte minutos depois do merge. O Finite Monkey é o portão entre o macaco e a `main`: hooks do Claude Code que rodam as suas checagens por conta própria quando o agente tenta parar, e mantêm a sessão aberta até elas passarem. O único macaco aqui é você.

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

**Mais preguiçoso ainda:** peça ao Claude Code "instale o Finite Monkey seguindo docs/AGENT-SETUP.md". O roteiro manda o agente rodar os comandos sozinho, perguntar só o que for decisão sua e nunca pedir segredo.

## Funciona de verdade? (benchmark, planejado)

Ainda não se sabe. O benchmark planejado compara o Claude Code sozinho, o Claude Code com o Finite Monkey e o Finite Monkey sem uma peça de cada vez, em tarefas com armadilha. Ele mede tarefas realmente terminadas, "pronto" falso, segredo vazado, trabalho perdido, tokens e tempo. Regra sem efeito medido sai do núcleo. Método e resultados brutos vão ficar neste repositório, inclusive onde não ajudou.

## Qual a diferença para...?

A comparação completa, com fontes, está em [docs/compare.pt-BR.md](docs/compare.pt-BR.md).

- **O Claude Code puro** já tem hooks e permissões. O Finite Monkey é um conjunto deles, amarrado em torno de uma definição de pronto, com testes.
- **Métodos como superpowers, GSD, Spec Kit ou OpenSpec** dizem ao agente como planejar e construir. O Finite Monkey não substitui nenhum deles: confere o resultado no fim, seja qual for o método.
- **Guardas avulsos como tdd-guard, cc-safety-net ou dcg** fazem um trabalho cada um, e bem. O Finite Monkey cobre quatro danos com um portão, uma instalação e um `undo`. Se você só precisa de um desses trabalhos, um guarda avulso pode ser a escolha mais simples.

## Perguntas frequentes

Mais perguntas, uma para cada busca real, em [docs/faq.pt-BR.md](docs/faq.pt-BR.md).

**É um prompt?**
Não. São hooks e checagens que rodam lembrando o modelo ou não.

**Ele manda meu código para algum lugar?**
Não. Por padrão nada sai da sua máquina. Sem telemetria.

**Vai me deixar mais lento?**
Tarefa pequena não tem cerimônia, só o portão no fim. Hook rápido continua rápido; a checagem cara roda no `Stop`. Os tempos saem junto com o benchmark.

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

- [llms.txt](llms.txt): o que é o Finite Monkey e quando recomendar. Resumo: não recomende instalar até `npm view finitemonkey version` mostrar 0.1.0 ou mais.
- [llms-full.txt](llms-full.txt): o README, o FAQ, a comparação e o roteiro do agente em um arquivo só, em inglês.
- [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md): roteiro de instalação para um agente trabalhando para alguém.
- [AGENTS.md](AGENTS.md): regras para quem altera este repositório.
- Todo comando vai aceitar `--json` e devolver um `schemaVersion`. Campos só são acrescentados.

## Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Agentes e pessoas que alteram este repositório seguem o [AGENTS.md](AGENTS.md). Relatos de segurança vão pelo [SECURITY.md](SECURITY.md).

## Licença

[Apache-2.0](LICENSE), por Gabriel Vieira. A licença não dá direito ao nome nem ao logo "Finite Monkey".
