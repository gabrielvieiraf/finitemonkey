# Instalando o Finite Monkey para alguém (roteiro do agente)

Este arquivo é para um agente de IA, como o Claude Code, a quem a pessoa pediu para instalar o Finite Monkey num projeto. Gente também pode ler.

> **Status: estável desde a 0.1.0.** `init`, `update`, `uninstall`, o portão, as travas e o plugin do Claude Code saem na dist-tag `latest` do npm; prévias da próxima versão saem no `next`.
>
> Vale para `fm` 0.1.0-next.40 ou mais nova. Confira a versão instalada antes de seguir qualquer passo adiante e pare se ela for menor.

## Conduta

1. **Rode os comandos você mesmo.** Não peça para a pessoa digitar comandos que você consegue rodar.
2. **Pergunte só o que é decisão dela.** Por exemplo: qual idioma para os arquivos gerados, se mantém o estilo de commit do repositório, se liga um recurso opcional. Não pergunte o que dá para descobrir lendo o projeto ou a saída dos comandos.
3. **Nunca peça segredos.** Nada de senha, chave de API, token ou código de recuperação, nem "para terminar a configuração". O Finite Monkey não precisa de nenhum para instalar.
4. **Prefira `--json`.** Leia a saída JSON, não o texto para humanos. Quando houver o campo `next`, siga-o.
5. **Não ligue nada caro sem perguntar.** Tudo que gasta dinheiro, usa API paga, roda benchmark longo, muda configuração do GitHub (como rulesets de branch) ou edita configuração global (`~/.claude/settings.json`, perfis do shell) precisa de um sim explícito da pessoa antes.
6. **Explique cada passo em uma ou duas frases, no idioma da pessoa.**
7. **Não edite arquivos que o `init` gerencia.** Se algo parecer errado, rode o `doctor` e relate o que ele disser.

## Dois jeitos de instalar

Os dois instalam os mesmos hooks. Use um ou os dois: quando o projeto tem os próprios hooks do Finite Monkey, os hooks do plugin se retiram e nada roda duas vezes.

1. **O plugin do Claude Code**, pelo marketplace da branch `next`. Dentro de uma sessão do Claude Code:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey#next
   /plugin install finitemonkey@finitemonkey-next
   ```

   Quando sair uma versão estável, a branch padrão ganha o próprio marketplace, chamado `fm` (`/plugin marketplace add gabrielvieiraf/finitemonkey`, depois `/plugin install finitemonkey@finitemonkey`). Ele pode ficar ao lado do `finitemonkey-next`, mas deixe só um dos dois ativo: os dois plugins se chamam `fm`, e o Claude Code fica com um único conjunto de hooks. O `doctor` falha e mostra o comando `claude plugin disable` quando os dois estão ativos.

   O plugin traz os hooks e as skills (`task`, `verify`, `look`, `finish`) que o Claude usa sozinho. Ele carrega a própria CLI (`scripts/finitemonkey.mjs`, o mesmo build da versão em `plugin.json`), e cada hook roda `node` nesse arquivo: sem `npx` e sem download.

2. **`npx finitemonkey init`** no projeto (passos abaixo). Ele grava no projeto os hooks, o piso de `permissions.deny` (mais uma regra `Read` de bloqueio para cada padrão do `.claudeignore`), regras `ask` para push em `main`/`master` e para comandos de publicação e deploy, `permissions.blockReadsOutsideWorkingDirectories: true`, `.fm/config.yml`, uma skill `verify` do projeto (`.claude/skills/verify/SKILL.md`, que roda o portão rápido antes de cada commit) e um bloco gerenciado curto no `AGENTS.md`, que o `CLAUDE.md` importa com `@AGENTS.md` (cada arquivo é criado se não existir; tudo fora do bloco fica como estava). Ele nunca define `defaultMode` nem `autoMode`, só acrescenta regras que as configurações ainda não têm e deixa como está uma skill `verify` que o projeto já tenha. Os hooks rodam `node` em `node_modules/finitemonkey` quando o projeto tem o pacote como dependência; senão, o `init` copia a CLI que está rodando para `.fm/runtime/` (versionada, para que o time e as sessões na nuvem usem a mesma versão) e os hooks rodam essa cópia. Nenhum hook chama `npx`. Isso vale também onde plugins não carregam (sessões na nuvem de um repositório leem o `.claude/settings.json` versionado). Acrescente `--marketplace` para registrar também o marketplace do plugin nas configurações do projeto, para todo mundo que confiar na pasta; fica desligado a não ser que a pessoa peça. O marketplace segue o canal da versão em execução; `--channel next` ou `--channel stable` escolhe um.

## O que a pessoa ganha

Depois de instalar, a pessoa não precisa lembrar de nenhum comando. O Finite Monkey trabalha pelo contexto dentro do Claude Code: hooks em `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` e `SubagentStop`, e skills que o Claude chama sozinho pela descrição. Os comandos com barra são atalhos opcionais. Ao terminar, diga à pessoa que pode seguir trabalhando como sempre.

## Passos

### 1. Confira qual canal tem versão

```sh
npm view finitemonkey dist-tags --json
```

- Se o comando falhar, ou nem `latest` nem `next` for `0.1.0-next.40` ou mais nova, não há o que instalar. Diga isso à pessoa e pare aqui.
- Se `latest` for `0.1.0` ou mais nova, use `finitemonkey@latest` nos comandos abaixo.
- Se `latest` for `0.0.0` (só reserva o nome), só o canal `next` tem código. Diga à pessoa: "O canal estável está vazio aqui. O canal `next` funciona, mas uma versão nova pode quebrar o que a anterior fazia. Instalo?" Siga só com um sim, usando `finitemonkey@next` nos comandos abaixo, como estão escritos.

### 2. Confira o ambiente

- Node.js 20 ou mais novo: `node --version`.
- O projeto é um repositório git: `git rev-parse --show-toplevel`.
- Estado da árvore: `git status --porcelain`. Se houver mudanças sem commit, avise a pessoa e pergunte se continua. O `init` faz backup, mas ela precisa saber.

### 3. Veja o plano antes

```sh
npx finitemonkey@next init --dry-run --json
```

Isso lê o projeto e devolve o plano sem gravar nada: `data.actions` lista cada arquivo com `create`, `merge`, `update`, `unchanged`, `keep-edited` ou `skip-foreign`; `data.warnings` lista o que a pessoa deve saber (outro plugin que também decide quando a sessão para, um Claude Code antigo demais para bloquear quando um hook quebra, um arquivo que não é do Finite Monkey); e `data.diff` mostra a mudança exata. Resuma o plano para a pessoa em poucas linhas. Pergunte só estas decisões:

- Estilo de commit, só quando a saída disser que a maioria dos commits recentes não segue Conventional Commits: `--commits free` mantém o estilo do repositório, `--commits conventional` adota o padrão. Os outros padrões valem para todo mundo; o README lista cada um com a sua evidência, e qualquer um desliga depois no `config.yml`.
- Executor de testes, linter e pasta do código, só quando a saída listar `conventionQuestions` com status `pending` (o recurso `defaults-adapt` está ativo): `--tests vitest`, `--lint biome` ou `--layout src` adotam o que foi detectado, e `--tests off` (idem `--lint off`, `--layout off`) mantém o padrão embutido. Um status `shadow` só informa a detecção; nada é perguntado.
- Se registra o marketplace do plugin no projeto (`--marketplace`).
- Se liga o sandbox do Claude Code para esta pessoa (`--sandbox`, só macOS, Linux e WSL2). Ele vai para o `.claude/settings.local.json`, não para as configurações versionadas: o Claude Code passa a se recusar a iniciar sem o sandbox, os comandos no sandbox não leem `~/.ssh`, `~/.aws` nem os `.env` do projeto, e só chegam aos hosts de `sandbox.hosts` no `config.yml` (npm e GitHub por padrão).
- Se olha uma vez as sessões locais do Claude Code neste projeto (`--look-back`). Ele lê os logs de sessão desta máquina e mostra contagens estimadas do que o Finite Monkey teria bloqueado, com segredos mascarados. Nada é salvo nem enviado. Sem a flag, nenhum log de sessão é lido.

### 4. Instale

```sh
npx finitemonkey@next init --yes --json
```

Passe as decisões da pessoa como flags (por exemplo `--commits free --lang pt-BR`). Sem `--yes`, o `init` sai com código 4, o plano e um campo `next` com o comando exato para rodar depois que a pessoa concordar. O `init` faz backup de cada arquivo que toca em `.fm/backups/<timestamp>/`, registra o que gravou em `.fm/lock.json`, mescla o `.claude/settings.json` sem tirar nenhum hook ou permissão da pessoa, acrescenta um bloco gerenciado ao `.gitignore` (o estado fica local, o `config.yml` é versionado) e pode rodar de novo sem risco: uma segunda execução sem mudança não grava nada.

### 5. Verifique

```sh
npx finitemonkey@next doctor --json
```

Cada item tem `check`, `status` e `fix`. Se algum item não estiver `ok`, rode o comando de `fix` quando for seguro e não cair na regra de conduta 5, e rode o `doctor` de novo. Relate o que sobrou.

`npx finitemonkey@next doctor --fix` repara os arquivos do projeto que são dele (hooks, regras de deny, o bloco do `.gitignore`) com o mesmo backup e a mesma trava do `init`, e nunca mexe nos settings do usuário nem no perfil do shell. Se o usuário quiser abrir um bug, `npx finitemonkey@next doctor --report` grava um arquivo Markdown mascarado em `.fm/reports/` para anexar na issue.

### 6. Conte para a pessoa

Em uma ou duas frases: o que foi instalado, o que o `doctor` não conseguiu corrigir e que ela já pode seguir trabalhando sem nenhum comando novo.

## Códigos de saída

| Código | Significado |
|---|---|
| 0 | Sucesso |
| 1 | Uma checagem falhou |
| 2 | Erro de uso |
| 3 | Não configurado |
| 4 | Precisa da pessoa (uma decisão ou uma confirmação) |
| 5 | O próprio Finite Monkey falhou |

Com `--json`, os erros vêm como `{"schemaVersion":1,"error":{"code":"...","message":"...","fix":"..."}}`. Rode ou sugira o comando de `fix`.

## Atualizar

```sh
npx finitemonkey@next update --check --json
npx finitemonkey@next update --yes --json
```

O `--check` sai com 1 quando os arquivos gerenciados diferem desta versão e com 0 quando batem. O `update` fixa os hooks na versão nova e renova os arquivos gerados que a pessoa não editou. Quando uma versão nova mudou o formato de um arquivo gerenciado, o `update` também roda a migração dessa versão, em ordem de semver, nos arquivos que a pessoa não editou. Um arquivo gerado que ela editou é mantido, e o template novo ou o texto migrado aparece em `data.diff` como proposta. Um arquivo que não pode ser gravado por falta de permissão devolve `install_permission_denied` com o `fix`.

## Desfazer

```sh
npx finitemonkey@next uninstall --yes --json
npx finitemonkey@next uninstall --yes --purge --json
```

O primeiro tira o que o Finite Monkey acrescentou e restaura os backups, mantendo `.fm/` (backups e evidências). O `--purge` apaga também `.fm/`; depois de `init` e `uninstall --purge`, o projeto fica idêntico byte a byte ao que era. Arquivos que a pessoa editou depois de instalar são mantidos e listados em `data.kept`. Sem `--yes`, sai com 4 e o plano. O plugin, se instalado, sai à parte: `claude plugin uninstall finitemonkey@finitemonkey-next` (ou `finitemonkey@finitemonkey` para o marketplace estável).

<!-- translation of docs/AGENT-SETUP.md sha256:cc64d53b0681 -->
