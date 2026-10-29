import type { Localized } from "./footprint-text.js";

export const DEPLOY_FOOTPRINT_TEXT = {
  "ledger-key": {
    en: "A random key, created the first time evidence is written, that signs every line of the evidence ledger. It stays in your home folder, outside the project, readable only by you. Lines without a valid signature are ignored and reported; deleting the key makes old evidence count as not run.",
    "pt-BR":
      "Uma chave aleatória, criada na primeira vez que uma evidência é gravada, que assina cada linha do registro de evidências. Fica na sua pasta pessoal, fora do projeto, legível só por você. Linhas sem assinatura válida são ignoradas e relatadas; apagar a chave faz as evidências antigas contarem como não executadas.",
    es: "Una clave aleatoria, creada la primera vez que se escribe una evidencia, que firma cada línea del registro de evidencias. Queda en tu carpeta personal, fuera del proyecto, legible solo por ti. Las líneas sin firma válida se ignoran y se informan; borrar la clave hace que las evidencias antiguas cuenten como no ejecutadas.",
  },
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
  headers: {
    en: "Through `curl`, only when `headers.url` is set in `.finitemonkey/config.yml` and a task contract has the `headers` check: one GET per configured route, to read the security headers of the real response. Without it, the headers come from the app `look` already started on 127.0.0.1.",
    "pt-BR":
      "Pelo `curl`, só quando `headers.url` está definido em `.finitemonkey/config.yml` e um contrato de tarefa tem o check `headers`: um GET por rota configurada, para ler os headers de segurança da resposta real. Sem isso, os headers vêm do app que o `look` já subiu em 127.0.0.1.",
    es: "A través de `curl`, solo cuando `headers.url` está definido en `.finitemonkey/config.yml` y un contrato de tarea tiene el check `headers`: un GET por ruta configurada, para leer los headers de seguridad de la respuesta real. Sin eso, los headers vienen de la app que `look` ya arrancó en 127.0.0.1.",
  },
  observability: {
    en: "Only with `finitemonkey observe --yes`, and only files that do not exist yet: an error-report scrubber, a JSON logger with an allow-list of fields and, from level 2, a plan to fill in. No account is created anywhere.",
    "pt-BR":
      "Só com `finitemonkey observe --yes`, e só arquivos que ainda não existem: um scrubber de relatórios de erro, um logger em JSON com lista de campos permitidos e, a partir do nível 2, um plano para preencher. Nenhuma conta é criada em lugar nenhum.",
    es: "Solo con `finitemonkey observe --yes`, y solo archivos que aún no existen: un scrubber de reportes de error, un logger en JSON con lista de campos permitidos y, desde el nivel 2, un plan para completar. No se crea ninguna cuenta en ningún sitio.",
  },
  "ci-watch": {
    en: "`ci-watch` keeps, per pull request, the commits whose CI failed and when the watch started, plus one line per run with the commit, each check's result, the failure class and the attempt. Failed logs are read through `gh` with secrets masked and only their last lines are shown, never stored.",
    "pt-BR":
      "O `ci-watch` guarda, por pull request, os commits cuja CI falhou e quando o acompanhamento começou, mais uma linha por execução com o commit, o resultado de cada checagem, a classe da falha e a tentativa. Os logs de falha são lidos pelo `gh` com segredos mascarados e só as últimas linhas aparecem, sem ser guardadas.",
    es: "`ci-watch` guarda, por pull request, los commits cuya CI falló y cuándo empezó el seguimiento, más una línea por ejecución con el commit, el resultado de cada verificación, la clase de falla y el intento. Los logs de falla se leen con `gh` con los secretos enmascarados y solo se muestran sus últimas líneas, sin guardarlas.",
  },
} as const satisfies Readonly<
  Record<
    | "ci-watch"
    | "infra"
    | "infra-remote"
    | "deploy-drift"
    | "deploy-generate"
    | "headers"
    | "observability"
    | "ledger-key",
    Localized
  >
>;
