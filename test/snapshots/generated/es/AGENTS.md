<!-- finitemonkey:begin v=1 -->
## Finite Monkey

- Antes de decir que una tarea está terminada, y antes de cada commit, ejecuta `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json` y corrige lo que falle. Nunca debilites, saltes ni borres una verificación para que pase.
- Cuando un hook bloquee una acción, lee el motivo y corrige la causa en lugar de esquivarlo.
- Si algo de la configuración parece mal, ejecuta `node .finitemonkey/runtime/dist/finitemonkey.mjs doctor --json` e informa lo que diga.
<!-- finitemonkey:end -->
