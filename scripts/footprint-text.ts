import type { FootprintId } from "../src/core/footprint.js";
import { DEPLOY_FOOTPRINT_TEXT } from "./footprint-deploy-text.js";
import { PERSON_FOOTPRINT_TEXT } from "./footprint-person-text.js";
import { COPY_FOOTPRINT_TEXT } from "./footprint-text-copy.js";
import { GUARDIAN_FOOTPRINT_TEXT } from "./footprint-text-guardian.js";
import { STAGE3_FOOTPRINT_TEXT } from "./footprint-text-stage3.js";

export const LANGS = ["en", "pt-BR", "es"] as const;

export type Lang = (typeof LANGS)[number];

export type Localized = Readonly<Record<Lang, string>>;

export const FOOTPRINT_TEXT: Readonly<Record<FootprintId, Localized>> = {
  ...STAGE3_FOOTPRINT_TEXT,
  ...GUARDIAN_FOOTPRINT_TEXT,
  ...COPY_FOOTPRINT_TEXT,
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
  "hook-sources": {
    en: "`doctor` reads installed plugins and their hook files to list every hook and find conflicts; `doctor --hooks` also reads the latest Claude Code debug log for hook timings. It never changes another plugin's files.",
    "pt-BR":
      "O `doctor` lê os plugins instalados e os arquivos de hook deles para listar cada hook e achar conflitos; o `doctor --hooks` também lê o log de debug mais recente do Claude Code para os tempos dos hooks. Nunca altera arquivos de outro plugin.",
    es: "`doctor` lee los plugins instalados y sus archivos de hooks para listar cada hook y encontrar conflictos; `doctor --hooks` también lee el log de depuración más reciente de Claude Code para los tiempos de los hooks. Nunca cambia archivos de otro plugin.",
  },
  install: {
    en: "`init` and `update`: hook settings (and, with `--sandbox`, the sandbox in your local settings), the verify skill, a short managed block in `AGENTS.md` that `CLAUDE.md` imports, one `.gitignore` line, the pinned runtime and a backup of every file it changes.",
    "pt-BR":
      "`init` e `update`: configuração dos hooks (e, com `--sandbox`, o sandbox nas suas configurações locais), a skill verify, um bloco gerenciado curto no `AGENTS.md` que o `CLAUDE.md` importa, uma linha no `.gitignore`, o runtime fixado e um backup de cada arquivo que alteram.",
    es: "`init` y `update`: la configuración de los hooks (y, con `--sandbox`, el sandbox en tu configuración local), la skill verify, un bloque gestionado corto en `AGENTS.md` que `CLAUDE.md` importa, una línea en `.gitignore`, el runtime fijado y una copia de cada archivo que cambian.",
  },
  prompts: {
    en: "What you type to Claude Code in this project, with secrets masked, so `finitemonkey audit` can find requests and decisions that never reached a document. It stays on this machine.",
    "pt-BR":
      "O que você digita para o Claude Code neste projeto, com segredos mascarados, para o `finitemonkey audit` achar pedidos e decisões que nunca chegaram a um documento. Fica nesta máquina.",
    es: "Lo que escribes a Claude Code en este proyecto, con los secretos enmascarados, para que `finitemonkey audit` encuentre pedidos y decisiones que nunca llegaron a un documento. Se queda en esta máquina.",
  },
  spend: {
    en: "Agent spend estimated from the local session logs, per task, day and month, and the differences found by `cost reconcile`.",
    "pt-BR":
      "O gasto do agente estimado a partir dos logs locais de sessão, por tarefa, dia e mês, e as diferenças achadas pelo `cost reconcile`.",
    es: "El gasto del agente estimado desde los logs locales de sesión, por tarea, día y mes, y las diferencias que encuentra `cost reconcile`.",
  },
  plan: {
    en: "Plan documents under `docs/plan/`: the inventory of what the code does today, decision records, research records, cost models, the master plan from the first L task and the copy of it kept before each consolidation.",
    "pt-BR":
      "Documentos de plano em `docs/plan/`: o inventário do que o código faz hoje, registros de decisão, registros de pesquisa, modelos de custo, o plano mestre a partir da primeira tarefa L e a cópia dele guardada antes de cada consolidação.",
    es: "Documentos de plan en `docs/plan/`: el inventario de lo que hace el código hoy, registros de decisión, registros de investigación, modelos de costo, el plan maestro desde la primera tarea L y la copia que se guarda antes de cada consolidación.",
  },
  map: {
    en: "The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash, and the log of reuse warnings with whether each one led to reuse.",
    "pt-BR":
      "O mapa do código de `finitemonkey map`: uma linha por pasta com as definições de topo, em cache pelo hash da árvore, e o registro dos avisos de reuso com o resultado de cada um.",
    es: "El mapa del código de `finitemonkey map`: una línea por carpeta con sus definiciones de nivel superior, en caché por el hash del árbol, y el registro de los avisos de reutilización con el resultado de cada uno.",
  },
  signals: {
    en: "Loop signals from `finitemonkey signals`: error signatures, edit hashes and prompt fingerprints (hashed word pairs, never the text), the loop index and the calibrated thresholds. Deleted by `signals forget`.",
    "pt-BR":
      "Sinais de volta de `finitemonkey signals`: assinaturas de erro, hashes de edição e impressões dos pedidos (pares de palavras em hash, nunca o texto), o índice de voltas e os limiares calibrados. Apagados por `signals forget`.",
    es: "Señales de vuelta de `finitemonkey signals`: firmas de error, hashes de edición y huellas de los pedidos (pares de palabras en hash, nunca el texto), el índice de vueltas y los umbrales calibrados. Se borran con `signals forget`.",
  },
  perfil: {
    en: "The per-domain profile of the person from `finitemonkey perfil`: tool literacy per domain, raised by commits made outside the session, domain knowledge from the quick start, the concept book with the level shown for each concept seen in the project, and the concept evidence log (exposures, predictions, own changes and repairs, failures after approval) the concept states are counted from, the last x-ray of the changed lines, and the probes with their answers. `xray forget` deletes the evidence log and the x-ray; `probe forget` deletes the probes. Never committed and never in PR text or reports. Deleted by `perfil forget`.",
    "pt-BR":
      "O perfil da pessoa por domínio, de `finitemonkey perfil`: literacia na ferramenta por domínio, que sobe com commits feitos fora da sessão, conhecimento do domínio vindo do início rápido, o livro de conceitos com o nível mostrado em cada conceito visto no projeto e o registro de evidência por conceito (exposições, previsões, alterações e reparos próprios, falhas depois da aprovação) de onde os estados são contados, o último raio-x das linhas alteradas e as sondas com as respostas. `xray forget` apaga o registro de evidência e o raio-x; `probe forget` apaga as sondas. Nunca vai para commit, texto de PR ou relatório. Apagado por `perfil forget`.",
    es: "El perfil de la persona por dominio, de `finitemonkey perfil`: alfabetización en la herramienta por dominio, que sube con commits hechos fuera de la sesión, conocimiento del dominio del inicio rápido, el libro de conceptos con el nivel mostrado en cada concepto visto en el proyecto y el registro de evidencia por concepto (exposiciones, predicciones, cambios y reparaciones propios, fallos después de la aprobación) del que se cuentan los estados, la última radiografía de las líneas cambiadas y las sondas con sus respuestas. `xray forget` borra el registro de evidencia y la radiografía; `probe forget` borra las sondas. Nunca va a un commit, a texto de PR ni a informes. Se borra con `perfil forget`.",
  },
  runs: {
    en: "The full output of commands run through `finitemonkey run`, with secrets masked; the 30 most recent are kept.",
    "pt-BR":
      "A saída inteira dos comandos rodados por `finitemonkey run`, com segredos mascarados; ficam as 30 mais recentes.",
    es: "La salida completa de los comandos ejecutados con `finitemonkey run`, con los secretos enmascarados; se guardan las 30 más recientes.",
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
    en: "Screen captures, the contact sheet, the JSON summary and the interface findings per rule (`ux.json`, boxed screenshots) that `look` writes per tree hash.",
    "pt-BR":
      "Capturas de tela, a folha de contato, o resumo JSON e os achados de interface por regra (`ux.json`, capturas com caixas) que o `look` grava por hash da árvore.",
    es: "Capturas de pantalla, la hoja de contactos, el resumen JSON y los hallazgos de interfaz por regla (`ux.json`, capturas con recuadros) que escribe `look` por hash del árbol.",
  },
  reports: {
    en: "Masked bug reports that `doctor --report` writes, only when asked, and the report each front writes before it stops.",
    "pt-BR":
      "Relatórios de bug mascarados que o `doctor --report` grava, só quando pedido, e o relatório que cada frente grava antes de parar.",
    es: "Informes de error enmascarados que escribe `doctor --report`, solo cuando se pide, y el informe que cada frente escribe antes de parar.",
  },

  "pr-scope": {
    en: "Who accepted files outside the task scope in `pr open`, when and why, one file per branch.",
    "pt-BR": "Quem aceitou arquivos fora do escopo da tarefa no `pr open`, quando e por quê, um arquivo por branch.",
    es: "Quién aceptó archivos fuera del alcance de la tarea en `pr open`, cuándo y por qué, un archivo por rama.",
  },
  fronts: {
    en: "The state of a wave of parallel fronts (scope, worktree, branch, port, agent, status and inbox of each front) and the briefing every front prompt cites. Local, never committed.",
    "pt-BR":
      "O estado de uma onda de frentes paralelas (escopo, worktree, branch, porta, agente, status e inbox de cada frente) e o briefing que todo prompt de frente cita. Local, nunca vai para commit.",
    es: "El estado de una ola de frentes paralelas (alcance, worktree, rama, puerto, agente, estado e inbox de cada frente) y el briefing que cita cada prompt de frente. Local, nunca se commitea.",
  },
  profile: {
    en: "The person's level per domain; the infrastructure level picks the git defaults (intermediate when missing).",
    "pt-BR":
      "O nível da pessoa por domínio; o nível de infraestrutura escolhe os padrões de git (intermediário quando falta).",
    es: "El nivel de la persona por dominio; el nivel de infraestructura elige los valores de git (intermedio si falta).",
  },
  "github-ruleset": {
    en: "The ruleset `init --github` proposes when the default branch has none; it is sent to GitHub only after the person says yes.",
    "pt-BR":
      "O ruleset que o `init --github` propõe quando a branch padrão não tem nenhum; só vai para o GitHub depois do sim da pessoa.",
    es: "El ruleset que `init --github` propone cuando la rama por defecto no tiene ninguno; solo se envía a GitHub tras el sí de la persona.",
  },
  worktrees: {
    en: "The worktree registry and merge reports in the git common dir (never committed), the local exclude line for `.claude/worktrees/`, and worktrees created by `wt new`; repos on `/mnt/<drive>` or a synced folder get theirs under `~/.finitemonkey/worktrees/`. `wt archive` saves a worktree into `refs/finitemonkey/archive/` and copies ignored files that are not secrets to `~/.finitemonkey/archive/`.",
    "pt-BR":
      "O registro de worktrees e os relatórios de mescla no diretório comum do git (nunca vão para commit), a linha de exclusão local para `.claude/worktrees/` e os worktrees criados pelo `wt new`; repositório em `/mnt/<disco>` ou em pasta sincronizada recebe os seus em `~/.finitemonkey/worktrees/`. O `wt archive` guarda um worktree em `refs/finitemonkey/archive/` e copia arquivos ignorados que não são segredo para `~/.finitemonkey/archive/`.",
    es: "El registro de worktrees y los informes de fusión en el directorio común de git (nunca se commitean), la línea de exclusión local para `.claude/worktrees/` y los worktrees que crea `wt new`; un repositorio en `/mnt/<disco>` o en una carpeta sincronizada recibe los suyos en `~/.finitemonkey/worktrees/`. `wt archive` guarda un worktree en `refs/finitemonkey/archive/` y copia los archivos ignorados que no son secretos a `~/.finitemonkey/archive/`.",
  },
  "git-safety": {
    en: "Snapshots before destructive git commands and `rm` in the repository, with copies of ignored and untracked secret files up to 50 MB inside .git, the journal that `undo` reads and dropped-line decisions from merges.",
    "pt-BR":
      "Snapshots antes de comandos git destrutivos e de `rm` no repositório, com cópias de arquivos ignorados e de segredos não rastreados até 50 MB dentro do .git, o diário que o `undo` lê e as decisões sobre linhas descartadas em merges.",
    es: "Snapshots antes de comandos git destructivos y de `rm` en el repositorio, con copias de archivos ignorados y de secretos sin seguimiento hasta 50 MB dentro de .git, el diario que lee `undo` y las decisiones sobre líneas descartadas en merges.",
  },
  review: {
    en: "The review round count used by `review packet`, and, only when `review.playwright: true` is set in the config, a verifier agent with the Playwright MCP.",
    "pt-BR":
      "A contagem de rodadas de revisão usada pelo `review packet` e, só quando `review.playwright: true` está na configuração, um agente verificador com o MCP do Playwright.",
    es: "El conteo de rondas de revisión que usa `review packet` y, solo cuando `review.playwright: true` está en la configuración, un agente verificador con el MCP de Playwright.",
  },
  regression: {
    en: "A throwaway git worktree at the base commit, used to check that the test added in a bug fix fails without the fix. It is removed after the run.",
    "pt-BR":
      "Um worktree descartável do git no commit base, usado para checar que o teste novo de uma correção de bug falha sem a correção. Ele é removido depois da execução.",
    es: "Un worktree desechable de git en el commit base, usado para comprobar que el test nuevo de una corrección de bug falla sin la corrección. Se elimina después de la ejecución.",
  },
  advisor: {
    en: "Refactoring suggestions shown at the end of a task after the gate passes, with whether each was accepted, dismissed or closed. Nothing is changed in the code.",
    "pt-BR":
      "Sugestões de refatoração mostradas no fim de uma tarefa depois que o portão passa, com o que foi aceito, descartado ou fechado. Nada é mudado no código.",
    es: "Sugerencias de refactorización que se muestran al final de una tarea después de que pasa la puerta, con lo que se aceptó, descartó o cerró. No se cambia nada en el código.",
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
  creds: {
    en: "`creds` writes the credential inventory: variable names, where they are read, environments, type and risk. Never a value.",
    "pt-BR":
      "O `creds` grava o inventário de credenciais: nomes de variáveis, onde são lidas, ambientes, tipo e risco. Nunca um valor.",
    es: "`creds` escribe el inventario de credenciales: nombres de variables, dónde se leen, entornos, tipo y riesgo. Nunca un valor.",
  },
  "supply-chain": {
    en: "`deps scan` keeps the date each known vulnerability was first seen, so its deadline holds between runs. `deps config --write` saves the Dependabot or Renovate file; without `--write` it only prints it.",
    "pt-BR":
      "O `deps scan` guarda a data em que cada vulnerabilidade conhecida apareceu pela primeira vez, para o prazo valer entre execuções. O `deps config --write` grava o arquivo do Dependabot ou do Renovate; sem `--write` ele só imprime.",
    es: "`deps scan` guarda la fecha en que cada vulnerabilidad conocida apareció por primera vez, para que su plazo valga entre ejecuciones. `deps config --write` guarda el archivo de Dependabot o Renovate; sin `--write` solo lo imprime.",
  },
  osv: {
    en: "Package names and versions from your lockfiles, to the OSV database through `osv-scanner`, only when you run `deps scan` (in CI, for example). Never from a hook.",
    "pt-BR":
      "Nomes e versões de pacotes dos seus lockfiles, para a base do OSV pelo `osv-scanner`, só quando você roda `deps scan` (no CI, por exemplo). Nunca a partir de um hook.",
    es: "Nombres y versiones de paquetes de tus lockfiles, a la base de OSV mediante `osv-scanner`, solo cuando ejecutas `deps scan` (en CI, por ejemplo). Nunca desde un hook.",
  },
  supervisor: {
    en: "Only with `supervisor: enabled: true` in the config: a short-lived hold file per session in the directory an account-switching supervisor announces, while the gate runs or holds the stop. `gain` reads that directory's `usage.json`.",
    "pt-BR":
      "Só com `supervisor: enabled: true` na configuração: um arquivo de espera de vida curta por sessão no diretório que um supervisor de troca de conta anuncia, enquanto o portão roda ou segura a parada. O `gain` lê o `usage.json` desse diretório.",
    es: "Solo con `supervisor: enabled: true` en la configuración: un archivo de espera de vida corta por sesión en el directorio que anuncia un supervisor de cambio de cuenta, mientras la puerta corre o retiene la parada. `gain` lee el `usage.json` de ese directorio.",
  },
  appsec: {
    en: "`appsec rules --write` saves the semgrep rules generated for the detected stack, for CI to run; without `--write` it only prints them. `data-map` writes one row per personal field found in the schema (names only).",
    "pt-BR":
      "O `appsec rules --write` grava as regras do semgrep geradas para a stack detectada, para o CI rodar; sem `--write` ele só imprime. O `data-map` grava uma linha por campo pessoal achado no schema (só nomes).",
    es: "`appsec rules --write` guarda las reglas de semgrep generadas para la stack detectada, para que CI las ejecute; sin `--write` solo las imprime. `data-map` escribe una fila por campo personal encontrado en el esquema (solo nombres).",
  },
  rules: {
    en: "`rules compile` writes, per rule in `.finitemonkey/rules.yml`: deny entries and settings keys in `.claude/settings.json`, a line in `AGENTS.md`, the list of what it wrote, and with `--ci` a workflow that checks the rules on pull requests. `uninstall` removes all of it.",
    "pt-BR":
      "O `rules compile` grava, para cada regra de `.finitemonkey/rules.yml`: entradas de deny e chaves de configuração em `.claude/settings.json`, uma linha no `AGENTS.md`, a lista do que gravou e, com `--ci`, um workflow que confere as regras nos pull requests. O `uninstall` remove tudo isso.",
    es: "`rules compile` escribe, por cada regla de `.finitemonkey/rules.yml`: entradas de deny y claves de configuración en `.claude/settings.json`, una línea en `AGENTS.md`, la lista de lo que escribió y, con `--ci`, un workflow que revisa las reglas en los pull requests. `uninstall` lo quita todo.",
  },
  "secrets-live": {
    en: "Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent.",
    "pt-BR":
      "Pelo `curl`, só quando você roda `finitemonkey secrets live <provedor> --env <VARIAVEL> --send`: uma requisição com aquela chave para a API do provedor para ver se ela ainda funciona. Desligado por padrão, nunca roda por hook, e o host aparece antes de qualquer envio.",
    es: "A través de `curl`, solo cuando tú ejecutas `finitemonkey secrets live <proveedor> --env <VARIABLE> --send`: una petición con esa clave a la API del proveedor para ver si aún funciona. Apagado por defecto, nunca lo ejecuta un hook, y el host se muestra antes de enviar nada.",
  },
  heavy: {
    en: "One lock file per running install, build or full test run, shared by every worktree on the machine, so they run one at a time (by default on WSL).",
    "pt-BR":
      "Um arquivo de trava por instalação, compilação ou suíte de testes em andamento, compartilhado por todas as worktrees da máquina, para que rodem uma de cada vez (por padrão no WSL).",
    es: "Un archivo de bloqueo por instalación, compilación o suite de pruebas en curso, compartido por todos los worktrees de la máquina, para que corran de a uno (por defecto en WSL).",
  },
  deploy: {
    en: "Through `curl`, only when `deploy.version_url` is set in `.finitemonkey/config.yml`: a GET to that URL after a push, to read which commit is live. With `deploy.environment`, the same question goes to GitHub deployments through `gh`.",
    "pt-BR":
      "Pelo `curl`, só quando `deploy.version_url` está definido em `.finitemonkey/config.yml`: um GET nessa URL depois de um push, para ler qual commit está no ar. Com `deploy.environment`, a mesma pergunta vai aos deployments do GitHub pelo `gh`.",
    es: "A través de `curl`, solo cuando `deploy.version_url` está definido en `.finitemonkey/config.yml`: un GET a esa URL después de un push, para leer qué commit está en producción. Con `deploy.environment`, la misma pregunta va a los deployments de GitHub a través de `gh`.",
  },
  "instruction-layers": {
    en: "`finitemonkey instructions` and `doctor` read every instruction file Claude Code would load: the managed `CLAUDE.md`, your `~/.claude/CLAUDE.md` and `~/.claude/rules/`, and each `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` from the folder you work in up to the disk root, to list them and find rules that contradict each other.",
    "pt-BR":
      "O `finitemonkey instructions` e o `doctor` leem cada arquivo de instruções que o Claude Code carregaria: o `CLAUDE.md` gerenciado, o seu `~/.claude/CLAUDE.md` e `~/.claude/rules/`, e cada `CLAUDE.md`, `CLAUDE.local.md` e `AGENTS.md` da pasta onde você trabalha até a raiz do disco, para listá-los e achar regras que se contradizem.",
    es: "`finitemonkey instructions` y `doctor` leen cada archivo de instrucciones que Claude Code cargaría: el `CLAUDE.md` administrado, tu `~/.claude/CLAUDE.md` y `~/.claude/rules/`, y cada `CLAUDE.md`, `CLAUDE.local.md` y `AGENTS.md` desde la carpeta donde trabajas hasta la raíz del disco, para listarlos y encontrar reglas que se contradicen.",
  },
  "instructions-log": {
    en: "The `InstructionsLoaded` hook appends one line per instruction file Claude Code loads: the session, the path, why it loaded and when. `finitemonkey instructions` compares it with what it resolved. No file content is copied.",
    "pt-BR":
      "O hook `InstructionsLoaded` acrescenta uma linha por arquivo de instruções que o Claude Code carrega: a sessão, o caminho, o motivo e quando. O `finitemonkey instructions` compara com o que ele resolveu. Nenhum conteúdo de arquivo é copiado.",
    es: "El hook `InstructionsLoaded` agrega una línea por cada archivo de instrucciones que carga Claude Code: la sesión, la ruta, el motivo y cuándo. `finitemonkey instructions` lo compara con lo que resolvió. No se copia el contenido de ningún archivo.",
  },
  "rules-propose": {
    en: "`rules propose` adds to `.finitemonkey/rules.yml` only the entries you confirm in a terminal. Every rule broken at the end of a turn, blocked by a guard or reported with `rules violation` gets one line in `rule-violations.jsonl` (rule, source, masked detail), the evidence for promoting a reminder.",
    "pt-BR":
      "O `rules propose` acrescenta a `.finitemonkey/rules.yml` só as entradas que você confirma num terminal. Cada regra descumprida no fim de um turno, bloqueada por um guard ou informada com `rules violation` ganha uma linha em `rule-violations.jsonl` (regra, origem, detalhe mascarado), a evidência para promover um lembrete.",
    es: "`rules propose` agrega a `.finitemonkey/rules.yml` solo las entradas que confirmas en una terminal. Cada regla incumplida al final de un turno, bloqueada por un guard o informada con `rules violation` deja una línea en `rule-violations.jsonl` (regla, origen, detalle enmascarado), la evidencia para promover un recordatorio.",
  },
  learnings: {
    en: "Lessons from earlier work: a short text keyed by file paths or by the signature of an error that stopped after a change, how often each was used and when it last matched. A lesson unused for 90 days or marked unhelpful twice is deleted; `learnings delete` removes one by hand.",
    "pt-BR":
      "Lições de trabalhos anteriores: um texto curto ligado a caminhos de arquivo ou à assinatura de um erro que parou depois de uma mudança, quantas vezes cada uma foi usada e quando combinou pela última vez. Uma lição sem uso por 90 dias ou marcada como inútil duas vezes é apagada; `learnings delete` remove uma à mão.",
    es: "Lecciones de trabajos anteriores: un texto corto ligado a rutas de archivo o a la firma de un error que se detuvo tras un cambio, cuántas veces se usó cada una y cuándo coincidió por última vez. Una lección sin uso por 90 días o marcada como inútil dos veces se borra; `learnings delete` quita una a mano.",
  },
  ownership: {
    en: "`gen ownership` writes one entry per component (name, vocabulary type, owner, consumers) after the person passes `--yes`; `ci gate`, `ownership check` and `plan check` read it, or read `catalog-info.yaml` when that exists.",
    "pt-BR":
      "O `gen ownership` grava uma entrada por peça (nome, tipo do vocabulário, dono, consumidores) depois que a pessoa passa `--yes`; `ci gate`, `ownership check` e `plan check` leem o arquivo, ou leem o `catalog-info.yaml` quando ele existe.",
    es: "`gen ownership` escribe una entrada por componente (nombre, tipo del vocabulario, dueño, consumidores) después de que la persona pasa `--yes`; `ci gate`, `ownership check` y `plan check` lo leen, o leen `catalog-info.yaml` cuando existe.",
  },
  "ci-protect": {
    en: "One line per GitHub setting `ci protect` changed after the person's yes in a terminal: when, the repository, the setting, the value before and after, and whether GitHub accepted it. The settings it read are cached in `.finitemonkey/cache/github-settings.json` for `doctor`.",
    "pt-BR":
      "Uma linha por configuração do GitHub que o `ci protect` mudou depois do sim da pessoa num terminal: quando, o repositório, a configuração, o valor antes e depois, e se o GitHub aceitou. O que ele leu fica em cache em `.finitemonkey/cache/github-settings.json` para o `doctor`.",
    es: "Una línea por cada configuración de GitHub que `ci protect` cambió tras el sí de la persona en una terminal: cuándo, el repositorio, la configuración, el valor antes y después, y si GitHub la aceptó. Lo que leyó queda en caché en `.finitemonkey/cache/github-settings.json` para `doctor`.",
  },
  ...DEPLOY_FOOTPRINT_TEXT,
  ...PERSON_FOOTPRINT_TEXT,
};

export { SECTION_TEXT } from "./footprint-sections.js";
