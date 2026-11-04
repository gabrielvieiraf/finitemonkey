import type { FailureModeText } from "./failure-modes-text.js";

export const FAILURE_MODES_ES: Readonly<Record<string, FailureModeText>> = {
  "The agent says done while checks fail": {
    failure: "El agente dice que terminó con revisiones fallando",
    cause: "El modelo declara éxito por su propia lectura del trabajo",
    mitigation: "El hook `Stop` ejecuta la compuerta y bloquea con la lista de lo que falta",
  },
  "A blocked stop loops forever": {
    failure: "Una parada bloqueada se vuelve un bucle sin fin",
    cause: "Cada intento de parar se bloquea otra vez",
    mitigation: "El bloqueo termina antes del límite de continuaciones del propio Claude Code, con un NOT DONE visible",
  },
  "A gate that cannot run looks like a pass": {
    failure: "Una compuerta que no puede ejecutarse parece aprobada",
    cause: "Un fallo, un archivo ausente o un registro sin permiso de escritura",
    mitigation:
      "La parada se retiene una vez con GATE DID NOT RUN y luego se deja pasar registrada como no ejecutada; `pr open` y `ci gate` se niegan hasta que pase una ejecución real",
  },
  "Old evidence passes new code": {
    failure: "Evidencia vieja aprueba código nuevo",
    cause: "Una revisión pasó y luego el árbol cambió",
    mitigation:
      "La evidencia queda atada al hash del árbol; cualquier edición después del verde vuelve a ejecutar la revisión",
  },
  "A check that never ran counts as passed": {
    failure: "Una revisión que nunca se ejecutó cuenta como aprobada",
    cause: "La herramienta no está instalada en la máquina",
    mitigation: "La revisión aparece como no verificada, nunca como aprobada",
  },
  "Old failures block unrelated work": {
    failure: "Fallos viejos bloquean trabajo sin relación",
    cause: "El proyecto ya estaba en rojo antes de empezar la tarea",
    mitigation: "Una línea base tomada al inicio de la sesión; solo bloquean los fallos nuevos",
  },
  "Tests are skipped to make the suite pass": {
    failure: "Se saltan pruebas para que la suite pase",
    cause: "El agente añade `.skip` o `xit` con cualquier herramienta",
    mitigation: "La revisión de pruebas lee el diff del árbol, no la llamada a la herramienta",
  },
  "The suite passes only because an existing test was rewritten": {
    failure: "La suite pasa solo porque se reescribió una prueba existente",
    cause:
      "El agente cambia la aserción de una prueba que ya existía en la base de la tarea, dentro de un alcance que lista la carpeta de pruebas",
    mitigation:
      "Una revisión de pruebas aprobada con líneas cambiadas o borradas en una prueba que ya existía espera a la persona: la prueba vuelve a como era, o la persona aprueba el cambio para este árbol",
  },
  "The agent redefines what test means": {
    failure: "El agente redefine qué es una prueba",
    cause: "`scripts.test`, la configuración del runner, el Makefile o un workflow de CI cambia durante la tarea",
    mitigation:
      "Con `test-pin` activo, la revisión queda retenida como pendiente de aprobación, con el diff, hasta que la persona apruebe",
  },
  "A review or approval outlives the code it saw": {
    failure: "Una revisión o aprobación sobrevive al código que vio",
    cause: "Una edición después de la revisión o de la aprobación manual, o un agente revisor escrito durante la tarea",
    mitigation:
      "Las revisiones solo cuentan con el veredicto de un revisor de confianza sobre el árbol actual; las aprobaciones llevan el hash del árbol y vuelven a pendientes de aprobación tras una edición",
  },
  "A dependency or runtime change keeps old green results": {
    failure: "Un cambio de dependencia o de entorno conserva resultados verdes viejos",
    cause: "El hash del árbol cubre solo el código, no los lockfiles, las versiones de herramientas ni el entorno",
    mitigation:
      "La evidencia registra sus entradas; un lockfile, una versión de herramienta o una variable de la lista permitida que cambió, o evidencia de comando más allá de su edad máxima, vuelve a ejecutar la revisión, y `evidence why` dice qué entrada",
  },
  "A forged ledger line passes a check": {
    failure: "Una línea falsificada en el registro aprueba una revisión",
    cause:
      "El agente añade una línea aprobada con el hash actual del árbol, o edita los scripts en los que confía la compuerta",
    mitigation:
      "Cada línea del registro lleva un HMAC con una clave fuera del proyecto; las líneas sin firma se ignoran y se informan, y la evidencia solo se reutiliza cuando los puntos de entrada de los hooks y los scripts de la compuerta tienen el mismo hash",
  },
  "A secret is committed": {
    failure: "Un secreto llega a un commit",
    cause: "Una credencial entra al stage junto con el cambio",
    mitigation: "El `git commit` se bloquea con el archivo y la línea",
  },
  "A block message repeats the secret it blocked": {
    failure: "Un mensaje de bloqueo repite el secreto que bloqueó",
    cause: "Los mensajes citan el texto problemático",
    mitigation: "Los mensajes dicen solo la regla y los cuatro últimos caracteres enmascarados",
  },
  "The agent turns the guards off": {
    failure: "El agente apaga los guards",
    cause: "Una edición quita los hooks de la configuración",
    mitigation: "El cambio queda bloqueado hasta que la persona lo libere",
  },
  "The agent grants itself a permission": {
    failure: "El agente se concede un permiso",
    cause: "El agente escribe en el almacén de permisos",
    mitigation: "El almacén de permisos no acepta escritura desde una llamada a herramienta",
  },
  "A fake approval reaches the gate": {
    failure: "Una aprobación falsa llega a la compuerta",
    cause: "Un marcador de aprobación llega dentro de una notificación en segundo plano",
    mitigation: "Solo cuentan los marcadores escritos por la persona",
  },
  "A hook hangs the session": {
    failure: "Un hook bloquea la sesión",
    cause: "La entrada estándar nunca se cierra",
    mitigation: "Un temporizador detiene el hook",
  },
  "Bad hook input lets the gate through": {
    failure: "Una entrada mala en el hook deja pasar la compuerta",
    cause: "La entrada estándar no es JSON válido",
    mitigation: "La compuerta bloquea y lo explica en el idioma de la persona",
  },
  "Another mod approves a call a guard denied": {
    failure: "Otro mod aprueba una llamada que un guard negó",
    cause:
      "En un login personal sin configuración gestionada, un allow de tool.check de un mod o un tool.call respondido sin next pasa por encima de un deny de PreToolUse",
    mitigation:
      "El id de la llamada negada se guarda; cuando llega a PostToolUse se registra como guard_bypassed, se muestra en la línea de estado y en la franja de la compuerta, y `ci gate` y `pr open` se niegan hasta que la persona ejecute `fm bypass review`; `doctor` nombra los mods instalados con ese alcance",
  },
  "The mod's permission check fails open": {
    failure: "La revisión de permisos del mod falla abierta",
    cause: "Un hook de mod que lanza un error o agota el tiempo se salta y la llamada sigue",
    mitigation:
      "El registro tool.check del mod tiene un .catch que niega la llamada; los hooks de comando siguen decidiendo",
  },
  "A hand-edited provenance block passes review": {
    failure: "Un bloque de procedencia editado a mano pasa la revisión",
    cause: "Alguien cambia el bloque generado en el cuerpo del pull request",
    mitigation:
      "El bloque lleva un hash de su propio texto; `ci gate` lo recalcula a partir del evento del pull request, sin el registro local, y falla cuando no coincide",
  },
};
