import type { Localized } from "./footprint-text.js";

export const DEPLOY_FOOTPRINT_TEXT = {
  infra: {
    en: "How the project deploys, read from its own files when you run `finitemonkey infra`: level, targets and risks with `file:line`, no address. Production hosts found in deploy files go to `hosts.local.yml`, which git ignores, and only when the `.gitignore` block is there.",
    "pt-BR":
      "Como o projeto faz deploy, lido dos próprios arquivos quando você roda `finitemonkey infra`: nível, alvos e riscos com `arquivo:linha`, sem endereço. Hosts de produção achados nos arquivos de deploy vão para `hosts.local.yml`, que o git ignora, e só quando o bloco do `.gitignore` existe.",
    es: "Cómo despliega el proyecto, leído de sus propios archivos cuando ejecutas `finitemonkey infra`: nivel, destinos y riesgos con `archivo:línea`, sin direcciones. Los hosts de producción hallados en los archivos de despliegue van a `hosts.local.yml`, que git ignora, y solo si el bloque del `.gitignore` existe.",
  },
  "infra-remote": {
    en: "Through `ssh`, only when a person runs `finitemonkey infra --remote --yes` in a terminal: read-only commands (`docker ps`, `systemctl list-units`) on the hosts listed in `hosts.local.yml`. Never from a hook or an agent.",
    "pt-BR":
      "Pelo `ssh`, só quando uma pessoa roda `finitemonkey infra --remote --yes` num terminal: comandos só de leitura (`docker ps`, `systemctl list-units`) nos hosts de `hosts.local.yml`. Nunca por hook nem por agente.",
    es: "A través de `ssh`, solo cuando una persona ejecuta `finitemonkey infra --remote --yes` en una terminal: comandos de solo lectura (`docker ps`, `systemctl list-units`) en los hosts de `hosts.local.yml`. Nunca desde un hook ni un agente.",
  },
  "deploy-drift": {
    en: "Through `ssh`, when you run `finitemonkey deploy check` (or its scheduled workflow, or the `deploy` gate check): read-only commands (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) as the read-only user, to compare production with the branch. With `--issue`, one GitHub issue is opened or commented through `gh`.",
    "pt-BR":
      "Pelo `ssh`, quando você roda `finitemonkey deploy check` (ou o workflow agendado dele, ou o check `deploy` do gate): comandos só de leitura (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) com o usuário só de leitura, para comparar a produção com a branch. Com `--issue`, uma issue do GitHub é aberta ou comentada pelo `gh`.",
    es: "A través de `ssh`, cuando ejecutas `finitemonkey deploy check` (o su workflow programado, o el check `deploy` del gate): comandos de solo lectura (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) con el usuario de solo lectura, para comparar producción con la rama. Con `--issue`, se abre o se comenta una issue de GitHub a través de `gh`.",
  },
  "deploy-generate": {
    en: "Only with `finitemonkey deploy generate --yes`, and only files that do not exist yet: the deploy and drift workflows, the script the server runs and its compose file. An existing file is never overwritten; its diff is shown instead.",
    "pt-BR":
      "Só com `finitemonkey deploy generate --yes`, e só arquivos que ainda não existem: os workflows de deploy e de drift, o script que o servidor roda e o compose dele. Um arquivo existente nunca é sobrescrito; o diff aparece no lugar.",
    es: "Solo con `finitemonkey deploy generate --yes`, y solo archivos que aún no existen: los workflows de despliegue y de drift, el script que corre el servidor y su compose. Un archivo existente nunca se sobrescribe; en su lugar se muestra el diff.",
  },
} as const satisfies Readonly<Record<"infra" | "infra-remote" | "deploy-drift" | "deploy-generate", Localized>>;
