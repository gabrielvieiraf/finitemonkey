# Finite Monkey

<p align="center">
  <a href="https://www.npmjs.com/package/finitemonkey/v/next"><img src="https://img.shields.io/npm/v/finitemonkey/next?color=cb3837&logo=npm&label=npm%40next" alt="npm"></a>
  <a href="https://www.npmjs.com/package/finitemonkey"><img src="https://img.shields.io/npm/dm/finitemonkey?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml"><img src="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml/badge.svg?branch=next" alt="CI"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/next/README.es.md#instalaci%C3%B3n-prevista"><img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757?logo=anthropic&logoColor=white" alt="Claude Code plugin"></a>
</p>

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animación: un mono con sudadera amarilla aporrea el teclado de un portátil mientras una terminal ejecuta el control. Las comprobaciones que fallan se ponen en verde y se bloquean una a una hasta que aparece actually done, y el mono lo celebra con un plátano.">
  <br>
  <sub>Ilustración. La grabación de abajo es la herramienta real.</sub>
</p>

<p align="center">
  <img src="assets/gate.gif" width="720" alt="Grabación de una sesión de Claude Code. Le piden sumar un cupón al carrito sin ejecutar las pruebas; ejecuta el control de todos modos, ve fallar la prueba total rounds to cents, redondea el resultado y lo ejecuta otra vez. El hook de Stop informa entonces: control en verde, 10 comprobaciones pasaron en este árbol.">
  <br>
  <sub>Grabación real, finitemonkey 0.1.0-next.27 con Claude Code 2.1.283, acelerada 1,3×. Fuente: <a href="assets/gate.cast">assets/gate.cast</a>.</sub>
</p>

**No hacen falta infinitos monos. Con uno basta: tú.**

[English](README.md) | [Português (Brasil)](README.pt-BR.md) | Español

> **Prelanzamiento.** Todavía no se puede instalar. El nombre `finitemonkey` en npm está reservado (la 0.0.0 es solo un marcador) y el código se está construyendo en abierto. Todo lo que sigue es el plan, no lo que pasa hoy. Dale una estrella o sigue el repositorio si quieres enterarte cuando salga la v0.1.

Sé cómo es. Con la llegada de la IA, muchas cosas cambiaron.

Unos se dan cabezazos contra el teclado esperando que Claude escupa por arte de magia el próximo SaaS millonario. Otros ya se cansaron de escribir código. Y hay quien tiene que entregar en días lo que antes exigía equipos enteros trabajando durante meses.

El resultado casi siempre es el mismo: te conviertes en un mono frente a la computadora, sepultado bajo tanto por hacer que ya no sabes por dónde empezar, y mucho menos cómo terminar.

Finite Monkey nació para ser la puerta entre ese mono y `main`.

Escribe como quieras. Trabaja con la IA que prefieras. Produce código a la velocidad que puedas.

Finite Monkey se ocupa primero de lo que no puede quedar a base de confianza: las verificaciones.

Cada verificación aprobada queda registrada. Cada fallo sigue a la vista hasta que se resuelve. Y nada se considera listo sin pruebas de que realmente funciona.

No importa cuánto código se generó, cuántos agentes trabajaron ni qué tan convincente parece la respuesta de la IA. Si no pasó las verificaciones, no está listo.

Y la puerta es solo el comienzo: Finite Monkey también se da cuenta cuando estás dando vueltas, muestra lo que falta en un proyecto que te queda grande, sostiene las riendas de varios agentes a la vez y lo lleva todo a producción sin romper nada en el camino.

Un mono. Tiempo finito. Trabajo que sale de verdad.

## Claude Code dice que terminó, pero no terminó

Es el problema principal que Finite Monkey quiere resolver. Comportamiento previsto:

- Cada tarea tiene una **definición de terminado** que una máquina puede comprobar: comandos que deben salir bien, tests que deben existir y pasar, un diff que no se sale del alcance.
- Cuando Claude intenta cerrar la sesión, el hook `Stop` ejecuta esa comprobación. Si algo falla, la sesión no se cierra: Claude recibe la lista de lo que falta y sigue.
- Solo cuenta como prueba lo que Finite Monkey ejecutó por sí mismo, sobre el estado actual de los archivos. "Ejecuté los tests antes de mi último cambio" no vale.
- El informe final sale solo de esas pruebas.

## Claude se saltó o borró tests para que pasaran

Controles previstos sobre las ediciones: tests eliminados, `skip` u `only` nuevos, aserciones borradas y cambios en la configuración del propio control se detectan y se informan.

## Claude ejecutó `git reset --hard` y perdí trabajo

Previsto:

- Una instantánea antes de cada operación arriesgada de git, y un `undo` que la recupera.
- Nada de `--force`, nunca.
- Los worktrees con cambios pendientes se archivan en lugar de borrarse.
- Una comprobación de "no se perdió nada" en cada merge.

## Mis reglas de CLAUDE.md se ignoran, sobre todo después de la compactación

Se ignoran. Claude lee `CLAUDE.md` como parte de su contexto, y nada comprueba que se haya seguido. Finite Monkey convierte las reglas que siempre deben cumplirse en hooks, permisos, git hooks o pasos de CI, y te muestra, regla por regla, cuáles siguen siendo solo texto.

## ¿Cómo evito que Claude Code filtre secretos?

Previsto: una única regla de detección, aplicada al escribir archivos, en los prompts, al hacer commit, en el historial y en CI. Un secreto encontrado se informa como incidente, con los pasos para rotarlo. Los secretos se citan por archivo y línea, nunca por su valor.

## ¿Cómo evito que un agente toque producción a mano?

Previsto: los comandos con efecto sobre un servidor de producción se bloquean. Producción cambia por el camino de despliegue que declares.

## Más que una puerta (previsto)

La puerta va primero porque nada más importa si el "listo" puede ser mentira. El resto del plan trata de quien escribe:

- **Cuando estás dando vueltas.** El cuarto arreglo para el mismo error, el mismo archivo editado una y otra vez, un bug pegado de una IA a otra y de vuelta: Finite Monkey nota la vuelta y lo dice claro, con qué probar en su lugar.
- **Cuando el proyecto te queda grande, por ahora.** Quien nunca puso un SaaS en marcha no sabe que necesita login, cobros, copias de seguridad y una forma de volver atrás. Los planos de proyecto muestran lo que necesita una versión de verdad y lo que aún falta, para que una pantalla de login no se llame producto. Las explicaciones se ajustan a lo que ya sabes y desaparecen a medida que aprendes.
- **Cuando una decisión pesa.** Antes de cambiar una biblioteca o un proveedor: qué hay hoy, cuáles son las opciones, los criterios escritos antes de los candidatos, el costo y cómo volver.
- **Cuando usas varios agentes a la vez.** Frentes de trabajo en paralelo, cada uno en su rama, un merge que comprueba que no se perdió nada y una pantalla con lo que hace cada frente.
- **Cuando una regla tiene que valer en todas partes.** Una regla que escribes una vez se convierte en hook, permiso, git hook y paso de CI, y ves dónde sigue siendo solo texto.
- **Cuando va a producción.** CI, deploy e infraestructura a la medida del proyecto, y revisiones de organización del código para bases que crecieron demasiado rápido.

## Ningún comando que memorizar

Ejecutas un comando, una vez. A partir de ahí Finite Monkey actúa por contexto dentro de Claude Code:

- Los **hooks** hacen cumplir: `SessionStart` recupera el estado de la tarea, `UserPromptSubmit` detecta lo que pediste, `PreToolUse` frena la acción peligrosa antes de que ocurra, `Stop` no deja terminar mientras la definición de terminado falle, y `SubagentStop` revisa lo que informan los subagentes.
- Las **skills** las activa Claude por su cuenta cuando la situación lo pide.
- Los **comandos con barra** son atajos opcionales. Ningún flujo depende de que recuerdes uno.
- El **estilo de salida `report`** es opcional y viene apagado. Elígelo con `/output-style report` si quieres cada respuesta con la forma del informe final: primero el resultado, luego lo verificado, lo no verificado y lo pendiente, con HECHO, OPINIÓN e INFERENCIA marcados. Mantiene las instrucciones de programación de Claude Code (`keep-coding-instructions: true`).

## Instalación (prevista)

Aún no disponible. Cuando salga la v0.1:

```sh
npx finitemonkey@latest init
```

O como plugin de Claude Code, desde dentro de una sesión:

```
/plugin install finitemonkey --marketplace gabrielvieiraf/finitemonkey
```

Requisitos: Node.js 20 o posterior, en Linux, macOS, Windows o WSL. La instalación hace copias de seguridad, fusiona en lugar de sobrescribir y se puede ejecutar dos veces sin romper nada. `doctor` te dice qué está mal y `uninstall` deja todo como estaba.

**Todavía más vago:** pídele a Claude Code "instala Finite Monkey siguiendo docs/AGENT-SETUP.es.md". La guía le indica al agente que ejecute los comandos él mismo, que te pregunte solo lo que sea decisión tuya y que nunca te pida un secreto.

## De dónde viene el diseño

Finite Monkey parte de un estudio sobre lo que pasa cuando alguien trabaja con IA por encima de lo que puede juzgar. El ensayo [Efecto Rebote: el usuario como límite invisible de la inteligencia artificial](docs/ricochet/ricochet.es.md) describe dos fronteras que la persona no ve desde adentro: lo que no sabe pedir y lo que no puede evaluar. La sección 10 muestra cómo cada mecanismo de aquí pone una verificación ejecutable en esos dos puntos y qué hipótesis va a probar el banco de pruebas.

## ¿De verdad ayuda? (benchmark, previsto)

Todavía no se sabe. El benchmark previsto compara Claude Code solo, Claude Code con Finite Monkey y Finite Monkey sin una pieza cada vez, en tareas con trampas. Mide tareas terminadas de verdad, "listo" falso, secretos filtrados, trabajo perdido, tokens y tiempo. La regla sin efecto medido sale del núcleo. El método y los resultados en bruto estarán en este repositorio, incluidas las partes donde no ayudó.

<!-- generated:evidence:start -->
Tasas de error de los guards siempre activos, reproducidas con `npm run evidence` en la versión 0.1.0-next.40 sobre el corpus etiquetado en [bench/corpus](bench/corpus). Una release falla cuando la tasa de falsos positivos de un guard pasa del 15% o cuando su corpus tiene menos de 50 casos que deben bloquear o 50 que deben pasar. Por ahora todos los casos son sintéticos, escritos a partir de las listas de prueba de los propios guards; los casos de sesiones reales se contarán aparte.

| Guard | Debe bloquear | Debe dejar | Falsos positivos | Falsos negativos | p95 (ms) |
|---|---|---|---|---|---|
| `secrets` | 59 | 54 | 0/54 (0.0%) | 0/59 (0.0%) | 0.4 |
| `gate` | 52 | 52 | 0/52 (0.0%) | 0/52 (0.0%) | 0.3 |
| `git` | 55 | 59 | 1/59 (1.7%) | 0/55 (0.0%) | 95.8 |
| `rules` | 50 | 55 | 0/55 (0.0%) | 0/50 (0.0%) | 2.5 |

Costo frente a Claude Code solo en las mismas tareas: todavía sin medir.
<!-- generated:evidence:end -->

## ¿En qué se diferencia de...?

La comparación completa, con fuentes, está en [docs/compare.es.md](docs/compare.es.md).

- **Claude Code solo** ya tiene hooks y permisos. Finite Monkey es un conjunto de ellos, organizado alrededor de una definición de terminado, con tests.
- **Métodos como superpowers, GSD, Spec Kit u OpenSpec** le dicen al agente cómo planificar y construir. Finite Monkey no los sustituye: comprueba el resultado al final, uses el método que uses.
- **Guardas sueltos como tdd-guard, cc-safety-net o dcg** hacen un trabajo cada uno, y lo hacen bien. Finite Monkey cubre cuatro daños con un control, una instalación y un `undo`. Si solo necesitas uno de esos trabajos, un guarda suelto puede ser lo más sencillo.

<!-- generated:defaults:start -->
## Valores predeterminados y su evidencia

Un solo conjunto de valores predeterminados para todos, generado desde `src/defaults/items.ts`. Cada elemento viene de prácticas encontradas en 78 sesiones locales y tres repositorios. Una guía que ayuda a quien empieza puede frenar a quien ya domina (efecto de reversión de la experticia, Kalyuga et al. 2003), así que cualquier elemento se apaga con `defaults: <item>: off` en `.finitemonkey/config.yml`, y una convención del repositorio distinta de un predeterminado genera una pregunta, una sola vez.

| Predeterminado | Qué hace | Evidencia |
|---|---|---|
| `no-attribution` | Sin crédito de IA en commits y pull requests: `attribution` se vacía en la configuración cuando no está definido, y el guard y el hook `commit-msg` bloquean líneas `Co-Authored-By` de herramientas de IA y pies `Generated with`. | Presente en los tres repositorios estudiados y corregido a mano en las sesiones locales: el commit es trabajo de la persona. Regla I3 de este repositorio. |
| `branch-names` | Una rama nueva debe llamarse `tipo/issue-descripcion`; cualquier otro nombre se bloquea en vez de solo avisar. | Un pull request por issue, encontrado por el nombre de su rama, en los tres repositorios. |
| `prose-blocks` | El texto de commits, pull requests e issues y el Markdown cambiado que parecen escritos por una máquina se bloquean en vez de solo avisar. | Corregido en las sesiones locales y presente en los tres repositorios. Cada patrón está en el catálogo de prosa con su corpus de prueba. |
| `research-first` | Una dependencia nueva necesita un registro de investigación antes de que pase la compuerta. | Investigación antes del diseño, con registro de decisión, en las sesiones locales y los tres repositorios. |
| `no-comments` | Los comentarios `TODO` y `FIXME` no se listan como deuda; la deuda vive en el registro que se escribe al cerrar una tarea. | Sin comentarios en el código en los tres repositorios. Regla I1 de este repositorio. |
| `no-time-estimates` | La revisión de prosa marca estimaciones de tiempo en planes (`docs/plan/`) e informes. | Práctica de las sesiones locales: planes e informes dicen qué está hecho, qué falta y qué lo bloquea, sin estimaciones. |
| `conventional-commits` | Los encabezados de commit siguen Conventional Commits, revisados por los hooks `commit-msg` y `pre-push` y por la CI. Cuando la mayoría de los commits recientes es distinta, `init` pregunta una vez y guarda la respuesta en `conventions.commits`. | Usado en los tres repositorios, donde la versión sale de los tipos de commit. Regla I4 de este repositorio. |
<!-- generated:defaults:end -->

<!-- generated:footprint:start -->
## Qué lee, escribe y envía

Generado desde `src/core/footprint.ts`, la lista que los tests exigen al código. Sin telemetría. Las rutas son relativas al proyecto salvo las que empiezan con `~`.

| | Qué | Para qué |
|---|---|---|
| Lee | `stdin` | El evento que Claude Code pasa a cada hook: la llamada a la herramienta, el prompt o la petición de parada. |
| Lee | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | La configuración de Claude Code, para comprobar que los hooks están instalados y que nada los desactiva. `$CLAUDE_CONFIG_DIR` reemplaza `~/.claude` si está definido. |
| Lee | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Archivos de instrucciones, que `doctor` lee para señalar reglas que solo existen como texto. |
| Lee | `~/.claude/projects/` | Los logs locales de sesión de Claude Code de este proyecto: leídos una vez con `init --look-back`, y leídos de a poco en cada prompt solo cuando hay un tope de gasto en `.finitemonkey/config.yml`. `finitemonkey drift` (y, salvo con la flag drift-sensor apagada, una corrida en segundo plano como mucho una vez al día después de un turno) cuenta llamadas de herramientas, modelo y versión por día a partir de ellos; solo esas cuentas se guardan, en `.finitemonkey/cache/drift.json`. |
| Lee | `~/.claude/plugins/`, `~/.claude/debug/latest` | `doctor` lee los plugins instalados y sus archivos de hooks para listar cada hook y encontrar conflictos; `doctor --hooks` también lee el log de depuración más reciente de Claude Code para los tiempos de los hooks. Nunca cambia archivos de otro plugin. |
| Lee | `.git/` | El repositorio a través del comando `git`: estado, diffs, refs y el reflog. |
| Lee | `git diff` | Archivos modificados, revisados en busca de secretos, tests saltados, placeholders y patrones de prosa. |
| Lee | `.finitemonkey/config.yml`, `.finitemonkey/policy.yml`, `.finitemonkey/briefing.md`, `.finitemonkey/look.yml`, `.finitemonkey/appsec.yml`, `.finitemonkey/routes-public.yml`, `.finitemonkey/rules.yml`, `.finitemonkey/arch.yml` | La configuración del proyecto, la política de los guards y el briefing opcional para subagentes. |
| Lee | `.finitemonkey/profile.yml`, `~/.finitemonkey/profile.yml` | El nivel de la persona por dominio; el nivel de infraestructura elige los valores de git (intermedio si falta). |
| Lee | `~/.claude/CLAUDE.md`, `~/.claude/rules/`, `/etc/claude-code/CLAUDE.md`, `../CLAUDE.md` | `finitemonkey instructions` y `doctor` leen cada archivo de instrucciones que Claude Code cargaría: el `CLAUDE.md` administrado, tu `~/.claude/CLAUDE.md` y `~/.claude/rules/`, y cada `CLAUDE.md`, `CLAUDE.local.md` y `AGENTS.md` desde la carpeta donde trabajas hasta la raíz del disco, para listarlos y encontrar reglas que se contradicen. |
| Escribe | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/verify/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` y `update`: la configuración de los hooks (y, con `--sandbox`, el sandbox en tu configuración local), la skill verify, un bloque gestionado corto en `AGENTS.md` que `CLAUDE.md` importa, una línea en `.gitignore`, el runtime fijado y una copia de cada archivo que cambian. |
| Escribe | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Contratos de tarea y cuál tarea está activa. |
| Escribe | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | La evidencia de cada comprobación, ligada al hash del árbol, y el log de la puerta. |
| Escribe | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Aprobaciones y permisos escritos por la persona, y una caché breve de los pull requests abiertos. |
| Escribe | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | La línea base de hallazgos aceptados y los incidentes de exposición. Ambos guardan huellas y máscaras, nunca el valor de un secreto. |
| Escribe | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/`, `.git/finitemonkey/snapshots/` | Snapshots antes de comandos git destructivos y de `rm` en el repositorio, con copias de archivos ignorados y de secretos sin seguimiento hasta 50 MB dentro de .git, el diario que lee `undo` y las decisiones sobre líneas descartadas en merges. |
| Escribe | `.finitemonkey/reports/` | Informes de error enmascarados que escribe `doctor --report`, solo cuando se pide, y el informe que cada frente escribe antes de parar. |
| Escribe | `.finitemonkey/pr/` | Quién aceptó archivos fuera del alcance de la tarea en `pr open`, cuándo y por qué, un archivo por rama. |
| Escribe | `.finitemonkey/fronts.yml`, `.finitemonkey/briefing.md` | El estado de una ola de frentes paralelas (alcance, worktree, rama, puerto, agente, estado e inbox de cada frente) y el briefing que cita cada prompt de frente. Local, nunca se commitea. |
| Escribe | `.finitemonkey/github-ruleset.json` | El ruleset que `init --github` propone cuando la rama por defecto no tiene ninguno; solo se envía a GitHub tras el sí de la persona. |
| Escribe | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | El registro de worktrees y los informes de fusión en el directorio común de git (nunca se commitean), la línea de exclusión local para `.claude/worktrees/` y los worktrees que crea `wt new`; un repositorio en `/mnt/<disco>` o en una carpeta sincronizada recibe los suyos en `~/.finitemonkey/worktrees/`. `wt archive` guarda un worktree en `refs/finitemonkey/archive/` y copia los archivos ignorados que no son secretos a `~/.finitemonkey/archive/`. |
| Escribe | `.finitemonkey/creds.yml` | `creds` escribe el inventario de credenciales: nombres de variables, dónde se leen, entornos, tipo y riesgo. Nunca un valor. |
| Escribe | `.finitemonkey/findings/osv.json`, `.github/dependabot.yml`, `renovate.json` | `deps scan` guarda la fecha en que cada vulnerabilidad conocida apareció por primera vez, para que su plazo valga entre ejecuciones. `deps config --write` guarda el archivo de Dependabot o Renovate; sin `--write` solo lo imprime. |
| Escribe | `$FINITEMONKEY_HOLD_DIR/<session>.hold.json` | Solo con `supervisor: enabled: true` en la configuración: un archivo de espera de vida corta por sesión en el directorio que anuncia un supervisor de cambio de cuenta, mientras la puerta corre o retiene la parada. `gain` lee el `usage.json` de ese directorio. |
| Escribe | `.finitemonkey/semgrep/`, `.finitemonkey/data-map.yml` | `appsec rules --write` guarda las reglas de semgrep generadas para la stack detectada, para que CI las ejecute; sin `--write` solo las imprime. `data-map` escribe una fila por campo personal encontrado en el esquema (solo nombres). |
| Escribe | `.finitemonkey/rules-compiled.json`, `.github/workflows/finitemonkey-rules.yml` | `rules compile` escribe, por cada regla de `.finitemonkey/rules.yml`: entradas de deny y claves de configuración en `.claude/settings.json`, una línea en `AGENTS.md`, la lista de lo que escribió y, con `--ci`, un workflow que revisa las reglas en los pull requests. `uninstall` lo quita todo. |
| Escribe | `.finitemonkey/look/` | Capturas de pantalla, la hoja de contactos, el resumen JSON y los hallazgos de interfaz por regla (`ux.json`, capturas con recuadros) que escribe `look` por hash del árbol. |
| Escribe | `.finitemonkey/prompts.jsonl` | Lo que escribes a Claude Code en este proyecto, con los secretos enmascarados, para que `finitemonkey audit` encuentre pedidos y decisiones que nunca llegaron a un documento. Se queda en esta máquina. |
| Escribe | `.finitemonkey/spend.json`, `.finitemonkey/spend-reconcile.jsonl` | El gasto del agente estimado desde los logs locales de sesión, por tarea, día y mes, y las diferencias que encuentra `cost reconcile`. |
| Escribe | `docs/plan/` | Documentos de plan en `docs/plan/`: el inventario de lo que hace el código hoy, registros de decisión, registros de investigación, modelos de costo, el plan maestro desde la primera tarea L y la copia que se guarda antes de cada consolidación. |
| Escribe | `.finitemonkey/signals.jsonl`, `.finitemonkey/signals-index.json`, `.finitemonkey/signals-profile.json` | Señales de vuelta de `finitemonkey signals`: firmas de error, hashes de edición y huellas de los pedidos (pares de palabras en hash, nunca el texto), el índice de vueltas y los umbrales calibrados. Se borran con `signals forget`. |
| Escribe | `.finitemonkey/perfil.yml`, `.finitemonkey/perfil-commits.json`, `.finitemonkey/conceitos.yml`, `.finitemonkey/conceitos-events.jsonl`, `.finitemonkey/xray.json`, `.finitemonkey/probes.json` | El perfil de la persona por dominio, de `finitemonkey perfil`: alfabetización en la herramienta por dominio, que sube con commits hechos fuera de la sesión, conocimiento del dominio del inicio rápido, el libro de conceptos con el nivel mostrado en cada concepto visto en el proyecto y el registro de evidencia por concepto (exposiciones, predicciones, cambios y reparaciones propios, fallos después de la aprobación) del que se cuentan los estados, la última radiografía de las líneas cambiadas y las sondas con sus respuestas. `xray forget` borra el registro de evidencia y la radiografía; `probe forget` borra las sondas. Nunca va a un commit, a texto de PR ni a informes. Se borra con `perfil forget`. |
| Escribe | `.finitemonkey/runs/` | La salida completa de los comandos ejecutados con `finitemonkey run`, con los secretos enmascarados; se guardan las 30 más recientes. |
| Escribe | `.finitemonkey/map.txt`, `.finitemonkey/reuse.json` | El mapa del código de `finitemonkey map`: una línea por carpeta con sus definiciones de nivel superior, en caché por el hash del árbol, y el registro de los avisos de reutilización con el resultado de cada uno. |
| Escribe | `.finitemonkey/review/`, `.claude/agents/verifier.md` | El conteo de rondas de revisión que usa `review packet` y, solo cuando `review.playwright: true` está en la configuración, un agente verificador con el MCP de Playwright. |
| Escribe | `.finitemonkey/regression/` | Un worktree desechable de git en el commit base, usado para comprobar que el test nuevo de una corrección de bug falla sin la corrección. Se elimina después de la ejecución. |
| Escribe | `.finitemonkey/suggestions.jsonl` | Sugerencias de refactorización que se muestran al final de una tarea después de que pasa la puerta, con lo que se aceptó, descartó o cerró. No se cambia nada en el código. |
| Escribe | `~/.finitemonkey/heavy/` | Un archivo de bloqueo por instalación, compilación o suite de pruebas en curso, compartido por todos los worktrees de la máquina, para que corran de a uno (por defecto en WSL). |
| Escribe | `.finitemonkey/instructions.jsonl` | El hook `InstructionsLoaded` agrega una línea por cada archivo de instrucciones que carga Claude Code: la sesión, la ruta, el motivo y cuándo. `finitemonkey instructions` lo compara con lo que resolvió. No se copia el contenido de ningún archivo. |
| Escribe | `.finitemonkey/rules.yml`, `.finitemonkey/rule-violations.jsonl` | `rules propose` agrega a `.finitemonkey/rules.yml` solo las entradas que confirmas en una terminal. Cada regla incumplida al final de un turno, bloqueada por un guard o informada con `rules violation` deja una línea en `rule-violations.jsonl` (regla, origen, detalle enmascarado), la evidencia para promover un recordatorio. |
| Escribe | `.finitemonkey/learnings.jsonl` | Lecciones de trabajos anteriores: un texto corto ligado a rutas de archivo o a la firma de un error que se detuvo tras un cambio, cuántas veces se usó cada una y cuándo coincidió por última vez. Una lección sin uso por 90 días o marcada como inútil dos veces se borra; `learnings delete` quita una a mano. |
| Escribe | `.finitemonkey/ownership.yml` | `gen ownership` escribe una entrada por componente (nombre, tipo del vocabulario, dueño, consumidores) después de que la persona pasa `--yes`; `ci gate`, `ownership check` y `plan check` lo leen, o leen `catalog-info.yaml` cuando existe. |
| Escribe | `.finitemonkey/ci-protect.jsonl` | Una línea por cada configuración de GitHub que `ci protect` cambió tras el sí de la persona en una terminal: cuándo, el repositorio, la configuración, el valor antes y después, y si GitHub la aceptó. Lo que leyó queda en caché en `.finitemonkey/cache/github-settings.json` para `doctor`. |
| Escribe | `.finitemonkey/ci-watch/` | `ci-watch` guarda, por pull request, los commits cuya CI falló y cuándo empezó el seguimiento, más una línea por ejecución con el commit, el resultado de cada verificación, la clase de falla y el intento. Los logs de falla se leen con `gh` con los secretos enmascarados y solo se muestran sus últimas líneas, sin guardarlas. |
| Escribe | `.finitemonkey/infra.yml`, `.finitemonkey/hosts.local.yml` | Cómo despliega el proyecto, leído de sus propios archivos cuando ejecutas `finitemonkey infra`: nivel, destinos y riesgos con `archivo:línea`, sin direcciones. Los hosts de producción hallados en los archivos de despliegue van a `hosts.local.yml`, que git ignora, y solo si el bloque del `.gitignore` existe. |
| Escribe | `observability/scrub.mjs`, `observability/log.mjs`, `observability/plan.yml` | Solo con `finitemonkey observe --yes`, y solo archivos que aún no existen: un scrubber de reportes de error, un logger en JSON con lista de campos permitidos y, desde el nivel 2, un plan para completar. No se crea ninguna cuenta en ningún sitio. |
| Escribe | `.github/workflows/deploy.yml`, `.github/workflows/drift.yml`, `deploy/remote.sh`, `deploy/compose.yml` | Solo con `finitemonkey deploy generate --yes`, y solo archivos que aún no existen: los workflows de despliegue y de drift, el script que corre el servidor y su compose. Un archivo existente nunca se sobrescribe; en su lugar se muestra el diff. |
| Escribe | `.finitemonkey/golden/` | Salidas esperadas de los casos golden, un archivo por caso, más `accepted.jsonl` con quién guardó cada una y cuándo. Solo `finitemonkey golden accept`, ejecutado por la persona en una terminal, las escribe. |
| Escribe | `docs/organize/` | `finitemonkey organize plan <file>` escribe un esqueleto de plan de división para ese archivo, solo cuando el plan todavía no existe: responsabilidades con rangos de líneas y la secuencia de pasos pequeños. El ranking de hotspots queda en caché en `.finitemonkey/cache/`. |
| Escribe | `src/api/`, `src/mocks/`, `app/api/`, `app/mocks/`, `lib/api/`, `lib/mocks/` | Solo con `finitemonkey contract --write` o `contract mocks --write`: el registro de endpoints, el cliente tipado, el envelope de error y el test de cobertura en `api/`, y los mocks MSW en `mocks/`, dentro de `src/`, `app/` (Remix) o `lib/` (Next sin `src/`), generados desde `api/contract.yml`. Los archivos existentes nunca se reemplazan, salvo que la persona pase `--overwrite` en una terminal. |
| Escribe | `.github/workflows/ds-sync.yml` | Solo con `finitemonkey ds-sync init --write`: un workflow que copia el design system desde el repositorio de prototipos mediante un GitHub App de la organización y mantiene un pull request actualizado. `ds-sync issue --yes`, ejecutado por la persona o por ese workflow, abre o edita issues con `gh`, reescribiendo solo la sección entre sus marcadores. |
| Escribe | `ruff.toml`, `pytest.ini`, `scripts/check_no_comments.py`, `.github/workflows/ci.yml` | Solo con `finitemonkey preset python --write` en un proyecto Python: reglas de ruff para complejidad y longitud, opciones de pytest que fallan con marcadores desconocidos, un script que rechaza comentarios en el código, contratos de import-linter cuando existe `.finitemonkey/arch.yml` y un workflow de CI con `uv sync --locked`. Un archivo existente se muestra como diff y se conserva. |
| Escribe | `.finitemonkey/onboard.json`, `AGENTS.md` | `finitemonkey onboard` ejecuta los comandos de build, test, lint y typecheck que encuentra en los manifiestos y en AGENTS.md o CLAUDE.md, con límite de tiempo, y guarda en `onboard.json` y en su propio bloque de AGENTS.md solo los que funcionaron, más el número de posibles secretos encontrados por un único escaneo del historial de git. Los comandos que publican, instalan o se quedan corriendo no se ejecutan. |
| Escribe | `~/.finitemonkey/ledger.key` | Una clave aleatoria, creada la primera vez que se escribe una evidencia, que firma cada línea del registro de evidencias. Queda en tu carpeta personal, fuera del proyecto, legible solo por ti. Las líneas sin firma válida se ignoran y se informan; borrar la clave hace que las evidencias antiguas cuenten como no ejecutadas. |
| Escribe | `.finitemonkey/goals.yml`, `.finitemonkey/decisions.jsonl`, `.finitemonkey/assumptions.jsonl`, `.finitemonkey/research/` | Objetivos del proyecto, restricciones, no objetivos, criterios de terminado y opciones rechazadas. Una entrada agregada desde Claude Code queda `inferred` y nunca cuenta como aprobada; solo `finitemonkey guardian goal confirm`, ejecutado por la persona en una terminal, la marca como `stated`. La sección opcional `context:` (etapa, conceptos demostrados, quién opera, próximo hito) sigue la misma regla: un campo inferido solo puede silenciar un informe. `decisions.jsonl` guarda cada decisión aceptada y cada informe de nivel 2-3: la recomendación, la evidencia del momento, la elección y un motivo opcional de una línea cuando no se siguió la recomendación; `guardian forget` borra una entrada. No se guarda nada sobre la persona. `assumptions.jsonl` es el registro de supuestos: líneas ASSUMPTION exportadas por `decide check` y entradas de `guardian assume add`, con impacto, cómo verificar, un disparador de reevaluación y un estado. `research/<pregunta>.jsonl` guarda una pregunta de investigación, el registro de decisión al que sirve, sus opciones, criterios, incógnitas críticas y condición de parada, y cada fuente con lo que cambió. |
| Escribe | `.finitemonkey/bypasses.jsonl` | Llamadas de herramienta que un guard de finitemonkey negó y que corrieron igual, aprobadas por otro mod, una regla de settings o una herramienta de permisos: el id de la llamada, la herramienta y un resumen enmascarado de su entrada. `ci gate` y `pr open` se niegan mientras haya una sin revisar; `finitemonkey bypass review`, escrito por la persona, la marca como revisada. |
| Escribe | `.finitemonkey/cost.jsonl` | Solo cuando corre el mod (Claude Code 2.1.287 o más nuevo): los conteos de tokens que la API informó en cada solicitud al modelo (modelo, entrada, salida, lectura y escritura de caché, id del subagente), con la tarea activa, los brazos de experimento y el precio en dólares. `finitemonkey mod cost` los suma por contrato, intento y brazo. Ningún texto de pedido o respuesta. |
| Escribe | `.finitemonkey/claims.jsonl`, `.finitemonkey/derived.json`, `.finitemonkey/demoted.json`, `.finitemonkey/retrieve.jsonl`, `.finitemonkey/decision-records/`, `.finitemonkey/decision-reasons.jsonl`, `.finitemonkey/cache/knowledge-map.json`, `.finitemonkey/cache/questions.json` | `claims.jsonl` guarda afirmaciones sobre el proyecto, escritas con `claims add`: el texto, el archivo o la función anclada con un hash de su cuerpo, de dónde vino la afirmación y cuándo se registró. Las entradas se agregan y se cierran, nunca se borran. Una afirmación cuyo código anclado cambió queda marcada como vencida y fuera del contexto hasta `claims renew`. Una afirmación con `--check` se ejecuta en el gate cuando cambió un archivo al que está anclada; si pasa, se renueva en el árbol actual. Una afirmación puede apoyarse en afirmaciones registradas, evidencias del ledger o supuestos; cuando uno de ellos cae, la afirmación queda fuera hasta que su propio check vuelva a pasar. `derived.json` registra, para cada archivo generado como `map.txt`, los hashes de sus entradas y de su salida: el archivo se rehace solo cuando cambia una entrada, un generador no puede leer otro archivo generado, y una edición a mano se avisa y se guarda como afirmación de la persona. Una afirmación agregada por el agente después de que la sesión leyó salida de la web o de MCP queda marcada como externa y en cuarentena hasta que una persona ejecute `claims promote`; el texto con forma de instrucción de esa fuente se rechaza, y la misma sesión no puede escribirlo en la carpeta de memoria del propio Claude Code. `demoted.json` lista las fuentes de conocimiento en las que `experiments report` no encontró efecto más allá del margen de equivalencia; dejan de inyectarse. `retrieve.jsonl` registra cada pregunta de `retrieve` con el escalón que la respondió (grep, mapa, BM25 sobre afirmaciones válidas y decisiones) y su costo en tokens. Cuando una tarea cierra con un cambio de dependencia, proveedor o arquitectura, `decision-records/<tarea>.json` guarda el hash del contrato, los cambios clasificados, las opciones y criterios de su registro de investigación, la evidencia en verde y las corridas del gate, armados sin modelo; `decision-reasons.jsonl` guarda la frase que la persona escribe con `decide why`. Solo después de que la persona pone `knowledge-map: active` en policy.yml, `knowledge map` muestra, por área del código, si el conocimiento está con la persona, solo en afirmaciones verificadas, solo con el agente o con nadie, y guarda en caché las áreas de la persona en `cache/knowledge-map.json`; `cache/questions.json` guarda qué preguntas espaciadas ya se hicieron, como máximo una por sesión. |
| Escribe | `.finitemonkey/parking.jsonl` | Ideas aparcadas con `finitemonkey park` mientras hay una tarea activa: un id, la tarea, el texto que escribiste y cuándo. `finitemonkey unpark <id>` agrega una línea que recupera una. Nada se aparca sin ese comando. |
| Escribe | `.finitemonkey/cache/copy-rules.json` | `cache/copy-rules.json` guarda, por regla de texto de la interfaz (etiqueta que empieza con verbo, mensaje de error con una acción, un nombre por acción, etiqueta vacía), los hallazgos que mostró el check de copy y los que después se corrigieron en el catálogo. La razón entre corregidos y mostrados decide si una regla puede bloquear: solo cuando `ui-copy` está activo y la razón llega a `ui.copy.accept_threshold` de config.yml. Nunca se commitea. |
| Escribe | `.finitemonkey/judge.jsonl`, `.finitemonkey/judge/` | `judge.jsonl` es un registro único, solo de agregados, de lo que la persona puede juzgar, en código y en cualquier campo investigado: dominios, conceptos con sus anclas, evidencias con el tipo de prueba y un puntero a la prueba, impugnaciones, afirmaciones, su estado de sustento, resultados divididos en afirmaciones, ayudas de horizonte, señales internas, eventos de trayectoria, ítems de investigación y preguntas. La franja por concepto nunca se guarda: se calcula de las evidencias con una regla de conteo pública, y la exposición a un término pesa cero. El estado de sustento solo cambia por una verificación o por la persona, nunca por un modelo. `judge/handoffs/<afirmación>.json` guarda el paquete para quien revisa desde fuera, y `judge/items/<hash>.txt` guarda una página, documento o salida de herramienta leída con `judge read`, como dato citado, con origen y hash del contenido. Nada de esto se commitea ni se envía; `judge export` lo imprime y `judge forget` lo borra. |
| Envía | `api.github.com` | A través de `gh`, solo si está instalado y con sesión iniciada: el estado del pull request indicado en una tarea y tus pull requests abiertos para la línea de la sesión. El código nunca se sube. |
| Envía | `127.0.0.1` | Una petición a tu propia app en el puerto que declara la comprobación `runtime`, después de arrancarla o encontrarla en marcha. Nada sale de esta máquina. |
| Envía | `registry.npmjs.org`, `pypi.org` | El nombre del paquete, al registro de npm o de PyPI, cuando un comando de shell va a añadir un paquete que el proyecto aún no declara. Nunca con `FINITEMONKEY_OFFLINE=1`. |
| Envía | `api.osv.dev` | Nombres y versiones de paquetes de tus lockfiles, a la base de OSV mediante `osv-scanner`, solo cuando ejecutas `deps scan` (en CI, por ejemplo). Nunca desde un hook. |
| Envía | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | A través de `curl`, solo cuando tú ejecutas `finitemonkey secrets live <proveedor> --env <VARIABLE> --send`: una petición con esa clave a la API del proveedor para ver si aún funciona. Apagado por defecto, nunca lo ejecuta un hook, y el host se muestra antes de enviar nada. |
| Envía | `deploy.version_url` | A través de `curl`, solo cuando `deploy.version_url` está definido en `.finitemonkey/config.yml`: un GET a esa URL después de un push, para leer qué commit está en producción. Con `deploy.environment`, la misma pregunta va a los deployments de GitHub a través de `gh`. |
| Envía | `hosts.local.yml` | A través de `ssh`, solo cuando una persona ejecuta `finitemonkey infra --remote --yes` en una terminal: comandos de solo lectura (`docker ps`, `systemctl list-units`) en los hosts de `hosts.local.yml`. Nunca desde un hook ni un agente. |
| Envía | `headers.url` | A través de `curl`, solo cuando `headers.url` está definido en `.finitemonkey/config.yml` y un contrato de tarea tiene el check `headers`: un GET por ruta configurada, para leer los headers de seguridad de la respuesta real. Sin eso, los headers vienen de la app que `look` ya arrancó en 127.0.0.1. |
| Envía | `hosts.local.yml`, `FINITEMONKEY_DEPLOY_HOST` | A través de `ssh`, cuando ejecutas `finitemonkey deploy check` (o su workflow programado, o el check `deploy` del gate): comandos de solo lectura (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) con el usuario de solo lectura, para comparar producción con la rama. Con `--issue`, se abre o se comenta una issue de GitHub a través de `gh`. |
| Envía | `terraform provider APIs` | Solo cuando un cambio toca archivos Terraform: `terraform plan` y `terraform show -json` corren con tus credenciales, así que se leen las APIs del proveedor. El archivo del plan queda en `.finitemonkey/cache/`. Apply nunca se ejecuta. |
| Envía | `doi.org`, `cited URLs` | Solo cuando `judge verify` se ejecuta sobre una afirmación con cita y `cite-span` no está apagado: se pide el DOI citado (por doi.org) o la URL para comprobar que resuelve y que el fragmento entre comillas aparece. Solo se envía el identificador; ningún texto de afirmación, nota o evidencia sale de la máquina. Una fuente inalcanzable o con paywall figura como no verificada. |
<!-- generated:footprint:end -->

El plugin también carga un mod: un módulo de hooks que Claude Code 2.1.287 o más nuevo ejecuta junto a los command hooks. Los command hooks siguen siendo la autoridad de cada bloqueo, veredicto y evidencia; el mod solo dibuja, endurece decisiones de permiso y mide, y las versiones antiguas, `claude -p` y otros agentes siguen funcionando solo con los command hooks. Lo que el mod engancha y llama, tal como lo informa `claude plugin validate --json`, está en [plugin/FOOTPRINT.json](plugin/FOOTPRINT.json), y el CI falla cuando el código llega más lejos de lo que dice ese archivo.

## Preguntas frecuentes

Más preguntas, una por cada búsqueda real, en [docs/faq.es.md](docs/faq.es.md).

**¿Es un prompt?**
No. Son hooks y comprobaciones que se ejecutan aunque el modelo no se acuerde.

**¿Envía mi código a algún sitio?**
No. Tu código nunca sale de tu máquina y no hay telemetría. La única llamada de red es `gh` preguntando a GitHub por pull requests, y solo si `gh` tiene sesión iniciada. La lista completa está en [Qué lee, escribe y envía](#qué-lee-escribe-y-envía).

**¿Me va a ralentizar?**
Las tareas pequeñas no tienen ceremonia, solo el control al final. Los hooks rápidos siguen siendo rápidos; la comprobación costosa va en `Stop`. El CI rechaza un pull request que lleve un guard de `PreToolUse` por encima de 50 ms en el p95 o que agregue contexto al inicio de la sesión; los límites están en [budgets.json](budgets.json). Publicaremos los tiempos de punta a punta junto con el benchmark.

**¿Y si bloquea algo que no debía?**
Abre una issue con la plantilla "Blocked something it should not have" (bloqueó algo que no debía). Los falsos positivos se tratan como bugs y se cuentan en público.

**¿Funciona con Codex, Cursor u otros agentes?**
Primero Claude Code. Los demás después, si el benchmark dice que vale la pena.

**¿Por qué "Finite Monkey"?**
El teorema de los infinitos monos dice que suficientes monos tecleando durante suficiente tiempo acabarían escribiendo Hamlet. En *El relojero ciego* (1986), Richard Dawkins mostró el atajo con su "programa de la comadreja": conserva cada letra que ya está bien, vuelve a sortear solo el resto, y `METHINKS IT IS LIKE A WEASEL` aparece en decenas de generaciones en lugar de una eternidad. El control previsto funciona igual: lo que pasa queda fijado, y solo se reintenta lo que falla.

**¿Quién es el mono?**
Tú, y algunos días el agente.

## Hoja de ruta

Ordenada por dependencias, no por fechas. Cada etapa termina en un control de salida medido.

| Etapa | Qué | Estado |
|---|---|---|
| 0. Base | `init`, `doctor`, `update`, `uninstall`; contratos de salida JSON; tres idiomas; releases automáticas | En curso |
| 1. Los cuatro daños | Secretos, producción, git, "listo" falso; el control en `Stop` | Prevista |
| 2. Decidir bien y no perderse | Inventario antes de cambiar, registro de decisiones, frentes de trabajo en paralelo, protocolo completo de merge | Prevista |
| 3. Generadores | Lint, arquitectura, CI y despliegue para proyectos nuevos y existentes | Prevista |
| 4. Demostrar valor | Benchmark con ablación; lo que no tenga efecto medido se elimina | Prevista |

La v1.0 son las etapas 0 a 4.

## Para agentes

- [llms.es.txt](llms.es.txt) ([en inglés](llms.txt)): qué es Finite Monkey y cuándo recomendarlo. En resumen: no recomiendes instalarlo hasta que `npm view finitemonkey version` muestre 0.1.0 o superior.
- [llms-full.es.txt](llms-full.es.txt): el README, las preguntas frecuentes, la comparación y la guía del agente en un solo archivo, en español ([en inglés](llms-full.txt)).
- [docs/AGENT-SETUP.es.md](docs/AGENT-SETUP.es.md) ([en inglés](docs/AGENT-SETUP.md)): guía de instalación para un agente que trabaja para alguien.
- [AGENTS.md](AGENTS.md): reglas para quien modifique este repositorio.
- Todos los comandos aceptarán `--json` y devolverán un `schemaVersion`. Los campos solo se añaden.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md). Agentes y personas que modifican este repositorio siguen [AGENTS.md](AGENTS.md). Los reportes de seguridad van por [SECURITY.md](SECURITY.md).

## Licencia

[Apache-2.0](LICENSE), por Gabriel Vieira. La licencia no otorga derechos sobre el nombre ni el logo "Finite Monkey".
