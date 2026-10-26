# Flujos de usuario

> Plantilla para `docs/flows.md`. Crea una sección por cada flujo de usuario. Mantén explícito el orden de los campos. Registra las decisiones como tomadas o pendientes; no presentes suposiciones como requisitos confirmados.

## [Nombre del flujo]

### Objetivo y activador

- **Objetivo del usuario:** [qué quiere conseguir la persona]
- **Activador:** [evento o punto de entrada]
- **Precondiciones:** [estado o permisos necesarios]
- **Resultado:** [resultado satisfactorio observable]

### Pasos y campos

Enumera los campos en el orden en que aparecen o se completan. Incluye la validación y la visibilidad condicional.

| Paso | Pantalla o acción | Campo (orden) | Regla / validación | Paso siguiente |
|---|---|---|---|---|
| 1 | [Pantalla/acción] | [Campo 1] | [Obligatorio, formato, restricciones] | [Decisión o paso] |
| 2 | [Pantalla/acción] | [Campo 2] | [Obligatorio, formato, restricciones] | [Decisión o paso] |

### Reglas y decisiones

- **Reglas:** [reglas de negocio, permisos, validación y comportamiento ante errores]
- **Decisiones tomadas:** [decisión y justificación]
- **Decisiones pendientes:** [pregunta, responsable y fecha límite o dependencia bloqueante]

### Componentes y estados

| Componente | Propósito | Estados que cubrir |
|---|---|---|
| [Componente] | [Propósito] | [Predeterminado, cargando, vacío, error, éxito, deshabilitado cuando corresponda] |

### Orden de implementación

1. [Requisito previo o contrato de datos]
2. [Componente o servicio principal]
3. [Flujo principal y validación]
4. [Estados de error, vacío y éxito]
5. [Pruebas y comprobaciones de accesibilidad]

### Verificación

- [ ] El flujo principal funciona.
- [ ] Se cubren los fallos de validación y permisos.
- [ ] Los estados de carga, vacío, error y éxito están definidos cuando corresponda.
- [ ] Se ha considerado el uso con teclado y tecnologías de asistencia.
- [ ] Las pruebas cubren los criterios de aceptación.

Repite esta sección para cada flujo de usuario distinto.
