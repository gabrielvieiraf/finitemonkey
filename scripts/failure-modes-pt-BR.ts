import type { FailureModeText } from "./failure-modes-text.js";

export const FAILURE_MODES_PT_BR: Readonly<Record<string, FailureModeText>> = {
  "The agent says done while checks fail": {
    failure: "O agente diz que terminou com checagens falhando",
    cause: "O modelo declara sucesso pela própria leitura do trabalho",
    mitigation: "O hook `Stop` roda o portão e bloqueia com a lista do que falta",
  },
  "A blocked stop loops forever": {
    failure: "Uma parada bloqueada vira um laço sem fim",
    cause: "Cada tentativa de parar é bloqueada de novo",
    mitigation: "O bloqueio termina antes do limite de continuações do próprio Claude Code, com um NOT DONE visível",
  },
  "A gate that cannot run looks like a pass": {
    failure: "Um portão que não consegue rodar parece aprovado",
    cause: "Uma falha, um arquivo ausente ou um registro sem permissão de escrita",
    mitigation:
      "A parada passa com um aviso GATE DID NOT RUN, mostrado uma vez, e fica registrada como não rodada; `pr open` e `ci gate` recusam até uma rodada real passar",
  },
  "Old evidence passes new code": {
    failure: "Evidência antiga aprova código novo",
    cause: "Uma checagem passou e depois a árvore mudou",
    mitigation: "A evidência fica presa ao hash da árvore; qualquer edição depois do verde roda a checagem de novo",
  },
  "A check that never ran counts as passed": {
    failure: "Uma checagem que nunca rodou conta como aprovada",
    cause: "A ferramenta não está instalada na máquina",
    mitigation: "A checagem aparece como não verificada, nunca como aprovada",
  },
  "Old failures block unrelated work": {
    failure: "Falhas antigas bloqueiam trabalho sem relação",
    cause: "O projeto já estava vermelho antes de a tarefa começar",
    mitigation: "Uma linha de base tirada no início da sessão; só falhas novas bloqueiam",
  },
  "Tests are skipped to make the suite pass": {
    failure: "Testes são pulados para a suíte passar",
    cause: "O agente acrescenta `.skip` ou `xit` por qualquer ferramenta",
    mitigation: "A checagem de testes lê o diff da árvore, não a chamada de ferramenta",
  },
  "The suite passes only because an existing test was rewritten": {
    failure: "A suíte só passa porque um teste existente foi reescrito",
    cause:
      "O agente muda a asserção de um teste que já existia na base da tarefa, dentro de um escopo que lista a pasta de testes",
    mitigation:
      "Uma checagem de testes aprovada com linhas mudadas ou removidas num teste que já existia espera a pessoa: o teste volta como era, ou a pessoa aprova a mudança para esta árvore",
  },
  "The agent redefines what test means": {
    failure: "O agente redefine o que é teste",
    cause: "`scripts.test`, a configuração do runner, o Makefile ou um workflow de CI muda durante a tarefa",
    mitigation:
      "Com `test-pin` ativo, a checagem fica segurada como precisa de aprovação, com o diff, até a pessoa aprovar",
  },
  "A review or approval outlives the code it saw": {
    failure: "Uma revisão ou aprovação sobrevive ao código que viu",
    cause: "Uma edição depois da revisão ou da aprovação manual, ou um agente revisor escrito durante a tarefa",
    mitigation:
      "Revisões só contam com veredito de um revisor confiável sobre a árvore atual; aprovações levam o hash da árvore e voltam a precisar de aprovação depois de uma edição",
  },
  "A dependency or runtime change keeps old green results": {
    failure: "Uma mudança de dependência ou de ambiente mantém resultados verdes antigos",
    cause: "O hash da árvore cobre só o código, não lockfiles, versões de ferramentas nem o ambiente",
    mitigation:
      "A evidência registra suas entradas; um lockfile, uma versão de ferramenta ou uma variável da lista permitida que mudou, ou evidência de comando além da idade máxima, roda a checagem de novo, e `evidence why` diz qual entrada",
  },
  "A forged ledger line passes a check": {
    failure: "Uma linha forjada no registro aprova uma checagem",
    cause:
      "O agente acrescenta uma linha aprovada com o hash atual da árvore, ou edita os scripts em que o portão confia",
    mitigation:
      "Cada linha do registro leva um HMAC com uma chave fora do projeto; linhas sem assinatura são ignoradas e relatadas, e a evidência só é reaproveitada quando os pontos de entrada dos hooks e os scripts do portão têm o mesmo hash",
  },
  "A secret is committed": {
    failure: "Um segredo vai para um commit",
    cause: "Uma credencial entra no stage junto com a mudança",
    mitigation: "O `git commit` é bloqueado com o arquivo e a linha",
  },
  "A block message repeats the secret it blocked": {
    failure: "Uma mensagem de bloqueio repete o segredo que bloqueou",
    cause: "As mensagens citam o texto problemático",
    mitigation: "As mensagens dizem só a regra e os quatro últimos caracteres mascarados",
  },
  "The agent turns the guards off": {
    failure: "O agente desliga os guards",
    cause: "Uma edição tira os hooks das configurações",
    mitigation: "A mudança fica bloqueada até a pessoa liberar",
  },
  "The agent grants itself a permission": {
    failure: "O agente concede uma permissão a si mesmo",
    cause: "O agente escreve no armazenamento de permissões",
    mitigation: "O armazenamento de permissões não aceita escrita vinda de uma chamada de ferramenta",
  },
  "A fake approval reaches the gate": {
    failure: "Uma aprovação falsa chega ao portão",
    cause: "Um marcador de aprovação chega dentro de uma notificação em segundo plano",
    mitigation: "Só contam marcadores digitados pela pessoa",
  },
  "A hook hangs the session": {
    failure: "Um hook trava a sessão",
    cause: "A entrada padrão nunca fecha",
    mitigation: "Um temporizador para o hook",
  },
  "Bad hook input lets the gate through": {
    failure: "Entrada ruim no hook deixa o portão passar",
    cause: "A entrada padrão não é JSON válido",
    mitigation: "O portão bloqueia e explica no idioma da pessoa",
  },
  "Another mod approves a call a guard denied": {
    failure: "Outro mod aprova uma chamada que um guard negou",
    cause:
      "Num login pessoal sem configurações gerenciadas, um allow de tool.check de um mod ou um tool.call respondido sem next passa por cima de um deny do PreToolUse",
    mitigation:
      "O id da chamada negada fica guardado; quando ela chega ao PostToolUse é registrada como guard_bypassed, aparece na linha de status e na faixa do portão, e `ci gate` e `pr open` recusam até a pessoa rodar `finitemonkey bypass review`; o `doctor` nomeia os mods instalados com esse alcance",
  },
  "The mod's permission check fails open": {
    failure: "A checagem de permissão do mod falha aberta",
    cause: "Um hook de mod que lança erro ou estoura o tempo é pulado e a chamada segue",
    mitigation: "O registro tool.check do mod tem um .catch que nega a chamada; os hooks de comando ainda decidem",
  },
  "A hand-edited provenance block passes review": {
    failure: "Um bloco de proveniência editado à mão passa na revisão",
    cause: "Alguém muda o bloco gerado no corpo do pull request",
    mitigation:
      "O bloco carrega um hash do próprio texto; o `ci gate` recalcula esse hash a partir do evento do pull request, sem o registro local, e falha quando ele diverge",
  },
};
