<!-- finitemonkey:begin v=1 -->
## Finite Monkey

- Antes de dizer que uma tarefa está pronta, e antes de cada commit, rode `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json` e corrija o que falhar. Nunca enfraqueça, pule ou apague uma checagem para ela passar.
- Quando um hook bloquear uma ação, leia o motivo e corrija a causa em vez de contornar.
- Se algo na configuração parecer errado, rode `node .finitemonkey/runtime/dist/finitemonkey.mjs doctor --json` e relate o que ele disser.
<!-- finitemonkey:end -->
