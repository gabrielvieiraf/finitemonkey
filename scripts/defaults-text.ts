import type { DefaultItem } from "../src/defaults/items.js";
import type { Lang } from "./footprint-text.js";

interface ItemText {
  readonly what: string;
  readonly evidence: string;
}

export const DEFAULTS_TEXT: Readonly<Record<DefaultItem, Readonly<Record<Lang, ItemText>>>> = {
  "no-attribution": {
    en: {
      what: "No AI credit in commits and pull requests: `attribution` is emptied in the settings when unset, and the guard and the `commit-msg` hook block `Co-Authored-By` lines for AI tools and `Generated with` footers.",
      evidence:
        "Kept in all three repositories studied and corrected by hand in the local sessions: the commit reads as the person's work. Rule I3 in this repository.",
    },
    "pt-BR": {
      what: "Sem crédito de IA em commits e pull requests: `attribution` é esvaziado nas configurações quando não definido, e o guard e o hook `commit-msg` bloqueiam linhas `Co-Authored-By` de ferramentas de IA e rodapés `Generated with`.",
      evidence:
        "Mantido nos três repositórios estudados e corrigido à mão nas sessões locais: o commit é trabalho da pessoa. Regra I3 deste repositório.",
    },
    es: {
      what: "Sin crédito de IA en commits y pull requests: `attribution` se vacía en la configuración cuando no está definido, y el guard y el hook `commit-msg` bloquean líneas `Co-Authored-By` de herramientas de IA y pies `Generated with`.",
      evidence:
        "Presente en los tres repositorios estudiados y corregido a mano en las sesiones locales: el commit es trabajo de la persona. Regla I3 de este repositorio.",
    },
  },
  "branch-names": {
    en: {
      what: "A new branch must be named `type/issue-description`; any other name is blocked instead of only warned.",
      evidence: "One pull request per issue, found by its branch name, in all three repositories.",
    },
    "pt-BR": {
      what: "Um branch novo precisa se chamar `tipo/issue-descricao`; outro nome é bloqueado em vez de só gerar aviso.",
      evidence: "Um pull request por issue, achado pelo nome do branch, nos três repositórios.",
    },
    es: {
      what: "Una rama nueva debe llamarse `tipo/issue-descripcion`; cualquier otro nombre se bloquea en vez de solo avisar.",
      evidence: "Un pull request por issue, encontrado por el nombre de su rama, en los tres repositorios.",
    },
  },
  "prose-blocks": {
    en: {
      what: "Commit, pull request and issue text and changed Markdown that read as machine-written are blocked instead of only warned.",
      evidence:
        "Corrected in the local sessions and kept in the three repositories. Each pattern is in the prose catalog with its test corpus.",
    },
    "pt-BR": {
      what: "Texto de commit, pull request e issue e Markdown alterado com cara de texto de máquina são bloqueados em vez de só gerar aviso.",
      evidence:
        "Corrigido nas sessões locais e mantido nos três repositórios. Cada padrão está no catálogo de prosa com o seu corpus de teste.",
    },
    es: {
      what: "El texto de commits, pull requests e issues y el Markdown cambiado que parecen escritos por una máquina se bloquean en vez de solo avisar.",
      evidence:
        "Corregido en las sesiones locales y presente en los tres repositorios. Cada patrón está en el catálogo de prosa con su corpus de prueba.",
    },
  },
  "research-first": {
    en: {
      what: "A new dependency needs a research record before the gate passes.",
      evidence: "Research before design, with a decision record, in the local sessions and the three repositories.",
    },
    "pt-BR": {
      what: "Uma dependência nova precisa de um registro de pesquisa antes de o portão passar.",
      evidence: "Pesquisa antes do desenho, com registro de decisão, nas sessões locais e nos três repositórios.",
    },
    es: {
      what: "Una dependencia nueva necesita un registro de investigación antes de que pase la compuerta.",
      evidence:
        "Investigación antes del diseño, con registro de decisión, en las sesiones locales y los tres repositorios.",
    },
  },
  "no-comments": {
    en: {
      what: "`TODO` and `FIXME` comments are not listed as debt; debt lives in the ledger written when a task closes.",
      evidence: "No code comments in the three repositories. Rule I1 in this repository.",
    },
    "pt-BR": {
      what: "Comentários `TODO` e `FIXME` não entram como dívida; a dívida fica no registro gravado quando a tarefa fecha.",
      evidence: "Sem comentários no código nos três repositórios. Regra I1 deste repositório.",
    },
    es: {
      what: "Los comentarios `TODO` y `FIXME` no se listan como deuda; la deuda vive en el registro que se escribe al cerrar una tarea.",
      evidence: "Sin comentarios en el código en los tres repositorios. Regla I1 de este repositorio.",
    },
  },
  "no-time-estimates": {
    en: {
      what: "The prose check flags time estimates in plans (`docs/plan/`) and reports.",
      evidence:
        "Practice from the local sessions: plans and reports say what is done, what is left and what blocks it, with no estimates.",
    },
    "pt-BR": {
      what: "A checagem de prosa aponta estimativas de tempo em planos (`docs/plan/`) e relatórios.",
      evidence:
        "Prática das sessões locais: planos e relatórios dizem o que está pronto, o que falta e o que bloqueia, sem estimativas.",
    },
    es: {
      what: "La revisión de prosa marca estimaciones de tiempo en planes (`docs/plan/`) e informes.",
      evidence:
        "Práctica de las sesiones locales: planes e informes dicen qué está hecho, qué falta y qué lo bloquea, sin estimaciones.",
    },
  },
  "conventional-commits": {
    en: {
      what: "Commit headers follow Conventional Commits, checked by the `commit-msg` and `pre-push` hooks and CI. When most recent commits differ, `init` asks once and stores the answer under `conventions.commits`.",
      evidence:
        "Used in all three repositories, where the version is computed from the commit types. Rule I4 in this repository.",
    },
    "pt-BR": {
      what: "Cabeçalhos de commit seguem Conventional Commits, conferidos pelos hooks `commit-msg` e `pre-push` e pela CI. Quando a maioria dos commits recentes é diferente, o `init` pergunta uma vez e guarda a resposta em `conventions.commits`.",
      evidence: "Usado nos três repositórios, onde a versão sai dos tipos de commit. Regra I4 deste repositório.",
    },
    es: {
      what: "Los encabezados de commit siguen Conventional Commits, revisados por los hooks `commit-msg` y `pre-push` y por la CI. Cuando la mayoría de los commits recientes es distinta, `init` pregunta una vez y guarda la respuesta en `conventions.commits`.",
      evidence:
        "Usado en los tres repositorios, donde la versión sale de los tipos de commit. Regla I4 de este repositorio.",
    },
  },
};

export const DEFAULTS_SECTION: Readonly<
  Record<Lang, { readonly heading: string; readonly intro: string; readonly columns: readonly string[] }>
> = {
  en: {
    heading: "Defaults and their evidence",
    intro:
      "One set of defaults for everyone, generated from `src/defaults/items.ts`. Each item comes from practices found in 78 local sessions and three repositories. Guidance that helps a beginner can slow down an expert (expertise reversal, Kalyuga et al. 2003), so any item turns off with `defaults: <item>: off` in `.finitemonkey/config.yml`, and a repository convention that differs from a default is asked about once.",
    columns: ["Default", "What it does", "Evidence"],
  },
  "pt-BR": {
    heading: "Padrões e a evidência de cada um",
    intro:
      "Um conjunto de padrões para todo mundo, gerado a partir de `src/defaults/items.ts`. Cada item vem de práticas encontradas em 78 sessões locais e três repositórios. Orientação que ajuda quem começa pode atrapalhar quem já domina (efeito de reversão da expertise, Kalyuga et al. 2003), então qualquer item desliga com `defaults: <item>: off` em `.finitemonkey/config.yml`, e uma convenção do repositório diferente de um padrão gera uma pergunta, uma vez.",
    columns: ["Padrão", "O que faz", "Evidência"],
  },
  es: {
    heading: "Valores predeterminados y su evidencia",
    intro:
      "Un solo conjunto de valores predeterminados para todos, generado desde `src/defaults/items.ts`. Cada elemento viene de prácticas encontradas en 78 sesiones locales y tres repositorios. Una guía que ayuda a quien empieza puede frenar a quien ya domina (efecto de reversión de la experticia, Kalyuga et al. 2003), así que cualquier elemento se apaga con `defaults: <item>: off` en `.finitemonkey/config.yml`, y una convención del repositorio distinta de un predeterminado genera una pregunta, una sola vez.",
    columns: ["Predeterminado", "Qué hace", "Evidencia"],
  },
};
