import type { GeneratedTemplates } from "./types.js";

export const es: GeneratedTemplates = {
  configHeader:
    "Configuración de Finite Monkey en este proyecto. Versiona este archivo. `finitemonkey update` conserva tus cambios.",
  agentsBlock: ({ gate, doctor }) => [
    "## Finite Monkey",
    "",
    `- Antes de decir que una tarea está terminada, y antes de cada commit, ejecuta \`${gate}\` y corrige lo que falle. Nunca debilites, saltes ni borres una verificación para que pase.`,
    "- Cuando un hook bloquee una acción, lee el motivo y corrige la causa en lugar de esquivarlo.",
    `- Si algo de la configuración parece mal, ejecuta \`${doctor}\` e informa lo que diga.`,
  ],
  verifySkill: {
    description:
      "Úsala antes de cada commit y antes de decirle a la persona que algo funciona. Ejecuta la compuerta rápida de Finite Monkey para que el resultado quede registrado como evidencia del árbol actual, en lugar de valer por tu palabra.",
    whenToUse:
      "Frases que la activan: commit, ejecuta las pruebas, comprueba que funciona, verifica, prueba, run the tests.",
    title: "Verificar: evidencia, no promesas",
    steps: (command) => [
      `Desde la raíz del proyecto, ejecuta \`${command}\`.`,
      "Lee `data`; para cada elemento que falló, corrige la causa, nunca la verificación.",
      "Cita el comando y su código de salida al informar un resultado. Un resultado de antes de tu última edición ya no cuenta.",
    ],
  },
};
