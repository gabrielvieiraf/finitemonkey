# Preguntas frecuentes de Finite Monkey

[English](faq.md) | [Português (Brasil)](faq.pt-BR.md) | Español

> **Versiones iniciales.** Finite Monkey se instala por el canal `next` de npm (`npx finitemonkey@next init`); todavía no hay versión estable.

## ¿Por qué Claude Code dice que terminó cuando no terminó?

Porque "listo" es una frase que escribe el modelo, y por defecto nada la comprueba. Es una queja frecuente, por ejemplo [anthropics/claude-code#60177](https://github.com/anthropics/claude-code/issues/60177) ("Claude marks tasks done without testing").

- **Hoy:** Claude Code tiene el hook `Stop`. Un hook escrito por ti puede negarse a cerrar la sesión y decirle a Claude por qué. Funciona, pero tú escribes y mantienes la comprobación.
- **En Finite Monkey:** una definición de terminado por tarea (comandos, tests, alcance) que el hook `Stop` ejecuta sobre los archivos actuales. Si falla, Claude recibe la lista de lo que falta y sigue trabajando. El informe final sale de esas pruebas, no del resumen del agente.

## ¿Cómo evito que Claude Code mienta sobre los tests?

Deja el resultado del test en manos de algo que no sea el agente. Una frase como "todos los tests pasan" en el chat, o un archivo de progreso que el agente edita, puede decir cualquier cosa. Una ejecución de tests que lanza un hook sobre los archivos actuales muestra lo que pasó de verdad.

- **Hoy:** un hook `Stop` que ejecuta tu comando de tests y bloquea si falla. Cuidado con las comprobaciones que aceptan cualquier comando que salga con 0, como `echo "tests passed"`.
- **En Finite Monkey:** solo cuenta como prueba lo que Finite Monkey ejecutó por sí mismo, sobre el estado actual del árbol. Los comandos triviales y las ejecuciones con cero tests se rechazan como prueba.

## Claude Code borró o se saltó mis tests para que pasaran. ¿Cómo lo evito?

Mira el diff además del resultado del test: después de borrar un test o marcarlo con `skip`, la ejecución sigue saliendo en verde.

- **Hoy:** revisa los diffs en archivos de test y añade un paso de CI que falle cuando baje el número de tests o aparezca `.skip` u `.only`.
- **En Finite Monkey:** un control de tests que detecta tests eliminados, `skip` u `only` nuevos, aserciones borradas y cambios en la configuración del propio control, también cuando el cambio llega por un comando de shell y no por una edición.

## Claude Code ejecutó `git reset --hard` y perdí trabajo. ¿Cómo lo evito?

Bloquea los comandos destructivos de git antes de que se ejecuten y guarda una instantánea de lo que se perdería. Es una queja habitual, por ejemplo [anthropics/claude-code#7232](https://github.com/anthropics/claude-code/issues/7232) y [#34327](https://github.com/anthropics/claude-code/issues/34327).

- **Hoy:** reglas de permiso `deny` para comandos destructivos de git en `.claude/settings.json`, o un hook `PreToolUse` que los bloquee. Los commits ya hechos suelen recuperarse con `git reflog`; los cambios sin commit, por lo general, no.
- **En Finite Monkey:** una instantánea antes de cada operación arriesgada de git, un `undo` que la recupera, worktrees con cambios pendientes archivados en lugar de borrados y una comprobación de "no se perdió nada" en cada merge.

## ¿Cómo evito que Claude Code haga force push?

Bloquéalo en dos sitios: en tu máquina y en el servidor.

- **Hoy:** una regla de permiso `deny` o un hook `PreToolUse` para `git push --force` y sus variantes, más protección de rama o un ruleset en GitHub que prohíba el force push en ramas compartidas. La regla del servidor es la que sigue valiendo si todo lo local se esquiva.
- **En Finite Monkey:** nunca hace force push y bloquea `--force` y sus variantes. También muestra qué reglas de git se cumplen por mecanismo y cuáles son solo texto.

## ¿Por qué Claude Code ignora CLAUDE.md, sobre todo después de la compactación?

Porque `CLAUDE.md` es texto cargado en el contexto del modelo, y nada lo ejecuta ni lo comprueba. El modelo lo pondera frente a todo lo demás de la conversación y puede dejarlo de lado. Mira [anthropics/claude-code#7777](https://github.com/anthropics/claude-code/issues/7777) y [#19471](https://github.com/anthropics/claude-code/issues/19471) ("CLAUDE.md instructions completely ignored after context compaction").

- **Hoy:** mantén `CLAUDE.md` corto y saca de la prosa toda regla que deba cumplirse siempre, llevándola a un hook, una regla de permiso, un git hook o un paso de CI.
- **En Finite Monkey:** hace ese traslado para las reglas que conoce y te muestra, regla por regla, cuáles se cumplen por mecanismo y cuáles siguen siendo solo texto.

## ¿Cómo hago que las reglas de CLAUDE.md se cumplan de verdad?

Convierte cada regla en el mecanismo más barato que pueda comprobarla. "Nunca hacer commit de `.env`" se convierte en un hook de pre-commit y un escaneo en CI. "Ejecutar los tests antes de decir listo" se convierte en un hook `Stop`. "No tocar producción" se convierte en un comando bloqueado.

- **Hoy:** hooks de Claude Code (`PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit` y otros), reglas de permiso, git hooks y CI. Cada uno se ejecuta aunque el modelo no recuerde la regla.
- **En Finite Monkey:** los entrega como un conjunto probado, instalado con copias de seguridad y que se quita con `uninstall`.

## ¿Cómo evito que Claude Code filtre claves de API o secretos en los commits?

Busca secretos en más de un punto, porque una clave puede filtrarse por un archivo escrito, un prompt, un commit, el historial o un pull request. [anthropics/claude-code#2142](https://github.com/anthropics/claude-code/issues/2142) es un caso de claves de API que llegaron al control de versiones.

- **Hoy:** un escáner de secretos en el pre-commit (gitleaks es una opción común), el secret scanning de GitHub con push protection y un hook `PreToolUse` o una regla `deny` que impida al agente leer archivos `.env`.
- **En Finite Monkey:** una única regla de detección, aplicada al escribir archivos, en los prompts, al hacer commit, en el historial y en CI. Un secreto encontrado se trata como un incidente para rotar. Los secretos se citan por archivo y línea, nunca por su valor.

## ¿Cómo evito que un agente de IA toque un servidor de producción?

No le des al agente un camino directo a producción y bloquea los comandos que lo crearían.

- **Hoy:** no dejes credenciales de producción donde el shell del agente pueda usarlas, despliega solo por CI y bloquea los comandos de shell remoto a servidores de producción con un hook o una regla de permiso.
- **En Finite Monkey:** los comandos con efecto sobre un servidor de producción declarado se bloquean. Producción cambia por el camino de despliegue que declaraste, y por ningún otro.

## ¿Qué es una definición de terminado para agentes de código?

Una lista de condiciones que una máquina puede comprobar antes de que el agente pueda dar el trabajo por terminado: comandos que deben salir bien, tests que deben existir y pasar, archivos que deben o no deben cambiar.

- **Hoy:** puedes escribir una a mano como script y llamarla desde un hook `Stop`.
- **En Finite Monkey:** crea una por tarea, la ejecuta en `Stop`, ata las pruebas al estado actual de los archivos y deja la ceremonia en cero para las tareas pequeñas.

## ¿Un hook Stop de Claude Code puede verificar los tests antes de terminar?

Sí. Un hook `Stop` puede ejecutar tu comando de tests y, si falla, bloquear el cierre con un motivo que Claude lee y sigue. Importan dos detalles: la comprobación debe ejecutarse sobre los archivos actuales, sin fiarse de una ejecución anterior, y no debe ceder la segunda vez que Claude intenta parar.

- **En Finite Monkey:** el control se construye justo sobre ese hook, con las reglas de prueba de arriba y un informe final de "no terminado" en lugar de un bucle infinito.

## ¿Hay un plugin de seguridad o guardrails para Claude Code?

Hay varios, y algunos son muy buenos en una sola tarea. tdd-guard obliga a escribir el test primero; cc-safety-net y dcg bloquean comandos destructivos de shell y git. Métodos como Superpowers, GSD y Spec Kit añaden proceso. La [página de comparación](compare.es.md) muestra qué garantiza cada uno por mecanismo y qué deja en prosa, con fuentes.

- **En Finite Monkey:** cubre cuatro daños ("listo" falso, secretos filtrados, cambios a mano en producción, trabajo perdido en git) con un control, una instalación y un `undo`.

## ¿Funciona con herramientas que cambian la cuenta de Claude Code cuando se acaba el límite?

Sí, si la herramienta lee un archivo de espera. Un supervisor que reinicia Claude Code en otra cuenta puede cortar la puerta en medio de un `Stop`, y la sesión reanudada te espera con el trabajo a medio revisar.

Para activarlo, agrega `supervisor:` con `enabled: true` a `.finitemonkey/config.yml` y haz que el supervisor defina `FINITEMONKEY_HOLD_DIR` con un directorio que vigile. Mientras la puerta corre o retiene la parada, Finite Monkey mantiene ahí `<sesión>.hold.json`, con una hora `until`; el supervisor no debe cambiar de cuenta mientras `until` esté en el futuro. El archivo vence solo (10 minutos para una ejecución, 15 para una parada retenida) y se borra cuando la puerta pasa. Cuando la sesión vuelve en la cuenta nueva, `SessionStart` le cuenta a Claude qué esperaba la puerta y la ejecuta otra vez. Los mensajes de reanudación que empiezan con `[supervisor]` no cuentan como tuyos, y un `usage.json` en el mismo directorio aparece en `finitemonkey gain`.
