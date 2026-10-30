import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stringifyYaml } from "../src/core/yaml/write.js";
import { scoreOf } from "../src/perfil/types.js";
import { PERFIL_DOMAINS, type PerfilDomain, type Persona } from "./bench-family.js";

export const selfReportYaml = (persona: Pick<Persona, "selfReport">, at: string): string =>
  stringifyYaml({
    schema: "finitemonkey/perfil@1",
    updated_at: at,
    quick_start: "done",
    domains: Object.fromEntries(
      PERFIL_DOMAINS.map((domain: PerfilDomain) => {
        const claimed = persona.selfReport[domain];
        return [
          domain,
          claimed === undefined ? { tool: 50, knowledge: 50 } : { tool: 50, knowledge: scoreOf(claimed), claimed },
        ];
      }),
    ),
  });

export const writeSelfReport = (persona: Pick<Persona, "selfReport">, workdir: string, at: string): boolean => {
  if (Object.keys(persona.selfReport).length === 0) return false;
  const file = join(workdir, ".finitemonkey", "perfil.yml");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, selfReportYaml(persona, at));
  return true;
};
