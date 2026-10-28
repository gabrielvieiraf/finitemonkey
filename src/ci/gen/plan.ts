import type { AbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import { isOn, type ProjectDefaults } from "../../defaults/items.js";
import type { GenFile } from "../../generate/files.js";
import type { Stack } from "../../generate/stack.js";
import { readCache } from "../../github/ruleset.js";
import { DEPENDABOT_FILE, dependabotConfig, updateEcosystems } from "../../supply/update-config.js";
import { toolchain } from "./toolchain.js";
import {
  ciWorkflow,
  deployWorkflow,
  releaseWorkflow,
  reviewWorkflow,
  securityWorkflow,
  type WorkflowInput,
} from "./workflows.js";

export const CI_WORKFLOWS = ["ci", "deploy", "release", "security", "dependabot", "review"] as const;

export type CiWorkflow = (typeof CI_WORKFLOWS)[number];

export const DEFAULT_WORKFLOWS: readonly CiWorkflow[] = ["ci", "security", "dependabot"];

export const WORKFLOW_FILES: Readonly<Record<Exclude<CiWorkflow, "dependabot">, string>> = {
  ci: ".github/workflows/ci.yml",
  deploy: ".github/workflows/deploy.yml",
  release: ".github/workflows/release.yml",
  security: ".github/workflows/security.yml",
  review: ".github/workflows/claude-review.yml",
};

export interface CiGenInput {
  readonly runtime: Pick<Runtime, "readText">;
  readonly root: AbsolutePath;
  readonly stack: Stack;
  readonly files: readonly string[];
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string | undefined;
  readonly defaults: ProjectDefaults;
  readonly version: string;
  readonly defaultBranch: string;
  readonly oidc: boolean;
}

const runner = (input: CiGenInput): string => {
  if (!input.stack.dependencies.has("finitemonkey")) return `npx --yes finitemonkey@${input.version}`;
  return input.stack.packageManager === "pnpm" ? "pnpm exec finitemonkey" : "npx finitemonkey";
};

const DEPLOY_SCRIPTS = ["scripts/deploy.sh", "deploy.sh"] as const;
const BUILD_DIRS = ["dist", "build", "out"] as const;

const releaseArtifacts = (input: CiGenInput): string => {
  const dir = BUILD_DIRS.find((name) => input.exists(name));
  if (dir !== undefined) return `${dir}/**`;
  return input.stack.scripts.has("build") ? "dist/**" : "sbom.spdx.json";
};

const dependabot = (input: CiGenInput): string => {
  const ecosystems = updateEcosystems(input.files);
  const actions = ecosystems.some((entry) => entry.ecosystem === "github-actions")
    ? ecosystems
    : [...ecosystems, { ecosystem: "github-actions", directories: ["/"] }];
  return dependabotConfig(actions);
};

export const ciFiles = (input: CiGenInput, chosen: ReadonlySet<CiWorkflow>): readonly GenFile[] => {
  const workflow: WorkflowInput = {
    tools: toolchain(input),
    finitemonkey: runner(input),
    mergeQueue: readCache(input.runtime, input.root)?.mergeQueue === true,
    defaultBranch: input.defaultBranch,
    attribution: isOn(input.defaults, "no-attribution"),
    oidc: input.oidc,
  };
  const deployCommand = DEPLOY_SCRIPTS.find(input.exists);
  const texts: Readonly<Record<CiWorkflow, () => string>> = {
    ci: () => ciWorkflow(workflow),
    deploy: () => deployWorkflow(workflow, deployCommand === undefined ? undefined : `./${deployCommand}`),
    release: () => releaseWorkflow(workflow, releaseArtifacts(input)),
    security: () => securityWorkflow(workflow),
    dependabot: () => dependabot(input),
    review: () => reviewWorkflow(),
  };
  return CI_WORKFLOWS.filter((name) => chosen.has(name)).map((name) => ({
    path: name === "dependabot" ? DEPENDABOT_FILE : WORKFLOW_FILES[name],
    text: texts[name](),
  }));
};
