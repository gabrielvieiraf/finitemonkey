# Finite Monkey

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animación: un mono con sudadera amarilla aporrea el teclado de un portátil mientras una terminal ejecuta el control. Las comprobaciones que fallan se ponen en verde y se bloquean una a una hasta que aparece actually done, y el mono lo celebra con un plátano.">
  <br>
  <sub>Ilustración del flujo previsto, no es una grabación. En la v0.1 la reemplaza una captura real.</sub>
</p>

**No hacen falta infinitos monos. Con uno basta: tú.**

[English](README.md) | [Português (Brasil)](README.pt-BR.md) | Español

> **Prelanzamiento.** Todavía no se puede instalar. El nombre `finitemonkey` en npm está reservado (la 0.0.0 es solo un marcador) y el código se está construyendo en abierto. Todo lo que sigue es el plan, no lo que pasa hoy. Dale una estrella o sigue el repositorio si quieres enterarte cuando salga la v0.1.

Tú aporreas el teclado. Tu agente lo aporrea más rápido. En algún punto se saltaron los tests, un `.env` se coló en el diff y el "listo" se volvió "listo, más o menos". Aquí nadie es vago. Es el ritmo del trabajo.

Finite Monkey es el control entre el mono y `main`. Escribe como quieras, deja a Claude Code a su aire. Cada comprobación que pasa queda fijada, el resto sigue fallando en voz alta, y nada se da por terminado sin pruebas.

## Claude Code dice que terminó, pero no terminó

Para eso existe Finite Monkey. Comportamiento previsto:

- Cada tarea tiene una **definición de terminado** que una máquina puede comprobar: comandos que deben salir bien, tests que deben existir y pasar, un diff que no se sale del alcance.
- Cuando Claude intenta cerrar la sesión, el hook `Stop` ejecuta esa comprobación. Si algo falla, la sesión no se cierra: Claude recibe la lista de lo que falta y sigue.
- Solo cuenta como prueba lo que Finite Monkey ejecutó por sí mismo, sobre el estado actual de los archivos. "Ejecuté los tests antes de mi último cambio" no vale.
- El informe final sale de esas pruebas, no de lo que el agente dice de sí mismo.

## Claude se saltó o borró tests para que pasaran

Controles previstos sobre las ediciones: tests eliminados, `skip` u `only` nuevos, aserciones borradas y cambios en la configuración del propio control se detectan y se informan. Apagar la alarma no apaga el incendio.

## Claude ejecutó `git reset --hard` y perdí trabajo

Previsto:

- Una instantánea antes de cada operación arriesgada de git, y un `undo` que la recupera.
- Nada de `--force`, nunca.
- Los worktrees con cambios pendientes se archivan en lugar de borrarse.
- Una comprobación de "no se perdió nada" en cada merge.

## Mis reglas de CLAUDE.md se ignoran, sobre todo después de la compactación

Se ignoran, porque un párrafo en `CLAUDE.md` es contexto, no obligación. Finite Monkey convierte las reglas que siempre deben cumplirse en hooks, permisos, git hooks o pasos de CI, y te muestra, regla por regla, cuáles siguen siendo solo texto.

## ¿Cómo evito que Claude Code filtre secretos?

Previsto: una única regla de detección, aplicada al escribir archivos, en los prompts, al hacer commit, en el historial y en CI. Un secreto encontrado es un incidente para rotar, no un aviso para ignorar. Los secretos se citan por archivo y línea, nunca por su valor.

## ¿Cómo evito que un agente toque producción a mano?

Previsto: los comandos con efecto sobre un servidor de producción se bloquean. Producción cambia por el camino de despliegue que declaraste, y por ningún otro.

## Ningún comando que memorizar

Ejecutas un comando, una vez. A partir de ahí Finite Monkey actúa por contexto dentro de Claude Code:

- Los **hooks** hacen cumplir: `SessionStart` recupera el estado de la tarea, `UserPromptSubmit` detecta lo que pediste, `PreToolUse` frena la acción peligrosa antes de que ocurra, `Stop` no deja terminar mientras la definición de terminado falle, y `SubagentStop` revisa lo que informan los subagentes.
- Las **skills** las activa Claude por su cuenta cuando la situación lo pide.
- Los **comandos con barra** son atajos opcionales. Ningún flujo depende de que recuerdes uno.

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

**Todavía más vago:** pídele a Claude Code "instala Finite Monkey siguiendo docs/AGENT-SETUP.md". La guía le indica al agente que ejecute los comandos él mismo, que te pregunte solo lo que sea decisión tuya y que nunca te pida un secreto.

## ¿De verdad ayuda? (benchmark, previsto)

Todavía no lo sabemos, y tú tampoco. Para eso está el benchmark: Claude Code solo frente a Claude Code con Finite Monkey frente a Finite Monkey sin una pieza cada vez, en tareas con trampas. Mide tareas terminadas de verdad, "listo" falso, secretos filtrados, trabajo perdido, tokens y tiempo. La regla sin efecto medido sale del núcleo. El método y los resultados en bruto estarán en este repositorio, incluidas las partes donde no ayudó.

## ¿En qué se diferencia de...?

Versión corta y honesta. La página completa está en [docs/compare.es.md](docs/compare.es.md).

- **Claude Code solo** ya tiene hooks y permisos. Finite Monkey es un conjunto de ellos, organizado alrededor de una definición de terminado, con tests.
- **Métodos como superpowers, GSD, Spec Kit u OpenSpec** le dicen al agente cómo planificar y construir. Finite Monkey no los sustituye: comprueba el resultado al final, uses el método que uses.
- **Guardas sueltos como tdd-guard, cc-safety-net o dcg** hacen un trabajo cada uno, y lo hacen bien. Finite Monkey cubre cuatro daños con un control, una instalación y un `undo`. Si solo necesitas uno de esos trabajos, un guarda suelto puede ser lo más sencillo.

## Preguntas frecuentes

Más preguntas, una por cada búsqueda real, en [docs/faq.es.md](docs/faq.es.md).

**¿Es un prompt?**
No. Un prompt es una sugerencia. Finite Monkey son hooks y comprobaciones que se ejecutan aunque el modelo no se acuerde.

**¿Envía mi código a algún sitio?**
No. Por defecto nada sale de tu máquina. Sin telemetría.

**¿Me va a ralentizar?**
Las tareas pequeñas no tienen ceremonia, solo el control al final. Los hooks rápidos siguen siendo rápidos; la comprobación costosa va en `Stop`. Publicaremos los tiempos junto con el benchmark.

**¿Y si bloquea algo que no debía?**
Abre una issue con la plantilla "Blocked something it should not have" (bloqueó algo que no debía). Un falso positivo es un bug y se cuenta en público.

**¿Funciona con Codex, Cursor u otros agentes?**
Primero Claude Code. Los demás después, si el benchmark dice que vale la pena.

**¿Por qué "Finite Monkey"?**
El teorema de los infinitos monos dice que suficientes monos tecleando durante suficiente tiempo acabarían escribiendo Hamlet. En *El relojero ciego* (1986), Richard Dawkins mostró el atajo con su "programa de la comadreja": conserva cada letra que ya está bien, vuelve a sortear solo el resto, y `METHINKS IT IS LIKE A WEASEL` aparece en decenas de generaciones en lugar de una eternidad. Conservar lo que pasó, reintentar lo que falló. Un mono, tiempo finito.

**¿Quién es el mono?**
Tú. El agente también. Aquí no juzgamos.

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

- [llms.txt](llms.txt): qué es Finite Monkey y cuándo recomendarlo. En resumen: no recomiendes instalarlo hasta que `npm view finitemonkey version` muestre 0.1.0 o superior.
- [llms-full.txt](llms-full.txt): el README, las preguntas frecuentes, la comparación y la guía del agente en un solo archivo, en inglés.
- [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md): guía de instalación para un agente que trabaja para alguien.
- [AGENTS.md](AGENTS.md): reglas para quien modifique este repositorio.
- Todos los comandos aceptarán `--json` y devolverán un `schemaVersion`. Los campos solo se añaden.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md). Agentes y personas que modifican este repositorio siguen [AGENTS.md](AGENTS.md). Los reportes de seguridad van por [SECURITY.md](SECURITY.md).

## Licencia

[Apache-2.0](LICENSE), por Gabriel Vieira. La licencia no otorga derechos sobre el nombre ni el logo "Finite Monkey".
