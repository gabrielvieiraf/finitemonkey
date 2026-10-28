# Spec Kit e OpenSpec

O Spec Kit e o OpenSpec planejam o trabalho e pedem uma etapa de verificação. O Finite Monkey confere o trabalho e não tem etapa de planejamento. Esta página junta os dois sem escrever a definição de pronto duas vezes.

## De um arquivo de tarefas para um contrato de pronto

```bash
npx finitemonkey task from-spec specs/001-checkout/tasks.md --port 3000
npx finitemonkey task from-spec openspec/changes/add-pix/tasks.md --id add-pix
```

- Linhas do Spec Kit como `- [ ] T002 [P] [US1] ...` e do OpenSpec como `- [ ] 1.2 ...` viram um critério cada. O id `T002` ou `1.2` fica ao lado.
- Um comando entre crases (`npm test -- pix`) vira uma checagem `command`.
- Uma linha EARS (`WHEN ... THE SYSTEM SHALL ...`) ou um cenário do OpenSpec (`**WHEN**` / `**THEN**`) que cita uma rota `GET` e um código de status vira uma checagem `runtime` quando você passa `--port`.
- O resto vira checagem `manual`, e o comando lista como "sem checagem executável" para você acrescentar uma.
- Sem `--id` o comando só mostra o contrato proposto. Com `--id` ele grava como tarefa ativa.
- O arquivo de origem é só lido. A saída traz o SHA-256 dele para um teste provar que não mudou.

## Rodando o portão a partir dessas ferramentas

Depois do `npx finitemonkey init`, o hook `Stop` do Claude Code já roda o portão sempre que o agente tenta terminar, seja qual for a ferramenta que escreveu o plano.

Os hooks de ciclo de vida do Spec Kit em `.specify/extensions.yml` (por exemplo `after_implement`) chamam comandos do Spec Kit, não comandos de shell, segundo o guia de extensões do Spec Kit lido em 2026-10-27 (https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-USER-GUIDE.md). Para pôr o portão ali, aponte o hook para um comando cujo texto peça ao agente para rodar `npx finitemonkey gate` e parar se falhar.

Num workflow ou job de CI, acrescente um passo de shell:

```yaml
- run: npx finitemonkey ci gate
```

## Um documento de design como entrada do contrato

Um documento de design aprovado (um `design.md` do OpenSpec, um `plan.md` do Spec Kit) é entrada, não o contrato. Copie os cenários de aceite para o arquivo de tarefas como linhas EARS ou checkboxes, rode `task from-spec` e guarde a decisão em `docs/plan/` com `finitemonkey decide new <tema>`.
