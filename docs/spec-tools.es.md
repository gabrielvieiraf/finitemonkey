# Spec Kit y OpenSpec

Spec Kit y OpenSpec planifican el trabajo y piden un paso de verificación. Finite Monkey comprueba el trabajo y no tiene paso de planificación. Esta página une los dos sin escribir dos veces la definición de terminado.

## De un archivo de tareas a un contrato de terminado

```bash
npx finitemonkey task from-spec specs/001-checkout/tasks.md --port 3000
npx finitemonkey task from-spec openspec/changes/add-pix/tasks.md --id add-pix
```

- Las líneas de Spec Kit como `- [ ] T002 [P] [US1] ...` y las de OpenSpec como `- [ ] 1.2 ...` se convierten en un criterio cada una. El id `T002` o `1.2` queda al lado.
- Un comando entre comillas invertidas (`npm test -- pix`) se convierte en una comprobación `command`.
- Una línea EARS (`WHEN ... THE SYSTEM SHALL ...`) o un escenario de OpenSpec (`**WHEN**` / `**THEN**`) que nombra una ruta `GET` y un código de estado se convierte en una comprobación `runtime` cuando pasas `--port`.
- Lo demás queda como comprobación `manual`, y el comando lo lista como "sin comprobación ejecutable" para que agregues una.
- Sin `--id` el comando solo muestra el contrato propuesto. Con `--id` lo guarda como tarea activa.
- El archivo de origen solo se lee. La salida trae su SHA-256 para que un test pruebe que no cambió.

## Ejecutar la puerta desde estas herramientas

Después de `npx finitemonkey init`, el hook `Stop` de Claude Code ya ejecuta la puerta cada vez que el agente intenta terminar, sea cual sea la herramienta que escribió el plan.

Los hooks de ciclo de vida de Spec Kit en `.specify/extensions.yml` (por ejemplo `after_implement`) llaman a comandos de Spec Kit, no a comandos de shell, según la guía de extensiones de Spec Kit leída el 2026-10-27 (https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-USER-GUIDE.md). Para poner la puerta ahí, apunta el hook a un comando cuyo texto pida al agente ejecutar `npx finitemonkey gate` y detenerse si falla.

En un workflow o job de CI, agrega un paso de shell:

```yaml
- run: npx finitemonkey ci gate
```

## Un documento de diseño como entrada del contrato

Un documento de diseño aprobado (un `design.md` de OpenSpec, un `plan.md` de Spec Kit) es entrada, no el contrato. Copia sus escenarios de aceptación al archivo de tareas como líneas EARS o casillas, ejecuta `task from-spec` y guarda la decisión en `docs/plan/` con `finitemonkey decide new <tema>`.
