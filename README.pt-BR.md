# Finite Monkey

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animação: um macaco de moletom bate no teclado de um notebook enquanto um terminal roda finitemonkey gate. As verificações que falham ficam verdes e travam uma a uma até aparecer actually done, e o macaco comemora com uma banana.">
</p>

**Não precisa de infinitos macacos. Um basta: você.**

[English](README.md) | Português (Brasil) | [Español](README.es.md)

> **Status: pré-lançamento.** Nada aqui funciona ainda. O nome `finitemonkey` no npm está reservado e o código está sendo construído em público. Tudo abaixo descreve o que o Finite Monkey está planejado para fazer, não o que ele faz hoje.

## A ideia

Você conhece o roteiro. Bate no teclado, cola alguma coisa de algum lugar, compilou, manda. Depois descobre que os testes não existem, que um `.env` entrou no diff e que "pronto" era "mais ou menos pronto". Não é defeito de caráter. É o ritmo do trabalho, com ou sem um agente de código digitando por você.

O Finite Monkey foi desenhado para ser o portão entre esse macaco e a `main`. Digite do jeito que quiser. Cada verificação que passa fica travada, o resto continua falhando em voz alta, e nada é chamado de pronto até cada verificação ter prova. Um macaco, tempo finito, trabalho que sai de verdade.

### Por que funciona

O teorema do macaco infinito diz que macacos suficientes, batendo à máquina por tempo suficiente, acabam escrevendo Hamlet. Em *O Relojoeiro Cego* (1986), Richard Dawkins mostrou um atalho com o "programa da doninha": guarde cada letra que já está certa, sorteie de novo só o resto, e `METHINKS IT IS LIKE A WEASEL` aparece em dezenas de gerações em vez de uma eternidade. A seleção cumulativa guarda o que passou. O Finite Monkey usa o mesmo truque no seu trabalho e no do seu agente: o que foi verificado continua verificado, e só o que ainda falha volta para outra tentativa.

## O problema

Agentes de código já são fortes o bastante para construir sistemas grandes em horas. O que falha é o entorno:

- O agente diz "pronto" e não está pronto.
- Os testes passam porque foram afrouxados ou pulados.
- Regras escritas no `CLAUDE.md` ou no `AGENTS.md` são esquecidas, principalmente depois da compactação do contexto, porque prosa é contexto, não imposição.
- Trabalho se perde num `git reset --hard`, num push forçado ou num worktree apagado.
- Um segredo vai parar num commit, num log ou num pull request.

São falhas de verificação e de controle, não de inteligência. Mais Markdown, mais fases e mais personas não resolvem. Mecanismo resolve.

## O que ele vai fazer (planejado)

### Você só digita; o portão confere

O Finite Monkey foi desenhado para **não ter nenhum comando para decorar**. Você roda `npx finitemonkey init` uma vez. Depois disso ele age sozinho, pelo contexto, dentro do Claude Code:

- **Hooks** fazem a imposição: `SessionStart` restaura o estado da tarefa, `UserPromptSubmit` percebe o que você pediu, `PreToolUse` barra ações perigosas antes que aconteçam, `Stop` se recusa a encerrar a sessão enquanto a definição de pronto falha, e `SubagentStop` confere o que os subagentes relatam.
- **Skills** são acionadas pelo Claude automaticamente, pela descrição, quando a situação pede.
- **Slash commands** existem só como atalhos opcionais. Nenhum fluxo depende deles.

### Uma definição de pronto verificada por máquina

Cada tarefa ganha um contrato do que "pronto" significa: comandos que precisam dar certo, testes que precisam existir e passar, um diff que fica dentro do escopo, e mais. O hook `Stop` roda o portão e bloqueia o fim da sessão com a lista do que ainda falta. A evidência é registrada só a partir de comandos que o próprio Finite Monkey executou, presa ao hash da árvore de trabalho, então "rodei os testes antes da última edição" não conta. O relatório final é gerado dessa evidência, não do que o agente diz.

### Os quatro danos que ele impede primeiro

A primeira etapa do roteiro cobre só o que é irreversível ou corrompe a prova:

1. **Vazar segredo.** Uma regra de detecção aplicada na escrita de arquivos, no prompt, no commit, no histórico e na CI. Segredo encontrado é incidente para rotacionar, não aviso para ignorar. Segredos são citados por arquivo e linha, nunca pelo valor.
2. **Editar produção na mão.** Comandos com efeito num host de produção são barrados. Produção só muda pelo caminho de deploy declarado.
3. **Perder trabalho no git.** Uma fotografia antes de toda operação git de risco, um `undo` que a devolve, `--force` nunca, worktree sujo arquivado em vez de apagado, e uma verificação de "nada se perdeu" em toda mescla.
4. **"Pronto" falso.** O portão acima, mais travas contra teste removido, `skip` ou `only` novo, asserção removida e edição da configuração do próprio portão.

### Princípios

- **Cerimônia proporcional.** Tarefa pequena não tem fase, só o portão. Tarefa maior ganha um plano curto e uma revisão independente.
- **Regra vira mecanismo.** Regra que precisa valer sempre vira hook, permissão, git hook ou passo de CI, não um parágrafo. O Finite Monkey mostra, por regra, onde ela ainda é só texto.
- **Toda regra prova valor ou sai.** Uma bancada compara o Claude Code puro, com o Finite Monkey e com o Finite Monkey menos uma peça de cada vez. Regra sem efeito medido sai do núcleo.
- **Nunca quebrar o que existe.** Instalação com backup, mescla estrutural, arquivo de lock, reexecução idempotente, `doctor`, `update` e `uninstall` limpo.
- **Nada sai da sua máquina por padrão.** Sem telemetria.
- **Saída para agente é contrato.** Todo comando vai aceitar `--json` e devolver `schemaVersion`; campos só são acrescentados.
- **Três idiomas.** Inglês, português do Brasil e espanhol.

## Roteiro

Ordenado por dependência, não por data. Cada etapa termina num portão de saída medido.

| Etapa | Conteúdo | Status |
|---|---|---|
| 0. Fundação | Executável com `init`, `doctor`, `update`, `uninstall`; contratos JSON; i18n; releases automáticas | Em construção |
| 1. Os quatro danos | Segredo, produção, git, "pronto" falso; o portão no `Stop` | Planejado |
| 2. Decidir bem e não se perder | Inventário antes de mudar, registro de decisão, checagens de custo e de paridade, frentes de trabalho em paralelo, protocolo completo de mescla, regras compiladas por superfície | Planejado |
| 3. Geradores | Geradores de lint, arquitetura, CI e deploy para projetos novos e existentes | Planejado |
| 4. Provar valor | Bancada com ablação; peças sem efeito medido são cortadas | Planejado |

A versão 1.0 é o conjunto das etapas 0 a 4.

## Instalação (planejada)

Ainda não disponível. Quando a primeira versão sair, o caminho principal será:

```sh
npx finitemonkey@latest init
```

É o único comando que você deve precisar. Os requisitos serão Node.js 20 ou mais novo, em Linux, macOS, Windows ou WSL. Executáveis avulsos para quem não tem Node estão planejados. Você também vai poder pedir ao Claude Code que instale por você; o agente segue o [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).

## Como saem as versões

- A versão é decidida pelas mensagens de commit. O repositório usa [Conventional Commits](https://www.conventionalcommits.org/pt-br/), conferidos pelo commitlint em todo commit.
- A cada push na `main`, a CI roda as checagens e o [semantic-release](https://semantic-release.gitbook.io/) calcula a versão, escreve o changelog, publica no npm e cria a release no GitHub. Ninguém edita a versão na mão.
- Os pacotes são publicados só pela CI, com [proveniência do npm](https://docs.npmjs.com/generating-provenance-statements), para você conferir que uma versão foi construída a partir deste repositório.
- Dois canais estão planejados: `latest` para versões estáveis e `next` para pré-lançamentos. O estável é o padrão; o `next` é opcional.

## Contribuir

Veja o [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês). Agentes e pessoas que mexem neste repositório seguem o [AGENTS.md](AGENTS.md). Relatos de segurança vão pelo [SECURITY.md](SECURITY.md).

## Licença

[Apache-2.0](LICENSE), por Gabriel Vieira. A licença não dá direito de usar o nome nem o logo "Finite Monkey".
