import type { FootprintId, FootprintKind } from "../src/core/footprint.js";

export const LANGS = ["en", "pt-BR", "es"] as const;

export type Lang = (typeof LANGS)[number];

type Localized = Readonly<Record<Lang, string>>;

export const FOOTPRINT_TEXT: Readonly<Record<FootprintId, Localized>> = {
  "hook-input": {
    en: "The event Claude Code passes to each hook: the tool call, the prompt or the stop request.",
    "pt-BR": "O evento que o Claude Code passa a cada hook: a chamada de ferramenta, o prompt ou o pedido de parada.",
    es: "El evento que Claude Code pasa a cada hook: la llamada a la herramienta, el prompt o la petición de parada.",
  },
  "claude-settings": {
    en: "Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set.",
    "pt-BR":
      "As configurações do Claude Code, para conferir que os hooks estão instalados e que nada os desliga. `$CLAUDE_CONFIG_DIR` substitui `~/.claude` quando definido.",
    es: "La configuración de Claude Code, para comprobar que los hooks están instalados y que nada los desactiva. `$CLAUDE_CONFIG_DIR` reemplaza `~/.claude` si está definido.",
  },
  instructions: {
    en: "Instruction files, read by `doctor` to report rules that exist only as text.",
    "pt-BR": "Arquivos de instrução, lidos pelo `doctor` para apontar regras que só existem como texto.",
    es: "Archivos de instrucciones, que `doctor` lee para señalar reglas que solo existen como texto.",
  },
  git: {
    en: "The repository through the `git` command: status, diffs, refs and the reflog.",
    "pt-BR": "O repositório pelo comando `git`: status, diffs, refs e o reflog.",
    es: "El repositorio a través del comando `git`: estado, diffs, refs y el reflog.",
  },
  "changed-files": {
    en: "Changed files, scanned for secrets, test skips, placeholders and prose patterns.",
    "pt-BR": "Arquivos alterados, varridos atrás de segredos, testes pulados, placeholders e padrões de prosa.",
    es: "Archivos modificados, revisados en busca de secretos, tests saltados, placeholders y patrones de prosa.",
  },
  config: {
    en: "Project configuration, the guard policy and the optional briefing for subagents.",
    "pt-BR": "A configuração do projeto, a política dos guards e o briefing opcional para subagentes.",
    es: "La configuración del proyecto, la política de los guards y el briefing opcional para subagentes.",
  },
  "session-logs": {
    en: "This project's local Claude Code session logs, read once and only with `init --look-back`.",
    "pt-BR": "Os logs locais de sessão do Claude Code deste projeto, lidos uma vez e só com `init --look-back`.",
    es: "Los logs locales de sesión de Claude Code de este proyecto, leídos una vez y solo con `init --look-back`.",
  },
  install: {
    en: "`init` and `update`: hook settings (and, with `--sandbox`, the sandbox in your local settings), the verify skill, a short managed block in `AGENTS.md` that `CLAUDE.md` imports, one `.gitignore` line, the pinned runtime and a backup of every file it changes.",
    "pt-BR":
      "`init` e `update`: configuração dos hooks (e, com `--sandbox`, o sandbox nas suas configurações locais), a skill verify, um bloco gerenciado curto no `AGENTS.md` que o `CLAUDE.md` importa, uma linha no `.gitignore`, o runtime fixado e um backup de cada arquivo que alteram.",
    es: "`init` y `update`: la configuración de los hooks (y, con `--sandbox`, el sandbox en tu configuración local), la skill verify, un bloque gestionado corto en `AGENTS.md` que `CLAUDE.md` importa, una línea en `.gitignore`, el runtime fijado y una copia de cada archivo que cambian.",
  },
  plan: {
    en: "Plan documents under `docs/plan/`: the inventory of what the code does today, the master plan from the first L task and the copy of it kept before each consolidation.",
    "pt-BR":
      "Documentos de plano em `docs/plan/`: o inventário do que o código faz hoje, o plano mestre a partir da primeira tarefa L e a cópia dele guardada antes de cada consolidação.",
    es: "Documentos de plan en `docs/plan/`: el inventario de lo que hace el código hoy, el plan maestro desde la primera tarea L y la copia que se guarda antes de cada consolidación.",
  },
  map: {
    en: "The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash.",
    "pt-BR":
      "O mapa do código de `finitemonkey map`: uma linha por pasta com as definições de topo, em cache pelo hash da árvore.",
    es: "El mapa del código de `finitemonkey map`: una línea por carpeta con sus definiciones de nivel superior, en caché por el hash del árbol.",
  },
  tasks: {
    en: "Task contracts and which task is active.",
    "pt-BR": "Contratos de tarefa e qual tarefa está ativa.",
    es: "Contratos de tarea y cuál tarea está activa.",
  },
  evidence: {
    en: "Evidence of each check, tied to the tree hash, and the gate log.",
    "pt-BR": "A evidência de cada checagem, ligada ao hash da árvore, e o log do portão.",
    es: "La evidencia de cada comprobación, ligada al hash del árbol, y el log de la puerta.",
  },
  person: {
    en: "Approvals and grants typed by the person, and a short-lived cache of open pull requests.",
    "pt-BR": "Aprovações e liberações digitadas pela pessoa, e um cache curto dos pull requests abertos.",
    es: "Aprobaciones y permisos escritos por la persona, y una caché breve de los pull requests abiertos.",
  },
  secrets: {
    en: "The accepted-findings baseline and exposure incidents. Both hold fingerprints and masks, never a secret value.",
    "pt-BR":
      "A baseline de achados aceitos e os incidentes de exposição. Os dois guardam impressões e máscaras, nunca o valor de um segredo.",
    es: "La línea base de hallazgos aceptados y los incidentes de exposición. Ambos guardan huellas y máscaras, nunca el valor de un secreto.",
  },
  look: {
    en: "Screen captures, the contact sheet and the JSON summary that `look` writes per tree hash.",
    "pt-BR": "Capturas de tela, a folha de contato e o resumo JSON que o `look` grava por hash da árvore.",
    es: "Capturas de pantalla, la hoja de contactos y el resumen JSON que escribe `look` por hash del árbol.",
  },
  reports: {
    en: "Masked bug reports that `doctor --report` writes, only when asked.",
    "pt-BR": "Relatórios de bug mascarados que o `doctor --report` grava, só quando pedido.",
    es: "Informes de error enmascarados que escribe `doctor --report`, solo cuando se pide.",
  },
  worktrees: {
    en: "The worktree registry in the git common dir (never committed), the local exclude line for `.claude/worktrees/`, and worktrees created by `wt new`; repos on `/mnt/<drive>` or a synced folder get theirs under `~/.finitemonkey/worktrees/`. `wt archive` saves a worktree into `refs/finitemonkey/archive/` and copies ignored files that are not secrets to `~/.finitemonkey/archive/`.",
    "pt-BR":
      "O registro de worktrees no diretório comum do git (nunca vai para commit), a linha de exclusão local para `.claude/worktrees/` e os worktrees criados pelo `wt new`; repositório em `/mnt/<disco>` ou em pasta sincronizada recebe os seus em `~/.finitemonkey/worktrees/`. O `wt archive` guarda um worktree em `refs/finitemonkey/archive/` e copia arquivos ignorados que não são segredo para `~/.finitemonkey/archive/`.",
    es: "El registro de worktrees en el directorio común de git (nunca se commitea), la línea de exclusión local para `.claude/worktrees/` y los worktrees que crea `wt new`; un repositorio en `/mnt/<disco>` o en una carpeta sincronizada recibe los suyos en `~/.finitemonkey/worktrees/`. `wt archive` guarda un worktree en `refs/finitemonkey/archive/` y copia los archivos ignorados que no son secretos a `~/.finitemonkey/archive/`.",
  },
  "git-safety": {
    en: "Snapshots before destructive git commands, the journal that `undo` reads and dropped-line decisions from merges.",
    "pt-BR":
      "Snapshots antes de comandos git destrutivos, o diário que o `undo` lê e as decisões sobre linhas descartadas em merges.",
    es: "Snapshots antes de comandos git destructivos, el diario que lee `undo` y las decisiones sobre líneas descartadas en merges.",
  },
  review: {
    en: "The review round count used by `review packet`, and, only when `review.playwright: true` is set in the config, a verifier agent with the Playwright MCP.",
    "pt-BR":
      "A contagem de rodadas de revisão usada pelo `review packet` e, só quando `review.playwright: true` está na configuração, um agente verificador com o MCP do Playwright.",
    es: "El conteo de rondas de revisión que usa `review packet` y, solo cuando `review.playwright: true` está en la configuración, un agente verificador con el MCP de Playwright.",
  },
  github: {
    en: "Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded.",
    "pt-BR":
      "Pelo `gh`, só quando ele está instalado e logado: o estado do pull request citado numa tarefa e os seus pull requests abertos para a linha da sessão. Código nunca é enviado.",
    es: "A través de `gh`, solo si está instalado y con sesión iniciada: el estado del pull request indicado en una tarea y tus pull requests abiertos para la línea de la sesión. El código nunca se sube.",
  },
  "local-app": {
    en: "One request to your own app on the port a `runtime` check declares, after starting it or finding it running. Nothing goes past this machine.",
    "pt-BR":
      "Uma requisição ao seu próprio app na porta que a checagem `runtime` declara, depois de subir o app ou achá-lo rodando. Nada sai desta máquina.",
    es: "Una petición a tu propia app en el puerto que declara la comprobación `runtime`, después de arrancarla o encontrarla en marcha. Nada sale de esta máquina.",
  },
  "deps-registry": {
    en: "The package name, to the npm or PyPI registry, when a shell command is about to add a package the project does not declare yet. Never with `FINITEMONKEY_OFFLINE=1`.",
    "pt-BR":
      "O nome do pacote, ao registro do npm ou do PyPI, quando um comando de shell vai adicionar um pacote que o projeto ainda não declara. Nunca com `FINITEMONKEY_OFFLINE=1`.",
    es: "El nombre del paquete, al registro de npm o de PyPI, cuando un comando de shell va a añadir un paquete que el proyecto aún no declara. Nunca con `FINITEMONKEY_OFFLINE=1`.",
  },
  "secrets-live": {
    en: "Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent.",
    "pt-BR":
      "Pelo `curl`, só quando você roda `finitemonkey secrets live <provedor> --env <VARIAVEL> --send`: uma requisição com aquela chave para a API do provedor para ver se ela ainda funciona. Desligado por padrão, nunca roda por hook, e o host aparece antes de qualquer envio.",
    es: "A través de `curl`, solo cuando tú ejecutas `finitemonkey secrets live <proveedor> --env <VARIABLE> --send`: una petición con esa clave a la API del proveedor para ver si aún funciona. Apagado por defecto, nunca lo ejecuta un hook, y el host se muestra antes de enviar nada.",
  },
};

export const SECTION_TEXT: Readonly<
  Record<
    Lang,
    {
      readonly heading: string;
      readonly intro: string;
      readonly kinds: Readonly<Record<FootprintKind, string>>;
      readonly what: string;
      readonly why: string;
    }
  >
> = {
  en: {
    heading: "What it reads, writes and sends",
    intro:
      "Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.",
    kinds: { reads: "Reads", writes: "Writes", sends: "Sends" },
    what: "What",
    why: "Why",
  },
  "pt-BR": {
    heading: "O que ele lê, grava e envia",
    intro:
      "Gerado a partir de `src/core/footprint.ts`, a lista que os testes cobram do código. Sem telemetria. Caminhos são relativos ao projeto, exceto os que começam com `~`.",
    kinds: { reads: "Lê", writes: "Grava", sends: "Envia" },
    what: "O quê",
    why: "Para quê",
  },
  es: {
    heading: "Qué lee, escribe y envía",
    intro:
      "Generado desde `src/core/footprint.ts`, la lista que los tests exigen al código. Sin telemetría. Las rutas son relativas al proyecto salvo las que empiezan con `~`.",
    kinds: { reads: "Lee", writes: "Escribe", sends: "Envía" },
    what: "Qué",
    why: "Para qué",
  },
};
