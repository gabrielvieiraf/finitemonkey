# Verificación manual: el panel de trayectoria en una sesión real de Claude Code

[English](trajectory-pane.md) | [Português (Brasil)](trajectory-pane.pt-BR.md) | Español

`claude plugin test` dibuja el panel de trayectoria (`/fm trajectory`) como Raster en la terminal y como Svg de 900 píxeles de ancho en Desktop y VS Code, en los temas claro y oscuro (`test/mod/trajectory.test.ts`, `test/trajectory-view.test.ts`). No reproduce cómo cada host escala, aplica tema y colorea lo que dibuja. Esta lista cubre esa parte. Una persona la ejecuta a mano, en una sesión real, con el plugin instalado desde el canal `next`. Ninguna verificación de abajo se ha ejecutado todavía: cada fila de [Resultados](#resultados) empieza como `not run`.

## Antes de empezar

1. Instala el plugin desde el marketplace `next` en Claude Code:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey#next
   /plugin install finitemonkey@finitemonkey-next
   ```

   Activa solo este plugin llamado `fm`, no también el estable.

2. Desde un clon de este repositorio, crea un proyecto descartable con una trayectoria conocida:

   ```
   npm ci
   npm run manual:trajectory -- --dir ../fm-trajectory-check
   cd ../fm-trajectory-check && git init -q
   ```

   El script rechaza una carpeta que ya tiene `.fm/`, así que nunca toca un registro real. Escribe tres archivos, con fechas relativas a hoy:
   - `.fm/policy.yml` activa la función `trajectory` (`guards: trajectory: active`), para que la banda muestre el segmento de trayectoria.
   - `.fm/conceitos-events.jsonl` tiene 13 eventos. El dominio `backend` tiene evidencia suficiente para dibujar: semanas sin evidencia (rayadas), un rebote en `webhook` la semana pasada (✕) y una marca de "aguantó" en `idempotency` esta semana (◉). `infrastructure` tiene un evento con peso, así que aparece como "no data".
   - `.fm/log.jsonl` tiene cinco ayudas de horizonte en `backend`, algunas sin criterio, para que se dibuje la franja ciega y la banda también muestre su segmento al lado de la trayectoria.

   `test/manual-trajectory.test.ts` mantiene honesto este fixture: falla si el seed deja de producir las dos marcas en semanas distintas, las semanas rayadas, la fila "no data" o los segmentos de la banda.

3. Antes de cada superficie, anota:
   - la versión de Claude Code (`claude --version`, o la entrada Acerca de en Desktop y en la extensión de VS Code);
   - la versión del plugin Finite Monkey (la muestra `/plugin`);
   - el sistema operativo y su versión;
   - la superficie (Desktop, VS Code, terminal y el nombre de la app de terminal).

4. Abre una sesión de Claude Code en `../fm-trajectory-check` en esa superficie y ejecuta `/fm trajectory`. Guarda una captura de pantalla por fila en `docs/manual-checks/screenshots/trajectory-pane/`, con el nombre `<version-de-claude-code>-<superficie>-<tema>-<verificacion>.png`.

Nunca pegues un secreto, un token o una ruta privada en una captura ni en una fila de resultado.

## Verificaciones

Cada verificación tiene un ID que se usa en la tabla de resultados. Una verificación solo pasa si se cumplen todos los puntos.

### Desktop

- **D1 claro** y **D2 oscuro**: pon el tema de Claude Code en claro, luego en oscuro, y ejecuta `/fm trajectory` cada vez.
  - El gráfico ocupa el ancho del panel. Nada se recorta a la derecha ni abajo, y el panel no muestra barra de desplazamiento horizontal ni vertical para el gráfico.
  - Estrecha y ensancha la ventana: el gráfico sigue al panel y mantiene sus proporciones (el texto no se estira).
  - El fondo y las franjas siguen el tema elegido.

### VS Code

- **V1 claro** y **V2 oscuro**: los mismos puntos de D1 y D2, en el panel de Claude Code en VS Code, con el tema de color de VS Code en uno claro y luego en uno oscuro.

### Tema automático

- **A1 Desktop** y **A2 VS Code**: pon el tema de Claude Code en un valor que no empiece por `light` ni `dark` (como automático, si la versión lo ofrece). Finite Monkey dibuja entonces el Svg con la regla `prefers-color-scheme: dark`.
  - Con el sistema en modo claro, el gráfico usa la paleta clara.
  - Cambia el sistema a modo oscuro sin cerrar el panel y ejecuta `/fm trajectory` otra vez: el gráfico usa la paleta oscura.
  - Anota si la paleta cambió sin volver a ejecutar el comando.

### Información al pasar el ratón

- **T1 Desktop** y **T2 VS Code**: el Svg se dibuja con `isInteractive` activado.
  - Pasar el ratón sobre el ✕ de la semana pasada muestra un texto que empieza por `ricochet · webhook ·` y lista su evidencia.
  - Pasar el ratón sobre el ◉ de esta semana muestra un texto que empieza por `held · idempotency ·`.
  - Pasar el ratón sobre una semana rayada muestra `<semana>: no evidence`.

### Terminal

Ejecútalas en una app de terminal, con Claude Code en esa terminal.

- **R1 truecolor, fondo oscuro**: una terminal con `COLORTERM=truecolor`, tema de Claude Code oscuro.
- **R2 256 colores, fondo oscuro**: la misma terminal sin `COLORTERM` y con `TERM=xterm-256color`, o una terminal que solo tiene 256 colores.
- **R3 truecolor, fondo claro** y **R4 256 colores, fondo claro**: un perfil de terminal claro, tema de Claude Code claro.

En cada una:
- Las franjas del Raster del panel tienen los mismos colores, en el mismo orden, que la paleta de las franjas. La referencia es el gráfico que `npx finitemonkey@next trajectory --domain backend` imprime en la misma terminal desde la carpeta creada, que nombra cada franja junto a su color. Con fondo claro, ejecútalo como `COLORFGBG='0;15' npx finitemonkey@next trajectory --domain backend` para que el comando elija su paleta clara.
- Las marcas ✕ y ◉ y las etiquetas se leen sobre todas las franjas y sobre el fondo de la terminal.
- Con fondo claro, ningún texto ni marca desaparece en el fondo.

### Banda

- **B1 80 columnas** y **B2 120 columnas**: ajusta la terminal a exactamente 80 y luego 120 columnas (`tput cols` muestra el ancho) y envía un prompt para que la banda se actualice.
  - La línea de la banda que empieza por `FM` muestra el segmento de trayectoria (dominio `backend`, la franja de esta semana y el rebote en `webhook`) junto al segmento de la franja ciega y los demás segmentos.
  - Ningún segmento se corta en mitad de una palabra, y la banda no salta a una segunda línea.
  - Anota qué segmentos aparecieron y cuáles, si alguno, desaparecieron.

## Cuando una verificación falla

Abre una issue por cada verificación que falla, con el ID de la verificación, la versión de Claude Code, el sistema operativo, la superficie y la captura. Pon el número de la issue en la fila del resultado. Ningún cambio de código salvo que falle una verificación.

## Resultados

Los resultados se guardan solo en el archivo en inglés, [trajectory-pane.md](trajectory-pane.md#results), para que haya un registro único: una fila por verificación y ejecución, con fecha, versión de Claude Code, versión del plugin, sistema operativo, superficie, tema, ID, resultado (`pass`, `fail` o `not run`), captura e issue. Las filas antiguas se conservan, porque el resultado puede cambiar entre versiones de Claude Code. Las traducciones llevan los mismos pasos.
