import type { YamlValue } from "../core/yaml/scalar.js";
import type { AcceptanceCheck, TaskContract } from "./types.js";

const checkYaml = (check: AcceptanceCheck): YamlValue => ({
  id: check.id,
  check: check.kind,
  ...(check.run === undefined ? {} : { run: check.run }),
  ...(check.timeoutS === undefined ? {} : { timeout_s: check.timeoutS }),
  ...(check.require === undefined ? {} : { require: [...check.require] }),
  ...(check.requireOpen === undefined ? {} : { require_open: check.requireOpen }),
  ...(check.description === undefined ? {} : { description: check.description }),
  ...(check.port === undefined ? {} : { port: check.port }),
  ...(check.route === undefined ? {} : { route: check.route }),
  ...(check.status === undefined ? {} : { status: check.status }),
  ...(check.body === undefined ? {} : { body: check.body }),
  ...(check.versionUrl === undefined ? {} : { version_url: check.versionUrl }),
  ...(check.field === undefined ? {} : { field: check.field }),
  ...(check.cases === undefined ? {} : { cases: check.cases }),
  ...(check.tolerance === undefined ? {} : { tolerance: check.tolerance }),
  ...(check.minScore === undefined ? {} : { min_score: check.minScore }),
});

export const contractYaml = (contract: TaskContract): YamlValue => ({
  id: contract.id,
  goal: contract.goal,
  size: contract.size,
  ...(contract.base === undefined ? {} : { base: contract.base }),
  scope: {
    paths: [...contract.scope.paths],
    ...(contract.scope.diffBudget === undefined ? {} : { diff_budget: { ...contract.scope.diffBudget } }),
    tests_protected: contract.scope.testsProtected,
  },
  acceptance: contract.acceptance.map(checkYaml),
  decisions_needed: [...contract.decisionsNeeded],
  ...(contract.callersIgnore === undefined ? {} : { callers_ignore: [...contract.callersIgnore] }),
  ...(contract.shortcuts === undefined ? {} : { shortcuts: contract.shortcuts.map((item) => ({ ...item })) }),
  ...(contract.blueprint === undefined ? {} : { blueprint: contract.blueprint }),
  ...(contract.clarified === undefined ? {} : { clarified: [...contract.clarified] }),
  ...(contract.testsFirst === true ? { tests_first: true } : {}),
});

export const contractJson = (contract: TaskContract): Readonly<Record<string, unknown>> => ({
  id: contract.id,
  goal: contract.goal,
  size: contract.size,
  base: contract.base ?? null,
  implicit: contract.implicit,
  scope: {
    paths: contract.scope.paths,
    diffBudget: contract.scope.diffBudget ?? null,
    testsProtected: contract.scope.testsProtected,
  },
  acceptance: contract.acceptance.map((check) => ({ ...check })),
  decisionsNeeded: contract.decisionsNeeded,
  ...(contract.shortcuts === undefined ? {} : { shortcuts: contract.shortcuts }),
  blueprint: contract.blueprint ?? null,
  ...(contract.clarified === undefined ? {} : { clarified: contract.clarified }),
});
