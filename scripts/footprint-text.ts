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
    en: "Project configuration and the optional briefing for subagents.",
    "pt-BR": "A configuração do projeto e o briefing opcional para subagentes.",
    es: "La configuración del proyecto y el briefing opcional para subagentes.",
  },
  install: {
    en: "`init` and `update`: hook settings, the verify skill, one `.gitignore` line, the pinned runtime and a backup of every file it changes.",
    "pt-BR":
      "`init` e `update`: configuração dos hooks, a skill verify, uma linha no `.gitignore`, o runtime fixado e um backup de cada arquivo que alteram.",
    es: "`init` y `update`: la configuración de los hooks, la skill verify, una línea en `.gitignore`, el runtime fijado y una copia de cada archivo que cambian.",
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
  "git-safety": {
    en: "Snapshots before destructive git commands, the journal that `undo` reads and dropped-line decisions from merges.",
    "pt-BR":
      "Snapshots antes de comandos git destrutivos, o diário que o `undo` lê e as decisões sobre linhas descartadas em merges.",
    es: "Snapshots antes de comandos git destructivos, el diario que lee `undo` y las decisiones sobre líneas descartadas en merges.",
  },
  github: {
    en: "Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded.",
    "pt-BR":
      "Pelo `gh`, só quando ele está instalado e logado: o estado do pull request citado numa tarefa e os seus pull requests abertos para a linha da sessão. Código nunca é enviado.",
    es: "A través de `gh`, solo si está instalado y con sesión iniciada: el estado del pull request indicado en una tarea y tus pull requests abiertos para la línea de la sesión. El código nunca se sube.",
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
