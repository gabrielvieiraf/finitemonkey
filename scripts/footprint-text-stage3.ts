import type { Localized } from "./footprint-text.js";

export const STAGE3_FOOTPRINT_TEXT: Readonly<Record<"golden" | "organize" | "api-contract" | "ds-sync", Localized>> = {
  golden: {
    en: "Expected outputs of golden cases, one file per case, plus `accepted.jsonl` with who recorded each one and when. Only `finitemonkey golden accept`, run by the person in a terminal, writes them.",
    "pt-BR":
      "Saídas esperadas dos casos golden, um arquivo por caso, mais `accepted.jsonl` com quem gravou cada uma e quando. Só o `finitemonkey golden accept`, rodado pela pessoa num terminal, escreve nelas.",
    es: "Salidas esperadas de los casos golden, un archivo por caso, más `accepted.jsonl` con quién guardó cada una y cuándo. Solo `finitemonkey golden accept`, ejecutado por la persona en una terminal, las escribe.",
  },
  organize: {
    en: "`finitemonkey organize plan <file>` writes a split plan skeleton for that file, only when the plan does not exist yet: responsibilities with line ranges and the sequence of small steps. The hotspot ranking itself is cached in `.finitemonkey/cache/`.",
    "pt-BR":
      "O `finitemonkey organize plan <file>` grava um esqueleto de plano de divisão para esse arquivo, só quando o plano ainda não existe: responsabilidades com faixas de linhas e a sequência de passos pequenos. O ranking de hotspots fica em cache em `.finitemonkey/cache/`.",
    es: "`finitemonkey organize plan <file>` escribe un esqueleto de plan de división para ese archivo, solo cuando el plan todavía no existe: responsabilidades con rangos de líneas y la secuencia de pasos pequeños. El ranking de hotspots queda en caché en `.finitemonkey/cache/`.",
  },
  "api-contract": {
    en: "Only with `finitemonkey contract --write` or `contract mocks --write`: the endpoint registry, typed client, error envelope and coverage test under `api/`, and the MSW mocks under `mocks/`, in `src/`, `app/` (Remix) or `lib/` (Next without `src/`), generated from `api/contract.yml`. Existing files are never replaced unless the person passes `--overwrite` in a terminal.",
    "pt-BR":
      "Só com `finitemonkey contract --write` ou `contract mocks --write`: o registro de endpoints, o cliente tipado, o envelope de erro e o teste de cobertura em `api/`, e os mocks MSW em `mocks/`, dentro de `src/`, `app/` (Remix) ou `lib/` (Next sem `src/`), gerados a partir de `api/contract.yml`. Arquivos existentes nunca são substituídos, a menos que a pessoa passe `--overwrite` num terminal.",
    es: "Solo con `finitemonkey contract --write` o `contract mocks --write`: el registro de endpoints, el cliente tipado, el envelope de error y el test de cobertura en `api/`, y los mocks MSW en `mocks/`, dentro de `src/`, `app/` (Remix) o `lib/` (Next sin `src/`), generados desde `api/contract.yml`. Los archivos existentes nunca se reemplazan, salvo que la persona pase `--overwrite` en una terminal.",
  },
  "ds-sync": {
    en: "Only with `finitemonkey ds-sync init --write`: a workflow that copies the design system from the prototype repository through an organization GitHub App and keeps one pull request updated. `ds-sync issue --yes`, run by the person or by that workflow, opens or edits issues through `gh`, rewriting only the section between its markers.",
    "pt-BR":
      "Só com `finitemonkey ds-sync init --write`: um workflow que copia o design system do repositório de protótipos por um GitHub App da organização e mantém um pull request atualizado. O `ds-sync issue --yes`, rodado pela pessoa ou por esse workflow, abre ou edita issues pelo `gh`, reescrevendo só a seção entre os marcadores.",
    es: "Solo con `finitemonkey ds-sync init --write`: un workflow que copia el design system desde el repositorio de prototipos mediante un GitHub App de la organización y mantiene un pull request actualizado. `ds-sync issue --yes`, ejecutado por la persona o por ese workflow, abre o edita issues con `gh`, reescribiendo solo la sección entre sus marcadores.",
  },
};
