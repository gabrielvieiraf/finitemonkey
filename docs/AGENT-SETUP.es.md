# Instalar Finite Monkey para alguien (guía del agente)

Este archivo es para un agente de IA, como Claude Code, al que una persona le pidió instalar Finite Monkey en un proyecto. Las personas también pueden leerlo.

> **Estado: prelanzamiento.** `init`, `update`, `uninstall` y el plugin de Claude Code existen en el repositorio y tienen pruebas, pero todavía no hay una versión 0.1.0 en npm. El paso 1 explica cómo detectarlo y qué decirle a la persona. Los hooks ya se instalan; la mayor parte de lo que hacen cumplir (la compuerta, los bloqueos) sigue **(planificada)**.
>
> Válido para `finitemonkey` >= 0.1.0. Comprueba la versión instalada antes de seguir cualquier paso posterior y detente si es menor.

## Conducta

1. **Ejecuta los comandos tú mismo.** No le pidas a la persona que escriba comandos que puedes ejecutar.
2. **Pregunta solo lo que es decisión suya.** Por ejemplo: qué preset, qué idioma para los archivos generados, si activar una función opcional. No preguntes lo que puedes averiguar leyendo el proyecto o la salida de los comandos.
3. **Nunca pidas secretos.** Ni contraseñas, ni claves de API, ni tokens, ni códigos de recuperación, tampoco "para terminar la configuración". Finite Monkey no necesita ninguno para instalarse.
4. **Prefiere `--json`.** Lee la salida JSON, no el texto para personas. Cuando exista el campo `next`, síguelo.
5. **No actives nada costoso sin preguntar.** Todo lo que gaste dinero, use APIs de pago, ejecute benchmarks largos, cambie configuración de GitHub (como los rulesets de ramas) o edite configuración global (`~/.claude/settings.json`, perfiles del shell) necesita antes un sí explícito de la persona.
6. **Explica cada paso en una o dos frases, en el idioma de la persona.**
7. **No edites archivos que gestiona `init`.** Si algo parece mal, ejecuta `doctor` e informa lo que diga.

## Dos formas de instalar

Las dos instalan los mismos hooks. Usa una o ambas: cuando el proyecto tiene sus propios hooks de Finite Monkey, los del plugin se hacen a un lado y nada se ejecuta dos veces.

1. **El plugin de Claude Code**, desde el marketplace del repositorio. Dentro de una sesión de Claude Code:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey
   /plugin install finitemonkey@finitemonkey
   ```

   El plugin trae los hooks y las skills (`task`, `verify`, `look`, `finish`) que Claude usa por su cuenta. Lleva su propia CLI (`scripts/finitemonkey.mjs`, el mismo build que la versión de su `plugin.json`), y cada hook ejecuta `node` sobre ese archivo: sin `npx`, sin descargas, sin red.

2. **`npx finitemonkey init`** en el proyecto (pasos abajo). Escribe en el proyecto los hooks, el piso de `permissions.deny` (más una regla `Read` de bloqueo por cada patrón de `.claudeignore`), reglas `ask` para los push a `main`/`master` y para comandos de publicación y despliegue, `permissions.blockReadsOutsideWorkingDirectories: true`, `.finitemonkey/config.yml`, una skill `verify` del proyecto (`.claude/skills/verify/SKILL.md`, que ejecuta la compuerta rápida antes de cada commit) y un bloque gestionado corto en `AGENTS.md`, que `CLAUDE.md` importa con `@AGENTS.md` (cada archivo se crea si no existe; todo lo que está fuera del bloque queda como estaba). Nunca define `defaultMode` ni `autoMode`, solo añade reglas que la configuración todavía no tiene y deja como está una skill `verify` que el proyecto ya tenga. Los hooks ejecutan `node` sobre `node_modules/finitemonkey` cuando el proyecto lo tiene como dependencia; si no, `init` copia la CLI que lo está ejecutando a `.finitemonkey/runtime/` (versionada, para que el equipo y las sesiones en la nube usen la misma versión) y los hooks ejecutan esa copia. Ningún hook llama a `npx`. Esto también vale donde los plugins no cargan (las sesiones en la nube de un repositorio leen el `.claude/settings.json` versionado). Añade `--marketplace` para registrar además el marketplace del plugin en la configuración del proyecto, para todos los que confíen en la carpeta; queda desactivado salvo que la persona lo pida.

## Qué obtiene la persona

Después de instalar, la persona no necesita recordar ningún comando. Finite Monkey trabaja con el contexto dentro de Claude Code: hooks en `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` y `SubagentStop`, y skills que Claude invoca solo según su descripción. Los comandos con barra son atajos opcionales. Al terminar, dile a la persona que siga trabajando como siempre.

## Pasos

### 1. Comprueba que existe una versión real

```sh
npm view finitemonkey version
```

- Si el comando falla, o la versión es `0.0.0` o menor que `0.1.0`, Finite Monkey todavía no se ha lanzado (`0.0.0` solo reserva el nombre). Dile a la persona: "Finite Monkey todavía no se ha lanzado; no hay nada que instalar." Detente aquí.
- Si no, continúa.

### 2. Comprueba el entorno

- Node.js 20 o posterior: `node --version`.
- El proyecto es un repositorio git: `git rev-parse --show-toplevel`.
- Estado del árbol: `git status --porcelain`. Si hay cambios sin commit, avisa a la persona y pregunta si continuar. `init` hace copias de seguridad, pero la persona debe saberlo.

### 3. Revisa el plan antes

```sh
npx finitemonkey@latest init --dry-run --json
```

Esto lee el proyecto y devuelve el plan sin escribir nada: `data.actions` lista cada archivo con `create`, `merge`, `update`, `unchanged`, `keep-edited` o `skip-foreign`; `data.warnings` lista lo que la persona debe saber (otro plugin que también decide cuándo termina la sesión, un Claude Code demasiado antiguo para bloquear cuando un hook falla, un archivo que no es de Finite Monkey); y `data.diff` muestra el cambio exacto. Resume el plan para la persona en pocas líneas. Pregunta solo estas decisiones:

- Preset: `neutral` (por defecto) o `gabriel` (añade las convenciones del autor, como desactivar la atribución de IA en commits y PRs cuando el proyecto no la ha definido).
- Si registrar el marketplace del plugin en el proyecto (`--marketplace`).

### 4. Instala

```sh
npx finitemonkey@latest init --yes --json
```

Pasa las decisiones de la persona como flags (por ejemplo `--preset gabriel --lang es`). Sin `--yes`, `init` sale con código 4, el plan y un campo `next` con el comando exacto para ejecutar cuando la persona esté de acuerdo. `init` guarda una copia de cada archivo que toca en `.finitemonkey/backups/<timestamp>/`, registra lo que escribió en `.finitemonkey/lock.json`, combina `.claude/settings.json` sin quitar ningún hook ni permiso de la persona, añade un bloque gestionado a `.gitignore` (el estado queda local, `config.yml` se versiona) y se puede ejecutar otra vez sin riesgo: una segunda ejecución sin cambios no escribe nada.

### 5. Verifica

```sh
npx finitemonkey doctor --json
```

Cada elemento tiene `check`, `status` y `fix`. Si alguno no está en `ok`, ejecuta el comando de `fix` cuando sea seguro y no caiga en la regla de conducta 5, y vuelve a ejecutar `doctor`. Informa lo que quede.

`npx finitemonkey doctor --fix` repara los archivos del proyecto que le pertenecen (hooks, reglas de deny, el bloque del `.gitignore`) con la misma copia de seguridad y el mismo bloqueo que `init`, y nunca toca los settings del usuario ni el perfil de la shell. Si el usuario quiere reportar un bug, `npx finitemonkey doctor --report` guarda un archivo Markdown enmascarado en `.finitemonkey/reports/` para adjuntarlo a la issue.

### 6. Cuéntaselo a la persona

En una o dos frases: qué se instaló, lo que `doctor` no pudo corregir y que ya puede seguir trabajando sin ningún comando nuevo.

## Códigos de salida

| Código | Significado |
|---|---|
| 0 | Éxito |
| 1 | Una comprobación falló |
| 2 | Error de uso |
| 3 | No configurado |
| 4 | Necesita a la persona (una decisión o una confirmación) |
| 5 | El propio Finite Monkey falló |

Con `--json`, los errores llegan como `{"schemaVersion":1,"error":{"code":"...","message":"...","fix":"..."}}`. Ejecuta o sugiere el comando de `fix`.

## Actualizar

```sh
npx finitemonkey update --check --json
npx finitemonkey update --yes --json
```

`--check` sale con 1 cuando los archivos gestionados difieren de esta versión y con 0 cuando coinciden. `update` fija los hooks en la versión nueva y renueva los archivos generados que la persona no editó. Cuando una versión nueva cambió el formato de un archivo gestionado, `update` también ejecuta la migración de esa versión, en orden de semver, sobre los archivos que la persona no editó. Un archivo generado que la persona editó se conserva, y la plantilla nueva o el texto migrado aparece en `data.diff` como propuesta. Un archivo que no se puede escribir por falta de permisos devuelve `install_permission_denied` con el `fix`.

## Deshacer

```sh
npx finitemonkey uninstall --yes --json
npx finitemonkey uninstall --yes --purge --json
```

El primero quita lo que Finite Monkey añadió y restaura las copias de seguridad, conservando `.finitemonkey/` (copias y evidencias). `--purge` borra también `.finitemonkey/`; después de `init` y `uninstall --purge`, el proyecto queda idéntico byte a byte a como estaba. Los archivos que la persona editó después de instalar se conservan y se listan en `data.kept`. Sin `--yes`, sale con 4 y el plan. El plugin, si está instalado, se quita aparte: `claude plugin uninstall finitemonkey@finitemonkey`.

<!-- translation of docs/AGENT-SETUP.md sha256:c31369133138 -->
