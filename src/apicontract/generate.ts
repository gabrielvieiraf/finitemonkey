import { posix } from "node:path";

import type { GeneratedFile } from "../generate/plan.js";
import type { Project } from "./framework.js";
import type { ApiRegistry } from "./registry.js";
import { CLIENT_FILE, errorsFile, registryFile, VALIDATE_FILE } from "./templates-api.js";
import {
  BROWSER_FILE,
  domainHandlersFile,
  domainsOf,
  handlersIndexFile,
  RESPOND_FILE,
  SEED_FILE,
  STORE_FILE,
} from "./templates-mocks.js";
import { coverageTestFile } from "./templates-test.js";

export const contractFiles = (registry: ApiRegistry, project: Project): readonly GeneratedFile[] => {
  const at = (path: string): string => posix.join(project.base, path);
  return [
    { path: at("api/registry.ts"), content: registryFile(registry) },
    { path: at("api/errors.ts"), content: errorsFile(registry) },
    { path: at("api/validate.ts"), content: VALIDATE_FILE },
    { path: at("api/client.ts"), content: CLIENT_FILE },
    { path: at("api/contract-coverage.test.ts"), content: coverageTestFile(project.runner) },
  ];
};

export const mockFiles = (registry: ApiRegistry, project: Project): readonly GeneratedFile[] => {
  const at = (path: string): string => posix.join(project.base, path);
  return [
    { path: at("mocks/seed.ts"), content: SEED_FILE },
    { path: at("mocks/store.ts"), content: STORE_FILE },
    { path: at("mocks/respond.ts"), content: RESPOND_FILE },
    ...domainsOf(registry).map((domain) => ({
      path: at(`mocks/handlers/${domain}.ts`),
      content: domainHandlersFile(registry, domain),
    })),
    { path: at("mocks/handlers/index.ts"), content: handlersIndexFile(registry) },
    { path: at("mocks/browser.ts"), content: BROWSER_FILE },
  ];
};

export const MOCK_DIRS = ["src/mocks", "app/mocks", "lib/mocks"] as const;
