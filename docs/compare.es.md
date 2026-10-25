# Cómo se compara Finite Monkey

[English](compare.md) | [Português (Brasil)](compare.pt-BR.md) | Español

> **Prelanzamiento.** Finite Monkey todavía no existe como herramienta funcional. Todo lo que esta página dice sobre él es **previsto, todavía sin medir**. Todo lo que dice sobre los demás proyectos es un hecho que puedes comprobar en el enlace de al lado.

**Revisado el 2026-10-25**, leyendo el código de cada proyecto en el commit indicado. No se ejecutó ningún hook de terceros. Si algo está mal o desactualizado, abre una issue o un pull request y se corregirá.

## Mecanismo o prosa

La pregunta que esta página le hace a cada proyecto es la misma: cuando el modelo prefiere saltarse una regla, ¿qué sigue valiendo?

- **Mecanismo**: código que se ejecuta en el harness (un hook, una regla de permiso, un git hook, un paso de CI) y bloquea o comprueba decida lo que decida el modelo.
- **Prosa**: texto que el modelo lee (una skill, un prompt, un `CLAUDE.md`) y puede seguir. La prosa muchas veces es la herramienta correcta, para planificar, para el estilo y para el criterio. Solo que no prueba nada.

Ninguno es "mejor". La mayoría de las buenas configuraciones mezclan los dos. La apuesta prevista de Finite Monkey es acotada: las pocas cosas que siempre deben cumplirse (terminado verificado, tests sin debilitar, ningún secreto filtrado, ningún trabajo perdido en git, ningún cambio a mano en producción) deben ser mecanismo.

## De un vistazo

| Proyecto | Qué es | Su punto fuerte | Mecanismo | Queda en manos del modelo |
|---|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | Biblioteca de skills y método de desarrollo | Planificar antes de programar, disciplina de test primero, cero comandos | Un hook `SessionStart`; un script `task-done` que solo registra con salida 0 | Llamar a `task-done`, y todos los controles de las skills |
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | Orquestación multiagente | Delegación, modos, barra de estado | Hooks en `Stop`, control de git con parser de shell, presupuesto de lectura | Declarar la finalización (`/cancel`); control de git apagado fuera de los modos autónomos |
| [GSD](https://github.com/open-gsd/gsd-core) | Flujo de spec y fases con estado en archivos | Trabajo que sobrevive a `/clear`, planificación | Controles sobre la lectura de `.env`, el encogimiento de archivos de estado y el aislamiento de agentes | El veredicto de verificación, escrito por un agente LLM |
| [Spec Kit](https://github.com/github/spec-kit) | Kit de desarrollo guiado por spec | Estructura para cambios medianos y grandes, extensibilidad | Pasos `shell` del workflow; un subsistema de hooks nativos, apagado por defecto | Hooks de extensión, validación de tests, "Converged" |
| [ECC](https://github.com/affaan-m/ECC) | Catálogo grande de skills, agentes, comandos y hooks | Amplitud; un control de `--no-verify` minucioso | Control de `--no-verify`, protección de config de lint | La comprobación de tipos en `Stop` informa y sale con 0; el control de primer toque deja pasar el reintento |
| [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop) | Plugin oficial que mantiene al agente iterando | Persistencia en tareas largas, sencillez | Un hook `Stop` que vuelve a enviar el prompt | La condición de salida, una frase que escribe el modelo |
| [tdd-guard](https://github.com/nizos/tdd-guard) | Obliga a escribir el test primero | Una sola tarea, hecha con foco | Hook sobre las ediciones que puede bloquear | El criterio de si una edición sigue test primero (una llamada a un modelo) |
| [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) | Guarda de comandos destructivos | Cobertura de comandos peligrosos, falla cerrado por tiempo | Bloqueo en `PreToolUse` | n/a (no trata de terminado) |
| [cc-safety-net](https://github.com/kenryu42/cc-safety-net) | Guarda de comandos destructivos | Una sola tarea, instalación rápida, `doctor` | Bloqueo en `PreToolUse` | n/a (no trata de terminado) |
| Finite Monkey | Control previsto alrededor de una definición de terminado | Nada todavía: no está publicado | Previsto: control en `Stop`, guardas en `PreToolUse`, git hooks, CI | Previsto: nada en los cuatro daños |

## Superpowers

Commit [`2ce8aa1`](https://github.com/obra/superpowers/tree/2ce8aa1) (v7.0.1).

**Qué hace bien.** Las skills se activan solas, así que no hay nada que recordar. La skill de brainstorming hace que el agente lea el proyecto y pregunte antes de programar, que es el efecto que los usuarios mencionan primero. Las skills de test primero y de depuración le dan al modelo un método sólido.

**Mecanismo.** Un hook: `SessionStart` en `startup|clear|compact` ([`hooks/hooks.json`](https://github.com/obra/superpowers/blob/2ce8aa1/hooks/hooks.json)). El script [`skills/executing-plans/scripts/task-done`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/executing-plans/scripts/task-done) ejecuta el comando de tests y solo escribe la línea "Task N: complete" si sale con 0.

**Prosa.** Los controles son texto de skill, como "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE" en [`verification-before-completion`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/verification-before-completion/SKILL.md). Quien decide llamar a `task-done` es el modelo, y [obra/superpowers#2549](https://github.com/obra/superpowers/issues/2549) señala que un comando sustituto como `echo "tests passed"` no se distingue de una ejecución real de tests.

**Dónde prevé diferenciarse Finite Monkey.** El control ejecuta la comprobación él mismo desde un hook, no cuando el modelo lo elige, y los comandos triviales no cuentan como prueba. No intenta sustituir las skills de planificación: un diseño aprobado en Superpowers puede ser la entrada de una definición de terminado. Previsto, todavía sin medir.

## oh-my-claudecode

Commit [`5632614`](https://github.com/Yeachan-Heo/oh-my-claudecode/tree/5632614) (v5.7.14).

**Qué hace bien.** Orquestación multiagente con roles y modos, una barra de estado que gusta a los usuarios y un control de git con un parser de shell de verdad.

**Mecanismo.** [`scripts/workflow-drift-guard.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/workflow-drift-guard.mjs) en `Stop` bloquea cuando el último mensaje dice que terminó y el diff añadió `.skip(`, `.only(` o marcadores provisionales. [`scripts/git-guardrails.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/git-guardrails.mjs) bloquea `git push`, `reset --hard`, `clean -f` y similares. Un presupuesto de lectura deniega lecturas enormes sin límite.

**Dónde decide el modelo.** El drift guard deja pasar el cierre cuando `stop_hook_active` está activo (línea 910), así que bloquea una vez. El control de git solo está activo en los modos `ralph`, `autopilot`, `team` y `ultragoal` (línea 38) o con una variable de entorno. En los modos persistentes, terminar es que el modelo ejecute `/cancel`.

**Dónde prevé diferenciarse Finite Monkey.** El control sigue bloqueando mientras la definición de terminado falle, en lugar de ceder en el segundo intento, y el control de git está siempre activo. Previsto, todavía sin medir.

## GSD

[`open-gsd/gsd-core`](https://github.com/open-gsd/gsd-core) en el commit [`754e886`](https://github.com/open-gsd/gsd-core/tree/754e886) (v1.18.0). El original [`gsd-build/get-shit-done`](https://github.com/gsd-build/get-shit-done) está archivado y apunta a él.

**Qué hace bien.** El estado vive en archivos, así que el trabajo sigue después de `/clear`. La planificación y las fases son el centro del producto. Incluye controles que bloquean de verdad.

**Mecanismo.** [`hooks/gsd-secret-read-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-secret-read-guard.js) bloquea la lectura de `.env` y archivos parecidos por Read, Grep y Bash, y su cabecera explica por qué un hook funciona mejor que las reglas de permiso `Read()`. [`hooks/gsd-write-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-write-guard.js) bloquea escrituras que encogen el roadmap o los archivos de estado. Un control de aislamiento deniega agentes ejecutores sin worktree.

**Dónde decide el modelo.** La verificación es un agente LLM ([`agents/gsd-verifier.md`](https://github.com/open-gsd/gsd-core/blob/754e886/agents/gsd-verifier.md)) que escribe `VERIFICATION.md`, y el control de fase en [`src/phase.cts`](https://github.com/open-gsd/gsd-core/blob/754e886/src/phase.cts) lee el estado que escribió ese agente.

**Dónde prevé diferenciarse Finite Monkey.** El veredicto sale de comandos que el control ejecutó sobre los archivos actuales, no de un informe escrito por un agente. Previsto, todavía sin medir.

## Spec Kit

Commit [`67e0f72`](https://github.com/github/spec-kit/tree/67e0f72).

**Qué hace bien.** Una estructura clara de spec a plan a tareas para cambios medianos y grandes, muchas integraciones y un contexto fijo pequeño. Los usuarios elogian su extensibilidad.

**Mecanismo.** Los pasos `shell` del workflow fallan con una salida distinta de cero. Un subsistema `events` puede instalar hooks nativos de Claude Code y transmitir su código de salida; las extensiones incluidas no lo activan.

**Prosa.** Los hooks de extensión como `after_implement` dependen de que el modelo los invoque: "mandatory extension hooks rely on the model invoking the hook skill" ([`src/specify_cli/integrations/claude/__init__.py`](https://github.com/github/spec-kit/blob/67e0f72/src/specify_cli/integrations/claude/__init__.py), líneas 70 a 72). La validación de tests en el comando de implementación es una instrucción, y la convergencia la declara el modelo. [github/spec-kit#1323](https://github.com/github/spec-kit/issues/1323) pide un control final de calidad.

**Dónde prevé diferenciarse Finite Monkey.** La idea es encajar en Spec Kit, no competir con él: el control como paso `shell` del workflow o como handler de `Stop`, leyendo `tasks.md` como definición de terminado. Previsto, todavía sin medir.

## ECC (Everything Claude Code)

[`affaan-m/ECC`](https://github.com/affaan-m/ECC) en el commit [`90606c8`](https://github.com/affaan-m/ECC/tree/90606c8) (v2.2.3).

**Qué hace bien.** El catálogo más amplio de esta lista. Su control de `--no-verify` es el más minucioso de los leídos para esta página: también detecta la redirección de hooks con `core.hooksPath`, `include.path` e `includeIf`, y bloquea cuando no puede analizar el comando.

**Mecanismo.** [`block-no-verify.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/block-no-verify.js) y [`config-protection.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/config-protection.js) bloquean con código de salida 2. La protección cubre configs de linter y formateador y deja fuera, a propósito, configs de test como `vitest.config.ts` y `tsconfig.json` (líneas 111 a 115).

**Dónde decide el modelo.** [`stop-format-typecheck.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/stop-format-typecheck.js) se ejecuta en `Stop`, informa y sale con 0, es decir, avisa sin bloquear. [`gateguard-fact-force.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/gateguard-fact-force.js) deniega el primer toque de un archivo y deja pasar el reintento (líneas 1935 y 1936).

**Dónde prevé diferenciarse Finite Monkey.** Un núcleo pequeño con presupuesto de contexto comprobado en CI, un control en `Stop` que bloquea y ningún control que ceda al reintentar. Previsto, todavía sin medir.

## ralph-loop

Plugin oficial en [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop), commit `5826794`.

**Qué hace bien.** Mantiene al agente trabajando en una tarea larga en lugar de parar antes de tiempo, casi sin configuración.

**Mecanismo.** Un hook `Stop` ([`hooks/stop-hook.sh`](https://github.com/anthropics/claude-plugins-official/blob/5826794/plugins/ralph-loop/hooks/stop-hook.sh)) vuelve a enviar el prompt hasta alcanzar un número máximo de iteraciones (línea 61).

**Dónde decide el modelo.** El bucle termina cuando el último mensaje del modelo contiene `<promise>TEXTO</promise>` igual a la promesa de finalización que definiste (líneas 129 a 138). El propio mensaje del hook le pide al modelo que no mienta para salir.

**Dónde prevé diferenciarse Finite Monkey.** La condición de salida es una definición de terminado que el control comprueba, no una frase. Previsto, todavía sin medir.

## tdd-guard

Commit [`108992d`](https://github.com/nizos/tdd-guard/tree/108992d).

**Qué hace bien.** Una sola tarea, hecha con foco: bloquea las ediciones que se saltan el test que falla primero. La persona lo enciende y apaga escribiendo `tdd-guard on` o `tdd-guard off` ([`src/hooks/userPromptHandler.ts`](https://github.com/nizos/tdd-guard/blob/108992d/src/hooks/userPromptHandler.ts), líneas 8 y 9), lo que deja ese interruptor en manos humanas.

**Mecanismo y criterio.** El hook bloquea de verdad. Si una edición cuenta como test primero lo decide una llamada a un modelo en cada edición.

**Dónde prevé diferenciarse Finite Monkey.** No obliga a escribir el test primero. Comprueba que los tests no se eliminaron, saltaron ni debilitaron, y que pasan sobre los archivos finales. Si lo que quieres es test primero, tdd-guard es la herramienta más directa.

## dcg (destructive_command_guard)

Commit [`b33f3ef`](https://github.com/Dicklesworthstone/destructive_command_guard/tree/b33f3ef).

**Qué hace bien.** Cobertura amplia de comandos destructivos, soporte para varios agentes y una dirección de fallo clara: una evaluación de más de 1000 ms devuelve una decisión indeterminada, "never allow" ([`src/perf.rs`](https://github.com/Dicklesworthstone/destructive_command_guard/blob/b33f3ef/src/perf.rs), líneas 800 a 812). Sus mantenedores siguen los falsos positivos en público, por ejemplo en [#560](https://github.com/Dicklesworthstone/destructive_command_guard/issues/560).

**Dónde prevé diferenciarse Finite Monkey.** dcg vigila comandos. Finite Monkey prevé añadir una instantánea y un `undo` alrededor de las operaciones arriesgadas de git, y un control de terminado. Si solo necesitas un guarda de comandos, dcg es una opción enfocada.

## cc-safety-net

Commit [`71baf74`](https://github.com/kenryu42/cc-safety-net/tree/71baf74).

**Qué hace bien.** Bloquea `git reset --hard`, `git push --force`, `rm -rf` sobre objetivos peligrosos y scripts de instalación por tubería, incluso dentro de `bash -c` o `python -c` ([`README.md`](https://github.com/kenryu42/cc-safety-net/blob/71baf74/README.md), línea 74). Se instala en una línea y tiene `doctor`. Cuando el hook era lento con `npx`, el mantenedor pasó a un binario incluido ([#16](https://github.com/kenryu42/cc-safety-net/issues/16)).

**Dónde prevé diferenciarse Finite Monkey.** Lo mismo que con dcg: lo que se prevé añadir es la instantánea con `undo` y el control de terminado. Para un guarda de comandos solo, cc-safety-net es la instalación más sencilla.

## Dónde prevé diferenciarse Finite Monkey

Todo esto es **previsto, todavía sin medir**.

- **Pruebas en lugar de testimonios.** Terminado significa que el control ejecutó la definición de terminado sobre los archivos actuales. Un mensaje en el chat, un archivo de progreso o un informe escrito por un agente no cuentan.
- **Un control que no cede.** Sigue bloqueando mientras la definición de terminado falle, y termina con un informe de "no terminado" en lugar de un bucle infinito.
- **Cuatro daños en una instalación.** "Listo" falso, secretos filtrados, cambios a mano en producción y trabajo perdido en git, con un `undo` para git.
- **Contexto fijo pequeño.** El cumplimiento vive en hooks, que no cuestan tokens por turno, con un presupuesto en bytes comprobado en CI.
- **Medido o eliminado.** Un benchmark público con ablación decide qué reglas se quedan.

## Dónde van por delante hoy

- Existen, están publicados y se usan. Finite Monkey no.
- Superpowers, GSD y Spec Kit ayudan a decidir qué construir. Finite Monkey no prevé construir esa fase; prevé leer lo que producen.
- Varios funcionan con muchos agentes. Finite Monkey empieza solo con Claude Code.

## Otros en el mismo espacio

- [OpenSpec](https://github.com/Fission-AI/OpenSpec): cambios guiados por spec; [#1142](https://github.com/Fission-AI/OpenSpec/issues/1142) pide controles de calidad como concepto de primera clase.
- [no-mistakes](https://github.com/kunchenguid/no-mistakes): revisión y tests antes del push, con los comandos leídos de la rama por defecto y no del commit enviado.
- [hookify](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/hookify): plugin oficial que convierte una frase en una regla de hook.
- En npm, `redpen-cli` ("A definition-of-done and verification layer for coding agents") y `@reneza/skillgate` ("Deterministic finish-line gates for AI coding agents") describen objetivos cercanos a los de Finite Monkey. No se leyeron a fondo para esta página.
