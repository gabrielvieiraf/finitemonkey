# Finite Monkey

**Infinite monkeys not required.**

[English](README.md) | [Português (Brasil)](README.pt-BR.md) | Español

> **Estado: prelanzamiento.** Nada de esto funciona todavía. El nombre `finitemonkey` en npm está reservado y el código se construye en público. Todo lo que sigue describe lo que Finite Monkey está planeado para hacer, no lo que hace hoy.

## La idea

El teorema del mono infinito dice que suficientes monos, tecleando durante suficiente tiempo, terminan escribiendo Hamlet. En *El relojero ciego* (1986), Richard Dawkins mostró un atajo con su "programa de la comadreja": conserva cada letra que ya es correcta, vuelve a sortear solo el resto, y la frase `METHINKS IT IS LIKE A WEASEL` aparece en decenas de generaciones en lugar de una eternidad. La selección acumulativa conserva lo que pasó.

Finite Monkey aplica eso a los agentes de código. El agente puede equivocarse libremente. Una compuerta conserva lo que se verificó y solo deja avanzar el trabajo cuando está probado. Un mono, tiempo finito, trabajo terminado.

## El problema

Los agentes de código ya son lo bastante capaces para construir sistemas grandes en horas. Lo que falla es el entorno:

- El agente dice "listo" y no está listo.
- Las pruebas pasan porque se debilitaron o se saltaron.
- Las reglas escritas en `CLAUDE.md` o `AGENTS.md` se olvidan, sobre todo después de la compactación del contexto, porque la prosa es contexto, no imposición.
- Se pierde trabajo con un `git reset --hard`, un push forzado o un worktree borrado.
- Un secreto termina en un commit, un log o un pull request.

Son fallas de verificación y de control, no de inteligencia. Más Markdown, más fases y más personas no las resuelven. El mecanismo sí.

## Lo que va a hacer (planeado)

### Tú solo trabajas; el mono pasa por la compuerta

Finite Monkey está diseñado para que **no haya ningún comando que recordar**. Ejecutas `npx finitemonkey init` una vez. Después actúa por su cuenta, según el contexto, dentro de Claude Code:

- **Hooks** hacen la imposición: `SessionStart` restaura el estado de la tarea, `UserPromptSubmit` detecta lo que pediste, `PreToolUse` bloquea acciones peligrosas antes de que ocurran, `Stop` se niega a cerrar la sesión mientras la definición de listo falle, y `SubagentStop` revisa lo que reportan los subagentes.
- **Skills** que Claude invoca automáticamente, según su descripción, cuando la situación lo pide.
- **Slash commands** existen solo como atajos opcionales. Ningún flujo depende de ellos.

### Una definición de listo verificada por máquina

Cada tarea recibe un contrato de lo que significa "listo": comandos que deben tener éxito, pruebas que deben existir y pasar, un diff que se mantiene dentro del alcance, y más. El hook `Stop` ejecuta la compuerta y bloquea el fin de la sesión con la lista de lo que aún falta. La evidencia se registra solo a partir de comandos que el propio Finite Monkey ejecutó, atada al hash del árbol de trabajo, así que "corrí las pruebas antes de la última edición" no cuenta. El informe final se genera a partir de esa evidencia, no de lo que dice el agente.

### Los cuatro daños que previene primero

La primera etapa de la hoja de ruta cubre solo lo que es irreversible o corrompe la prueba:

1. **Filtrar secretos.** Una regla de detección aplicada al escribir archivos, en el prompt, al hacer commit, en el historial y en CI. Un secreto encontrado es un incidente que hay que rotar, no un aviso para ignorar. Los secretos se citan por archivo y línea, nunca por su valor.
2. **Editar producción a mano.** Se bloquean los comandos con efecto en un host de producción. Producción solo cambia por el camino de despliegue declarado.
3. **Perder trabajo en git.** Una instantánea antes de cada operación git riesgosa, un `undo` que la restaura, nunca `--force`, worktrees sucios archivados en lugar de borrados, y una verificación de "no se perdió nada" en cada merge.
4. **Un "listo" falso.** La compuerta de arriba, más protecciones contra pruebas eliminadas, `skip` u `only` nuevos, aserciones eliminadas y ediciones a la configuración de la propia compuerta.

### Principios

- **Ceremonia proporcional.** Una tarea pequeña no tiene fases, solo la compuerta. Las tareas grandes reciben un plan corto y una revisión independiente.
- **Las reglas se vuelven mecanismo.** Una regla que debe cumplirse siempre se convierte en hook, permiso, git hook o paso de CI, no en un párrafo. Finite Monkey muestra, por regla, dónde sigue siendo solo texto.
- **Cada regla demuestra su valor o se va.** Un banco de pruebas compara Claude Code solo, con Finite Monkey y con Finite Monkey menos una pieza a la vez. Una regla sin efecto medido sale del núcleo.
- **Nunca romper lo que existe.** Instalación con respaldo, fusión estructural, archivo de lock, reejecución idempotente, `doctor`, `update` y un `uninstall` limpio.
- **Nada sale de tu máquina por defecto.** Sin telemetría.
- **La salida para agentes es un contrato.** Todo comando aceptará `--json` y devolverá `schemaVersion`; los campos solo se agregan.
- **Tres idiomas.** Inglés, portugués de Brasil y español.

## Hoja de ruta

Ordenada por dependencia, no por fecha. Cada etapa termina en una compuerta de salida medida.

| Etapa | Contenido | Estado |
|---|---|---|
| 0. Fundación | Ejecutable con `init`, `doctor`, `update`, `uninstall`; contratos JSON; i18n; versiones automáticas | En construcción |
| 1. Los cuatro daños | Secretos, producción, git, "listo" falso; la compuerta en `Stop` | Planeado |
| 2. Decidir bien y no perderse | Inventario antes de cambiar, registros de decisión, controles de costo y de paridad, frentes de trabajo en paralelo, protocolo completo de merge, reglas compiladas por superficie | Planeado |
| 3. Generadores | Generadores de lint, arquitectura, CI y despliegue para proyectos nuevos y existentes | Planeado |
| 4. Demostrar valor | Banco de pruebas con ablación; se recortan las piezas sin efecto medido | Planeado |

La versión 1.0 es el conjunto de las etapas 0 a 4.

## Instalación (planeada)

Todavía no está disponible. Cuando salga la primera versión, el camino principal será:

```sh
npx finitemonkey@latest init
```

Es el único comando que deberías necesitar. Los requisitos serán Node.js 20 o superior, en Linux, macOS, Windows o WSL. Se planean ejecutables independientes para quien no tenga Node. También podrás pedirle a Claude Code que lo instale por ti; el agente sigue [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).

## Cómo salen las versiones

- La versión la deciden los mensajes de commit. El repositorio usa [Conventional Commits](https://www.conventionalcommits.org/es/), verificados por commitlint en cada commit.
- En cada push a `main`, CI ejecuta los controles y [semantic-release](https://semantic-release.gitbook.io/) calcula la versión, escribe el changelog, publica en npm y crea la release en GitHub. Nadie edita la versión a mano.
- Los paquetes se publican solo desde CI, con [procedencia de npm](https://docs.npmjs.com/generating-provenance-statements), para que puedas verificar que una versión se construyó desde este repositorio.
- Se planean dos canales: `latest` para versiones estables y `next` para prelanzamientos. El estable es el predeterminado; `next` es opcional.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) (en inglés). Los agentes y las personas que cambian este repositorio siguen [AGENTS.md](AGENTS.md). Los reportes de seguridad van por [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE), por Gabriel Vieira.
