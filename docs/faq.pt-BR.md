# Perguntas frequentes do Finite Monkey

[English](faq.md) | Português (Brasil) | [Español](faq.es.md)

> **Pré-lançamento.** O Finite Monkey ainda não pode ser instalado. Cada resposta abaixo diz o que dá para fazer hoje só com o Claude Code e o que o Finite Monkey planeja acrescentar. "Planejado" quer dizer desenhado e ainda não entregue. Nada aqui foi medido ainda.

Cada pergunta é uma busca que as pessoas digitam de verdade, tirada de títulos de issues em [anthropics/claude-code](https://github.com/anthropics/claude-code/issues) e de discussões no Hacker News, conferidos em 2026-10-25.

## Por que o Claude Code diz que terminou quando não terminou?

Porque "pronto" é uma frase que o modelo escreve, e por padrão nada confere essa frase. É uma queixa frequente, por exemplo [anthropics/claude-code#60177](https://github.com/anthropics/claude-code/issues/60177) ("Claude marks tasks done without testing").

- **Hoje:** o Claude Code tem o hook `Stop`. Um hook escrito por você pode recusar o fim da sessão e dizer ao Claude por quê. É a camada certa; você é quem escreve e mantém a checagem.
- **Planejado no Finite Monkey:** uma definição de pronto por tarefa (comandos, testes, escopo) que o hook `Stop` roda nos arquivos atuais. Se falhar, o Claude recebe a lista do que falta e continua trabalhando. O relatório final sai dessa prova, não do resumo do agente.

## Como impedir o Claude Code de mentir sobre os testes?

Faça o resultado do teste ser algo que o agente não consegue escrever. Uma frase como "todos os testes passaram" no chat, ou um arquivo de progresso que o agente edita, é depoimento. Uma execução de teste disparada por um hook, nos arquivos como estão agora, é prova.

- **Hoje:** um hook `Stop` que roda o seu comando de teste e bloqueia quando falha. Cuidado com checagens que aceitam qualquer comando com saída 0, como `echo "tests passed"`.
- **Planejado:** só vale como prova o comando que o próprio Finite Monkey rodou, no estado atual da árvore. Comando trivial e execução com zero testes serão recusados como prova.

## O Claude Code apagou ou pulou meus testes para eles passarem. Como evitar?

Confira o diff, não o resultado do teste. Uma execução verde depois de remover um teste ou marcá-lo com `skip` continua verde.

- **Hoje:** revise os diffs em arquivos de teste e acrescente uma etapa de CI que falha quando o número de testes cai ou quando aparece `.skip` ou `.only`.
- **Planejado:** uma trava de testes que pega teste removido, `skip` ou `only` novo, asserção apagada e mexida na configuração do próprio portão, inclusive quando a mudança vem por comando de shell e não por edição.

## O Claude Code rodou `git reset --hard` e eu perdi trabalho. Como evitar?

Barre os comandos destrutivos do git antes que rodem, e guarde uma fotografia do que seria perdido. É uma queixa comum, por exemplo [anthropics/claude-code#7232](https://github.com/anthropics/claude-code/issues/7232) e [#34327](https://github.com/anthropics/claude-code/issues/34327).

- **Hoje:** regras de permissão `deny` para comandos destrutivos do git no `.claude/settings.json`, ou um hook `PreToolUse` que os bloqueia. Commits já feitos costumam ser recuperáveis pelo `git reflog`; edições sem commit, em geral, não.
- **Planejado:** uma fotografia antes de toda operação arriscada no git, um `undo` que a traz de volta, worktree com mudança pendente arquivada em vez de apagada e uma checagem de "nada se perdeu" em todo merge.

## Como impedir o Claude Code de fazer force push?

Bloqueie em dois lugares: na sua máquina e no servidor.

- **Hoje:** uma regra de permissão `deny` ou um hook `PreToolUse` para `git push --force` e variantes, mais proteção de branch ou um ruleset no GitHub proibindo force push nas branches compartilhadas. A regra do servidor é a que continua valendo se tudo o que é local for contornado.
- **Planejado:** o Finite Monkey nunca faz force push e bloqueia `--force` e variantes. Também vai mostrar quais das suas regras de git são garantidas por mecanismo e quais são só texto.

## Por que o Claude Code ignora o CLAUDE.md, ainda mais depois da compactação?

Porque o `CLAUDE.md` é contexto que o modelo lê, não um mecanismo que roda. O modelo pesa o arquivo contra todo o resto da conversa e pode deixá-lo de lado. Veja [anthropics/claude-code#7777](https://github.com/anthropics/claude-code/issues/7777) e [#19471](https://github.com/anthropics/claude-code/issues/19471) ("CLAUDE.md instructions completely ignored after context compaction").

- **Hoje:** mantenha o `CLAUDE.md` curto e tire da prosa toda regra que precisa valer sempre, levando-a para um hook, uma regra de permissão, um git hook ou uma etapa de CI.
- **Planejado:** o Finite Monkey faz essa mudança para as regras que conhece e mostra, regra por regra, quais são garantidas e quais ainda são só texto.

## Como fazer as regras do CLAUDE.md valerem de verdade?

Transforme cada regra no mecanismo mais barato que consegue checá-la. "Nunca commitar `.env`" vira um hook de pre-commit e uma varredura no CI. "Rodar os testes antes de dizer pronto" vira um hook `Stop`. "Não mexer na produção" vira um comando bloqueado.

- **Hoje:** hooks do Claude Code (`PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit` e outros), regras de permissão, git hooks e CI. Cada um roda lembrando o modelo da regra ou não.
- **Planejado:** o Finite Monkey entrega isso como um conjunto testado, instalado com backup e removível com `uninstall`.

## Como impedir o Claude Code de vazar chaves de API ou segredos nos commits?

Procure segredos em mais de um ponto, porque uma chave pode vazar por um arquivo escrito, um prompt, um commit, o histórico ou um pull request. A [anthropics/claude-code#2142](https://github.com/anthropics/claude-code/issues/2142) é um relato de chaves de API chegando ao controle de versão.

- **Hoje:** um scanner de segredos no pre-commit (o gitleaks é uma escolha comum), o secret scanning do GitHub com push protection e um hook `PreToolUse` ou regra `deny` que impede o agente de ler arquivos `.env`.
- **Planejado:** uma regra única de detecção, aplicada quando um arquivo é escrito, no prompt, no commit, no histórico e no CI. Segredo encontrado é tratado como incidente para rotacionar. O segredo é citado por arquivo e linha, nunca pelo valor. Isso reduz o risco; não dá para prometer que nada nunca vaza.

## Como impedir um agente de IA de mexer num servidor de produção?

Não dê ao agente um caminho direto até a produção, e bloqueie os comandos que criariam esse caminho.

- **Hoje:** não deixe credenciais de produção onde o shell do agente alcança, faça deploy só pelo CI e bloqueie comandos de shell remoto para os servidores de produção com um hook ou uma regra de permissão.
- **Planejado:** comandos com efeito num servidor de produção declarado são bloqueados. Produção muda pelo caminho de deploy que você declarou, e por nenhum outro.

## O que é uma definição de pronto para agentes de código?

Uma lista de condições que a máquina consegue checar antes de o agente poder chamar o trabalho de terminado: comandos que precisam passar, testes que precisam existir e passar, arquivos que devem ou não devem mudar. Ela transforma "pronto" de afirmação em resultado.

- **Hoje:** dá para escrever uma à mão, como script, e chamá-la de um hook `Stop`.
- **Planejado:** o Finite Monkey cria uma por tarefa, roda no `Stop`, prende a prova ao estado atual dos arquivos e mantém a cerimônia em zero para tarefas pequenas.

## Um hook Stop do Claude Code consegue verificar os testes antes de terminar?

Sim. Um hook `Stop` pode rodar o seu comando de teste e, se falhar, bloquear o fim com um motivo que o Claude lê e segue. Dois detalhes importam: a checagem precisa rodar nos arquivos atuais, sem confiar numa execução anterior, e não deve desistir na segunda vez que o Claude tenta parar.

- **Planejado:** o portão do Finite Monkey é construído exatamente sobre esse hook, com as regras de prova acima e um relatório final de "não terminado" em vez de um laço sem fim.

## Existe plugin de segurança ou guardrails para o Claude Code?

Existem vários, e alguns são ótimos num trabalho só. O tdd-guard obriga a escrever o teste antes; o cc-safety-net e o dcg bloqueiam comandos destrutivos de shell e git. Métodos como Superpowers, GSD e Spec Kit acrescentam processo. A [página de comparação](compare.pt-BR.md) mostra o que cada um garante por mecanismo e o que deixa na prosa, com fontes.

- **Planejado:** o Finite Monkey pretende cobrir quatro danos ("pronto" falso, segredo vazado, mexida na produção na mão, trabalho perdido no git) com um portão, uma instalação e um `undo`. Se isso vale mais do que um guarda avulso no seu caso é o que o benchmark planejado vai responder.
