---
name: verify
description: >-
  Use antes de todo commit e antes de dizer à pessoa que algo funciona. Roda o portão rápido do Finite Monkey para que o resultado fique registrado como evidência da árvore atual, em vez de valer pela sua palavra.
when_to_use: >-
  Frases que disparam: commit, roda os testes, confere se funciona, verifica, run the tests, prueba.
---

# Verificar: evidência, não promessa

1. Na raiz do projeto, rode `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json`.
2. Leia `data`; para cada item que falhou, corrija a causa, nunca a checagem.
3. Cite o comando e o código de saída ao relatar um resultado. Resultado de antes da sua última edição não vale mais.

<!-- finitemonkey:generated v=1 -->
