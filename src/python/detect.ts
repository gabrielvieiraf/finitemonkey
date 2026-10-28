import type { AcceptanceCheck } from "../task/types.js";

export const PYTHON_FEATURE = "python-preset";

export type PythonManager = "uv" | "pip";

export interface PythonProject {
  readonly manager: PythonManager;
  readonly ruffConfigured: boolean;
  readonly pytestConfigured: boolean;
  readonly sections: ReadonlySet<string>;
}

const SECTION = /^\[tool\.([\w.-]+)/gm;

export const pyprojectSections = (text: string | undefined): ReadonlySet<string> =>
  new Set([...(text ?? "").matchAll(SECTION)].map((match) => match[1] ?? ""));

export const isPythonProject = (exists: (relative: string) => boolean): boolean =>
  ["pyproject.toml", "uv.lock", "requirements.txt", "setup.py", "setup.cfg"].some(exists);

export const detectPython = (
  read: (relative: string) => string | undefined,
  exists: (relative: string) => boolean,
): PythonProject | undefined => {
  if (!isPythonProject(exists)) return undefined;
  const sections = pyprojectSections(read("pyproject.toml"));
  return {
    manager: exists("uv.lock") ? "uv" : "pip",
    ruffConfigured:
      exists("ruff.toml") || exists(".ruff.toml") || [...sections].some((name) => name.startsWith("ruff")),
    pytestConfigured: exists("pytest.ini") || sections.has("pytest.ini_options"),
    sections,
  };
};

export const PIP_DEFAULT: PythonProject = {
  manager: "pip",
  ruffConfigured: false,
  pytestConfigured: true,
  sections: new Set(),
};

export const pythonChecks = (project: PythonProject): readonly AcceptanceCheck[] => {
  const run = project.manager === "uv" ? "uv run " : "python -m ";
  return [
    ...(project.ruffConfigured ? [{ id: "lint", kind: "command" as const, run: `${run}ruff check .` }] : []),
    { id: "test", kind: "tests" as const, run: `${run}pytest -q` },
  ];
};
