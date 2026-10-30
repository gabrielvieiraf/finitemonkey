import type { Localized } from "./footprint-text.js";
import { KNOWLEDGE_JUDGE_FOOTPRINT_TEXT } from "./footprint-text-judge.js";

export const COPY_FOOTPRINT_TEXT: Readonly<Record<keyof typeof KNOWLEDGE_JUDGE_FOOTPRINT_TEXT | "ui-copy", Localized>> =
  {
    ...KNOWLEDGE_JUDGE_FOOTPRINT_TEXT,
    "ui-copy": {
      en: "`cache/copy-rules.json` keeps, per interface copy rule (verb-first labels, error messages with an action, one name per action, empty labels), the findings the copy check showed and the ones later fixed in the catalog. The ratio of fixed over shown decides whether a rule may block: only when `ui-copy` is active and the ratio reaches `ui.copy.accept_threshold` from config.yml. Never committed.",
      "pt-BR":
        "O `cache/copy-rules.json` guarda, por regra de texto da interface (rótulo começando com verbo, mensagem de erro com ação, um nome por ação, rótulo vazio), os achados que o check de copy mostrou e os que depois foram corrigidos no catálogo. A razão entre corrigidos e mostrados decide se a regra pode bloquear: só quando `ui-copy` está ativo e a razão chega ao `ui.copy.accept_threshold` do config.yml. Nunca vai para commit.",
      es: "`cache/copy-rules.json` guarda, por regla de texto de la interfaz (etiqueta que empieza con verbo, mensaje de error con una acción, un nombre por acción, etiqueta vacía), los hallazgos que mostró el check de copy y los que después se corrigieron en el catálogo. La razón entre corregidos y mostrados decide si una regla puede bloquear: solo cuando `ui-copy` está activo y la razón llega a `ui.copy.accept_threshold` de config.yml. Nunca se commitea.",
    },
  };
