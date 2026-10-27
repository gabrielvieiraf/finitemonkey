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

## ¿De verdad ayuda? (benchmark, previsto)

Todavía no se sabe. El benchmark previsto compara Claude Code solo, Claude Code con Finite Monkey y Finite Monkey sin una pieza cada vez, en tareas con trampas. Mide tareas terminadas de verdad, "listo" falso, secretos filtrados, trabajo perdido, tokens y tiempo. La regla sin efecto medido sale del núcleo. El método y los resultados en bruto estarán en este repositorio, incluidas las partes donde no ayudó.

## ¿En qué se diferencia de...?

La comparación completa, con fuentes, está en [docs/compare.es.md](docs/compare.es.md).

- **Claude Code solo** ya tiene hooks y permisos. Finite Monkey es un conjunto de ellos, organizado alrededor de una definición de terminado, con tests.
- **Métodos como superpowers, GSD, Spec Kit u OpenSpec** le dicen al agente cómo planificar y construir. Finite Monkey no los sustituye: comprueba el resultado al final, uses el método que uses.
- **Guardas sueltos como tdd-guard, cc-safety-net o dcg** hacen un trabajo cada uno, y lo hacen bien. Finite Monkey cubre cuatro daños con un control, una instalación y un `undo`. Si solo necesitas uno de esos trabajos, un guarda suelto puede ser lo más sencillo.

<!-- generated:footprint:start -->
## Qué lee, escribe y envía

Generado desde `src/core/footprint.ts`, la lista que los tests exigen al código. Sin telemetría. Las rutas son relativas al proyecto salvo las que empiezan con `~`.

| | Qué | Para qué |
|---|---|---|
| Lee | `stdin` | El evento que Claude Code pasa a cada hook: la llamada a la herramienta, el prompt o la petición de parada. |
| Lee | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | La configuración de Claude Code, para comprobar que los hooks están instalados y que nada los desactiva. `$CLAUDE_CONFIG_DIR` reemplaza `~/.claude` si está definido. |
| Lee | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Archivos de instrucciones, que `doctor` lee para señalar reglas que solo existen como texto. |
| Lee | `~/.claude/projects/` | Los logs locales de sesión de Claude Code de este proyecto, leídos una vez y solo con `init --look-back`. |
| Lee | `.git/` | El repositorio a través del comando `git`: estado, diffs, refs y el reflog. |
| Lee | `git diff` | Archivos modificados, revisados en busca de secretos, tests saltados, placeholders y patrones de prosa. |
| Lee | `.finitemonkey/config.yml`, `.finitemonkey/policy.yml`, `.finitemonkey/briefing.md`, `.finitemonkey/look.yml` | La configuración del proyecto, la política de los guards y el briefing opcional para subagentes. |
| Escribe | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/verify/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` y `update`: la configuración de los hooks (y, con `--sandbox`, el sandbox en tu configuración local), la skill verify, un bloque gestionado corto en `AGENTS.md` que `CLAUDE.md` importa, una línea en `.gitignore`, el runtime fijado y una copia de cada archivo que cambian. |
| Escribe | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Contratos de tarea y cuál tarea está activa. |
| Escribe | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | La evidencia de cada comprobación, ligada al hash del árbol, y el log de la puerta. |
| Escribe | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Aprobaciones y permisos escritos por la persona, y una caché breve de los pull requests abiertos. |
| Escribe | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | La línea base de hallazgos aceptados y los incidentes de exposición. Ambos guardan huellas y máscaras, nunca el valor de un secreto. |
| Escribe | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/` | Snapshots antes de comandos git destructivos, el diario que lee `undo` y las decisiones sobre líneas descartadas en merges. |
| Escribe | `.finitemonkey/reports/` | Informes de error enmascarados que escribe `doctor --report`, solo cuando se pide. |
| Escribe | `.finitemonkey/pr/` | Quién aceptó archivos fuera del alcance de la tarea en `pr open`, cuándo y por qué, un archivo por rama. |
| Escribe | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | El registro de worktrees y los informes de fusión en el directorio común de git (nunca se commitean), la línea de exclusión local para `.claude/worktrees/` y los worktrees que crea `wt new`; un repositorio en `/mnt/<disco>` o en una carpeta sincronizada recibe los suyos en `~/.finitemonkey/worktrees/`. `wt archive` guarda un worktree en `refs/finitemonkey/archive/` y copia los archivos ignorados que no son secretos a `~/.finitemonkey/archive/`. |
| Escribe | `.finitemonkey/look/` | Capturas de pantalla, la hoja de contactos y el resumen JSON que escribe `look` por hash del árbol. |
| Escribe | `docs/plan/` | Documentos de plan en `docs/plan/`: el inventario de lo que hace el código hoy, registros de decisión, registros de investigación, modelos de costo, el plan maestro desde la primera tarea L y la copia que se guarda antes de cada consolidación. |
| Escribe | `.finitemonkey/map.txt` | El mapa del código de `finitemonkey map`: una línea por carpeta con sus definiciones de nivel superior, en caché por el hash del árbol. |
| Escribe | `.finitemonkey/review/`, `.claude/agents/verifier.md` | El conteo de rondas de revisión que usa `review packet` y, solo cuando `review.playwright: true` está en la configuración, un agente verificador con el MCP de Playwright. |
| Envía | `api.github.com` | A través de `gh`, solo si está instalado y con sesión iniciada: el estado del pull request indicado en una tarea y tus pull requests abiertos para la línea de la sesión. El código nunca se sube. |
| Envía | `127.0.0.1` | Una petición a tu propia app en el puerto que declara la comprobación `runtime`, después de arrancarla o encontrarla en marcha. Nada sale de esta máquina. |
| Envía | `registry.npmjs.org`, `pypi.org` | El nombre del paquete, al registro de npm o de PyPI, cuando un comando de shell va a añadir un paquete que el proyecto aún no declara. Nunca con `FINITEMONKEY_OFFLINE=1`. |
| Envía | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | A través de `curl`, solo cuando tú ejecutas `finitemonkey secrets live <proveedor> --env <VARIABLE> --send`: una petición con esa clave a la API del proveedor para ver si aún funciona. Apagado por defecto, nunca lo ejecuta un hook, y el host se muestra antes de enviar nada. |
<!-- generated:footprint:end -->

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
