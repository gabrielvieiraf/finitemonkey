---
name: verify
description: >-
  Úsala antes de cada commit y antes de decirle a la persona que algo funciona. Ejecuta la compuerta rápida de Finite Monkey para que el resultado quede registrado como evidencia del árbol actual, en lugar de valer por tu palabra.
when_to_use: >-
  Frases que la activan: commit, ejecuta las pruebas, comprueba que funciona, verifica, prueba, run the tests.
---

# Verificar: evidencia, no promesas

1. Desde la raíz del proyecto, ejecuta `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json`.
2. Lee `data`; para cada elemento que falló, corrige la causa, nunca la verificación.
3. Cita el comando y su código de salida al informar un resultado. Un resultado de antes de tu última edición ya no cuenta.

<!-- finitemonkey:generated v=1 -->
