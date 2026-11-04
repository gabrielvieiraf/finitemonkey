import type { Localized } from "./footprint-text.js";
import { KNOWLEDGE_JUDGE_FOOTPRINT_TEXT } from "./footprint-text-judge.js";

export const COPY_FOOTPRINT_TEXT: Readonly<
  Record<
    | keyof typeof KNOWLEDGE_JUDGE_FOOTPRINT_TEXT
    | "ui-copy"
    | "a11y-engine"
    | "stale-registry"
    | "ui-critic"
    | "ds-config",
    Localized
  >
> = {
  ...KNOWLEDGE_JUDGE_FOOTPRINT_TEXT,
  "ui-copy": {
    en: "`cache/copy-rules.json` keeps, per interface copy rule (verb-first labels, error messages with an action, one name per action, empty labels), the findings the copy check showed and the ones later fixed in the catalog. The ratio of fixed over shown decides whether a rule may block: only when `ui-copy` is active and the ratio reaches `ui.copy.accept_threshold` from config.yml. Never committed.",
    "pt-BR":
      "O `cache/copy-rules.json` guarda, por regra de texto da interface (rótulo começando com verbo, mensagem de erro com ação, um nome por ação, rótulo vazio), os achados que o check de copy mostrou e os que depois foram corrigidos no catálogo. A razão entre corrigidos e mostrados decide se a regra pode bloquear: só quando `ui-copy` está ativo e a razão chega ao `ui.copy.accept_threshold` do config.yml. Nunca vai para commit.",
    es: "`cache/copy-rules.json` guarda, por regla de texto de la interfaz (etiqueta que empieza con verbo, mensaje de error con una acción, un nombre por acción, etiqueta vacía), los hallazgos que mostró el check de copy y los que después se corrigieron en el catálogo. La razón entre corregidos y mostrados decide si una regla puede bloquear: solo cuando `ui-copy` está activo y la razón llega a `ui.copy.accept_threshold` de config.yml. Nunca se commitea.",
  },
  "a11y-engine": {
    en: "Your package manager downloads `axe-core` from the npm registry, only after `init --look --yes` from you. Without `--yes` it only prints the command.",
    "pt-BR":
      "O seu gerenciador de pacotes baixa o `axe-core` do registro do npm, só depois de um `init --look --yes` seu. Sem `--yes` ele só imprime o comando.",
    es: "Tu gestor de paquetes descarga `axe-core` del registro de npm, solo después de un `init --look --yes` tuyo. Sin `--yes` solo imprime el comando.",
  },
  "stale-registry": {
    en: "The package name from package.json, to the npm registry (`npm view <name> dist-tags --json`), only when you run `stale --online` or `stale --after-merge`, to check docs that say the package is not published. Offline, the changelog answers instead.",
    "pt-BR":
      "O nome do pacote do package.json, ao registro do npm (`npm view <nome> dist-tags --json`), só quando você roda `stale --online` ou `stale --after-merge`, para checar docs que dizem que o pacote não está publicado. Offline, quem responde é o changelog.",
    es: "El nombre del paquete de package.json, al registro de npm (`npm view <nombre> dist-tags --json`), solo cuando ejecutas `stale --online` o `stale --after-merge`, para revisar docs que dicen que el paquete no está publicado. Sin conexión, responde el changelog.",
  },
  "ui-critic": {
    en: "`cache/critic-classes.json` keeps, per critic checklist class, the opinions the critic produced and the ones the person accepted with `fm look opinion accept <id>`. With `ui.critic.show_threshold` set in config.yml, a class shows in the `look` output only after its accepted-over-shown ratio reaches it over at least `ui.critic.min_shown` opinions; below it, the class is only logged. Never committed.",
    "pt-BR":
      "O `cache/critic-classes.json` guarda, por classe do checklist do crítico, as opiniões que o crítico produziu e as que a pessoa aceitou com `fm look opinion accept <id>`. Com `ui.critic.show_threshold` definido no config.yml, a classe só aparece na saída do `look` depois que a razão entre aceitas e mostradas chega a ele em pelo menos `ui.critic.min_shown` opiniões; abaixo disso, a classe só vai para o log. Nunca vai para commit.",
    es: "`cache/critic-classes.json` guarda, por clase del checklist del crítico, las opiniones que produjo el crítico y las que la persona aceptó con `fm look opinion accept <id>`. Con `ui.critic.show_threshold` definido en config.yml, la clase solo aparece en la salida de `look` después de que la razón entre aceptadas y mostradas llega a él sobre al menos `ui.critic.min_shown` opiniones; por debajo, la clase solo se registra en el log. Nunca se commitea.",
  },
  "ds-config": {
    en: "Only with `ds.read_config: true` in look.yml: the design-system check runs the utility-CSS framework's own config resolver (`tailwindcss/resolveConfig`) on this file in a child process with the project's Node, so project code in the config runs. The resolved theme is cached in `cache/ds-config.json` by the file's hash. Off by default.",
    "pt-BR":
      "Só com `ds.read_config: true` no look.yml: o check de design system roda o resolvedor de configuração do próprio framework de CSS utilitário (`tailwindcss/resolveConfig`) sobre este arquivo em um processo filho com o Node do projeto, então o código do projeto que está na configuração roda. O tema resolvido fica em cache no `cache/ds-config.json` pelo hash do arquivo. Desligado por padrão.",
    es: "Solo con `ds.read_config: true` en look.yml: el check de design system ejecuta el resolvedor de configuración del propio framework de CSS utilitario (`tailwindcss/resolveConfig`) sobre este archivo en un proceso hijo con el Node del proyecto, así que el código del proyecto que está en la configuración se ejecuta. El tema resuelto queda en caché en `cache/ds-config.json` por el hash del archivo. Apagado por defecto.",
  },
};
