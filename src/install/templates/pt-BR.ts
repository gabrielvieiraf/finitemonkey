import type { GeneratedTemplates } from "./types.js";

export const ptBR: GeneratedTemplates = {
  configHeader:
    "Configuração do Finite Monkey neste projeto. Versione este arquivo. O `finitemonkey update` mantém suas edições.",
  verifySkill: {
    description:
      "Use antes de todo commit e antes de dizer à pessoa que algo funciona. Roda o portão rápido do Finite Monkey para que o resultado fique registrado como evidência da árvore atual, em vez de valer pela sua palavra.",
    whenToUse: "Frases que disparam: commit, roda os testes, confere se funciona, verifica, run the tests, prueba.",
    title: "Verificar: evidência, não promessa",
    steps: (command) => [
      `Na raiz do projeto, rode \`${command}\`.`,
      "Leia `data`; para cada item que falhou, corrija a causa, nunca a checagem.",
      "Cite o comando e o código de saída ao relatar um resultado. Resultado de antes da sua última edição não vale mais.",
    ],
  },
};
